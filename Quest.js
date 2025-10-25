const yaml = require('js-yaml');
const fs = require('fs');
const SanitizedStringMap = require('./SanitizedStringMap.js');
const { findPackageJSON } = require('module');
const Globals = require('./Globals.js');


class QuestObjective {
  description = '';
  completed = false;

  constructor(description) {
    this.description = description;
  }
}

class Quest {
  #objectives = [];
  #description = '';
  #name = '';
  #rewardItems = '';
  #rewardCurrency = 0;
  #rewardXp = 0;

  constructor(options = {}) {
    this.#name = options.name || '';
    this.#description = options.description || '';
    this.#rewardItems = options.rewardItems || [];
    this.#rewardCurrency = options.rewardCurrency || 0;
    this.#rewardXp = options.rewardXp || 0;
  }
}

module.exports = Quest;