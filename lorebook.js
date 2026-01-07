const fs = require('fs');
const path = require('path');

/**
 * LorebookManager - Manages SillyTavern-compatible lorebooks
 *
 * Supports loading lorebooks from a directory, keyword matching,
 * and injecting relevant entries into prompts.
 */
class LorebookManager {
  constructor(lorebooksPath = './lorebooks') {
    this.lorebooksPath = lorebooksPath;
    this.lorebooks = new Map(); // Map<filename, lorebook>
    this.enabledBooks = new Set(); // Set of enabled filenames
    this.stateFile = path.join(lorebooksPath, 'lorebook-state.json');
    this.allEntries = []; // Flattened list of all entries from enabled books
  }

  /**
   * Initialize the lorebook manager - load state and all lorebooks
   */
  async initialize() {
    await this.ensureDirectory();
    await this.loadState();
    await this.loadAllLorebooks();
    return this;
  }

  /**
   * Ensure the lorebooks directory exists
   */
  async ensureDirectory() {
    try {
      await fs.promises.mkdir(this.lorebooksPath, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') {
        console.error('[Lorebook] Failed to create lorebooks directory:', err);
      }
    }
  }

  /**
   * Load enabled/disabled state from lorebook-state.json
   */
  async loadState() {
    try {
      const data = await fs.promises.readFile(this.stateFile, 'utf-8');
      const state = JSON.parse(data);
      this.enabledBooks = new Set(state.enabled || []);
      console.log(`[Lorebook] Loaded state: ${this.enabledBooks.size} books enabled`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[Lorebook] Failed to load state:', err);
      }
      // Default: no books enabled
      this.enabledBooks = new Set();
    }
  }

  /**
   * Save enabled/disabled state to lorebook-state.json
   */
  async saveState() {
    try {
      const state = { enabled: Array.from(this.enabledBooks) };
      await fs.promises.writeFile(this.stateFile, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Lorebook] Failed to save state:', err);
    }
  }

  /**
   * Load all .json lorebook files from the lorebooks directory
   */
  async loadAllLorebooks() {
    this.lorebooks.clear();
    this.allEntries = [];

    try {
      const files = await fs.promises.readdir(this.lorebooksPath);
      const jsonFiles = files.filter(f => f.endsWith('.json') && f !== 'lorebook-state.json');

      for (const filename of jsonFiles) {
        try {
          const filepath = path.join(this.lorebooksPath, filename);
          const data = await fs.promises.readFile(filepath, 'utf-8');
          const lorebook = JSON.parse(data);

          // Normalize the lorebook structure
          const normalized = this.normalizeLorebook(lorebook, filename);
          this.lorebooks.set(filename, normalized);

          console.log(`[Lorebook] Loaded: ${filename} (${normalized.entryCount} entries)`);
        } catch (err) {
          console.error(`[Lorebook] Failed to load ${filename}:`, err.message);
        }
      }

      // Rebuild flattened entries list from enabled books
      this.rebuildEntriesList();

      console.log(`[Lorebook] Total: ${this.lorebooks.size} lorebooks, ${this.allEntries.length} active entries`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[Lorebook] Failed to read lorebooks directory:', err);
      }
    }
  }

  /**
   * Normalize a lorebook to a consistent internal structure
   */
  normalizeLorebook(lorebook, filename) {
    const entries = [];

    // SillyTavern format: entries is an object with numeric keys
    if (lorebook.entries && typeof lorebook.entries === 'object') {
      for (const [uid, entry] of Object.entries(lorebook.entries)) {
        if (!entry || typeof entry !== 'object') continue;

        entries.push({
          uid: entry.uid ?? parseInt(uid, 10) ?? 0,
          key: this.normalizeKeys(entry.key),
          content: entry.content || '',
          comment: entry.comment || '',
          enabled: entry.enabled !== false, // Default true
          constant: entry.constant === true, // Default false
          insertion_order: entry.insertion_order ?? 100,
          case_sensitive: entry.case_sensitive === true, // Default false
          priority: entry.priority ?? 10,
          bookFilename: filename
        });
      }
    }

    // Calculate token estimate (~4 chars per token)
    const totalChars = entries.reduce((sum, e) => sum + (e.content?.length || 0), 0);
    const tokenEstimate = Math.ceil(totalChars / 4);

    return {
      name: lorebook.name || filename.replace('.json', ''),
      filename,
      entries,
      entryCount: entries.length,
      tokenEstimate
    };
  }

