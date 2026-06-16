const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Globals = require('../Globals.js');
const IdGenerator = require('../IdGenerator.js');
const Tracker = require('../Tracker.js');
const Utils = require('../Utils.js');

function makeTempSaveDir() {
  const tmpRoot = path.join(process.cwd(), 'tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  return fs.mkdtempSync(path.join(tmpRoot, 'tracker-save-'));
}

function emptySerializedContext() {
  return {
    gameLocations: new Map(),
    gameLocationExits: new Map(),
    regions: new Map(),
    chatHistory: [],
    generatedImages: new Map(),
    things: new Map(),
    players: new Map(),
    skills: new Map(),
    factions: new Map(),
    pendingRegionStubs: new Map()
  };
}

function emptyHydrationContext() {
  return {
    gameLocations: new Map(),
    gameLocationExits: new Map(),
    regions: new Map(),
    chatHistoryRef: [],
    generatedImages: new Map(),
    things: new Map(),
    players: new Map(),
    skills: new Map(),
    factions: new Map(),
    pendingRegionStubs: new Map()
  };
}

test('Tracker stores active plot tracker records and validates typed values', () => {
  IdGenerator.reset();
  Tracker.clear();

    try {
        const countdown = new Tracker({
            name: 'Ritual Completion',
            type: 'countdown',
            value: '3 hours',
            hiddenFromPlayer: false,
            lastUpdatedWorldMinute: 30,
            deriveCountdownUntilWorldMinute: true,
            description: 'Update when the ritual advances, stalls, or is interrupted.'
        });
    const short = new Tracker({
      name: 'Oracle Mood',
      type: 'short_string',
      value: 'deeply worried',
      hiddenFromPlayer: true,
      lastUpdatedWorldMinute: 45,
      description: 'Update when the oracle learns new information.'
    });

    assert.equal(countdown.id, 'tracker_1');
    assert.equal(short.id, 'tracker_2');
    assert.deepEqual(Tracker.getAll().map(tracker => tracker.id), ['tracker_1', 'tracker_2']);
    assert.equal(Tracker.getById('tracker_1'), countdown);
    assert.equal(Tracker.findByNameOrKey('oracle')[0], short);

    assert.throws(() => new Tracker({
      name: 'Too Long',
      type: 'short_string',
      value: 'one two three four',
      lastUpdatedWorldMinute: 0,
      description: 'Update when this changes.'
    }), /three words or fewer/);
    assert.throws(() => new Tracker({
      name: 'Bad Percentage',
      type: 'percentage',
      value: 'half',
      lastUpdatedWorldMinute: 0,
      description: 'Update when this changes.'
    }), /percentage/);
    assert.throws(() => new Tracker({
      name: 'Bad Fraction',
      type: 'x_out_of_total',
      value: 'two of five',
      lastUpdatedWorldMinute: 0,
      description: 'Update when this changes.'
    }), /x\/total/);
    } finally {
        Tracker.clear();
        IdGenerator.reset();
    }
});

test('Tracker countdowns persist absolute target minutes and render dynamic remaining time', () => {
  IdGenerator.reset();
  Tracker.clear();

  try {
    const tracker = new Tracker({
      name: 'Supply Shuttle Arrival',
      type: 'countdown',
      value: '2 days, 3 hours, 12 minutes',
      hiddenFromPlayer: false,
      lastUpdatedWorldMinute: 100,
      deriveCountdownUntilWorldMinute: true,
      description: 'Update only if the deadline changes or the shuttle arrives.'
    });

    assert.equal(tracker.countdownUntilWorldMinute, 3172);
    assert.equal(tracker.toJSON().countdownUntilWorldMinute, 3172);
    assert.equal(
      tracker.toClientJSON({
        formatCountdownValue: (untilMinute) => Utils.formatCountdownUntilWorldMinute(untilMinute, {
          currentTotalMinutes: 100
        })
      }).value,
      '2 days, 3 hours'
    );
    assert.equal(
      tracker.toPromptContext({
        formatCountdownValue: (untilMinute) => Utils.formatCountdownUntilWorldMinute(untilMinute, {
          currentTotalMinutes: 3240
        })
      }).value,
      '1 hour, 8 minutes past'
    );

    tracker.updateValue('90 minutes', { worldMinute: 200 });
    assert.equal(tracker.value, '90 minutes');
    assert.equal(tracker.countdownUntilWorldMinute, 290);
    assert.equal(
      tracker.toClientJSON({
        formatCountdownValue: (untilMinute) => Utils.formatCountdownUntilWorldMinute(untilMinute, {
          currentTotalMinutes: 200
        })
      }).value,
      '1 hour, 30 minutes'
    );
  } finally {
    Tracker.clear();
    IdGenerator.reset();
  }
});

test('Tracker updates values, removes records, and round-trips JSON', () => {
  IdGenerator.reset();
  Tracker.clear();

  try {
    const tracker = new Tracker({
      name: 'Conspiracy Influence',
      type: 'percentage',
      value: '45%',
      hiddenFromPlayer: true,
      lastUpdatedWorldMinute: 120,
      description: 'Update when the conspiracy gains or loses influence.',
      createdAt: '2026-06-16T00:00:00.000Z',
      updatedAt: '2026-06-16T00:00:00.000Z'
    });
    tracker.updateValue('50%', { worldMinute: 135 });
    assert.equal(tracker.value, '50%');
    assert.equal(tracker.lastUpdatedWorldMinute, 135);

    const serialized = Tracker.serializeAll();
    Tracker.clear();
    Tracker.loadAll(serialized);
    assert.equal(Tracker.getById(tracker.id).description, 'Update when the conspiracy gains or loses influence.');

    const removed = Tracker.removeById(tracker.id);
    assert.equal(removed.id, tracker.id);
    assert.equal(Tracker.getById(tracker.id), null);
  } finally {
    Tracker.clear();
    IdGenerator.reset();
  }
});

test('serialized game state writes, loads, and hydrates trackers', () => {
  IdGenerator.reset();
  Tracker.clear();
  const saveDir = makeTempSaveDir();
  const previousSceneSummaries = Globals.sceneSummaries;

  try {
    Globals.sceneSummaries = {
      serialize: () => ({}),
      load: () => {}
    };
    const tracker = new Tracker({
      name: 'Signal Strength',
      type: 'percentage',
      value: '30%',
      hiddenFromPlayer: false,
      lastUpdatedWorldMinute: 75,
      description: 'Update when signal conditions change.'
    });

    Utils.writeSerializedGameState(saveDir, Utils.serializeGameState(emptySerializedContext()));
    const raw = JSON.parse(fs.readFileSync(path.join(saveDir, 'trackers.json'), 'utf8'));
    assert.equal(raw[tracker.id].name, 'Signal Strength');

    Tracker.clear();
    const loaded = Utils.loadSerializedGameState(saveDir);
    assert.equal(loaded.metadata.totalTrackers, 1);
    Utils.hydrateGameState(loaded, emptyHydrationContext());
    assert.equal(Tracker.getById(tracker.id).value, '30%');
  } finally {
    Globals.sceneSummaries = previousSceneSummaries;
    Tracker.clear();
    IdGenerator.reset();
  }
});
