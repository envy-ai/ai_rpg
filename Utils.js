const fs = require('fs');
const path = require('path');
const { DOMParser, XMLSerializer } = require('xmldom');

let cachedLocationModule = null;
let cachedLocationExitModule = null;
let cachedRegionModule = null;
let cachedThingModule = null;
let cachedPlayerModule = null;
let cachedSkillModule = null;
const chatSummaryStore = new Map();
const chatSummaryQueue = [];

class Utils {
  static intersection = (setA, setB) => new Set([...setA].filter(x => setB.has(x)));
  static difference = (setA, setB) => new Set([...setA].filter(x => !setB.has(x)));
  static union = (setA, setB) => new Set([...setA, ...setB]);
  static innerXML(node) {
    const s = new XMLSerializer();
    return Array.from(node.childNodes).map(n => s.serializeToString(n)).join('');
  }

  /* Capitalizes the first letter of each word in a string, except for small words that aren't supposed to be capitalized in titles (like "and", "the", "of", etc.), unless they are the first or last word. */
  static capitalizeProperNoun(str) {
    const smallWords = [
      "and", "the", "of", "in", "on", "at", "to", "for", "by", "with", "a", "an", "but", "or", "nor", "as", "from", "with"
    ];
    if (!str || typeof str !== "string") return "";
    const words = str.split(/\s+/);
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
      currentSetting = null
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

    serialized.chatSummaries = this.serializeChatSummaries();


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
    ensureFile('skills.json', serialized.skills || []);
    ensureFile('metadata.json', serialized.metadata || {});

    if (serialized.setting) {
      ensureFile('setting.json', serialized.setting);
    }

    ensureFile('chatSummaries.json', serialized.chatSummaries || {});
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
      skills: readJson('skills.json', []),
      metadata: readJson('metadata.json', {}),
      setting: readJson('setting.json', null),
      chatSummaries: readJson('chatSummaries.json', {})
    };

    return serialized;
  }

  static hydrateGameState(serialized, context = {}) {
    if (!serialized || typeof serialized !== 'object') {
      throw new Error('hydrateGameState requires serialized data');
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
      jobQueue,
      imageJobs,
      pendingLocationImages,
      npcGenerationPromises
    } = context;

    const Location = this.#getLocationModule();
    const LocationExit = this.#getLocationExitModule();
    const Region = this.#getRegionModule();
    const Thing = this.#getThingModule();
    const Player = this.#getPlayerModule();
    const Skill = this.#getSkillModule();

    this.loadChatSummaries(serialized.chatSummaries || {});

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
        baseLevel: locationData.baseLevel ?? null,
        id: locationData.id,
        regionId: locationData.regionId ?? null,
        checkRegionId: false,
        name: locationData.name ?? null,
        imageId: locationData.imageId ?? null,
        isStub: locationData.isStub ?? false,
        stubMetadata: locationData.stubMetadata ?? null,
        hasGeneratedStubs: locationData.hasGeneratedStubs ?? false,
        statusEffects: locationData.statusEffects || [],
        npcIds: locationData.npcIds || [],
        thingIds: locationData.thingIds || []
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

    return {
      metadata: serialized.metadata || {},
      setting: serialized.setting || null
    };
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