  /**
   * Normalize keys to always be an array of strings
   */
  normalizeKeys(keys) {
    if (!keys) return [];
    if (typeof keys === 'string') {
      // Could be comma-separated
      return keys.split(',').map(k => k.trim()).filter(k => k.length > 0);
    }
    if (Array.isArray(keys)) {
      return keys.map(k => String(k).trim()).filter(k => k.length > 0);
    }
    return [];
  }

  /**
   * Rebuild the flattened entries list from enabled books only
   */
  rebuildEntriesList() {
    this.allEntries = [];

    for (const [filename, lorebook] of this.lorebooks) {
      if (!this.enabledBooks.has(filename)) continue;

      for (const entry of lorebook.entries) {
        if (entry.enabled) {
          this.allEntries.push(entry);
        }
      }
    }
  }

  /**
   * Enable a lorebook by filename
   */
  async enableLorebook(filename) {
    if (!this.lorebooks.has(filename)) {
      throw new Error(`Lorebook not found: ${filename}`);
    }
    this.enabledBooks.add(filename);
    this.rebuildEntriesList();
    await this.saveState();
    return true;
  }

  /**
   * Disable a lorebook by filename
   */
  async disableLorebook(filename) {
    this.enabledBooks.delete(filename);
    this.rebuildEntriesList();
    await this.saveState();
    return true;
  }

  /**
   * Check if a lorebook is enabled
   */
  isEnabled(filename) {
    return this.enabledBooks.has(filename);
  }

