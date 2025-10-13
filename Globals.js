class Globals {
  static config;
  static currentPlayer;
  static baseDir;
  static gameLoaded = false;
  static processedMove = false;

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
}

module.exports = Globals;
