/**
 * ModLoader - Loads and initializes mods from the mods/ directory
 * 
 * Each mod is a subdirectory of mods/ containing:
 * - mod.js: Main entry point that exports a register(scope) function
 * - prompts/ (optional): Custom prompt templates
 * - public/ (optional): Client-side assets (JS, CSS, images)
 */

const fs = require('fs');
const path = require('path');

class ModLoader {
    constructor(baseDir) {
        this.baseDir = baseDir;
        this.modsDir = path.join(baseDir, 'mods');
        this.loadedMods = new Map();
        this.modPromptEnvs = new Map();
    }

    /**
     * Get list of valid mod directories
     * @returns {string[]} Array of mod directory names
     */
    getModDirectories() {
        if (!fs.existsSync(this.modsDir)) {
            return [];
        }

        const entries = fs.readdirSync(this.modsDir, { withFileTypes: true });
        const modDirs = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            // Skip hidden directories and common non-mod directories
            if (entry.name.startsWith('.') || entry.name === 'node_modules') {
                continue;
            }

            const modJsPath = path.join(this.modsDir, entry.name, 'mod.js');
            if (fs.existsSync(modJsPath)) {
                modDirs.push(entry.name);
            }
        }

        return modDirs;
    }

    /**
     * Load all mods and register them with the provided scope
     * @param {Object} scope - The apiScope object from server.js
     * @returns {Object} Summary of loaded mods
     */
    loadMods(scope) {
        const modDirs = this.getModDirectories();
        const results = {
            loaded: [],
            failed: [],
            total: modDirs.length
        };

        if (modDirs.length === 0) {
            console.log('🔌 No mods found in mods/ directory');
            return results;
        }

        console.log(`🔌 Found ${modDirs.length} mod(s) to load...`);

        for (const modName of modDirs) {
            try {
                this.loadMod(modName, scope);
                results.loaded.push(modName);
                console.log(`   ✅ Loaded mod: ${modName}`);
            } catch (error) {
                results.failed.push({ name: modName, error: error.message });
                console.error(`   ❌ Failed to load mod "${modName}":`, error.message);
            }
        }

        if (results.loaded.length > 0) {
            console.log(`🔌 Successfully loaded ${results.loaded.length} mod(s)`);
        }

        return results;
    }

    /**
     * Load a single mod
     * @param {string} modName - Name of the mod directory
     * @param {Object} scope - The apiScope object
     */
    loadMod(modName, scope) {
        const modDir = path.join(this.modsDir, modName);
        const modJsPath = path.join(modDir, 'mod.js');

        if (!fs.existsSync(modJsPath)) {
            throw new Error(`mod.js not found in ${modDir}`);
        }

        // Clear require cache to allow hot reloading in development
        delete require.cache[require.resolve(modJsPath)];

        const mod = require(modJsPath);

        if (typeof mod.register !== 'function') {
            throw new Error(`mod.js must export a register(scope) function`);
        }

        // Create a mod-specific scope with additional helpers
        const modScope = this.createModScope(modName, modDir, scope);

        // Call the mod's register function
        mod.register(modScope);

        // Store mod info
        this.loadedMods.set(modName, {
            name: modName,
            dir: modDir,
            mod: mod,
            meta: mod.meta || {}
        });
    }

    /**
     * Create a scope object for a specific mod
     * @param {string} modName - Name of the mod
     * @param {string} modDir - Path to mod directory
     * @param {Object} scope - The base apiScope
     * @returns {Object} Extended scope for the mod
     */
    createModScope(modName, modDir, scope) {
        const nunjucks = scope.nunjucks;

        // Create a Nunjucks environment for this mod's prompts
        const modPromptsDir = path.join(modDir, 'prompts');
        let modPromptEnv = null;

        if (fs.existsSync(modPromptsDir) && nunjucks) {
            modPromptEnv = nunjucks.configure(modPromptsDir, {
                autoescape: false
            });
            this.modPromptEnvs.set(modName, modPromptEnv);
        }

        const modScope = Object.create(scope);
        
        Object.assign(modScope, {
            // Mod-specific properties
            modName,
            modDir,
            modPromptsDir,
            modPromptEnv,
            modPublicDir: path.join(modDir, 'public'),

            // Helper to get mod's public URL path
            getModPublicUrl: (filePath = '') => {
                const normalized = filePath.startsWith('/') ? filePath.slice(1) : filePath;
                return `/mods/${modName}/${normalized}`;
            },

            // Helper to render a mod prompt template
            renderModPrompt: (templateName, context = {}) => {
                if (!modPromptEnv) {
                    throw new Error(`Mod "${modName}" has no prompts directory`);
                }
                return modPromptEnv.render(templateName, context);
            },

            // Helper to register a mod API route with namespaced path
            registerModRoute: (method, path, handler) => {
                const fullPath = `/api/mods/${modName}${path.startsWith('/') ? path : '/' + path}`;
                const app = scope.app;

                switch (method.toLowerCase()) {
                    case 'get':
                        app.get(fullPath, handler);
                        break;
                    case 'post':
                        app.post(fullPath, handler);
                        break;
                    case 'put':
                        app.put(fullPath, handler);
                        break;
                    case 'delete':
                        app.delete(fullPath, handler);
                        break;
                    case 'patch':
                        app.patch(fullPath, handler);
                        break;
                    default:
                        throw new Error(`Unsupported HTTP method: ${method}`);
                }

                console.log(`      📡 Registered route: ${method.toUpperCase()} ${fullPath}`);
                return fullPath;
            },

            // Reference to the mod loader for inter-mod communication
            modLoader: this,

            // Mod configuration
            modConfig: this.getModConfig(modName)
        });

        return modScope;
    }

    /**
     * Get configuration for a specific mod
     * @param {string} modName 
     */
    getModConfig(modName) {
        const modInfo = this.loadedMods.get(modName);
        if (!modInfo) return {};

        const configPath = path.join(modInfo.dir, 'config.json');
        let config = {};

        // Load saved config if exists
        if (fs.existsSync(configPath)) {
            try {
                config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            } catch (e) {
                console.warn(`Failed to load config for mod ${modName}:`, e.message);
            }
        }

        // Apply defaults from schema if available
        if (modInfo.mod.configSchema) {
            for (const [key, schema] of Object.entries(modInfo.mod.configSchema)) {
                if (config[key] === undefined && schema.default !== undefined) {
                    config[key] = schema.default;
                }
            }
        }

        return config;
    }

    /**
     * Get configurations and schemas for all loaded mods
     * @returns {Array} Array of { name, schema, config }
     */
    getModConfigs() {
        const configs = [];
        for (const [modName, modInfo] of this.loadedMods) {
            if (modInfo.mod.configSchema) {
                configs.push({
                    name: modName,
                    displayName: modInfo.meta?.name || modName,
                    schema: modInfo.mod.configSchema,
                    config: this.getModConfig(modName)
                });
            }
        }
        return configs;
    }

    /**
     * Save configuration for a mod
     * @param {string} modName 
     * @param {Object} newConfig 
     */
    saveModConfig(modName, newConfig) {
        const modInfo = this.loadedMods.get(modName);
        if (!modInfo) {
            throw new Error(`Mod ${modName} not found`);
        }
        const configPath = path.join(modInfo.dir, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');

    }

    /**
     * Setup static file serving for mod public directories
     * @param {Object} app - Express app
     * @param {Object} express - Express module
     */
    setupStaticServing(app, express) {
        const modDirs = this.getModDirectories();

        for (const modName of modDirs) {
            const publicDir = path.join(this.modsDir, modName, 'public');
            if (fs.existsSync(publicDir)) {
                const urlPath = `/mods/${modName}`;
                app.use(urlPath, express.static(publicDir));
                console.log(`   📁 Serving static files: ${urlPath} -> ${publicDir}`);
            }
        }
    }

    /**
     * Get client-side script paths for all mods that have public JS
     * @returns {Array} Array of {modName, scripts} objects
     */
    getModClientScripts() {
        const scripts = [];

        for (const [modName, modInfo] of this.loadedMods) {
            const jsDir = path.join(modInfo.dir, 'public', 'js');
            if (!fs.existsSync(jsDir)) {
                continue;
            }

            const jsFiles = fs.readdirSync(jsDir)
                .filter(f => f.endsWith('.js'))
                .map(f => `/mods/${modName}/js/${f}`);

            if (jsFiles.length > 0) {
                scripts.push({
                    modName,
                    scripts: jsFiles
                });
            }
        }

        return scripts;
    }

    /**
     * Get client-side stylesheet paths for all mods that have public CSS
     * @returns {Array} Array of {modName, styles} objects
     */
    getModClientStyles() {
        const styles = [];

        for (const [modName, modInfo] of this.loadedMods) {
            const cssDir = path.join(modInfo.dir, 'public', 'css');
            if (!fs.existsSync(cssDir)) {
                continue;
            }

            const cssFiles = fs.readdirSync(cssDir)
                .filter(f => f.endsWith('.css'))
                .map(f => `/mods/${modName}/css/${f}`);

            if (cssFiles.length > 0) {
                styles.push({
                    modName,
                    styles: cssFiles
                });
            }
        }

        return styles;
    }
}

module.exports = ModLoader;
