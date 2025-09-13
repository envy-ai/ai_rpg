const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

class Player {
    constructor(options = {}) {
        // Load attribute definitions first
        this.definitions = this.loadDefinitions();
        
        // Initialize attributes dynamically from definitions
        this.attributes = {};
        this.initializeAttributes(options.attributes || {});
        
        // Base stats (not attributes)
        this.level = options.level || 1;
        this.health = options.health || this.calculateBaseHealth();
        this.maxHealth = this.health;
        
        // Player identification
        this.name = options.name || "Unnamed Player";
        this.id = options.id || this.generateId();
        
        // Creation timestamp
        this.createdAt = new Date().toISOString();
        this.lastUpdated = this.createdAt;
    }
    
    /**
     * Load complete definitions from YAML file
     */
    loadDefinitions() {
        try {
            const defsPath = path.join(__dirname, 'defs', 'attributes.yaml');
            const fileContents = fs.readFileSync(defsPath, 'utf8');
            const data = yaml.load(fileContents);
            return data;
        } catch (error) {
            console.error('Error loading attribute definitions:', error.message);
            // Fallback to basic definitions
            return {
                attributes: {
                    strength: { label: 'Strength', default: 10, min: 3, max: 18 },
                    dexterity: { label: 'Dexterity', default: 10, min: 3, max: 18 },
                    constitution: { label: 'Constitution', default: 10, min: 3, max: 18 },
                    intelligence: { label: 'Intelligence', default: 10, min: 3, max: 18 },
                    wisdom: { label: 'Wisdom', default: 10, min: 3, max: 18 },
                    charisma: { label: 'Charisma', default: 10, min: 3, max: 18 }
                },
                system: {
                    modifierFormula: "floor((value - 10) / 2)",
                    validationRules: { enforceMinMax: true }
                }
            };
        }
    }
    
    /**
     * Get attribute definitions only
     */
    get attributeDefinitions() {
        return this.definitions.attributes || {};
    }
    
    /**
     * Get system configuration
     */
    get systemConfig() {
        return this.definitions.system || {};
    }
    
    /**
     * Initialize attributes dynamically from definitions
     */
    initializeAttributes(providedAttributes = {}) {
        for (const [attrName, attrDef] of Object.entries(this.attributeDefinitions)) {
            // Use provided value, or default from definition, or fallback to 10
            this.attributes[attrName] = providedAttributes[attrName] || attrDef.default || 10;
        }
    }
    
    /**
     * Get list of all attribute names
     */
    getAttributeNames() {
        return Object.keys(this.attributeDefinitions);
    }
    
    /**
     * Get attribute definition by name
     */
    getAttributeDefinition(attributeName) {
        return this.attributeDefinitions[attributeName] || null;
    }
    
    /**
     * Validate attribute value against definition
     */
    validateAttributeValue(attributeName, value) {
        const definition = this.getAttributeDefinition(attributeName);
        if (!definition) {
            throw new Error(`Unknown attribute: ${attributeName}`);
        }
        
        if (typeof value !== 'number') {
            throw new Error(`Attribute value must be a number, got ${typeof value}`);
        }
        
        const config = this.systemConfig.validationRules || {};
        if (config.enforceMinMax) {
            const min = definition.min || 1;
            const max = definition.max || 20;
            
            if (value < min || value > max) {
                throw new Error(`${definition.label} must be between ${min} and ${max}, got ${value}`);
            }
        }
        
        return true;
    }
    
    /**
     * Calculate base health based on constitution and level
     */
    calculateBaseHealth() {
        const constitutionModifier = this.getAttributeModifier('constitution');
        return 10 + constitutionModifier + (this.level - 1) * (6 + constitutionModifier);
    }
    
    /**
     * Calculate attribute modifier using formula from definitions
     */
    getAttributeModifier(attributeName) {
        const attributeValue = this.attributes[attributeName];
        if (attributeValue === undefined) {
            console.warn(`Unknown attribute: ${attributeName}`);
            return 0;
        }
        
        // Use formula from system config, fallback to standard D&D formula
        const formula = this.systemConfig.modifierFormula || "floor((value - 10) / 2)";
        
        // Simple formula evaluation (could be enhanced with a proper expression parser)
        if (formula === "floor((value - 10) / 2)") {
            return Math.floor((attributeValue - 10) / 2);
        }
        
        // Fallback calculation
        return Math.floor((attributeValue - 10) / 2);
    }
    
    /**
     * Get a formatted object of all attribute modifiers
     */
    getAttributeModifiers() {
        const modifiers = {};
        for (const attrName of this.getAttributeNames()) {
            modifiers[attrName] = this.getAttributeModifier(attrName);
        }
        return modifiers;
    }
    
    /**
     * Set an attribute value with validation from definitions
     */
    setAttribute(attributeName, value) {
        // Validate using definition
        this.validateAttributeValue(attributeName, value);
        
        const oldValue = this.attributes[attributeName];
        this.attributes[attributeName] = value;
        this.lastUpdated = new Date().toISOString();
        
        // Check if this attribute affects health (specifically constitution)
        const definition = this.getAttributeDefinition(attributeName);
        if (definition && definition.affects && definition.affects.includes('health')) {
            this.recalculateHealth();
        }
        
        return {
            attribute: attributeName,
            oldValue,
            newValue: value,
            modifier: this.getAttributeModifier(attributeName)
        };
    }
    
