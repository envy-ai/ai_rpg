const yaml = require('js-yaml');
const fs = require('fs');
const SanitizedStringMap = require('./SanitizedStringMap.js');
const { findPackageJSON } = require('module');
const Globals = require('./Globals.js');


class QuestObjective {
  #id = null;
  description = '';
  completed = false;
  optional = false;

  constructor(description, optional = false) {
    if (typeof description !== 'string' || !description.trim()) {
      throw new Error('QuestObjective description must be a non-empty string');
    }
    this.description = description;
    this.optional = Boolean(optional);
    this.#id = QuestObjective.generateId();
  }

  static generateId() {
    return `obj_${Math.random().toString(36).substr(2, 9)}`;
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
    const obj = new QuestObjective(data.description, data.optional);
    obj.#id = data.id || QuestObjective.generateId();
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
  rewardClaimed = false;
  secretNotes = '';
  giverId = null;
  giverName = '';
  secretNotes = '';

  static #indexByName = new SanitizedStringMap();
  static #indexById = new Map();

  constructor(options = {}) {
    const generatedId = `quest_${Math.random().toString(36).substr(2, 9)}`;
    const providedId = typeof options.id === 'string' && options.id.trim() ? options.id.trim() : null;
    this.#id = providedId || generatedId;

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

    if (Array.isArray(options.rewardItems)) {
      this.rewardItems = options.rewardItems
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);
    } else if (typeof options.rewardItems === 'string' && options.rewardItems.trim()) {
      this.rewardItems = [options.rewardItems.trim()];
    } else {
      this.rewardItems = [];
    }

    const currencyValue = Number(options.rewardCurrency);
    this.rewardCurrency = Number.isFinite(currencyValue) ? Math.max(0, Math.floor(currencyValue)) : 0;

    const xpValue = Number(options.rewardXp);
    this.rewardXp = Number.isFinite(xpValue) ? Math.max(0, Math.floor(xpValue)) : 0;

    this.rewardClaimed = Boolean(options.rewardClaimed);

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
      rewardItems: Array.isArray(this.rewardItems) ? this.rewardItems.slice() : [],
      rewardCurrency: this.rewardCurrency,
      rewardXp: this.rewardXp,
      secretNotes: this.secretNotes || null,
      rewardClaimed: Boolean(this.rewardClaimed),
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
      secretNotes: typeof data.secretNotes === 'string' ? data.secretNotes : '',
      giverId,
      giverName,
      rewardClaimed: Boolean(data.rewardClaimed),
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

}

Quest.QuestObjective = QuestObjective;
module.exports = Quest;
