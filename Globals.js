class Globals {
  static config;
  static currentPlayer;
  static baseDir;
  static gameLoaded = false;
  static _processedMove = false;
  static inCombat = false;

  static set processedMove(value) {
    console.log(`Globals.processedMove set to ${value}`);
    console.trace();
    Globals._processedMove = value;
  }

  static get processedMove() {
    console.log(`Globals.processedMove accessed, value is ${Globals._processedMove}`);
    return Globals._processedMove;
  }

  static setInCombat(value) {
    console.log(`Globals.setInCombat(${value}) called.`);
    Globals.inCombat = value;
  }

  static isInCombat() {
    console.log(`Globals.isInCombat() => ${Globals.inCombat}`);
    return Globals.inCombat;
  }

  static get location() {
    if (!Globals.currentPlayer) {
      console.warn('Globals.location accessed before currentPlayer was set.');
      console.trace();
      return null;
    }
    return Globals.currentPlayer.location;
  }

  static get region() {
    if (!Globals.currentPlayer) {
      console.warn('Globals.region accessed before currentPlayer was set.');
      console.trace();
      return null;
    }
    return Globals.currentPlayer.location.region;
  }

  static get elapsedTime() {
    if (!Globals.currentPlayer) {
      console.warn('Globals.elapsedTime accessed before currentPlayer was set.');
      console.trace();
      return 0;
    }
    return Globals.currentPlayer.elapsedTime;
  }

  static set elapsedTime(value) {
    if (!Globals.currentPlayer) {
      console.warn('Globals.elapsedTime set before currentPlayer was set.');
      console.trace();
      return;
    }
    Globals.currentPlayer.elapsedTime = value;
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
}

module.exports = Globals;
