const yaml = require('js-yaml');
const fs = require('fs');
const SanitizedStringMap = require('./SanitizedStringMap.js');
const { findPackageJSON } = require('module');
const Globals = require('./Globals.js');
const IdGenerator = require('./IdGenerator.js');
const { questRewardBenefitRegistry } = require('./QuestRewardBenefitRegistry.js');


class QuestObjective {
  #id = null;
  description = '';
  completed = false;
  optional = false;

  constructor(description, optional = false, id = null) {
    if (typeof description !== 'string' || !description.trim()) {
      throw new Error('QuestObjective description must be a non-empty string');
    }
    this.description = description;
    this.optional = Boolean(optional);
    this.#id = (typeof id === 'string' && id.trim()) ? id.trim() : QuestObjective.generateId();
    IdGenerator.register('objective', this.#id);
  }

  static generateId() {
    return IdGenerator.next('objective');
  }

  toJSON() {
    return {
      id: this.#id,
      description: this.description,
      completed: this.completed,
      optional: this.optional
    };
  }

  static fromJSON(data) {
    const obj = new QuestObjective(data.description, data.optional, data.id || null);
    obj.completed = Boolean(data.completed);
    return obj;
  }

  get id() {
    return this.#id;
  }
}

class Quest {
  #id = null;
  objectives = [];
  description = '';
  name = '';
  rewardItems = [];
  rewardCurrency = 0;
  rewardXp = 0;
  rewardFactionReputation = {};
  rewardNpcDispositions = [];
  rewardBenefits = [];
  rewardNotes = [];
  appliedRewardBenefitIds = [];
  rewardNotesPresented = false;
  rewardClaimed = false;
  secretNotes = '';
  giverId = null;
  giverName = '';
  secretNotes = '';
  paused = false;

  static #indexByName = new SanitizedStringMap();
  static #indexById = new Map();

  static #normalizeRewardFactionReputation(value) {
    if (value === null || value === undefined) {
      return {};
    }

