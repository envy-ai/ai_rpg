const crypto = require('crypto');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

/**
 * SettingInfo class for AI RPG
 * Represents custom game settings and world configurations
 * Uses ES13 syntax with private fields and modern JavaScript features
 */
class SettingInfo {
  // Private fields - encapsulated state
  #id;
  #name;
  #description;
  #theme;
  #genre;
  #startingLocationType;
  #magicLevel;
  #techLevel;
  #tone;
  #difficulty;
  #playerStartingLevel;
  #enabledFeatures;
  #customRules;
  #createdAt;
  #lastUpdated;
  #definitions;

  // Static indexing maps
  static #indexByID = new Map();
  static #indexByName = new Map();

  // Static private method for generating unique IDs
  static #generateId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(6).toString('hex');
    return `setting_${timestamp}_${random}`;
  }

  // Load settings definitions from YAML
  static #loadDefinitions() {
    try {
      const defsPath = path.join(__dirname, 'defs', 'settings.yaml');
      const defsContent = fs.readFileSync(defsPath, 'utf8');
      return yaml.load(defsContent);
    } catch (error) {
      console.warn('Could not load settings definitions:', error.message);
      return this.#getDefaultDefinitions();
    }
  }

  // Fallback default definitions if YAML file is missing
  static #getDefaultDefinitions() {
    return {
      settings: {
        theme: {
          options: ['fantasy', 'sci-fi', 'modern', 'historical', 'post-apocalyptic', 'cyberpunk', 'steampunk', 'horror', 'mystery', 'western'],
          default: 'fantasy',
          description: 'The overarching theme or setting of the game world'
        },
        genre: {
          options: ['adventure', 'mystery', 'combat', 'exploration', 'roleplay', 'survival', 'political', 'romantic', 'horror', 'comedy'],
          default: 'adventure',
          description: 'The primary genre or style of gameplay'
        },
        startingLocationType: {
          options: ['village', 'city', 'tavern', 'wilderness', 'dungeon', 'ship', 'castle', 'monastery', 'academy', 'prison'],
          default: 'village',
          description: 'The type of location where adventures typically begin'
        },
        magicLevel: {
          options: ['none', 'rare', 'uncommon', 'common', 'abundant', 'omnipresent'],
          default: 'common',
          description: 'How prevalent magic is in the game world'
        },
        techLevel: {
          options: ['stone-age', 'bronze-age', 'iron-age', 'medieval', 'renaissance', 'industrial', 'modern', 'near-future', 'far-future'],
          default: 'medieval',
          description: 'The technological advancement level of the world'
        },
        tone: {
          options: ['heroic', 'gritty', 'comedic', 'dark', 'lighthearted', 'epic', 'realistic', 'cinematic', 'surreal'],
          default: 'heroic',
          description: 'The overall emotional tone and atmosphere'
        },
        difficulty: {
          options: ['story-mode', 'easy', 'normal', 'hard', 'extreme', 'custom'],
          default: 'normal',
          description: 'The challenge level and lethality of encounters'
        }
      }
    };
  }

  /**
   * Creates a new SettingInfo instance
   * @param {Object} options - Setting configuration
   * @param {string} options.name - Name of the setting
   * @param {string} [options.description] - Description of the setting
   * @param {string} [options.theme] - Theme of the world
   * @param {string} [options.genre] - Genre of gameplay
   * @param {string} [options.startingLocationType] - Type of starting location
   * @param {string} [options.magicLevel] - Level of magic prevalence
   * @param {string} [options.techLevel] - Technological advancement level
   * @param {string} [options.tone] - Emotional tone and atmosphere
   * @param {string} [options.difficulty] - Challenge level
   * @param {number} [options.playerStartingLevel] - Starting level for new players
   * @param {Array} [options.enabledFeatures] - Enabled game features
   * @param {Object} [options.customRules] - Custom rules and modifications
   * @param {string} [options.id] - Custom ID (if not provided, one will be generated)
   */
  constructor(options = {}) {
    // Load definitions first
    this.#definitions = SettingInfo.#loadDefinitions();

    // Validate required parameters
    if (!options.name || typeof options.name !== 'string') {
      throw new Error('Setting name is required and must be a string');
    }

    // Initialize private fields
    this.#id = options.id || SettingInfo.#generateId();
    this.#name = options.name;
    this.#description = options.description || `Custom game setting: ${options.name}`;

    // Initialize setting properties with validation
    this.#theme = this.#validateAndSet('theme', options.theme);
    this.#genre = this.#validateAndSet('genre', options.genre);
    this.#startingLocationType = this.#validateAndSet('startingLocationType', options.startingLocationType);
    this.#magicLevel = this.#validateAndSet('magicLevel', options.magicLevel);
    this.#techLevel = this.#validateAndSet('techLevel', options.techLevel);
    this.#tone = this.#validateAndSet('tone', options.tone);
    this.#difficulty = this.#validateAndSet('difficulty', options.difficulty);

    // Additional properties
    this.#playerStartingLevel = Math.max(1, Math.min(20, options.playerStartingLevel || 1));
    this.#enabledFeatures = Array.isArray(options.enabledFeatures) ? [...options.enabledFeatures] : ['combat', 'magic', 'exploration', 'roleplay'];
    this.#customRules = options.customRules || {};

    // Timestamps
    this.#createdAt = new Date().toISOString();
    this.#lastUpdated = this.#createdAt;

    // Add to static indexes
    SettingInfo.#indexByID.set(this.#id, this);
    SettingInfo.#indexByName.set(this.#name.toLowerCase(), this);
  }

  // Validate and set a setting property
  #validateAndSet(propertyName, value) {
    const settingDef = this.#definitions?.settings?.[propertyName];
    if (!settingDef) {
      console.warn(`No definition found for setting property: ${propertyName}`);
      return value || 'unknown';
    }

    if (value && settingDef.options && !settingDef.options.includes(value)) {
      console.warn(`Invalid value "${value}" for ${propertyName}. Valid options: ${settingDef.options.join(', ')}`);
      return settingDef.default;
    }

    return value || settingDef.default;
  }

  // Update last modified timestamp
  #updateTimestamp() {
    this.#lastUpdated = new Date().toISOString();
  }

  // Getters for all properties
  get id() { return this.#id; }
  get name() { return this.#name; }
  get description() { return this.#description; }
  get theme() { return this.#theme; }
  get genre() { return this.#genre; }
  get startingLocationType() { return this.#startingLocationType; }
  get magicLevel() { return this.#magicLevel; }
  get techLevel() { return this.#techLevel; }
  get tone() { return this.#tone; }
  get difficulty() { return this.#difficulty; }
  get playerStartingLevel() { return this.#playerStartingLevel; }
  get enabledFeatures() { return [...this.#enabledFeatures]; }
  get customRules() { return { ...this.#customRules }; }
  get createdAt() { return this.#createdAt; }
  get lastUpdated() { return this.#lastUpdated; }

  // Setters with validation
  set name(value) {
    if (!value || typeof value !== 'string') {
      throw new Error('Setting name must be a non-empty string');
    }
    
    // Remove from old name index
    SettingInfo.#indexByName.delete(this.#name.toLowerCase());
    
    this.#name = value;
    this.#updateTimestamp();
    
    // Add to new name index
    SettingInfo.#indexByName.set(this.#name.toLowerCase(), this);
  }

  set description(value) {
    this.#description = value || '';
    this.#updateTimestamp();
  }

  set theme(value) {
    this.#theme = this.#validateAndSet('theme', value);
    this.#updateTimestamp();
  }

  set genre(value) {
    this.#genre = this.#validateAndSet('genre', value);
    this.#updateTimestamp();
  }

  set startingLocationType(value) {
    this.#startingLocationType = this.#validateAndSet('startingLocationType', value);
    this.#updateTimestamp();
  }

  set magicLevel(value) {
    this.#magicLevel = this.#validateAndSet('magicLevel', value);
    this.#updateTimestamp();
  }

  set techLevel(value) {
    this.#techLevel = this.#validateAndSet('techLevel', value);
    this.#updateTimestamp();
  }

  set tone(value) {
    this.#tone = this.#validateAndSet('tone', value);
    this.#updateTimestamp();
  }

  set difficulty(value) {
    this.#difficulty = this.#validateAndSet('difficulty', value);
    this.#updateTimestamp();
  }

  set playerStartingLevel(value) {
    this.#playerStartingLevel = Math.max(1, Math.min(20, parseInt(value) || 1));
    this.#updateTimestamp();
  }

  set enabledFeatures(value) {
    this.#enabledFeatures = Array.isArray(value) ? [...value] : [];
    this.#updateTimestamp();
  }

  set customRules(value) {
    this.#customRules = value || {};
    this.#updateTimestamp();
  }

  // Static methods for CRUD operations
  static create(options) {
    return new SettingInfo(options);
  }

  static getById(id) {
    return SettingInfo.#indexByID.get(id) || null;
  }

  static getByName(name) {
    return SettingInfo.#indexByName.get(name.toLowerCase()) || null;
  }

  static getAll() {
    return Array.from(SettingInfo.#indexByID.values());
  }

  static exists(id) {
    return SettingInfo.#indexByID.has(id);
  }

  static delete(id) {
    const setting = SettingInfo.#indexByID.get(id);
    if (setting) {
      SettingInfo.#indexByID.delete(id);
      SettingInfo.#indexByName.delete(setting.name.toLowerCase());
      return true;
    }
    return false;
  }

  static count() {
    return SettingInfo.#indexByID.size;
  }

  static clear() {
    SettingInfo.#indexByID.clear();
    SettingInfo.#indexByName.clear();
  }

  static getValidOptions(propertyName) {
    const definitions = SettingInfo.#loadDefinitions();
    return definitions?.settings?.[propertyName]?.options || [];
  }

  static getDefaultValue(propertyName) {
    const definitions = SettingInfo.#loadDefinitions();
    return definitions?.settings?.[propertyName]?.default || null;
  }

  // Instance methods
  update(updates) {
    // Update properties safely
    Object.keys(updates).forEach(key => {
      if (key !== 'id' && key !== 'createdAt' && this.hasOwnProperty(key)) {
        try {
          this[key] = updates[key];
        } catch (error) {
          console.warn(`Failed to update ${key}:`, error.message);
        }
      }
    });
    return this;
  }

  // Get all properties as a plain object
  getStatus() {
    return {
      id: this.#id,
      name: this.#name,
      description: this.#description,
      theme: this.#theme,
      genre: this.#genre,
      startingLocationType: this.#startingLocationType,
      magicLevel: this.#magicLevel,
      techLevel: this.#techLevel,
      tone: this.#tone,
      difficulty: this.#difficulty,
      playerStartingLevel: this.#playerStartingLevel,
      enabledFeatures: this.#enabledFeatures,
      customRules: this.#customRules,
      createdAt: this.#createdAt,
      lastUpdated: this.#lastUpdated
    };
  }

  // Serialize for JSON storage
  toJSON() {
    return this.getStatus();
  }

  // Create from JSON data
  static fromJSON(data) {
    return new SettingInfo(data);
  }

  // Clone the setting
  clone(newName = null) {
    const data = { ...this.getStatus() };
    delete data.id;
    delete data.createdAt;
    delete data.lastUpdated;
    
    if (newName) {
      data.name = newName;
    } else {
      data.name = `${data.name} (Copy)`;
    }
    
    return new SettingInfo(data);
  }

  // Check if setting is compatible with another setting
  isCompatibleWith(otherSetting) {
    if (!(otherSetting instanceof SettingInfo)) {
      return false;
    }

    // Simple compatibility check - same theme and close tech/magic levels
    return this.#theme === otherSetting.theme &&
           Math.abs(this.#getNumericLevel('techLevel') - otherSetting.#getNumericLevel('techLevel')) <= 2 &&
           Math.abs(this.#getNumericLevel('magicLevel') - otherSetting.#getNumericLevel('magicLevel')) <= 2;
  }

  // Helper to convert level strings to numbers for comparison
  #getNumericLevel(levelType) {
    const techLevels = ['stone-age', 'bronze-age', 'iron-age', 'medieval', 'renaissance', 'industrial', 'modern', 'near-future', 'far-future'];
    const magicLevels = ['none', 'rare', 'uncommon', 'common', 'abundant', 'omnipresent'];
    
    if (levelType === 'techLevel') {
      return techLevels.indexOf(this.#techLevel) || 0;
    } else if (levelType === 'magicLevel') {
      return magicLevels.indexOf(this.#magicLevel) || 0;
    }
    return 0;
  }

  // Generate prompt variables for template system
  getPromptVariables() {
    return {
      theme: this.#theme,
      genre: this.#genre,
      startingLocationType: this.#startingLocationType,
      magicLevel: this.#magicLevel,
      techLevel: this.#techLevel,
      tone: this.#tone,
      difficulty: this.#difficulty,
      playerStartingLevel: this.#playerStartingLevel,
      enabledFeatures: this.#enabledFeatures,
      customRules: this.#customRules,
      settingName: this.#name,
      settingDescription: this.#description
    };
  }

  // String representation
  toString() {
    return `${this.#name} (${this.#theme}/${this.#genre})`;
  }

  // ==================== FILE PERSISTENCE METHODS ====================

  // Save setting to file
  save(saveDir = null) {
    try {
      const dir = saveDir || path.join(__dirname, 'saves', 'settings');
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const filename = `${this.#name.replace(/[^a-zA-Z0-9]/g, '_')}_${this.#id}.json`;
      const filepath = path.join(dir, filename);
      
      fs.writeFileSync(filepath, JSON.stringify(this.toJSON(), null, 2));
      return filepath;
    } catch (error) {
      throw new Error(`Failed to save setting: ${error.message}`);
    }
  }

  // Load setting from file
  static load(filepath) {
    try {
      const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      return SettingInfo.fromJSON(data);
    } catch (error) {
      throw new Error(`Failed to load setting from ${filepath}: ${error.message}`);
    }
  }

  // Save all settings to directory
  static saveAll(saveDir = null) {
    try {
      const dir = saveDir || path.join(__dirname, 'saves', 'settings');
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const allSettings = SettingInfo.getAll();
      const savedFiles = [];

      // Save individual setting files
      for (const setting of allSettings) {
        const filepath = setting.save(dir);
        savedFiles.push(filepath);
      }

      // Save index file with all settings
      const indexData = {
        settings: allSettings.map(s => s.toJSON()),
        count: allSettings.length,
        savedAt: new Date().toISOString()
      };
      
      const indexPath = path.join(dir, 'settings_index.json');
      fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
      savedFiles.push(indexPath);

      return {
        count: allSettings.length,
        files: savedFiles,
        directory: dir
      };
    } catch (error) {
      throw new Error(`Failed to save all settings: ${error.message}`);
    }
  }

  // Load all settings from directory
  static loadAll(saveDir = null) {
    try {
      const dir = saveDir || path.join(__dirname, 'saves', 'settings');
      
      if (!fs.existsSync(dir)) {
        return { count: 0, settings: [] };
      }

      // Try to load from index file first
      const indexPath = path.join(dir, 'settings_index.json');
      if (fs.existsSync(indexPath)) {
        const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        
        // Clear existing settings
        SettingInfo.clear();
        
        // Load each setting
        const loadedSettings = [];
        for (const settingData of indexData.settings) {
          try {
            const setting = SettingInfo.fromJSON(settingData);
            loadedSettings.push(setting);
          } catch (error) {
            console.warn(`Failed to load setting ${settingData.name}:`, error.message);
          }
        }

        return {
          count: loadedSettings.length,
          settings: loadedSettings,
          loadedFrom: 'index'
        };
      }

      // Fallback: scan directory for individual setting files
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'settings_index.json');
      
      // Clear existing settings
      SettingInfo.clear();
      
      const loadedSettings = [];
      for (const filename of files) {
        try {
          const filepath = path.join(dir, filename);
          const setting = SettingInfo.load(filepath);
          loadedSettings.push(setting);
        } catch (error) {
          console.warn(`Failed to load setting from ${filename}:`, error.message);
        }
      }

      return {
        count: loadedSettings.length,
        settings: loadedSettings,
        loadedFrom: 'individual_files'
      };
    } catch (error) {
      throw new Error(`Failed to load all settings: ${error.message}`);
    }
  }

  // List available setting files
  static listSavedSettings(saveDir = null) {
    try {
      const dir = saveDir || path.join(__dirname, 'saves', 'settings');
      
      if (!fs.existsSync(dir)) {
        return [];
      }

      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      return files.map(filename => {
        const filepath = path.join(dir, filename);
        const stats = fs.statSync(filepath);
        
        // Try to read basic info without fully loading
        try {
          const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
          return {
            filename,
            filepath,
            name: data.name || 'Unknown',
            theme: data.theme || 'Unknown',
            genre: data.genre || 'Unknown',
            lastModified: stats.mtime,
            size: stats.size
          };
        } catch (error) {
          return {
            filename,
            filepath,
            name: 'Corrupted File',
            theme: 'Unknown',
            genre: 'Unknown',
            lastModified: stats.mtime,
            size: stats.size,
            error: error.message
          };
        }
      });
    } catch (error) {
      throw new Error(`Failed to list saved settings: ${error.message}`);
    }
  }

  // Delete setting file
  deleteSavedFile(saveDir = null) {
    try {
      const dir = saveDir || path.join(__dirname, 'saves', 'settings');
      const filename = `${this.#name.replace(/[^a-zA-Z0-9]/g, '_')}_${this.#id}.json`;
      const filepath = path.join(dir, filename);
      
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        return true;
      }
      return false;
    } catch (error) {
      throw new Error(`Failed to delete setting file: ${error.message}`);
    }
  }
}

module.exports = SettingInfo;