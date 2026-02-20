const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const Globals = require('./Globals.js');

let sharedDomParser = null;

let cachedLocationModule = null;
let cachedLocationExitModule = null;
let cachedRegionModule = null;
let cachedThingModule = null;
let cachedPlayerModule = null;
let cachedSkillModule = null;
let cachedFactionModule = null;
const chatSummaryStore = new Map();
const chatSummaryQueue = [];
const COMMON_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by',
  'can', 'did', 'do', 'does', 'doing', 'done', 'for', 'from', 'had',
  'has', 'have', 'having', 'he', 'her', 'hers', 'him', 'his', 'i', 'if', 'in',
  'into', 'is', 'it', 'its', 'me', 'my', 'mine', 'no', 'not',
  'of', 'off', 'on', 'or', 'our', 'ours', 'out', 'she', 'should', 'so', 'than',
  'that', 'the', 'their', 'theirs', 'them', 'then', 'these', 'they', 'this',
  'those', 'to', 'too', 'under', 'up', 'us', 'very', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will',
  'with', 'without', 'you', 'your', 'yours',
  "aren't", "can't", "didn't", "doesn't", "don't", "hadn't",
  "hasn't", "haven't", "he'd", "he'll", "he's", "i'd", "i'll", "i'm", "i've",
  "isn't", "it'd", "it'll", "it's", "let's", "mustn't", "shan't", "she'd",
  "she'll", "she's", "shouldn't", "that'd", "that'll", "that's", "there's",
  "they'd", "they'll", "they're", "they've", "we'd", "we'll", "we're", "we've",
  "weren't", "what's", "when's", "where's", "who's", "why's", "won't",
  "you'd", "you'll", "you're", "you've"
]);

class Utils {
  static intersection = (setA, setB) => new Set([...setA].filter(x => setB.has(x)));
  static difference = (setA, setB) => new Set([...setA].filter(x => !setB.has(x)));
  static union = (setA, setB) => new Set([...setA, ...setB]);
  static innerXML(node) {
    const s = new XMLSerializer();
    return Array.from(node.childNodes).map(n => s.serializeToString(n)).join('');
  }

  static roundAwayFromZero(value) {
    if (!Number.isFinite(value) || value === 0) {
      return 0;
    }
    return value > 0 ? Math.ceil(value) : Math.floor(value);
  }

  static parseDurationToMinutes(value, { fieldName = 'duration' } = {}) {
    const label = typeof fieldName === 'string' && fieldName.trim()
      ? fieldName.trim()
      : 'duration';
    const throwWithTrace = (message) => {
      console.trace(message);
      throw new Error(message);
    };

    if (value === null || value === undefined) {
      throwWithTrace(`${label} is required.`);
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
        throwWithTrace(`${label} must be a non-negative integer minute value.`);
      }
      return value;
    }

    if (typeof value !== 'string') {
      throwWithTrace(`${label} must be a string or number.`);
    }