    let entries = null;
    if (value instanceof Map) {
      entries = Array.from(value.entries());
    } else if (Array.isArray(value)) {
      entries = value
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }
          const rawFactionId = typeof entry.factionId === 'string'
            ? entry.factionId
            : (typeof entry.name === 'string' ? entry.name : '');
          const rawDelta = entry.delta ?? entry.amount ?? entry.value;
          return [rawFactionId, rawDelta];
        })
        .filter(Boolean);
    } else if (typeof value === 'object') {
      entries = Object.entries(value);
    } else {
      throw new Error('rewardFactionReputation must be an object, array, or Map.');
    }

    const normalized = {};
    for (const [rawFactionId, rawDelta] of entries) {
      if (typeof rawFactionId !== 'string') {
        throw new Error('rewardFactionReputation keys must be strings.');
      }
      const factionId = rawFactionId.trim();
      if (!factionId) {
        throw new Error('rewardFactionReputation keys must be non-empty strings.');
      }
      const delta = Number(rawDelta);
      if (!Number.isFinite(delta) || !Number.isInteger(delta)) {
        throw new Error(`rewardFactionReputation["${factionId}"] must be a finite integer.`);
      }
      if (delta === 0) {
        continue;
      }
      normalized[factionId] = delta;
    }

    return normalized;
  }

  static normalizeRewardNpcDispositions(value) {
    if (value === null || value === undefined || value === '') {
      return [];
    }
    if (!Array.isArray(value)) {
      throw new Error('rewardNpcDispositions must be an array.');
    }

    const normalizeDispositionEntries = (rawDispositions, npcLabel) => {
      let dispositionEntries = null;
      if (Array.isArray(rawDispositions)) {
        dispositionEntries = rawDispositions;
      } else if (rawDispositions && typeof rawDispositions === 'object') {
        dispositionEntries = Object.entries(rawDispositions).map(([type, intensity]) => ({
          type,
          intensity
        }));
      } else {
        throw new Error(`rewardNpcDispositions for "${npcLabel}" must include dispositions.`);
      }

      return dispositionEntries
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            throw new Error(`rewardNpcDispositions for "${npcLabel}" contains a non-object disposition.`);
          }
          const type = typeof entry.type === 'string' ? entry.type.trim() : '';
          if (!type) {
            throw new Error(`rewardNpcDispositions for "${npcLabel}" contains a disposition without a type.`);
          }

          const intensity = Number(entry.intensity ?? entry.amount ?? entry.delta ?? entry.value);
          if (!Number.isFinite(intensity) || !Number.isInteger(intensity)) {
            throw new Error(`rewardNpcDispositions for "${npcLabel}" ${type} intensity must be an integer.`);
          }
          if (intensity === 0) {
            return null;
          }

          const reason = typeof entry.reason === 'string' && entry.reason.trim()
            ? entry.reason.trim()
            : null;

          return {
            type,
            intensity,
            reason
          };
        })
        .filter(Boolean);
    };

    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          throw new Error('rewardNpcDispositions entries must be objects.');
        }

        const npcId = typeof entry.npcId === 'string' && entry.npcId.trim()
          ? entry.npcId.trim()
          : (typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : null);
        const npcName = typeof entry.npcName === 'string' && entry.npcName.trim()
          ? entry.npcName.trim()
          : (typeof entry.name === 'string' && entry.name.trim()
            ? entry.name.trim()
            : (typeof entry.npc === 'string' && entry.npc.trim() ? entry.npc.trim() : null));

        if (!npcId && !npcName) {
          throw new Error('rewardNpcDispositions entries must include npcId or npcName.');
        }

        const npcLabel = npcName || npcId;
        const dispositions = normalizeDispositionEntries(entry.dispositions, npcLabel);
        if (!dispositions.length) {
          return null;
        }

        return {
          npcId,
          npcName,
          dispositions
        };
      })
      .filter(Boolean);
  }

  static normalizeRewardItems(value) {
    if (value === null || value === undefined || value === '') {
      return [];
    }

    const entries = Array.isArray(value) ? value : [value];
    return entries.map((entry) => {
      if (typeof entry === 'string') {
        const name = entry.trim();
        if (!name) {
          return null;
        }
        return { name, description: '' };
      }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('rewardItems entries must be strings or objects.');
      }

      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (!name) {
        throw new Error('rewardItems entries must have a non-empty name.');
      }
      const description = typeof entry.description === 'string'
        ? entry.description.trim()
        : '';
      return { name, description };
    }).filter(Boolean);
  }

  static normalizeRewardBenefits(value, context = {}) {
    return questRewardBenefitRegistry.normalizeAll(value, context);
  }

  static normalizeRewardNotes(value) {
    if (value === null || value === undefined || value === '') {
      return [];
    }
    if (!Array.isArray(value)) {
      throw new Error('rewardNotes must be an array.');
    }
    const seen = new Set();
    return value.map((entry) => {
      if (typeof entry !== 'string' || !entry.trim()) {
        throw new Error('rewardNotes entries must be non-empty strings.');
      }
      return entry.trim();
    }).filter((entry) => {
      if (seen.has(entry)) {
        return false;
      }
      seen.add(entry);
      return true;
    });
  }

  static normalizeAppliedRewardBenefitIds(value) {
    if (value === null || value === undefined || value === '') {
      return [];
    }
    if (!Array.isArray(value)) {
      throw new Error('appliedRewardBenefitIds must be an array.');
    }
    return Array.from(new Set(value.map((entry) => {
      if (typeof entry !== 'string' || !entry.trim()) {
        throw new Error('appliedRewardBenefitIds entries must be non-empty strings.');
      }
      return entry.trim();
    })));
  }

  constructor(options = {}) {
    const providedId = typeof options.id === 'string' && options.id.trim() ? options.id.trim() : null;
    this.#id = providedId || IdGenerator.next('quest');
    IdGenerator.register('quest', this.#id);

    const rawObjectives = Array.isArray(options.objectives) ? options.objectives : [];
    this.objectives = rawObjectives
      .map(entry => {
        if (!entry) {
          return null;
        }
        if (entry instanceof QuestObjective) {
          return entry;
        }
        if (typeof entry === 'string') {
          return new QuestObjective(entry, false);
        }
        if (entry && typeof entry.description === 'string') {
          const objective = new QuestObjective(entry.description, Boolean(entry.optional));
          if (typeof entry.completed === 'boolean') {
            objective.completed = entry.completed;
          }
          return objective;
        }
        return null;
      })
      .filter(Boolean);

    this.name = typeof options.name === 'string' ? options.name.trim() : '';
    if (!this.name) {
      throw new Error('Quest name must be a non-empty string');
    }
    this.description = typeof options.description === 'string' ? options.description : '';
    this.secretNotes = typeof options.secretNotes === 'string' ? options.secretNotes : '';

    this.rewardItems = Quest.normalizeRewardItems(options.rewardItems);

    const currencyValue = Number(options.rewardCurrency);
    this.rewardCurrency = Number.isFinite(currencyValue) ? Math.max(0, Math.floor(currencyValue)) : 0;

    const xpValue = Number(options.rewardXp);
    this.rewardXp = Number.isFinite(xpValue) ? Math.max(0, Math.floor(xpValue)) : 0;
    this.rewardFactionReputation = Quest.#normalizeRewardFactionReputation(
      options.rewardFactionReputation,
    );
    this.rewardNpcDispositions = Quest.normalizeRewardNpcDispositions(
      options.rewardNpcDispositions,
    );
    this.rewardBenefits = Quest.normalizeRewardBenefits(options.rewardBenefits);
    this.rewardNotes = Quest.normalizeRewardNotes(options.rewardNotes);
    this.appliedRewardBenefitIds = Quest.normalizeAppliedRewardBenefitIds(
      options.appliedRewardBenefitIds,
    );
    this.rewardNotesPresented = Boolean(options.rewardNotesPresented);

    this.rewardClaimed = Boolean(options.rewardClaimed);
    this.paused = Boolean(options.paused);

    this.giverName = typeof options.giverName === 'string' ? options.giverName.trim() : '';

    if (options.giver && typeof options.giver === 'object') {
      this.giverId = options.giver.id || null;
      if (typeof options.giver.name === 'string' && options.giver.name.trim()) {
        this.giverName = options.giver.name.trim();
      }
    } else {
      this.giverId = options.giverId || null;
    }

    if (this.giverId && typeof this.giverId === 'string') {
      this.giverId = this.giverId.trim() || null;
    }

    Quest.#indexByName.set(this.name, this);
    Quest.#indexById.set(this.#id, this);
  }

  get id() {
    return this.#id;
  }

  static getByName(name) {
    if (typeof name !== 'string' || !name.trim()) {
      return null;
    }
    return Quest.#indexByName.get(name.trim()) || null;
  }

  static getById(id) {
    if (typeof id !== 'string' || !id.trim()) {
      return null;
    }
    return Quest.#indexById.get(id.trim()) || null;
  }

  static clear() {
    Quest.#indexByName.clear();
    Quest.#indexById.clear();
  }

  get giver() {
    if (this.giverId) {
      const Player = require('./Player.js');
      return Player.getById(this.giverId) || null;
    }
    return null;
  }

  set giver(player) {
    if (player && typeof player === 'object') {
      this.giverId = player.id || null;
      if (typeof player.name === 'string' && player.name.trim()) {
        this.giverName = player.name.trim();
      }
    } else {
      this.giverId = null;
      this.giverName = '';
    }
  }

  get completed() {
    return this.objectives.every(obj => obj.completed || obj.optional);
  }

  addObjective(description, optional = false) {
    const objective = new QuestObjective(description, optional);
    this.objectives.push(objective);
  }

  completeObjective(index) {
    if (index >= 0 && index < this.objectives.length) {
      this.objectives[index].completed = true;
    } else {
      throw new Error('Invalid objective index');
    }
  }

  toJSON() {
    return {
      id: this.#id,
      name: this.name,
      description: this.description,
      objectives: this.objectives.map(obj => (obj.toJSON())),
      rewardItems: Quest.normalizeRewardItems(this.rewardItems),
      rewardCurrency: this.rewardCurrency,
      rewardXp: this.rewardXp,
      rewardFactionReputation: { ...this.rewardFactionReputation },
      rewardNpcDispositions: Quest.normalizeRewardNpcDispositions(this.rewardNpcDispositions),
      rewardBenefits: Quest.normalizeRewardBenefits(this.rewardBenefits),
      rewardNotes: Quest.normalizeRewardNotes(this.rewardNotes),
      appliedRewardBenefitIds: Quest.normalizeAppliedRewardBenefitIds(this.appliedRewardBenefitIds),
      rewardNotesPresented: Boolean(this.rewardNotesPresented),
      secretNotes: this.secretNotes || null,
      rewardClaimed: Boolean(this.rewardClaimed),
      paused: Boolean(this.paused),
      giverId: this.giverId || null,
      giverName: this.giverName || null,
      giver: this.giverName || null,
      completed: this.completed,
      secretNotes: this.secretNotes || null
    };
  }

  static fromJSON(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Quest.fromJSON requires quest data.');
    }

    const rewardItems = Array.isArray(data.rewardItems)
      ? data.rewardItems
      : (typeof data.rewardItems === 'string' && data.rewardItems.trim() ? [data.rewardItems.trim()] : []);

    const rawGiver = data.giver;
    const giverId = typeof data.giverId === 'string'
      ? data.giverId.trim()
      : (rawGiver && typeof rawGiver === 'object' && typeof rawGiver.id === 'string'
        ? rawGiver.id.trim()
        : null);

    const giverName = typeof data.giverName === 'string'
      ? data.giverName.trim()
      : (rawGiver && typeof rawGiver === 'object' && typeof rawGiver.name === 'string'
        ? rawGiver.name.trim()
        : (typeof rawGiver === 'string' ? rawGiver.trim() : ''));

    const quest = new Quest({
      id: typeof data.id === 'string' && data.id.trim() ? data.id.trim() : null,
      name: data.name,
      description: data.description,
      rewardItems,
      rewardCurrency: data.rewardCurrency,
      rewardXp: data.rewardXp,
      rewardFactionReputation: data.rewardFactionReputation,
      rewardNpcDispositions: data.rewardNpcDispositions,
      rewardBenefits: data.rewardBenefits,
      rewardNotes: data.rewardNotes,
      appliedRewardBenefitIds: data.appliedRewardBenefitIds,
      rewardNotesPresented: Boolean(data.rewardNotesPresented),
      secretNotes: typeof data.secretNotes === 'string' ? data.secretNotes : '',
      giverId,
      giverName,
      rewardClaimed: Boolean(data.rewardClaimed),
      paused: Boolean(data.paused),
      objectives: [],
      secretNotes: data.secretNotes || null
    });

    quest.objectives = [];
    if (Array.isArray(data.objectives)) {
      data.objectives.forEach(objData => {
        try {
          const objective = QuestObjective.fromJSON(objData);
          quest.objectives.push(objective);
        } catch (error) {
          console.warn('Failed to deserialize quest objective:', error?.message || error);
        }
      });
    }
    return quest;
  }

  static filterActiveQuests(quests = [], { includePaused = false } = {}) {
    if (!Array.isArray(quests)) {
      throw new TypeError('Quest.filterActiveQuests requires an array of quests.');
    }
    return quests.filter(quest => {
      if (!quest) {
        return false;
      }
      const isCompleted = Boolean(quest.completed);
      const isPaused = Boolean(quest.paused);
      if (isCompleted) {
        return false;
      }
      if (!includePaused && isPaused) {
        return false;
      }
      return true;
    });
  }

}

Quest.QuestObjective = QuestObjective;
module.exports = Quest;
