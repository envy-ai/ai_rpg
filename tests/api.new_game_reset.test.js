const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const IdGenerator = require('../IdGenerator.js');
const Location = require('../Location.js');
const Quest = require('../Quest.js');
const QuestConfirmationManager = require('../QuestConfirmationManager.js');
const Region = require('../Region.js');
const ScheduledEvent = require('../ScheduledEvent.js');
const SceneSummaries = require('../SceneSummaies.js');
const Thing = require('../Thing.js');
const Utils = require('../Utils.js');
const Tracker = require('../Tracker.js');
const {
  clearNewGameRuntimeRegistries,
  resetNewGameRuntimeState
} = require('../api.js');

function clearLocationIndex() {
  if (typeof Location.clear === 'function') {
    Location.clear();
    return;
  }
  for (const location of Location.getAll()) {
    Location.removeFromIndex(location);
  }
}

test('new-game runtime registry reset clears trackers and scheduled events from previous games', () => {
  const previousConfig = Globals.config;
  Globals.config = {
    ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
    trackers: {
      ...(previousConfig?.trackers && typeof previousConfig.trackers === 'object'
        ? previousConfig.trackers
        : {}),
      short_string_max_words: 4
    }
  };
  IdGenerator.reset();
  Tracker.clear();
  ScheduledEvent.clear();

  try {
    new Tracker({
      name: 'Old Game Alarm',
      type: 'countdown',
      value: '1 hour',
      lastUpdatedWorldMinute: 5000,
      deriveCountdownUntilWorldMinute: true,
      description: 'A stale tracker from a previous game.'
    });
    new ScheduledEvent({
      event: 'Old scheduled event',
      regionId: 'old-region',
      regionName: 'Old Region',
      locationId: 'old-location',
      locationName: 'Old Location',
      targetWorldMinute: 5100,
      targetWorldTime: { dayIndex: 3, timeMinutes: 780 },
      createdAtWorldMinute: 5000,
      createdAtWorldTime: { dayIndex: 3, timeMinutes: 680 }
    });

    assert.equal(Tracker.getAll().length, 1);
    assert.equal(ScheduledEvent.getAll().length, 1);

    clearNewGameRuntimeRegistries();

    assert.deepEqual(Tracker.getAll(), []);
    assert.deepEqual(ScheduledEvent.getAll(), []);
  } finally {
    Tracker.clear();
    ScheduledEvent.clear();
    IdGenerator.reset();
    Globals.config = previousConfig;
  }
});

test('new-game runtime registry reset clears model static indexes from previous games', () => {
  IdGenerator.reset();
  clearLocationIndex();
  Region.clear();
  Thing.clear();
  if (typeof Quest.clear === 'function') {
    Quest.clear();
  }

  try {
    const oldRegion = new Region({
      name: 'Old Indexed Region',
      description: 'Region from the previous game.'
    });
    const oldLocation = new Location({
      name: 'Old Indexed Location',
      description: 'Location from the previous game.',
      regionId: oldRegion.id,
      checkRegionId: true
    });
    const oldThing = new Thing({
      name: 'Old Indexed Thing',
      description: 'Thing from the previous game.',
      thingType: 'item'
    });
    const oldQuest = new Quest({
      name: 'Old Indexed Quest',
      description: 'Quest from the previous game.'
    });

    assert.equal(Location.getById(oldLocation.id), oldLocation);
    assert.equal(Thing.getById(oldThing.id), oldThing);
    assert.equal(Quest.getById(oldQuest.id), oldQuest);

    clearNewGameRuntimeRegistries();

    assert.equal(Location.getById(oldLocation.id), null);
    assert.equal(Thing.getById(oldThing.id), null);
    assert.equal(Quest.getById(oldQuest.id), null);
    assert.equal(Region.get(oldRegion.id), null);
  } finally {
    clearLocationIndex();
    Region.clear();
    Thing.clear();
    if (typeof Quest.clear === 'function') {
      Quest.clear();
    }
    IdGenerator.reset();
  }
});