    const trimmed = value.trim();
    if (!trimmed) {
      throwWithTrace(`${label} must not be empty.`);
    }

    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed);
    }

    const hhmmMatch = trimmed.match(/^(\d+):([0-5]\d)$/);
    if (hhmmMatch) {
      const hours = Number(hhmmMatch[1]);
      const minutes = Number(hhmmMatch[2]);
      return (hours * 60) + minutes;
    }

    const normalized = trimmed
      .toLowerCase()
      .replace(/,/g, ' ')
      .replace(/\band\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const unitPattern = /(\d+)\s*(days?|d|hours?|hrs?|hr|h|minutes?|mins?|min|m)\b/g;
    let cursor = 0;
    let matched = false;
    let totalMinutes = 0;

    for (const match of normalized.matchAll(unitPattern)) {
      matched = true;
      const [segment, numericText, unitRaw] = match;
      const segmentIndex = Number(match.index);
      const between = normalized.slice(cursor, segmentIndex);
      if (between.trim()) {
        throwWithTrace(`${label} contains malformed separators or unknown units: "${value}".`);
      }
      if (cursor !== 0 && between.length === 0) {
        throwWithTrace(`${label} must separate duration parts with spaces or commas: "${value}".`);
      }

      const amount = Number(numericText);
      if (!Number.isFinite(amount)) {
        throwWithTrace(`${label} contains an invalid numeric value: "${value}".`);
      }

      const unit = unitRaw.toLowerCase();
      if (unit === 'day' || unit === 'days' || unit === 'd') {
        totalMinutes += amount * 1440;
      } else if (unit === 'hour' || unit === 'hours' || unit === 'hr' || unit === 'hrs' || unit === 'h') {
        totalMinutes += amount * 60;
      } else if (unit === 'minute' || unit === 'minutes' || unit === 'min' || unit === 'mins' || unit === 'm') {
        totalMinutes += amount;
      } else {
        throwWithTrace(`${label} contains an unsupported unit "${unitRaw}".`);
      }

      cursor = segmentIndex + segment.length;
    }

    if (!matched) {
      throwWithTrace(`${label} is invalid ('${value}'). Expected HH:MM, integer minutes, or day/hour/minute units.`);
    }

    if (normalized.slice(cursor).trim()) {
      throwWithTrace(`${label} contains malformed separators or unknown units: "${value}".`);
    }

    return totalMinutes;
  }

  static getMinimumUnmitigatedWeaponDamage(rarity, level) {
    const normalizedRarity = typeof rarity === 'string' ? rarity.trim() : '';
    if (!normalizedRarity) {
      throw new TypeError('Utils.getMinimumUnmitigatedWeaponDamage requires a weapon rarity key.');
    }

    const normalizedLevel = Number(level);
    if (!Number.isFinite(normalizedLevel)) {
      throw new TypeError('Utils.getMinimumUnmitigatedWeaponDamage requires a numeric weapon level.');
    }
    if (normalizedLevel < 1) {
      throw new RangeError('Utils.getMinimumUnmitigatedWeaponDamage requires a level of at least 1.');
    }

    const Thing = this.#getThingModule();
    const rarityDefinition = Thing.getRarityDefinition(normalizedRarity, { fallbackToDefault: false });
    if (!rarityDefinition) {
      throw new Error(`Unknown weapon rarity "${normalizedRarity}".`);
    }

    const damageMultiplier = rarityDefinition.damageMultiplier;
    if (!Number.isFinite(damageMultiplier)) {
      throw new Error(`Weapon rarity "${normalizedRarity}" is missing a damage multiplier.`);
    }

    const baseWeaponDamage = Number(Globals.config.baseWeaponDamage);
    if (!Number.isFinite(baseWeaponDamage)) {
      throw new Error('Globals.config.baseWeaponDamage must be a finite number.');
    }

    const baseDamage = baseWeaponDamage + normalizedLevel * damageMultiplier;
    const hitDegreeMultiplier = 0.75;
    const preRoundedDamage = baseDamage * hitDegreeMultiplier;
    const roundedDamageComponent = Math.round(preRoundedDamage);
    const constantBonus = 1;
    return constantBonus + roundedDamageComponent;
  }

  static longestCommonSubstringLength(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
      throw new TypeError('Utils.longestCommonSubstringLength requires two string arguments.');
    }
    if (!a.length || !b.length) {
      return 0;
    }

    // Keep memory to O(min(len(a), len(b)))
    let shorter = a;
    let longer = b;
    if (b.length < a.length) {
      shorter = b;
      longer = a;
    }

    const prev = new Array(shorter.length + 1).fill(0);
    const curr = new Array(shorter.length + 1).fill(0);
    let longest = 0;

    for (let i = 1; i <= longer.length; i += 1) {
      const longChar = longer.charAt(i - 1);
      for (let j = 1; j <= shorter.length; j += 1) {
        if (longChar === shorter.charAt(j - 1)) {
          curr[j] = prev[j - 1] + 1;
          if (curr[j] > longest) {
            longest = curr[j];
          }
        } else {
          curr[j] = 0;
        }
      }
      // swap buffers
      for (let k = 1; k < curr.length; k += 1) {
        prev[k] = curr[k];
        curr[k] = 0;
      }
    }

    return longest;
  }

  static #getNpcNameStopwords() {
    const stopwords = new Set();
    let Player = null;
    try {
      Player = Utils.#getPlayerModule();
    } catch (_) {
      return stopwords;
    }
    if (!Player || typeof Player.getAll !== 'function') {
      return stopwords;
    }

    let players = [];
    try {
      players = Player.getAll();
    } catch (_) {
      return stopwords;
    }
    if (!Array.isArray(players)) {
      return stopwords;
    }

    for (const player of players) {
      if (!player || player.isNPC !== true || typeof player.name !== 'string') {
        continue;
      }
      const nameTokens = player.name
        .toLowerCase()
        .replace(/[^a-z0-9']+/gi, ' ')
        .split(/\s+/)
        .map(t => t.trim())
        .filter(t => t && /[a-z0-9]/i.test(t));
      for (const token of nameTokens) {
        stopwords.add(token);
      }

      let aliases = [];
      try {
        if (typeof player.getAliases === 'function') {
          aliases = player.getAliases();
        } else if (player.aliases instanceof Set) {
          aliases = Array.from(player.aliases);
        } else if (Array.isArray(player.aliases)) {
          aliases = player.aliases.slice(0);
        }
      } catch (_) {
        aliases = [];
      }

      if (Array.isArray(aliases)) {
        for (const alias of aliases) {
          if (typeof alias !== 'string') {
            continue;
          }
          const aliasTokens = alias
            .toLowerCase()
            .replace(/[^a-z0-9']+/gi, ' ')
            .split(/\s+/)
            .map(t => t.trim())
            .filter(t => t && /[a-z0-9]/i.test(t));
          for (const token of aliasTokens) {
            stopwords.add(token);
          }
        }
      }
    }
    return stopwords;
  }

  static #normalizeKgramTokens(text, { excludeNpcNames = true } = {}) {
    const npcNameStopwords = excludeNpcNames ? Utils.#getNpcNameStopwords() : null;
    return text
      .toLowerCase()
      .replace(/[^a-z0-9']+/gi, ' ')
      .split(/\s+/)
      .map(t => t.trim())
      .filter(t => t && /[a-z0-9]/i.test(t))
      .filter(t => !COMMON_WORDS.has(t))
      .filter(t => !npcNameStopwords || !npcNameStopwords.has(t));
  }

  static normalizeKgramTokens(text, options = {}) {
    if (typeof text !== 'string') {
      throw new TypeError('Utils.normalizeKgramTokens requires a string argument.');
    }
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Utils.normalizeKgramTokens options must be an object.');
    }
    return Utils.#normalizeKgramTokens(text, options);
  }

  static #buildKgramSet(tokens, k) {
    const kgrams = new Set();
    for (let i = 0; i <= tokens.length - k; i += 1) {
      kgrams.add(tokens.slice(i, i + k).join(' '));
    }
    return kgrams;
  }

  static #containsSubgram(containerTokens, subTokens) {
    if (!Array.isArray(containerTokens) || !Array.isArray(subTokens)) {
      throw new TypeError('Utils.#containsSubgram requires token arrays.');
    }
    if (!subTokens.length || containerTokens.length < subTokens.length) {
      return false;
    }
    for (let i = 0; i <= containerTokens.length - subTokens.length; i += 1) {
      let matches = true;
      for (let j = 0; j < subTokens.length; j += 1) {
        if (containerTokens[i + j] !== subTokens[j]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return true;
      }
    }
    return false;
  }

  static pruneContainedKgrams(ngrams) {
    if (!Array.isArray(ngrams)) {
      throw new TypeError('Utils.pruneContainedKgrams requires an array of n-gram strings.');
    }
    if (!ngrams.length) {
      return [];
    }
    const candidates = ngrams.map((gram, index) => {
      if (typeof gram !== 'string' || !gram.trim()) {
        throw new TypeError('Utils.pruneContainedKgrams expects non-empty n-gram strings.');
      }
      const cleaned = gram.trim();
      return { gram: cleaned, index, tokens: cleaned.split(/\s+/) };
    });
    candidates.sort((a, b) => {
      const lengthDelta = b.tokens.length - a.tokens.length;
      if (lengthDelta !== 0) {
        return lengthDelta;
      }
      return a.index - b.index;
    });

    const kept = [];
    for (const candidate of candidates) {
      let contained = false;
      for (const existing of kept) {
        if (Utils.#containsSubgram(existing.tokens, candidate.tokens)) {
          contained = true;
          break;
        }
      }
      if (!contained) {
        kept.push(candidate);
      }
    }

    kept.sort((a, b) => a.index - b.index);
    return kept.map(item => item.gram);
  }

  static hasKgramOverlap(a, b, { k = 10, minMatches = 1 } = {}) {
    if (typeof a !== 'string' || typeof b !== 'string') {
      throw new TypeError('Utils.hasKgramOverlap requires two string arguments.');
    }
    const tokensA = Utils.#normalizeKgramTokens(a);
    const tokensB = Utils.#normalizeKgramTokens(b);
    if (tokensA.length < k || tokensB.length < k) {
      return false;
    }

    const small = tokensA.length <= tokensB.length ? tokensA : tokensB;
    const large = small === tokensA ? tokensB : tokensA;

    const smallKgrams = Utils.#buildKgramSet(small, k);
    let matches = 0;
    for (let i = 0; i <= large.length - k; i += 1) {
      const gram = large.slice(i, i + k).join(' ');
      if (smallKgrams.has(gram)) {
        matches += 1;
        if (matches >= minMatches) {
          return true;
        }
      }
    }
    return false;
  }

  static findKgramOverlaps(a, b, { minK = 4, maxK = null } = {}) {
    if (typeof a !== 'string' || typeof b !== 'string') {
      throw new TypeError('Utils.findKgramOverlaps requires two string arguments.');
    }
    const tokensA = Utils.#normalizeKgramTokens(a);
    const tokensB = Utils.#normalizeKgramTokens(b);
    if (!Number.isInteger(minK) || minK < 1) {
      throw new RangeError('Utils.findKgramOverlaps requires minK to be a positive integer.');
    }
    if (tokensA.length < minK || tokensB.length < minK) {
      return [];
    }

    let resolvedMaxK = maxK;
    if (!Number.isInteger(resolvedMaxK) || resolvedMaxK < minK) {
      resolvedMaxK = Math.min(tokensA.length, tokensB.length);
    }

    const small = tokensA.length <= tokensB.length ? tokensA : tokensB;
    const large = small === tokensA ? tokensB : tokensA;
    const overlaps = [];
    const overlapSet = new Set();
    const spans = [];

    for (let k = resolvedMaxK; k >= minK; k -= 1) {
      const smallKgrams = Utils.#buildKgramSet(small, k);
      for (let i = 0; i <= large.length - k; i += 1) {
        const gram = large.slice(i, i + k).join(' ');
        if (!smallKgrams.has(gram)) {
          continue;
        }
        if (overlapSet.has(gram)) {
          continue;
        }

        const start = i;
        const end = i + k;
        let overlapsExisting = false;
        for (const span of spans) {
          if (start < span.end && end > span.start) {
            overlapsExisting = true;
            break;
          }
        }
        if (overlapsExisting) {
          continue;
        }

        overlaps.push(gram);
        overlapSet.add(gram);
        spans.push({ start, end });
      }
    }

    return overlaps;
  }

  static findKgramOverlap(a, b, { k = 10 } = {}) {
    if (typeof a !== 'string' || typeof b !== 'string') {
      throw new TypeError('Utils.findKgramOverlap requires two string arguments.');
    }
    const tokensA = Utils.#normalizeKgramTokens(a);
    const tokensB = Utils.#normalizeKgramTokens(b);
    if (tokensA.length < k || tokensB.length < k) {
      return null;
    }

    const small = tokensA.length <= tokensB.length ? tokensA : tokensB;
    const large = small === tokensA ? tokensB : tokensA;

    const smallKgrams = Utils.#buildKgramSet(small, k);
    for (let i = 0; i <= large.length - k; i += 1) {
      const gram = large.slice(i, i + k).join(' ');
      if (smallKgrams.has(gram)) {
        return gram;
      }
    }

    return null;
  }

  static #getDomParserInstance() {
    if (!sharedDomParser) {
      sharedDomParser = new DOMParser({ onError: () => { } });
    }
    return sharedDomParser;
  }

  static #normalizeXmlWithCheerio(input) {
    if (input === null || input === undefined) {
      return '';
    }

    const source = typeof input === 'string' ? input : String(input);
    const trimmed = source.trim();
    if (!trimmed) {
      return '';
    }

    try {
      const $ = cheerio.load(trimmed, {
        xmlMode: true,
        decodeEntities: false,
        recognizeCDATA: true,
        lowerCaseTags: false,
        lowerCaseAttributeNames: false
      });

      // Remove punctuation from all attribute names
      $('*').each((_, elem) => {
        const attribs = elem.attribs || {};
        for (const attrName of Object.keys(attribs)) {
          const normalizedAttrName = attrName.replace(/[^\w-]/g, '');
          if (normalizedAttrName !== attrName) {
            const value = attribs[attrName];
            delete attribs[attrName];
            attribs[normalizedAttrName] = value;
          }
        }
      });

      const normalized = $.xml();
      return typeof normalized === 'string' && normalized.trim() ? normalized : trimmed;
    } catch (error) {
      console.warn('Failed to normalize XML via cheerio:', error.message);
      return trimmed;
    }
  }

  static parseXmlDocument(xmlContent, mimeType = 'text/xml') {
    if (xmlContent === null || xmlContent === undefined) {
      throw new TypeError('Utils.parseXmlDocument requires a string input.');
    }

    let normalized = '';
    if (!Globals.config.strictXMLParsing) {
      normalized = this.#normalizeXmlWithCheerio(xmlContent);
    } else {
      normalized = typeof xmlContent === 'string' ? xmlContent.trim() : String(xmlContent).trim();
    }
    const parser = this.#getDomParserInstance();

    try {
      return parser.parseFromString(normalized, mimeType || 'text/xml');
    } catch (error) {
      console.log('XML Content:', normalized);
      throw new Error(`Failed to parse XML content: ${error.message}`);
    }
  }

  /* Capitalizes the first letter of each word in a string, except for small words that aren't supposed to be capitalized in titles (like "and", "the", "of", etc.), unless they are the first or last word. */
  static capitalizeProperNoun(str, options = {}) {
    if (options === null || Array.isArray(options) || typeof options !== "object") {
      throw new TypeError("Utils.capitalizeProperNoun options must be an object.");
    }
    const { remove_articles = false } = options;
    if (typeof remove_articles !== "boolean") {
      throw new TypeError("Utils.capitalizeProperNoun remove_articles must be a boolean.");
    }
    const smallWords = [
      "and", "the", "of", "in", "on", "at", "to", "for", "by", "with", "a", "an", "but", "or", "nor", "as", "from", "with"
    ];
    if (!str || typeof str !== "string") return "";
    const words = str.split(/\s+/);
    if (remove_articles) {
      const nonEmptyWords = words.filter((word) => word.length > 0);
      if (nonEmptyWords.length > 1) {
        const firstWord = nonEmptyWords[0].toLowerCase();
        if (firstWord === "a" || firstWord === "an" || firstWord === "the") {
          const firstIndex = words.findIndex((word) => word.length > 0);
          if (firstIndex !== -1) {
            words.splice(firstIndex, 1);
          }
        }
      }
    }
    return words
      .map((word, idx) => {
        const lower = word.toLowerCase();
        if (
          idx !== 0 &&
          idx !== words.length - 1 &&
          smallWords.includes(lower)
        ) {
          return lower;
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(" ");
  }

  static #getLocationModule() {
    if (!cachedLocationModule) {
      cachedLocationModule = require('./Location.js');
    }
    return cachedLocationModule;
  }

  static #getLocationExitModule() {
    if (!cachedLocationExitModule) {
      cachedLocationExitModule = require('./LocationExit.js');
    }
    return cachedLocationExitModule;
  }

  static #getRegionModule() {
    if (!cachedRegionModule) {
      cachedRegionModule = require('./Region.js');
    }
    return cachedRegionModule;
  }

  static #getThingModule() {
    if (!cachedThingModule) {
      cachedThingModule = require('./Thing.js');
    }
    return cachedThingModule;
  }

  static #getPlayerModule() {
    if (!cachedPlayerModule) {
      cachedPlayerModule = require('./Player.js');
    }
    return cachedPlayerModule;
  }

  static #getSkillModule() {
    if (!cachedSkillModule) {
      cachedSkillModule = require('./Skill.js');
    }
    return cachedSkillModule;
  }

  static #getFactionModule() {
    if (!cachedFactionModule) {
      cachedFactionModule = require('./Faction.js');
    }
    return cachedFactionModule;
  }

  static serializeGameState(context = {}) {
    const {
      currentPlayer = null,
      gameLocations = new Map(),
      gameLocationExits = new Map(),
      regions = new Map(),
      chatHistory = [],
      generatedImages = new Map(),
      things = new Map(),
      players = new Map(),
      skills = new Map(),
      factions = new Map(),
      currentSetting = null,
      pendingRegionStubs = null
    } = context;

    const serialized = {};

    const Location = this.#getLocationModule();
    const LocationExit = this.#getLocationExitModule();
    const Region = this.#getRegionModule();

    serialized.gameWorld = {
      locations: Object.fromEntries(
        Array.from(gameLocations.entries()).map(([id, location]) => {
          if (location && typeof location.toJSON === 'function') {
            return [id, location.toJSON()];
          }
          return [id, null];
        })
      ),
      locationExits: Object.fromEntries(
        Array.from(gameLocationExits.entries()).map(([id, exit]) => {
          if (exit && typeof exit.toJSON === 'function') {
            return [id, exit.toJSON()];
          }
          return [id, null];
        })
      ),
      regions: Object.fromEntries(
        Array.from(regions.entries()).map(([id, region]) => {
          if (region && typeof region.toJSON === 'function') {
            return [id, region.toJSON()];
          }
          return [id, null];
        })
      )
    };

    serialized.chatHistory = Array.isArray(chatHistory) ? [...chatHistory] : [];
    serialized.generatedImages = Object.fromEntries(generatedImages);
    if (pendingRegionStubs instanceof Map) {
      serialized.pendingRegionStubs = Object.fromEntries(pendingRegionStubs);
    } else {
      serialized.pendingRegionStubs = {};
    }

    serialized.things = Object.fromEntries(
      Array.from(things.entries()).map(([id, thing]) => {
        if (thing && typeof thing.toJSON === 'function') {
          return [id, thing.toJSON()];
        }
        return [id, null];
      })
    );

    serialized.players = Object.fromEntries(
      Array.from(players.entries()).map(([id, player]) => {
        if (player && typeof player.toJSON === 'function') {
          return [id, player.toJSON()];
        }
        return [id, null];
      })
    );

    serialized.factions = Object.fromEntries(
      Array.from(factions.entries()).map(([id, faction]) => {
        if (faction && typeof faction.toJSON === 'function') {
          return [id, faction.toJSON()];
        }
        return [id, null];
      })
    );

    const availableSkills = Array.from(skills.values()).map(skill => {
      if (skill && typeof skill.toJSON === 'function') {
        return skill.toJSON();
      }
      return null;
    }).filter(Boolean);

    serialized.skills = availableSkills;

    serialized.metadata = {
      timestamp: new Date().toISOString(),
      playerName: currentPlayer?.name || null,
      playerId: currentPlayer?.id || null,
      playerLevel: currentPlayer?.level || null,
      gameVersion: '1.0.0',
      chatHistoryLength: Array.isArray(chatHistory) ? chatHistory.length : 0,
      totalPlayers: players.size,
      totalThings: things.size,
      totalLocations: gameLocations.size,
      totalLocationExits: gameLocationExits.size,
      totalRegions: regions.size,
      totalFactions: factions.size,
      totalGeneratedImages: generatedImages.size,
      totalSkills: skills.size,
      currentSettingId: currentSetting?.id || null,
      currentSettingName: currentSetting?.name || null
    };

    serialized.setting = null;
    if (currentSetting) {
      if (typeof currentSetting.toJSON === 'function') {
        serialized.setting = currentSetting.toJSON();
      } else {
        try {
          serialized.setting = JSON.parse(JSON.stringify(currentSetting));
        } catch (_) {
          serialized.setting = null;
        }
      }
    }

    serialized.worldTime = Globals.getSerializedWorldTime();
    serialized.calendarDefinition = Globals.getSerializedCalendarDefinition();

    serialized.chatSummaries = this.serializeChatSummaries();

    const sceneSummaries = Globals.getSceneSummaries();
    if (!sceneSummaries || typeof sceneSummaries.serialize !== 'function') {
      throw new Error('Scene summaries are unavailable for serialization.');
    }
    serialized.sceneSummaries = sceneSummaries.serialize();


    return serialized;
  }

  static writeSerializedGameState(saveDir, serialized) {
    if (!saveDir || typeof saveDir !== 'string') {
      throw new Error('writeSerializedGameState requires a target directory');
    }
    if (!serialized || typeof serialized !== 'object') {
      throw new Error('writeSerializedGameState requires serialized data');
    }

    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }

    const ensureFile = (filename, data) => {
      const filePath = path.join(saveDir, filename);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    };

    ensureFile('gameWorld.json', serialized.gameWorld || {});
    ensureFile('chatHistory.json', serialized.chatHistory || []);
    ensureFile('images.json', serialized.generatedImages || {});
    ensureFile('things.json', serialized.things || {});
    ensureFile('allPlayers.json', serialized.players || {});
    ensureFile('factions.json', serialized.factions || {});
    ensureFile('skills.json', serialized.skills || []);
    ensureFile('metadata.json', serialized.metadata || {});
    ensureFile('pendingRegionStubs.json', serialized.pendingRegionStubs || {});
    ensureFile('worldTime.json', serialized.worldTime || {});
    ensureFile('calendarDefinition.json', serialized.calendarDefinition || {});

    if (serialized.setting) {
      ensureFile('setting.json', serialized.setting);
    }

    ensureFile('chatSummaries.json', serialized.chatSummaries || {});
    ensureFile('sceneSummaries.json', serialized.sceneSummaries || {});
  }

  static loadSerializedGameState(saveDir) {
    if (!saveDir || typeof saveDir !== 'string') {
      throw new Error('loadSerializedGameState requires a save directory');
    }

    const readJson = (filename, fallback) => {
      const filePath = path.join(saveDir, filename);
      if (!fs.existsSync(filePath)) {
        return fallback;
      }
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
      } catch (error) {
        console.warn(`Failed to read ${filename}:`, error.message);
        return fallback;
      }
    };

    const serialized = {
      gameWorld: readJson('gameWorld.json', {}),
      chatHistory: readJson('chatHistory.json', []),
      generatedImages: readJson('images.json', {}),
      things: readJson('things.json', {}),
      players: readJson('allPlayers.json', {}),
      factions: readJson('factions.json', {}),
      skills: readJson('skills.json', []),
      metadata: readJson('metadata.json', {}),
      setting: readJson('setting.json', null),
      chatSummaries: readJson('chatSummaries.json', {}),
      sceneSummaries: readJson('sceneSummaries.json', {}),
      pendingRegionStubs: readJson('pendingRegionStubs.json', {}),
      worldTime: readJson('worldTime.json', null),
      calendarDefinition: readJson('calendarDefinition.json', null)
    };

    return serialized;
  }

  static #migrateLegacyHourValueToMinutes(value, { allowNegative = false } = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return value;
    }
    if (numeric < 0) {
      return allowNegative ? numeric : value;
    }
    return Math.round(numeric * 60);
  }

  static #migrateLegacyWorldTimeSnapshotToMinutes(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(snapshot, 'timeMinutes')) {
      const timeMinutes = Number(snapshot.timeMinutes);
      if (Number.isFinite(timeMinutes) && timeMinutes >= 0) {
        snapshot.timeMinutes = Math.round(timeMinutes);
      }
      return;
    }

    if (Object.prototype.hasOwnProperty.call(snapshot, 'timeHours')) {
      const timeMinutes = Utils.#migrateLegacyHourValueToMinutes(snapshot.timeHours);
      if (Number.isFinite(Number(timeMinutes))) {
        snapshot.timeMinutes = Number(timeMinutes);
        delete snapshot.timeHours;
      }
    }
  }

  static #migrateLegacyStatusEffectEntryToMinutes(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(entry, 'duration')) {
      const duration = Number(entry.duration);
      if (Number.isFinite(duration)) {
        entry.duration = duration < 0 ? -1 : Math.round(duration * 60);
      }
    }

    if (Object.prototype.hasOwnProperty.call(entry, 'appliedAt')) {
      const appliedAt = Number(entry.appliedAt);
      if (Number.isFinite(appliedAt) && appliedAt >= 0) {
        entry.appliedAt = Math.round(appliedAt * 60);
      }
    }
  }

  static #migrateLegacyStatusEffectCollectionToMinutes(collection) {
    if (!collection) {
      return;
    }
    if (Array.isArray(collection)) {
      for (const entry of collection) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }
        Utils.#migrateLegacyStatusEffectEntryToMinutes(entry);
        if (entry.effect && typeof entry.effect === 'object') {
          Utils.#migrateLegacyStatusEffectEntryToMinutes(entry.effect);
        }
      }
      return;
    }
    if (typeof collection === 'object') {
      Utils.#migrateLegacyStatusEffectEntryToMinutes(collection);
      if (collection.effect && typeof collection.effect === 'object') {
        Utils.#migrateLegacyStatusEffectEntryToMinutes(collection.effect);
      }
    }
  }

  static #migrateLegacyWeatherDefinitionToMinutes(weather) {
    if (!weather || typeof weather !== 'object' || Array.isArray(weather)) {
      return;
    }
    const seasonWeather = Array.isArray(weather.seasonWeather) ? weather.seasonWeather : [];
    for (const seasonEntry of seasonWeather) {
      if (!seasonEntry || typeof seasonEntry !== 'object' || Array.isArray(seasonEntry)) {
        continue;
      }
      const weatherTypes = Array.isArray(seasonEntry.weatherTypes) ? seasonEntry.weatherTypes : [];
      for (const weatherType of weatherTypes) {
        if (!weatherType || typeof weatherType !== 'object' || Array.isArray(weatherType)) {
          continue;
        }
        const range = weatherType.durationRange;
        if (!range || typeof range !== 'object' || Array.isArray(range)) {
          continue;
        }
        const hasMinutes = Object.prototype.hasOwnProperty.call(range, 'minMinutes')
          || Object.prototype.hasOwnProperty.call(range, 'maxMinutes');
        if (hasMinutes) {
          continue;
        }
        const minMinutes = Utils.#migrateLegacyHourValueToMinutes(range.minHours);
        const maxMinutes = Utils.#migrateLegacyHourValueToMinutes(range.maxHours);
        if (Number.isFinite(Number(minMinutes)) && Number.isFinite(Number(maxMinutes))) {
          range.minMinutes = Number(minMinutes);
          range.maxMinutes = Number(maxMinutes);
          delete range.minHours;
          delete range.maxHours;
        }
      }
    }
  }

  static #migrateLegacyWeatherStateToMinutes(weatherState) {
    if (!weatherState || typeof weatherState !== 'object' || Array.isArray(weatherState)) {
      return;
    }
    const hasMinutes = Object.prototype.hasOwnProperty.call(weatherState, 'nextChangeMinutes')
      || Object.prototype.hasOwnProperty.call(weatherState, 'durationMinutes');
    if (hasMinutes) {
      return;
    }
    const nextChangeMinutes = Utils.#migrateLegacyHourValueToMinutes(weatherState.nextChangeHours);
    const durationMinutes = Utils.#migrateLegacyHourValueToMinutes(weatherState.durationHours);
    if (Number.isFinite(Number(nextChangeMinutes)) && Number.isFinite(Number(durationMinutes))) {
      weatherState.nextChangeMinutes = Number(nextChangeMinutes);
      weatherState.durationMinutes = Number(durationMinutes);
      delete weatherState.nextChangeHours;
      delete weatherState.durationHours;
    }
  }

  static #migrateLegacyHourBasedSaveToMinutes(serialized) {
    if (!serialized || typeof serialized !== 'object' || Array.isArray(serialized)) {
      return false;
    }

    const worldTime = serialized.worldTime;
    const isLegacyWorldTime = Boolean(
      worldTime
      && typeof worldTime === 'object'
      && !Array.isArray(worldTime)
      && !Object.prototype.hasOwnProperty.call(worldTime, 'timeMinutes')
      && Object.prototype.hasOwnProperty.call(worldTime, 'timeHours')
    );

    if (!isLegacyWorldTime) {
      return false;
    }

    Utils.#migrateLegacyWorldTimeSnapshotToMinutes(serialized.worldTime);

    const playersData = serialized.players && typeof serialized.players === 'object'
      ? serialized.players
      : {};
    for (const payload of Object.values(playersData)) {
      if (!payload || typeof payload !== 'object') {
        continue;
      }
      if (Number.isFinite(Number(payload.elapsedTime)) && Number(payload.elapsedTime) >= 0) {
        payload.elapsedTime = Utils.#migrateLegacyHourValueToMinutes(payload.elapsedTime);
      }
      if (Number.isFinite(Number(payload.lastVisitedTime)) && Number(payload.lastVisitedTime) >= 0) {
        payload.lastVisitedTime = Utils.#migrateLegacyHourValueToMinutes(payload.lastVisitedTime);
      }
      Utils.#migrateLegacyStatusEffectCollectionToMinutes(payload.statusEffects);
    }

    const thingsData = serialized.things && typeof serialized.things === 'object'
      ? serialized.things
      : {};
    for (const payload of Object.values(thingsData)) {
      if (!payload || typeof payload !== 'object') {
        continue;
      }
      Utils.#migrateLegacyStatusEffectCollectionToMinutes(payload.statusEffects);
      Utils.#migrateLegacyStatusEffectCollectionToMinutes(payload.causeStatusEffect);
      Utils.#migrateLegacyStatusEffectCollectionToMinutes(payload.causeStatusEffectOnTarget);
      Utils.#migrateLegacyStatusEffectCollectionToMinutes(payload.causeStatusEffectOnEquipper);
      const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : null;
      if (metadata) {
        Utils.#migrateLegacyStatusEffectCollectionToMinutes(metadata.causeStatusEffect);
        Utils.#migrateLegacyStatusEffectCollectionToMinutes(metadata.causeStatusEffectOnTarget);
        Utils.#migrateLegacyStatusEffectCollectionToMinutes(metadata.causeStatusEffectOnEquipper);
      }
    }

    const worldData = serialized.gameWorld && typeof serialized.gameWorld === 'object'
      ? serialized.gameWorld
      : {};
    const locationEntries = worldData.locations && typeof worldData.locations === 'object'
      ? worldData.locations
      : {};
    for (const payload of Object.values(locationEntries)) {
      if (!payload || typeof payload !== 'object') {
        continue;
      }
      if (Number.isFinite(Number(payload.lastVisitedTime)) && Number(payload.lastVisitedTime) >= 0) {
        payload.lastVisitedTime = Utils.#migrateLegacyHourValueToMinutes(payload.lastVisitedTime);
      }
      Utils.#migrateLegacyStatusEffectCollectionToMinutes(payload.statusEffects);
    }

    const regionEntries = worldData.regions && typeof worldData.regions === 'object'
      ? worldData.regions
      : {};
    for (const payload of Object.values(regionEntries)) {
      if (!payload || typeof payload !== 'object') {
        continue;
      }
      if (Number.isFinite(Number(payload.lastVisitedTime)) && Number(payload.lastVisitedTime) >= 0) {
        payload.lastVisitedTime = Utils.#migrateLegacyHourValueToMinutes(payload.lastVisitedTime);
      }
      Utils.#migrateLegacyStatusEffectCollectionToMinutes(payload.statusEffects);
      Utils.#migrateLegacyWeatherDefinitionToMinutes(payload.weather);
      Utils.#migrateLegacyWeatherStateToMinutes(payload.weatherState);
    }

    const metadata = serialized.metadata && typeof serialized.metadata === 'object'
      ? serialized.metadata
      : null;
    if (metadata && metadata.offscreenNpcActivityState && typeof metadata.offscreenNpcActivityState === 'object') {
      const offscreen = metadata.offscreenNpcActivityState;
      Utils.#migrateLegacyWorldTimeSnapshotToMinutes(offscreen.lastDailyPromptWorldTime);
      Utils.#migrateLegacyWorldTimeSnapshotToMinutes(offscreen.lastWeeklyPromptWorldTime);
    }

    return true;
  }

  static hydrateGameState(serialized, context = {}) {
    if (!serialized || typeof serialized !== 'object') {
      throw new Error('hydrateGameState requires serialized data');
    }

    const migratedLegacyTimeData = Utils.#migrateLegacyHourBasedSaveToMinutes(serialized);
    if (migratedLegacyTimeData) {
      console.log('⏱️ Migrated legacy hour-based save fields to minute-based canonical values.');
    }

    const {
      gameLocations,
      gameLocationExits,
      regions,
      chatHistoryRef,
      generatedImages,
      things,
      players,
      skills,
      factions,
      jobQueue,
      imageJobs,
      pendingLocationImages,
      npcGenerationPromises,
      pendingRegionStubs
    } = context;

    Globals.hydrateWorldTime({
      worldTime: serialized.worldTime || null,
      calendarDefinition: serialized.calendarDefinition || null,
      settingName: serialized.setting?.name || null
    });

    const Location = this.#getLocationModule();
    const LocationExit = this.#getLocationExitModule();
    const Region = this.#getRegionModule();
    const Thing = this.#getThingModule();
    const Player = this.#getPlayerModule();
    const Skill = this.#getSkillModule();
    const Faction = this.#getFactionModule();

    this.loadChatSummaries(serialized.chatSummaries || {});
    const sceneSummaries = Globals.getSceneSummaries();
    if (!sceneSummaries || typeof sceneSummaries.load !== 'function') {
      throw new Error('Scene summaries are unavailable during hydration.');
    }
    sceneSummaries.load(serialized.sceneSummaries || {});

    if (Array.isArray(jobQueue)) {
      jobQueue.length = 0;
    }
    if (imageJobs?.clear) {
      imageJobs.clear();
    }
    if (pendingLocationImages?.clear) {
      pendingLocationImages.clear();
    }
    if (npcGenerationPromises?.clear) {
      npcGenerationPromises.clear();
    }
    if (generatedImages?.clear) {
      generatedImages.clear();
    }

    if (skills?.clear) {
      skills.clear();
    }
    if (typeof Skill.setAvailableSkills === 'function') {
      Skill.setAvailableSkills(skills);
    }

    const skillsData = Array.isArray(serialized.skills) ? serialized.skills : [];
    for (const skillEntry of skillsData) {
      try {
        const skill = Skill.fromJSON(skillEntry);
        skills.set(skill.name, skill);
      } catch (error) {
        console.warn('Skipping invalid skill entry:', error.message);
      }
    }
    Player.setAvailableSkills(skills);

    if (factions?.clear) {
      factions.clear();
    }
    if (typeof Faction?.clear === 'function') {
      Faction.clear();
    }
    const factionsData = serialized.factions || {};
    for (const [id, payload] of Object.entries(factionsData)) {
      try {
        const faction = Faction.fromJSON(payload);
        if (faction && faction.id) {
          factions.set(id, faction);
        }
      } catch (error) {
        console.warn('Skipping invalid faction entry:', error.message);
      }
    }

    if (things?.clear) {
      things.clear();
    }
    if (typeof Thing.clear === 'function') {
      Thing.clear();
    }
    const thingsData = serialized.things || {};
    for (const [id, payload] of Object.entries(thingsData)) {
      try {
        const thing = Thing.fromJSON(payload);
        things.set(id, thing);
      } catch (error) {
        console.warn('Skipping invalid thing entry:', error.message);
      }
    }

    if (players?.clear) {
      players.clear();
    }
    const playersData = serialized.players || {};
    for (const [id, payload] of Object.entries(playersData)) {
      try {
        const player = Player.fromJSON(payload);
        if (typeof player.syncSkillsWithAvailable === 'function') {
          player.syncSkillsWithAvailable();
        }
        players.set(id, player);
      } catch (error) {
        console.warn('Skipping invalid player entry:', error.message);
      }
    }

    const generatedImageEntries = serialized.generatedImages || {};
    for (const [id, imageData] of Object.entries(generatedImageEntries)) {
      generatedImages.set(id, imageData);
    }

    if (Array.isArray(chatHistoryRef)) {
      chatHistoryRef.length = 0;
      const loadedHistory = Array.isArray(serialized.chatHistory) ? serialized.chatHistory : [];
      chatHistoryRef.push(...loadedHistory);
    }

    if (gameLocations?.clear) {
      gameLocations.clear();
    }
    if (gameLocationExits?.clear) {
      gameLocationExits.clear();
    }
    if (regions?.clear) {
      regions.clear();
    }
    if (Region?.clear) {
      Region.clear();
    }
    if (pendingRegionStubs?.clear) {
      pendingRegionStubs.clear();
    }

    const worldData = serialized.gameWorld || {};
    const locationEntries = worldData.locations || {};
    const exitEntries = worldData.locationExits || {};
    const regionEntries = worldData.regions || {};

    for (const [id, locationData] of Object.entries(locationEntries)) {
      if (!locationData) {
        continue;
      }
      const location = new Location({
        description: locationData.description ?? null,
        shortDescription: locationData.shortDescription ?? null,
        baseLevel: locationData.baseLevel ?? null,
        id: locationData.id,
        regionId: locationData.regionId ?? null,
        controllingFactionId: locationData.controllingFactionId ?? null,
        checkRegionId: false,
        name: locationData.name ?? null,
        imageId: locationData.imageId ?? null,
        isStub: locationData.isStub ?? false,
        stubMetadata: locationData.stubMetadata ?? null,
        hasGeneratedStubs: locationData.hasGeneratedStubs ?? false,
        statusEffects: locationData.statusEffects || [],
        npcIds: locationData.npcIds || [],
        thingIds: locationData.thingIds || [],
        randomEvents: Array.isArray(locationData.randomEvents) ? locationData.randomEvents : [],
        lastVisitedTime: Number.isFinite(Number(locationData.lastVisitedTime))
          ? Number(locationData.lastVisitedTime)
          : null
      });

      if (Object.prototype.hasOwnProperty.call(locationData, 'visited')) {
        try {
          location.visited = Boolean(locationData.visited);
        } catch (error) {
          console.warn(`Failed to restore visited state for location ${location.id}:`, error.message);
        }
      }

      const exitsByDirection = locationData.exits || {};
      for (const [direction, exitInfo] of Object.entries(exitsByDirection)) {
        if (!exitInfo || !exitInfo.destination) {
          continue;
        }

        const exitId = exitInfo.id || undefined;
        let exit = exitId ? gameLocationExits.get(exitId) : null;

        if (!exit) {
          exit = new LocationExit({
            description: exitInfo.description || `${exitInfo.destination}`,
            destination: exitInfo.destination,
            destinationRegion: exitInfo.destinationRegion || null,
            bidirectional: exitInfo.bidirectional !== false,
            id: exitId,
            isVehicle: Boolean(exitInfo.isVehicle || exitInfo.vehicleType),
            vehicleType: exitInfo.vehicleType || null
          });
          gameLocationExits.set(exit.id, exit);
        } else {
          if (exitInfo.description) {
            try {
              exit.description = exitInfo.description;
            } catch (_) {
              exit.update({ description: exitInfo.description });
            }
          }
          try {
            exit.destination = exitInfo.destination;
          } catch (_) {
            exit.update({ destination: exitInfo.destination });
          }
          try {
            exit.bidirectional = exitInfo.bidirectional !== false;
          } catch (_) {
            exit.update({ bidirectional: exitInfo.bidirectional !== false });
          }
          try {
            exit.destinationRegion = exitInfo.destinationRegion || null;
          } catch (_) {
            exit.update({ destinationRegion: exitInfo.destinationRegion || null });
          }
          try {
            exit.isVehicle = Boolean(exitInfo.isVehicle || exitInfo.vehicleType);
          } catch (_) {
            exit.update({ isVehicle: Boolean(exitInfo.isVehicle || exitInfo.vehicleType) });
          }
          try {
            exit.vehicleType = exitInfo.vehicleType || null;
          } catch (_) {
            exit.update({ vehicleType: exitInfo.vehicleType || null });
          }
        }

        location.addExit(direction, exit);
      }

      gameLocations.set(id, location);
    }

    for (const [id, exitData] of Object.entries(exitEntries)) {
      if (gameLocationExits.has(id) || !exitData) {
        continue;
      }
      const exit = new LocationExit({
        description: exitData.description,
        destination: exitData.destination,
        destinationRegion: exitData.destinationRegion || null,
        bidirectional: exitData.bidirectional,
        id: exitData.id,
        isVehicle: Boolean(exitData.isVehicle || exitData.vehicleType),
        vehicleType: exitData.vehicleType || null
      });
      gameLocationExits.set(id, exit);
    }

    for (const [id, regionData] of Object.entries(regionEntries)) {
      if (!regionData) {
        continue;
      }
      try {
        const region = Region.fromJSON(regionData);
        regions.set(id, region);
      } catch (error) {
        console.warn(`Failed to load region ${id}:`, error.message);
      }
    }

    if (pendingRegionStubs instanceof Map) {
      const pendingEntries = serialized.pendingRegionStubs || {};
      for (const [id, pendingData] of Object.entries(pendingEntries)) {
        if (!id) {
          continue;
        }
        if (pendingData && typeof pendingData === 'object') {
          pendingRegionStubs.set(id, { id, ...pendingData });
        } else {
          pendingRegionStubs.set(id, { id });
        }
      }
    }

    this.rebuildPendingRegionStubs({
      pendingRegionStubs,
      regions,
      gameLocations,
      gameLocationExits
    });

    this.mergeDuplicatePendingRegionStubs({
      pendingRegionStubs,
      regions,
      gameLocations,
      gameLocationExits
    });

    return {
      metadata: serialized.metadata || {},
      setting: serialized.setting || null
    };
  }

  static rebuildPendingRegionStubs({
    pendingRegionStubs,
    regions,
    gameLocations,
    gameLocationExits
  } = {}) {
    if (!(pendingRegionStubs instanceof Map)) {
      throw new Error('pendingRegionStubs must be provided as a Map.');
    }

    const normalize = (value) => (typeof value === 'string' ? value.trim() : '');
    const normalizeOptional = (value) => {
      const normalized = normalize(value);
      return normalized || null;
    };

    const safeNumber = (value) => (Number.isFinite(value) ? value : null);

    const prefer = (primary, fallback) => {
      if (primary === null || primary === undefined) {
        return fallback;
      }
      if (typeof primary === 'string') {
        return primary.trim() ? primary : fallback;
      }
      return primary;
    };

    const ensurePendingEntry = (regionId, draft = {}) => {
      const normalizedRegionId = normalize(regionId);
      if (!normalizedRegionId) {
        throw new Error('Cannot rebuild pending region stub without a region id.');
      }
      if (regions instanceof Map && regions.has(normalizedRegionId)) {
        pendingRegionStubs.delete(normalizedRegionId);
        return;
      }

      const existing = pendingRegionStubs.get(normalizedRegionId) || { id: normalizedRegionId };
      const merged = { ...existing };

      const nameCandidate = prefer(existing.name, draft.name);
      merged.name = normalize(nameCandidate) || normalizedRegionId;
      merged.originalName = prefer(existing.originalName, draft.originalName) || merged.name;
      merged.description = prefer(existing.description, draft.description) || '';
      merged.relationship = prefer(existing.relationship, draft.relationship) || 'Adjacent';
      merged.relativeLevel = safeNumber(prefer(existing.relativeLevel, draft.relativeLevel));
      merged.parentRegionId = normalizeOptional(prefer(existing.parentRegionId, draft.parentRegionId));
      merged.sourceRegionId = normalizeOptional(prefer(existing.sourceRegionId, draft.sourceRegionId));
      merged.exitLocationId = normalizeOptional(prefer(existing.exitLocationId, draft.exitLocationId));
      merged.entranceStubId = normalizeOptional(prefer(existing.entranceStubId, draft.entranceStubId));
      merged.originDirection = normalizeOptional(prefer(existing.originDirection, draft.originDirection));
      merged.imageDataUrl = normalizeOptional(prefer(existing.imageDataUrl, draft.imageDataUrl));
      merged.createdAt = prefer(existing.createdAt, draft.createdAt) || new Date().toISOString();
      merged.id = normalizedRegionId;

      pendingRegionStubs.set(normalizedRegionId, merged);
    };

    if (regions instanceof Map) {
      for (const regionId of pendingRegionStubs.keys()) {
        if (regions.has(regionId)) {
          pendingRegionStubs.delete(regionId);
        }
      }
    }

    if (gameLocations instanceof Map) {
      for (const location of gameLocations.values()) {
        if (!location || !location.isStub) {
          continue;
        }
        const metadata = location.stubMetadata || {};
        if (!metadata.isRegionEntryStub) {
          continue;
        }
        const regionId = normalizeOptional(metadata.targetRegionId)
          || normalizeOptional(metadata.regionId)
          || normalizeOptional(location.regionId);
        if (!regionId) {
          throw new Error(`Region entry stub ${location.id || '<unknown>'} is missing a target region id.`);
        }

        const name = normalize(metadata.targetRegionName)
          || normalize(location.name)
          || normalize(metadata.originalName)
          || regionId;

        ensurePendingEntry(regionId, {
          id: regionId,
          name,
          originalName: normalize(metadata.originalName) || name,
          description: normalize(metadata.targetRegionDescription)
            || normalize(metadata.shortDescription)
            || normalize(location.description),
          relativeLevel: safeNumber(metadata.targetRegionRelativeLevel)
            ?? safeNumber(metadata.relativeLevel),
          parentRegionId: normalizeOptional(metadata.targetRegionParentId)
            || normalizeOptional(metadata.parentRegionId),
          sourceRegionId: normalizeOptional(metadata.originRegionId),
          exitLocationId: normalizeOptional(metadata.originLocationId),
          entranceStubId: normalizeOptional(location.id),
          originDirection: normalizeOptional(metadata.originDirection),
          imageDataUrl: normalizeOptional(metadata.imageDataUrl)
        });
      }
    }

    if (gameLocationExits instanceof Map) {
      for (const exit of gameLocationExits.values()) {
        if (!exit) {
          continue;
        }
        const regionId = normalizeOptional(exit.destinationRegion);
        if (!regionId) {
          continue;
        }
        if (regions instanceof Map && regions.has(regionId)) {
          pendingRegionStubs.delete(regionId);
          continue;
        }

        let destinationLocation = null;
        if (gameLocations instanceof Map) {
          destinationLocation = gameLocations.get(exit.destination);
        }

        const metadata = destinationLocation?.stubMetadata || {};
        const name = normalize(metadata.targetRegionName)
          || normalize(destinationLocation?.name)
          || regionId;

        ensurePendingEntry(regionId, {
          id: regionId,
          name,
          originalName: normalize(metadata.originalName) || name,
          description: normalize(metadata.targetRegionDescription)
            || normalize(metadata.shortDescription)
            || normalize(destinationLocation?.description),
          relativeLevel: safeNumber(metadata.targetRegionRelativeLevel)
            ?? safeNumber(metadata.relativeLevel),
          parentRegionId: normalizeOptional(metadata.targetRegionParentId)
            || normalizeOptional(metadata.parentRegionId),
          sourceRegionId: normalizeOptional(metadata.originRegionId),
          exitLocationId: normalizeOptional(metadata.originLocationId),
          entranceStubId: normalizeOptional(destinationLocation?.id),
          originDirection: normalizeOptional(metadata.originDirection),
          imageDataUrl: normalizeOptional(metadata.imageDataUrl)
        });
      }
    }
  }

  static mergeDuplicatePendingRegionStubs({
    pendingRegionStubs,
    regions,
    gameLocations,
    gameLocationExits
  } = {}) {
    if (!(pendingRegionStubs instanceof Map)) {
      throw new Error('mergeDuplicatePendingRegionStubs requires pendingRegionStubs as a Map.');
    }
    if (pendingRegionStubs.size === 0) {
      return;
    }
    if (!(gameLocations instanceof Map)) {
      throw new Error('mergeDuplicatePendingRegionStubs requires gameLocations as a Map.');
    }
    if (!(gameLocationExits instanceof Map)) {
      throw new Error('mergeDuplicatePendingRegionStubs requires gameLocationExits as a Map.');
    }

    const normalize = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
    const normalizeOptional = (value) => {
      const normalized = typeof value === 'string' ? value.trim() : '';
      return normalized || null;
    };
    const safeNumber = (value) => (Number.isFinite(value) ? value : null);

    const resolveStubNameKey = (entry) => {
      const raw = entry?.name || entry?.originalName || entry?.targetRegionName || entry?.id || '';
      const normalized = normalize(raw);
      if (!normalized) {
        throw new Error('Pending region stub is missing a usable name for deduplication.');
      }
      return normalized;
    };

    const entranceRefCounts = new Map();
    for (const location of gameLocations.values()) {
      if (!location || typeof location.getAvailableDirections !== 'function') {
        continue;
      }
      for (const direction of location.getAvailableDirections()) {
        const exit = location.getExit(direction);
        const destinationId = exit?.destination;
        if (!destinationId) {
          continue;
        }
        entranceRefCounts.set(destinationId, (entranceRefCounts.get(destinationId) || 0) + 1);
      }
    }

    const groups = new Map();
    for (const entry of pendingRegionStubs.values()) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const key = resolveStubNameKey(entry);
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(entry);
    }

    const parseTimestamp = (value) => {
      const parsed = Date.parse(value || '');
      return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
    };

    const mergeInto = (base, incoming) => {
      const merged = { ...base };
      const pickString = (primary, fallback) => {
        const primaryTrimmed = typeof primary === 'string' ? primary.trim() : '';
        if (primaryTrimmed) {
          return primaryTrimmed;
        }
        const fallbackTrimmed = typeof fallback === 'string' ? fallback.trim() : '';
        return fallbackTrimmed || primaryTrimmed;
      };

      merged.name = pickString(merged.name, incoming.name);
      merged.originalName = pickString(merged.originalName, incoming.originalName) || merged.name;
      merged.description = pickString(merged.description, incoming.description);
      merged.relationship = pickString(merged.relationship, incoming.relationship) || 'Adjacent';
      merged.parentRegionId = normalizeOptional(merged.parentRegionId || incoming.parentRegionId);
      merged.sourceRegionId = normalizeOptional(merged.sourceRegionId || incoming.sourceRegionId);
      merged.exitLocationId = normalizeOptional(merged.exitLocationId || incoming.exitLocationId);
      merged.entranceStubId = normalizeOptional(merged.entranceStubId || incoming.entranceStubId);
      merged.originDirection = normalizeOptional(merged.originDirection || incoming.originDirection);
      merged.imageDataUrl = normalizeOptional(merged.imageDataUrl || incoming.imageDataUrl);

      if (!Number.isFinite(merged.relativeLevel)) {
        merged.relativeLevel = safeNumber(incoming.relativeLevel);
      }

      const baseCreated = parseTimestamp(merged.createdAt);
      const incomingCreated = parseTimestamp(incoming.createdAt);
      merged.createdAt = baseCreated <= incomingCreated
        ? (merged.createdAt || incoming.createdAt || new Date().toISOString())
        : (incoming.createdAt || merged.createdAt || new Date().toISOString());

      merged.id = merged.id || incoming.id;
      return merged;
    };

    const updateStubMetadata = (location, canonicalId, canonicalName, canonicalDescription, canonicalRelativeLevel) => {
      if (!location || !location.isStub) {
        return;
      }
      const metadata = location.stubMetadata || {};
      if (!metadata.isRegionEntryStub) {
        return;
      }

      metadata.targetRegionId = canonicalId;
      metadata.regionId = canonicalId;
      if (canonicalName) {
        metadata.targetRegionName = canonicalName;
      }
      if (canonicalDescription) {
        metadata.targetRegionDescription = canonicalDescription;
      }
      if (canonicalRelativeLevel !== null) {
        metadata.targetRegionRelativeLevel = canonicalRelativeLevel;
        metadata.relativeLevel = canonicalRelativeLevel;
      }
      location.stubMetadata = metadata;
    };

    const rewireExitsToEntrance = (fromEntranceId, toEntranceId) => {
      if (!fromEntranceId || !toEntranceId || fromEntranceId === toEntranceId) {
        return;
      }
      for (const exit of gameLocationExits.values()) {
        if (exit?.destination === fromEntranceId) {
          exit.destination = toEntranceId;
        }
      }
    };

    const updateExitNamesForEntrance = (entranceId, name) => {
      if (!entranceId || !name) {
        return;
      }
      for (const exit of gameLocationExits.values()) {
        if (exit?.destination === entranceId) {
          exit.description = name;
        }
      }
    };

    for (const entries of groups.values()) {
      if (entries.length < 2) {
        continue;
      }

      entries.sort((a, b) => {
        const aEntranceId = normalizeOptional(a.entranceStubId);
        const bEntranceId = normalizeOptional(b.entranceStubId);
        const aEntranceCount = aEntranceId ? (entranceRefCounts.get(aEntranceId) || 0) : -1;
        const bEntranceCount = bEntranceId ? (entranceRefCounts.get(bEntranceId) || 0) : -1;
        if (aEntranceCount !== bEntranceCount) {
          return bEntranceCount - aEntranceCount;
        }
        const aHasEntrance = aEntranceId && gameLocations.has(aEntranceId);
        const bHasEntrance = bEntranceId && gameLocations.has(bEntranceId);
        if (aHasEntrance !== bHasEntrance) {
          return aHasEntrance ? -1 : 1;
        }
        const aCreated = parseTimestamp(a.createdAt);
        const bCreated = parseTimestamp(b.createdAt);
        if (aCreated !== bCreated) {
          return aCreated - bCreated;
        }
        return String(a.id || '').localeCompare(String(b.id || ''), undefined, { sensitivity: 'base' });
      });

      const canonical = entries[0];
      if (!canonical?.id) {
        throw new Error('Cannot merge pending region stubs: canonical entry is missing id.');
      }

      const canonicalEntranceId = normalizeOptional(canonical.entranceStubId)
        || entries.map(entry => normalizeOptional(entry.entranceStubId)).find(id => id && gameLocations.has(id));

      if (!canonicalEntranceId) {
        throw new Error(`Cannot merge pending region stubs for "${canonical.name || canonical.id}": missing entrance stub id.`);
      }

      let mergedCanonical = { ...canonical };

      for (const entry of entries) {
        if (!entry || entry.id === canonical.id) {
          continue;
        }

        mergedCanonical = mergeInto(mergedCanonical, entry);

        const entryEntranceId = normalizeOptional(entry.entranceStubId);
        if (entryEntranceId) {
          rewireExitsToEntrance(entryEntranceId, canonicalEntranceId);
          const entryLocation = gameLocations.get(entryEntranceId);
          if (entryLocation) {
            updateStubMetadata(
              entryLocation,
              canonical.id,
              mergedCanonical.name,
              mergedCanonical.description,
              safeNumber(mergedCanonical.relativeLevel)
            );
          }
        }

        pendingRegionStubs.delete(entry.id);
      }

      mergedCanonical.entranceStubId = canonicalEntranceId;
      pendingRegionStubs.set(canonical.id, mergedCanonical);

      const canonicalLocation = gameLocations.get(canonicalEntranceId);
      if (canonicalLocation) {
        updateStubMetadata(
          canonicalLocation,
          canonical.id,
          mergedCanonical.name,
          mergedCanonical.description,
          safeNumber(mergedCanonical.relativeLevel)
        );
      }

      const canonicalName = normalizeOptional(mergedCanonical.name)
        || normalizeOptional(mergedCanonical.originalName)
        || normalizeOptional(mergedCanonical.targetRegionName)
        || normalizeOptional(mergedCanonical.id);
      if (!canonicalName) {
        throw new Error('Merged region stub is missing a name to apply to exits.');
      }
      updateExitNamesForEntrance(canonicalEntranceId, canonicalName);

      if (regions instanceof Map && regions.has(canonical.id)) {
        pendingRegionStubs.delete(canonical.id);
      }
    }
  }

  static setChatSummary(messageId, summaryPayload = {}) {
    if (!messageId) {
      return;
    }
    const entry = {
      entryId: messageId,
      summary: typeof summaryPayload.summary === 'string' ? summaryPayload.summary : (summaryPayload.text || null),
      type: summaryPayload.type || null,
      timestamp: summaryPayload.timestamp || null,
      metadata: summaryPayload.metadata && typeof summaryPayload.metadata === 'object'
        ? { ...summaryPayload.metadata }
        : undefined
    };
    chatSummaryStore.set(messageId, entry);
  }

  static getChatSummary(messageId) {
    return messageId ? chatSummaryStore.get(messageId) || null : null;
  }

  static hasChatSummary(messageId) {
    return chatSummaryStore.has(messageId);
  }

  static serializeChatSummaries() {
    return Object.fromEntries(chatSummaryStore.entries());
  }

  static loadChatSummaries(data = {}) {
    chatSummaryStore.clear();
    if (!data || typeof data !== 'object') {
      return;
    }
    for (const [key, value] of Object.entries(data)) {
      if (!key) {
        continue;
      }
      if (value && typeof value === 'object') {
        chatSummaryStore.set(key, {
          entryId: key,
          summary: typeof value.summary === 'string' ? value.summary : null,
          type: value.type || null,
          timestamp: value.timestamp || null,
          metadata: value.metadata && typeof value.metadata === 'object' ? { ...value.metadata } : undefined
        });
      }
    }
  }

  static getAllChatSummaries() {
    return new Map(chatSummaryStore);
  }

  static enqueueChatSummaryCandidate(candidate = {}) {
    if (!candidate || !candidate.entryId || !candidate.content) {
      return;
    }
    if (chatSummaryQueue.some(item => item.entryId === candidate.entryId)) {
      return;
    }
    chatSummaryQueue.push({
      entryId: candidate.entryId,
      content: candidate.content,
      locationId: candidate.locationId || null,
      type: candidate.type || null,
      timestamp: candidate.timestamp || null
    });
  }

  static dequeueChatSummaryBatch(batchSize) {
    const size = Number(batchSize);
    if (!Number.isInteger(size) || size <= 0) {
      return [];
    }
    if (chatSummaryQueue.length < size) {
      return [];
    }
    return chatSummaryQueue.splice(0, size);
  }

  static getChatSummaryQueueLength() {
    return chatSummaryQueue.length;
  }

  static peekChatSummaryQueue() {
    return [...chatSummaryQueue];
  }
}

module.exports = Utils;
