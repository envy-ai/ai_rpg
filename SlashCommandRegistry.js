const fs = require('fs');
const path = require('path');

const registry = new Map();
let initialized = false;
let commandsDirectory = path.join(__dirname, 'slashcommands');

function warnWithStack(message, error = null) {
    console.warn(message);
    if (error && error.stack) {
        console.warn(error.stack);
    } else {
        console.trace();
    }
}

function normalizeName(name) {
    return (typeof name === 'string' ? name.trim().toLowerCase() : '');
}

function registerName(label, commandModule, sourceFile, { isAlias = false } = {}) {
    const normalized = normalizeName(label);
    if (!normalized) {
        warnWithStack(`Invalid ${isAlias ? 'alias' : 'command name'} "${label}" in ${sourceFile}`, new Error('Invalid slash command label'));
        return;
    }

    const existing = registry.get(normalized);
    if (existing && existing.module !== commandModule) {
        warnWithStack(`Duplicate slash command registration for "${label}" from ${sourceFile}`, new Error('Duplicate slash command label'));
        return;
    }

    if (!existing) {
        registry.set(normalized, {
            module: commandModule,
            canonicalName: commandModule?.name || normalized,
            source: sourceFile,
            isAlias
        });
    }
}

function readAliases(commandModule, sourceFile) {
    try {
        const aliases = commandModule?.aliases;
        if (!aliases) {
            return [];
        }
        if (!Array.isArray(aliases)) {
            warnWithStack(`Aliases for slash command in ${sourceFile} must be an array`, new Error('Invalid aliases definition'));
            return [];
        }
        return aliases
            .map(alias => (typeof alias === 'string' ? alias.trim() : ''))
            .filter(Boolean);
    } catch (error) {
        warnWithStack(`Failed to read aliases for slash command in ${sourceFile}`, error);
        return [];
    }
}

function loadCommandModule(filePath) {
    try {
        // Use cached module; assume commands are static during runtime.
        return require(filePath);
    } catch (error) {
        warnWithStack(`Failed to load slash command module at ${filePath}`, error);
        return null;
    }
}

function initializeSlashCommands(directory = commandsDirectory) {
    commandsDirectory = directory;
    registry.clear();

    let entries = [];
    try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
        warnWithStack(`Failed to enumerate slash command directory at ${directory}`, error);
        initialized = false;
        return registry;
    }

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.js')) {
            continue;
        }

        const filePath = path.join(directory, entry.name);
        const commandModule = loadCommandModule(filePath);
        if (!commandModule) {
            continue;
        }

        let commandName;
        try {
            commandName = commandModule.name;
        } catch (error) {
            warnWithStack(`Slash command module at ${filePath} does not provide a static name`, error);
            continue;
        }

        if (typeof commandName !== 'string' || !commandName.trim()) {
            warnWithStack(`Slash command module at ${filePath} has an invalid name`, new Error('Invalid slash command name'));
            continue;
        }

        if (typeof commandModule.execute !== 'function') {
            warnWithStack(`Slash command "${commandName}" at ${filePath} is missing an execute function`, new Error('Missing execute handler'));
            continue;
        }

        registerName(commandName, commandModule, filePath, { isAlias: false });

        const aliases = readAliases(commandModule, filePath);
        for (const alias of aliases) {
            registerName(alias, commandModule, filePath, { isAlias: true });
        }
    }

    initialized = true;
    return registry;
}

function ensureInitialized() {
    if (!initialized) {
        initializeSlashCommands(commandsDirectory);
    }
}

function getSlashCommandModule(name) {
    ensureInitialized();
    const normalized = normalizeName(name);
    if (!normalized) {
        return null;
    }
    const entry = registry.get(normalized);
    return entry ? entry.module : null;
}

function getRegisteredSlashCommands() {
    ensureInitialized();
    return Array.from(registry.entries()).map(([key, value]) => ({
        name: key,
        module: value.module,
        canonicalName: value.canonicalName,
        source: value.source,
        isAlias: value.isAlias
    }));
}

module.exports = {
    initializeSlashCommands,
    getSlashCommandModule,
    getRegisteredSlashCommands
};
