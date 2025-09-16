const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const Location = require('./Location.js');

class Player {
    // Private fields using ES13 syntax
    #definitions;
    #attributes = {};
    #level;
    #health;
    #maxHealth;
    #name;
    #description;
    #shortDescription;
    #id;
    #currentLocation;
    #imageId;
    #createdAt;
    #lastUpdated;
    #isNPC;

    // Static private method for ID generation
    static #generateUniqueId() {
        return `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    constructor(options = {}) {
        // Load definitions first
        this.#definitions = this.#loadDefinitions();

        // Initialize attributes dynamically from definitions
        this.#initializeAttributes(options.attributes ?? {});

        // Base stats (not attributes)
        this.#level = options.level ?? 1;
        this.#health = options.health ?? this.#calculateBaseHealth();
        this.#maxHealth = this.#health;

        // Player identification
        this.#name = options.name ?? "Unnamed Player";
        this.#description = options.description ?? "A mysterious adventurer with an unknown past.";
        this.#shortDescription = options.shortDescription ?? "";
        this.#id = options.id ?? Player.#generateUniqueId();

        // Location (can be Location ID string or Location object)
        this.#currentLocation = options.location ?? null;

        // Player image ID for generated portrait
        this.#imageId = options.imageId ?? null;
        this.#isNPC = Boolean(options.isNPC);

        // Creation timestamp
        this.#createdAt = new Date().toISOString();
        this.#lastUpdated = this.#createdAt;
    }

    /**
     * Load complete definitions from YAML file (private method)
     */
    #loadDefinitions() {
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
     * Initialize attributes dynamically from definitions (private method)
     */
    #initializeAttributes(providedAttributes = {}) {
        for (const [attrName, attrDef] of Object.entries(this.attributeDefinitions)) {
            // Use provided value, or default from definition, or fallback to 10
            this.#attributes[attrName] = providedAttributes[attrName] ?? attrDef.default ?? 10;
        }
    }

    /**
     * Calculate base health based on constitution and level (private method)
     */
    #calculateBaseHealth() {
        const constitutionModifier = this.getAttributeModifier('constitution');
        return 10 + constitutionModifier + (this.#level - 1) * (6 + constitutionModifier);
    }

    /**
     * Validate attribute value against definition (private method)
     */
    #validateAttributeValue(attributeName, value) {
        const definition = this.getAttributeDefinition(attributeName);
        if (!definition) {
            throw new Error(`Unknown attribute: ${attributeName}`);
        }

        if (typeof value !== 'number') {
            throw new Error(`Attribute value must be a number, got ${typeof value}`);
        }

        const config = this.systemConfig.validationRules ?? {};
        if (config.enforceMinMax) {
            const min = definition.min ?? 1;
            const max = definition.max ?? 20;

            if (value < min || value > max) {
                throw new Error(`${definition.label} must be between ${min} and ${max}, got ${value}`);
            }
        }

        return true;
    }

    /**
     * Recalculate max health and adjust current health proportionally (private method)
     */
    #recalculateHealth() {
        const oldMaxHealth = this.#maxHealth;
        this.#maxHealth = this.#calculateBaseHealth();

        if (oldMaxHealth > 0) {
            // Maintain health ratio
            const healthRatio = this.#health / oldMaxHealth;
            this.#health = Math.ceil(this.#maxHealth * healthRatio);
        } else {
            this.#health = this.#maxHealth;
        }
    }

    // Public getters for private fields
    get attributeDefinitions() {
        return this.#definitions.attributes ?? {};
    }

    get systemConfig() {
        return this.#definitions.system ?? {};
    }

    get attributes() {
        return { ...this.#attributes }; // Return copy to prevent mutation
    }

    get level() {
        return this.#level;
    }

    get health() {
        return this.#health;
    }

    get maxHealth() {
        return this.#maxHealth;
    }

    get name() {
        return this.#name;
    }

    get description() {
        return this.#description;
    }

    get shortDescription() {
        return this.#shortDescription;
    }

    set description(newDescription) {
        if (typeof newDescription !== 'string') {
            throw new Error('Description must be a string');
        }
        this.#description = newDescription.trim();
        this.#lastUpdated = new Date().toISOString();
    }

    set shortDescription(newShortDescription) {
        if (typeof newShortDescription !== 'string') {
            throw new Error('Short description must be a string');
        }
        this.#shortDescription = newShortDescription.trim();
        this.#lastUpdated = new Date().toISOString();
    }

    get imageId() {
        return this.#imageId;
    }

    set imageId(newImageId) {
        if (newImageId !== null && typeof newImageId !== 'string') {
            throw new Error('Image ID must be a string or null');
        }
        this.#imageId = newImageId;
        this.#lastUpdated = new Date().toISOString();
    }

    get id() {
        return this.#id;
    }

    get currentLocation() {
        return this.#currentLocation;
    }

    get isNPC() {
        return this.#isNPC;
    }

    get createdAt() {
        return this.#createdAt;
    }

    get lastUpdated() {
        return this.#lastUpdated;
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
        return this.attributeDefinitions[attributeName] ?? null;
    }

    /**
     * Calculate attribute modifier using formula from definitions
     */
    getAttributeModifier(attributeName) {
        const attributeValue = this.#attributes[attributeName];
        if (attributeValue === undefined) {
            console.warn(`Unknown attribute: ${attributeName}`);
            return 0;
        }

        // Use formula from system config, fallback to standard D&D formula
        const formula = this.systemConfig.modifierFormula ?? "floor((value - 10) / 2)";

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
        this.#validateAttributeValue(attributeName, value);

        const oldValue = this.#attributes[attributeName];
        this.#attributes[attributeName] = value;
        this.#lastUpdated = new Date().toISOString();

        // Check if this attribute affects health (specifically constitution)
        const definition = this.getAttributeDefinition(attributeName);
        if (definition?.affects?.includes('health')) {
            this.#recalculateHealth();
        }

        return {
            attribute: attributeName,
            oldValue,
            newValue: value,
            modifier: this.getAttributeModifier(attributeName)
        };
    }

    /**
     * Level up the player
     */
    levelUp() {
        this.#level += 1;
        const oldMaxHealth = this.#maxHealth;
        this.#maxHealth = this.#calculateBaseHealth();

        // Add the health increase to current health
        this.#health += (this.#maxHealth - oldMaxHealth);
        this.#lastUpdated = new Date().toISOString();
    }

    /**
     * Modify health (damage or healing)
     */
    modifyHealth(amount, reason = '') {
        const oldHealth = this.#health;
        this.#health = Math.max(0, Math.min(this.#maxHealth, this.#health + amount));
        this.#lastUpdated = new Date().toISOString();

        return {
            oldHealth,
            newHealth: this.#health,
            change: this.#health - oldHealth,
            reason
        };
    }

    /**
     * Check if player is alive
     */
    isAlive() {
        return this.#health > 0;
    }

    /**
     * Set player name
     */
    setName(name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Player name must be a non-empty string');
        }
        this.#name = name.trim();
        this.#lastUpdated = new Date().toISOString();
        return this.#name;
    }

    /**
     * Set player description
     */
    setDescription(description) {
        this.#description = description || '';
        this.#lastUpdated = new Date().toISOString();
        return this.#description;
    }

    /**
     * Set player level
     */
    setLevel(level) {
        if (!Number.isInteger(level) || level < 1 || level > 20) {
            throw new Error('Player level must be an integer between 1 and 20');
        }
        const oldLevel = this.#level;
        this.#level = level;

        // Recalculate max health based on new level
        const oldMaxHealth = this.#maxHealth;
        this.#maxHealth = this.#calculateBaseHealth();

        // Adjust current health proportionally
        if (oldMaxHealth > 0) {
            const healthRatio = this.#health / oldMaxHealth;
            this.#health = Math.round(this.#maxHealth * healthRatio);
        }

        this.#lastUpdated = new Date().toISOString();
        return {
            oldLevel,
            newLevel: this.#level,
            oldMaxHealth,
            newMaxHealth: this.#maxHealth,
            newHealth: this.#health
        };
    }

    /**
     * Set current health
     */
    setHealth(health) {
        if (!Number.isInteger(health) || health < 0) {
            throw new Error('Health must be a non-negative integer');
        }
        this.#health = Math.min(health, this.#maxHealth);
        this.#lastUpdated = new Date().toISOString();
        return this.#health;
    }

    /**
     * Set maximum health
     */
    setMaxHealth(maxHealth) {
        if (!Number.isInteger(maxHealth) || maxHealth < 1) {
            throw new Error('Maximum health must be a positive integer');
        }
        this.#maxHealth = maxHealth;
        // Ensure current health doesn't exceed new max
        this.#health = Math.min(this.#health, this.#maxHealth);
        this.#lastUpdated = new Date().toISOString();
        return this.#maxHealth;
    }

    /**
    /**
     * Set the player's current location
     * @param {string|Object} location - Location ID (string) or Location object
     */
    setLocation(location) {
        // Load object if given an id
        if (typeof location === 'string') {
            location = Location.get(location);
        }

        if (location === null || location === undefined) {
            this.#currentLocation = null;
        } else if (typeof location === 'object' && location.id) {
            // Store Location object or just its ID
            this.#currentLocation = location.id || location;
            location.visited = true;
        } else {
            throw new Error('Location must be a string ID, Location object with ID, or null');
        }

        this.#lastUpdated = new Date().toISOString();
    }

    /**
     * Move to a new location using an exit direction
     * @param {string} direction - Direction to move (e.g., 'north', 'south')
     * @param {Map|Object} locationMap - Map or object containing location ID -> Location mappings
     * @returns {Object} - Movement result with success status and details
     */
    moveToLocation(direction, locationMap) {
        if (!this.#currentLocation) {
            return {
                success: false,
                error: 'Player is not currently in any location',
                currentLocation: null
            };
        }

        // Get current location object
        let currentLocationObj = null;
        if (locationMap instanceof Map) {
            currentLocationObj = locationMap.get(this.#currentLocation);
        } else if (typeof locationMap === 'object') {
            currentLocationObj = locationMap[this.#currentLocation];
        }

        if (!currentLocationObj) {
            return {
                success: false,
                error: `Current location '${this.#currentLocation}' not found in location map`,
                currentLocation: this.#currentLocation
            };
        }

        // Check if exit exists
        const exit = currentLocationObj.getExit ? currentLocationObj.getExit(direction) : null;
        if (!exit) {
            return {
                success: false,
                error: `No exit found in direction '${direction}' from current location`,
                currentLocation: this.#currentLocation,
                availableDirections: currentLocationObj.getAvailableDirections ? currentLocationObj.getAvailableDirections() : []
            };
        }

        // Move to new location
        const oldLocation = this.#currentLocation;
        this.#currentLocation = exit.destination;
        this.#lastUpdated = new Date().toISOString();

        const newLocationObj = locationMap instanceof Map
            ? locationMap.get(this.#currentLocation)
            : (typeof locationMap === 'object' ? locationMap[this.#currentLocation] : null);
        if (newLocationObj && typeof newLocationObj === 'object' && typeof newLocationObj.visited !== 'undefined') {
            try {
                newLocationObj.visited = true;
            } catch (setError) {
                // Ignore failure to set visited flag; map rendering will fall back to default styling.
            }
        }

        return {
            success: true,
            oldLocation: oldLocation,
            newLocation: this.#currentLocation,
            direction: direction,
            exitDescription: exit.description || 'No description'
        };
    }

    /**
     * Get information about the current location
     * @param {Map|Object} locationMap - Map or object containing location ID -> Location mappings
     * @returns {Object|null} - Location information or null if not in a location
     */
    getCurrentLocationInfo(locationMap) {
        if (!this.#currentLocation) {
            return null;
        }

        let locationObj = null;
        if (locationMap instanceof Map) {
            locationObj = locationMap.get(this.#currentLocation);
        } else if (typeof locationMap === 'object') {
            locationObj = locationMap[this.#currentLocation];
        }

        if (!locationObj) {
            return {
                id: this.#currentLocation,
                error: 'Location not found in map'
            };
        }

        return locationObj.getDetails ? locationObj.getDetails() : locationObj;
    }

    /**
     * Get available exit directions from current location
     * @param {Map|Object} locationMap - Map or object containing location ID -> Location mappings
     * @returns {string[]} - Array of available directions
     */
    getAvailableExits(locationMap) {
        if (!this.#currentLocation) {
            return [];
        }

        let locationObj = null;
        if (locationMap instanceof Map) {
            locationObj = locationMap.get(this.#currentLocation);
        } else if (typeof locationMap === 'object') {
            locationObj = locationMap[this.#currentLocation];
        }

        if (!locationObj || !locationObj.getAvailableDirections) {
            return [];
        }

        return locationObj.getAvailableDirections();
    }

    /**
     * Get a single attribute value
     */
    getAttribute(attributeName) {
        return this.#attributes[attributeName] ?? null;
    }

    /**
     * Get an attribute in LLM-readable text.
     * 
     *  < 3 -> "terribe",
     *  3-5 -> "poor",
     *  6-8 -> "below average",
     *  9-11 -> "average",
     *  12-14 -> "above average",
     *  15-17 -> "excellent",
     *  18+ -> "legendary"
     */
    getAttributeTextValue(attributeName) {
        const value = this.getAttribute(attributeName);
        if (value === null) return 'unknown';
        if (value < 3) return 'terrible';
        if (value <= 5) return 'poor';
        if (value <= 8) return 'below average';
        if (value <= 11) return 'average';
        if (value <= 14) return 'above average';
        if (value <= 17) return 'excellent';
        return 'legendary';
    }


    /**
     * Get all attribute information including definitions
     */
    getAttributeInfo() {
        const info = {};
        for (const [attrName, definition] of Object.entries(this.attributeDefinitions)) {
            info[attrName] = {
                ...definition,
                value: this.#attributes[attrName],
                modifier: this.getAttributeModifier(attrName)
            };
        }
        return info;
    }

    /**
     * Get player's current status with enhanced attribute information
     */
    getStatus() {
        return {
            id: this.#id,
            name: this.#name,
            description: this.#description,
            level: this.#level,
            health: this.#health,
            maxHealth: this.#maxHealth,
            alive: this.isAlive(),
            currentLocation: this.#currentLocation,
            imageId: this.#imageId,
            isNPC: this.#isNPC,
            attributes: { ...this.#attributes },
            modifiers: this.getAttributeModifiers(),
            attributeInfo: this.getAttributeInfo()
        };
    }

    /**
     * Export player data for saving
     */
    toJSON() {
        return {
            id: this.#id,
            name: this.#name,
            description: this.#description,
            level: this.#level,
            health: this.#health,
            maxHealth: this.#maxHealth,
            currentLocation: this.#currentLocation,
            imageId: this.#imageId,
            attributes: this.#attributes,
            isNPC: this.#isNPC,
            createdAt: this.#createdAt,
            lastUpdated: this.#lastUpdated
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
            imageId: data.imageId,
            id: data.id,
            description: data.description,
            location: data.currentLocation,
            isNPC: data.isNPC
        });
        player.#maxHealth = data.maxHealth;
        player.#createdAt = data.createdAt;
        player.#lastUpdated = data.lastUpdated;
        return player;
    }

    /**
     * Get available attribute generation methods from definitions
     */
    getGenerationMethods() {
        return this.systemConfig.generationMethods ?? {};
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
            if (this.#attributes.hasOwnProperty(attrName)) {
                this.setAttribute(attrName, value);
            }
        }

        return newAttributes;
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
                const abbrev = def.abbreviation ?? name.charAt(0).toUpperCase();
                return `${abbrev}:${this.#attributes[name]}`;
            })
            .join(' ');

        return `${statusEmoji} ${this.#name} (Lvl ${this.#level}) HP:${this.#health}/${this.#maxHealth} [${attrs}]`;
    }
}

module.exports = Player;