    /**
     * Recalculate max health and adjust current health proportionally
     */
    recalculateHealth() {
        const oldMaxHealth = this.maxHealth;
        this.maxHealth = this.calculateBaseHealth();
        
        if (oldMaxHealth > 0) {
            // Maintain health ratio
            const healthRatio = this.health / oldMaxHealth;
            this.health = Math.ceil(this.maxHealth * healthRatio);
        } else {
            this.health = this.maxHealth;
        }
    }
    
    /**
     * Get all attribute information including definitions
     */
    getAttributeInfo() {
        const info = {};
        for (const [attrName, definition] of Object.entries(this.attributeDefinitions)) {
            info[attrName] = {
                ...definition,
                value: this.attributes[attrName],
                modifier: this.getAttributeModifier(attrName)
            };
        }
        return info;
    }
    
    /**
     * Level up the player
     */
    levelUp() {
        this.level += 1;
        const oldMaxHealth = this.maxHealth;
        this.maxHealth = this.calculateBaseHealth();
        
        // Add the health increase to current health
        this.health += (this.maxHealth - oldMaxHealth);
        this.lastUpdated = new Date().toISOString();
    }
    
    /**
     * Modify health (damage or healing)
     */
    modifyHealth(amount, reason = '') {
        const oldHealth = this.health;
        this.health = Math.max(0, Math.min(this.maxHealth, this.health + amount));
        this.lastUpdated = new Date().toISOString();
        
        return {
            oldHealth,
            newHealth: this.health,
            change: this.health - oldHealth,
            reason
        };
    }
    
    /**
     * Check if player is alive
     */
    isAlive() {
        return this.health > 0;
    }
    
    /**
     * Get player's current status with enhanced attribute information
     */
    getStatus() {
        return {
            name: this.name,
            level: this.level,
            health: this.health,
            maxHealth: this.maxHealth,
            alive: this.isAlive(),
            attributes: { ...this.attributes },
            modifiers: this.getAttributeModifiers(),
            attributeInfo: this.getAttributeInfo()
        };
    }
    
    /**
     * Export player data for saving
     */
    toJSON() {
        return {
            id: this.id,
            name: this.name,
            level: this.level,
            health: this.health,
            maxHealth: this.maxHealth,
            attributes: this.attributes,
            createdAt: this.createdAt,
            lastUpdated: this.lastUpdated
        };
    }
    
    /**
     * Create player from saved data
     */
    static fromJSON(data) {
        const player = new Player({
            name: data.name,
            level: data.level,
            health: data.health,
            attributes: data.attributes,
            id: data.id
        });
        player.maxHealth = data.maxHealth;
        player.createdAt = data.createdAt;
        player.lastUpdated = data.lastUpdated;
        return player;
    }
    
    /**
     * Get available attribute generation methods from definitions
     */
    getGenerationMethods() {
        return this.systemConfig.generationMethods || {};
    }
    
    /**
     * Generate attributes using a specific method
     */
    generateAttributes(method = 'standard', diceModule = null) {
        const methods = this.getGenerationMethods();
        const generationMethod = methods[method];
        
        if (!generationMethod) {
            throw new Error(`Unknown generation method: ${method}`);
        }
        
        const attrNames = this.getAttributeNames();
        const newAttributes = {};
        
        switch (method) {
            case 'standard':
                // Assign standard array values randomly
                const values = [...generationMethod.values];
                for (const attrName of attrNames) {
                    if (values.length === 0) break;
                    const randomIndex = Math.floor(Math.random() * values.length);
                    newAttributes[attrName] = values.splice(randomIndex, 1)[0];
                }
                break;
                
            case 'rolled':
                // Roll dice for each attribute
                if (!diceModule) {
                    throw new Error('Dice module required for rolled generation');
                }
                for (const attrName of attrNames) {
                    newAttributes[attrName] = diceModule.rollDice(generationMethod.method).total;
                }
                break;
                
            case 'pointBuy':
                // Start with base values (point buy would need a UI)
                for (const attrName of attrNames) {
                    newAttributes[attrName] = generationMethod.baseValue;
                }
                break;
                
            default:
                throw new Error(`Generation method '${method}' not implemented`);
        }
        
        // Apply the generated attributes
        for (const [attrName, value] of Object.entries(newAttributes)) {
            if (this.attributes.hasOwnProperty(attrName)) {
                this.setAttribute(attrName, value);
            }
        }
        
        return newAttributes;
    }
    
    /**
     * Generate a unique ID for the player
     */
    generateId() {
        return 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    /**
     * Get a summary string of the player
     */
    toString() {
        const statusEmoji = this.isAlive() ? '🟢' : '💀';
        
        // Build attribute string using abbreviations if available
        const attrs = this.getAttributeNames()
            .map(name => {
                const def = this.getAttributeDefinition(name);
                const abbrev = def.abbreviation || name.charAt(0).toUpperCase();
                return `${abbrev}:${this.attributes[name]}`;
            })
            .join(' ');
        
        return `${statusEmoji} ${this.name} (Lvl ${this.level}) HP:${this.health}/${this.maxHealth} [${attrs}]`;
    }
}

module.exports = Player;
