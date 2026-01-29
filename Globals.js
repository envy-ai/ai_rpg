class Globals {
  static config;

  static baseDir;
  static gameLoaded = false;
  static _processedMove = false;
  static inCombat = false;
  static #currentPlayerOverride = null;
  static realtimeHub = null;
  static travelHistory = [];
  static slopWords = [];
  static slopTrigrams = [];
  static currentSaveVersion = '1';
  static saveFileSaveVersion = '0';

  static getBasePromptContext = function () {
    throw new Error('Globals.getBasePromptContext called before being set.');
  }

  static getPromptEnv = function () {
    throw new Error('Globals.getPromptEnv called before being set.');
  }

  static parseXMLTemplate = function () {
    throw new Error('Globals.parseXMLTemplate called before being set.');
  }

  static get currentPlayer() {
    const Player = require('./Player.js');
    if (Globals.#currentPlayerOverride) {
      return Globals.#currentPlayerOverride;
    }
    return typeof Player.getCurrentPlayer === 'function'
      ? Player.getCurrentPlayer()
      : null;
  }

  static set currentPlayer(player) {
    const Player = require('./Player.js');
    Globals.#currentPlayerOverride = player || null;
    if (typeof Player.setCurrentPlayerResolver === 'function') {
      Player.setCurrentPlayerResolver(() => Globals.#currentPlayerOverride);
    }
  }

  static set processedMove(value) {
    //console.log(`Globals.processedMove set to ${value}`);
    //console.trace();
    Globals._processedMove = value;
  }

  static get processedMove() {
    //console.log(`Globals.processedMove accessed, value is ${Globals._processedMove}`);
    return Globals._processedMove;
  }

  static setInCombat(value) {
    //console.log(`Globals.setInCombat(${value}) called.`);
    Globals.inCombat = value;
  }

  static isInCombat() {
    //console.log(`Globals.isInCombat() => ${Globals.inCombat}`);
    return Globals.inCombat;
  }

  static get location() {
    const player = Globals.currentPlayer;
    return player?.location || null;
  }

  static get region() {
    const player = Globals.currentPlayer;
    return player?.location?.region || null;
  }

  static get elapsedTime() {
    const player = Globals.currentPlayer;
    return player?.elapsedTime ?? 0;
  }

  static set elapsedTime(value) {
    const player = Globals.currentPlayer;
    if (!player) {
      return;
    }
    player.elapsedTime = value;
  }

  static locationById(id) {
    if (!Globals.config) {
      console.warn('Globals.locationById accessed before config was set.');
      console.trace();
      return null;
    }
    const Location = require('./Location.js');
    return Location.get(id);
  }

  static regionsById(id) {
    if (!Globals.config) {
      console.warn('Globals.regionsById accessed before config was set.');
      console.trace();
      return null;
    }
    const Region = require('./Region.js');
    return Region.get(id);
  }

  static get locationsById() {
    if (!Globals.config) {
      console.warn('Globals.locationsById accessed before config was set.');
      console.trace();
      return new Map();
    }

    const Location = require('./Location.js');
    return Location.indexById;
  }

  static get regionsById() {
    if (!Globals.config) {
      console.warn('Globals.regionsById accessed before config was set.');
      console.trace();
      return new Map();
    }

    const Region = require('./Region.js');
    return Region.indexById;
  }

  static get locationsByName() {
    if (!Globals.config) {
      console.warn('Globals.locationsByName accessed before config was set.');
      console.trace();
      return new Map();
    }

    const Location = require('./Location.js');
    return Location.indexByName;
  }

  static get regionsByName() {
    if (!Globals.config) {
      console.warn('Globals.regionsByName accessed before config was set.');
      console.trace();
      return new Map();
    }

    const Region = require('./Region.js');
    return Region.indexByName;
  }

  static get playersById() {
    if (!Globals.config) {
      console.warn('Globals.playersById accessed before config was set.');
      console.trace();
      return new Map();
    }

    const Player = require('./Player.js');
    return Player.indexById;
  }

  static get playersByName() {
    if (!Globals.config) {
      console.warn('Globals.playersByName accessed before config was set.');
      console.trace();
      return new Map();
    }

    const Player = require('./Player.js');
    return Player.indexByName;
  }

  static emitToClient(clientId, type, payload = {}, options = {}) {
    const hub = Globals.realtimeHub;
    if (!hub || typeof hub.emit !== 'function') {
      throw new Error('Globals.emitToClient called before realtimeHub was initialized.');
    }

    const normalizedType = typeof type === 'string' ? type.trim() : '';
    if (!normalizedType) {
      throw new Error('Globals.emitToClient requires a non-empty event type.');
    }

    const hasClientId = clientId !== undefined && clientId !== null;
    let normalizedClientId = null;
    if (hasClientId) {
      if (typeof clientId !== 'string') {
        throw new TypeError('Globals.emitToClient expects clientId to be a string when provided.');
      }
      normalizedClientId = clientId.trim();
      if (!normalizedClientId) {
        throw new Error('Globals.emitToClient received an empty clientId string.');
      }
    }

    const includeServerTime = options?.includeServerTime !== false;
    const requestId = typeof options?.requestId === 'string' ? options.requestId.trim() : null;

    let payloadEnvelope;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      payloadEnvelope = { ...payload };
    } else {
      payloadEnvelope = { value: payload };
    }

    if (includeServerTime && !Object.prototype.hasOwnProperty.call(payloadEnvelope, 'serverTime')) {
      payloadEnvelope.serverTime = new Date().toISOString();
    }

    if (requestId && !Object.prototype.hasOwnProperty.call(payloadEnvelope, 'requestId')) {
      payloadEnvelope.requestId = requestId;
    }

    return Boolean(hub.emit(normalizedClientId, normalizedType, payloadEnvelope));
  }

  static updateSpinnerText({
    clientId = null,
    message = 'Loading...',
    scope = 'chat',
    requestId = null,
    includeServerTime = true
  } = {}) {
    const normalizedMessage = typeof message === 'string' && message.trim()
      ? message.trim()
      : 'Loading...';

    const payload = {
      stage: 'spinner:update',
      message: normalizedMessage,
      scope
    };

    if (requestId && typeof requestId === 'string' && requestId.trim()) {
      payload.requestId = requestId.trim();
    }

    return Globals.emitToClient(clientId, 'chat_status', payload, {
      includeServerTime
    });
  }
}

module.exports = Globals;
