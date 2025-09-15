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
  #createdAt;
  #lastUpdated;

  // Static indexing maps
  static #indexByID = new Map();
  static #indexByName = new Map();

  // Static private method for generating unique IDs
  static #generateId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(6).toString('hex');
    return `setting_${timestamp}_${random}`;
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
   * @param {string} [options.id] - Custom ID (if not provided, one will be generated)
   */
  constructor(options = {}) {
    // Validate required parameters
    if (!options.name || typeof options.name !== 'string') {
      throw new Error('Setting name is required and must be a string');
    }

    // Initialize private fields
    this.#id = options.id || SettingInfo.#generateId();
    this.#name = options.name;
    this.#description = options.description || '';

    // Initialize setting properties from options
    this.#theme = options.theme || '';
    this.#genre = options.genre || '';
    this.#startingLocationType = options.startingLocationType || '';
    this.#magicLevel = options.magicLevel || '';
    this.#techLevel = options.techLevel || '';
    this.#tone = options.tone || '';
    this.#difficulty = options.difficulty || '';

    // Additional properties
    this.#playerStartingLevel = Math.max(1, Math.min(20, options.playerStartingLevel || 1));

    // Timestamps
    this.#createdAt = new Date().toISOString();
    this.#lastUpdated = this.#createdAt;

    // Add to static indexes
    SettingInfo.#indexByID.set(this.#id, this);
    SettingInfo.#indexByName.set(this.#name.toLowerCase(), this);
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
    this.#theme = value;
    this.#updateTimestamp();
  }

  set genre(value) {
    this.#genre = value;
    this.#updateTimestamp();
  }

  set startingLocationType(value) {
    this.#startingLocationType = value;
    this.#updateTimestamp();
  }

  set magicLevel(value) {
    this.#magicLevel = value;
    this.#updateTimestamp();
  }

  set techLevel(value) {
    this.#techLevel = value;
    this.#updateTimestamp();
  }

  set tone(value) {
    this.#tone = value;
    this.#updateTimestamp();
  }

  set difficulty(value) {
    this.#difficulty = value;
    this.#updateTimestamp();
  }

  set playerStartingLevel(value) {
    this.#playerStartingLevel = Math.max(1, Math.min(20, parseInt(value) || 1));
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


  // Instance methods
  update(updates = {}) {
    // Update properties safely using defined setters
    Object.entries(updates).forEach(([key, value]) => {
      if (key === 'id' || key === 'createdAt' || key === 'lastUpdated') {
        return;
      }

      if (key in this) {
        try {
          this[key] = value;
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

      // Scan directory for individual setting files
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
        directory: dir,
        files: files.map(filename => path.join(dir, filename))
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

      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'settings_index.json');
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