test('new-game runtime state reset clears save-scoped collections and cancels stale runtime work', () => {
  assert.equal(typeof resetNewGameRuntimeState, 'function');

  const previousSceneSummaries = Globals.sceneSummaries;
  const sceneSummaries = new SceneSummaries();
  Globals.sceneSummaries = sceneSummaries;
  Utils.setChatSummary('old-entry', { summary: 'Old summary', type: 'assistant-prose' });
  sceneSummaries.addSummaryResult({
    scenes: [{
      summary: 'Old scene summary.',
      startIndex: 1,
      endIndex: 1,
      startEntryId: 'old-entry',
      endEntryId: 'old-entry'
    }],
    entryIndexMap: [{ entryId: 'old-entry', index: 1 }],
    summarizedRange: { start: 1, end: 1 }
  });

  const maps = {
    players: new Map([['old-player', {}]]),
    things: new Map([['old-thing', {}]]),
    gameLocations: new Map([['old-location', {}]]),
    gameLocationExits: new Map([['old-exit', {}]]),
    regions: new Map([['old-region', {}]]),
    factions: new Map([['old-faction', {}]]),
    skills: new Map([['old-skill', {}]]),
    stubExpansionPromises: new Map([['old-stub', Promise.resolve()]]),
    regionEntryExpansionPromises: new Map([['old-region-entry', Promise.resolve()]]),
    pendingRegionStubs: new Map([['old-pending-region', {}]]),
    pendingLocationImages: new Map([['old-location', 'old-job']]),
    generatedImages: new Map([['old-image', {}]]),
    imageJobs: new Map([['old-job', { id: 'old-job' }]]),
    activeImageJobs: new Set(['old-job']),
    entityImageJobs: new Map([['player:old-player', 'old-job']]),
    npcGenerationPromises: new Map([['old-npc', Promise.resolve()]]),
    playerAbilitySelectionPromises: new Map([['old-ability', Promise.resolve()]]),
    playerImageGenerationPromises: new Map([['old-player', Promise.resolve()]]),
    locationImageGenerationPromises: new Map([['old-location', Promise.resolve()]]),
    levelUpAbilityPromises: new Map([['old-level', Promise.resolve()]]),
    shortDescriptionBackfillByClient: new Map([['client-1', {}]])
  };
  const chatHistory = [{ role: 'user', content: 'old game' }];
  const jobQueue = ['old-job'];
  const callbacks = {
    currentPlayer: {},
    isProcessingJob: true,
    currentTurnToken: 'old-turn',
    baseContextResetCount: 0,
    cancelledInputCount: 0,
    moveLocksCleared: 0,
    runtimeGenerationAdvances: 0
  };
  const questConfirmationManager = {
    rejectedReason: null,
    rejectAll(reason) {
      this.rejectedReason = reason;
      return 2;
    }
  };

  try {
    const result = resetNewGameRuntimeState({
      ...maps,
      chatHistory,
      jobQueue,
      questConfirmationManager,
      setCurrentPlayer: (value) => {
        callbacks.currentPlayer = value;
      },
      setIsProcessingJob: (value) => {
        callbacks.isProcessingJob = value;
      },
      clearCurrentTurnToken: () => {
        callbacks.currentTurnToken = null;
      },
      resetBaseContextMemoryCache: () => {
        callbacks.baseContextResetCount += 1;
      },
      cancelPendingPlayerInputRequests: () => {
        callbacks.cancelledInputCount += 1;
        return 1;
      },
      clearPlayerMoveLocks: () => {
        callbacks.moveLocksCleared += 1;
      },
      advanceRuntimeGeneration: () => {
        callbacks.runtimeGenerationAdvances += 1;
        return callbacks.runtimeGenerationAdvances;
      }
    });

    for (const [label, collection] of Object.entries(maps)) {
      assert.equal(collection.size, 0, `${label} should be cleared`);
    }
    assert.deepEqual(chatHistory, []);
    assert.deepEqual(jobQueue, []);
    assert.deepEqual(Utils.serializeChatSummaries(), {});
    assert.deepEqual(sceneSummaries.getScenesInOrder(), []);
    assert.equal(callbacks.currentPlayer, null);
    assert.equal(callbacks.isProcessingJob, false);
    assert.equal(callbacks.currentTurnToken, null);
    assert.equal(callbacks.baseContextResetCount, 1);
    assert.equal(callbacks.cancelledInputCount, 1);
    assert.equal(callbacks.moveLocksCleared, 1);
    assert.equal(callbacks.runtimeGenerationAdvances, 1);
    assert.match(questConfirmationManager.rejectedReason, /new game/i);
    assert.equal(result.cancelledPlayerInputRequests, 1);
    assert.equal(result.rejectedQuestConfirmations, 2);
    assert.equal(result.runtimeGenerationId, 1);
  } finally {
    Utils.loadChatSummaries({});
    Globals.sceneSummaries = previousSceneSummaries;
  }
});

test('QuestConfirmationManager can reject every pending confirmation during new-game reset', () => {
  const manager = new QuestConfirmationManager();
  const rejectedMessages = [];
  manager.pending.set('confirmation-1', {
    clientId: 'client-1',
    timeout: setTimeout(() => {}, 10000),
    reject: (error) => rejectedMessages.push(error.message)
  });
  manager.pending.set('confirmation-2', {
    clientId: 'client-2',
    timeout: setTimeout(() => {}, 10000),
    reject: (error) => rejectedMessages.push(error.message)
  });

  const rejectedCount = manager.rejectAll('New game started');

  assert.equal(rejectedCount, 2);
  assert.equal(manager.pending.size, 0);
  assert.deepEqual(rejectedMessages, ['New game started', 'New game started']);
});