  /**
   * Get list of all lorebooks with metadata
   */
  getLorebookList() {
    const list = [];
    for (const [filename, lorebook] of this.lorebooks) {
      list.push({
        filename,
        name: lorebook.name,
        entryCount: lorebook.entryCount,
        tokenEstimate: lorebook.tokenEstimate,
        enabled: this.enabledBooks.has(filename)
      });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get details of a specific lorebook including entries
   */
  getLorebookDetails(filename) {
    const lorebook = this.lorebooks.get(filename);
    if (!lorebook) return null;

    return {
      filename,
      name: lorebook.name,
      entryCount: lorebook.entryCount,
      tokenEstimate: lorebook.tokenEstimate,
      enabled: this.enabledBooks.has(filename),
      entries: lorebook.entries.map(e => ({
        uid: e.uid,
        key: e.key,
        content: e.content,
        comment: e.comment,
        enabled: e.enabled,
        constant: e.constant,
        priority: e.priority,
        insertion_order: e.insertion_order
      }))
    };
  }

  /**
   * Find matching entries for a given context string
   * @param {string} contextText - Text to match against (action text, location name, etc.)
   * @param {object} options - { maxTokens: 2000 }
   * @returns {Array} Matched entries sorted by priority
   */
  findMatchingEntries(contextText, { maxTokens = 2000 } = {}) {
    if (!contextText || typeof contextText !== 'string') {
      return this.getConstantEntries(maxTokens);
    }

    const matches = [];
    const contextLower = contextText.toLowerCase();

    // 1. Collect constant entries (always inject)
    for (const entry of this.allEntries) {
      if (entry.constant) {
        matches.push({ ...entry, matchType: 'constant' });
      }
    }

    // 2. Collect keyword-matched entries
    for (const entry of this.allEntries) {
      if (entry.constant) continue; // Already added

      const matched = entry.key.some(key => {
        const k = entry.case_sensitive ? key : key.toLowerCase();
        const ctx = entry.case_sensitive ? contextText : contextLower;
        return ctx.includes(k);
      });

      if (matched) {
        matches.push({ ...entry, matchType: 'keyword' });
      }
    }

    // 3. Sort by priority (desc), then insertion_order (asc)
    matches.sort((a, b) =>
      (b.priority || 0) - (a.priority || 0) ||
      (a.insertion_order || 100) - (b.insertion_order || 100)
    );

    // 4. Trim to token budget
    return this.trimToTokenBudget(matches, maxTokens);
  }

  /**
   * Get only constant (always-on) entries
   */
  getConstantEntries(maxTokens = 2000) {
    const constants = this.allEntries
      .filter(e => e.constant)
      .sort((a, b) =>
        (b.priority || 0) - (a.priority || 0) ||
        (a.insertion_order || 100) - (b.insertion_order || 100)
      );

    return this.trimToTokenBudget(constants, maxTokens);
  }

  /**
   * Trim entries to fit within token budget
   */
  trimToTokenBudget(entries, maxTokens) {
    const result = [];
    let usedTokens = 0;
    const charsPerToken = 4;

    for (const entry of entries) {
      const entryTokens = Math.ceil((entry.content?.length || 0) / charsPerToken);
      if (usedTokens + entryTokens <= maxTokens) {
        result.push(entry);
        usedTokens += entryTokens;
      } else {
        // Token budget exceeded, stop adding entries
        break;
      }
    }

    return result;
  }

  /**
   * Format matched entries for injection into prompts
   * @param {Array} entries - Matched entries from findMatchingEntries
   * @returns {string} Formatted string for prompt injection
   */
  formatEntriesForPrompt(entries) {
    if (!entries || entries.length === 0) return '';

    return entries
      .map(e => e.content)
      .filter(c => c && c.trim())
      .join('\n\n');
  }

  /**
   * Delete a lorebook file
   */
  async deleteLorebook(filename) {
    if (!this.lorebooks.has(filename)) {
      throw new Error(`Lorebook not found: ${filename}`);
    }

    const filepath = path.join(this.lorebooksPath, filename);
    await fs.promises.unlink(filepath);

    this.lorebooks.delete(filename);
    this.enabledBooks.delete(filename);
    this.rebuildEntriesList();
    await this.saveState();

    return true;
  }

  /**
   * Save an uploaded lorebook file
   */
  async saveLorebook(filename, content) {
    // Ensure .json extension
    if (!filename.endsWith('.json')) {
      filename = filename + '.json';
    }

    // Validate it's valid JSON and has entries
    let lorebook;
    try {
      lorebook = JSON.parse(content);
    } catch (err) {
      throw new Error('Invalid JSON format');
    }

    if (!lorebook.entries || typeof lorebook.entries !== 'object') {
      throw new Error('Invalid lorebook format: missing entries');
    }

    const filepath = path.join(this.lorebooksPath, filename);
    await fs.promises.writeFile(filepath, content, 'utf-8');

    // Reload to add to our collection
    const normalized = this.normalizeLorebook(lorebook, filename);
    this.lorebooks.set(filename, normalized);

    console.log(`[Lorebook] Saved: ${filename} (${normalized.entryCount} entries)`);

    return { filename, entryCount: normalized.entryCount };
  }

  /**
   * Reload all lorebooks (for slash command)
   */
  async reload() {
    await this.loadState();
    await this.loadAllLorebooks();
    return {
      count: this.lorebooks.size,
      enabledCount: this.enabledBooks.size,
      totalEntries: this.allEntries.length
    };
  }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton LorebookManager instance
 */
function getLorebookManager() {
  return instance;
}

/**
 * Initialize the singleton LorebookManager
 */
async function initializeLorebookManager(lorebooksPath = './lorebooks') {
  instance = new LorebookManager(lorebooksPath);
  await instance.initialize();
  return instance;
}

module.exports = {
  LorebookManager,
  getLorebookManager,
  initializeLorebookManager
};
