const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Utils = require('../Utils.js');

function createPlotAnalysisFixture() {
    return {
        raw: [
            '- Find the missing courier (current focus).',
            '',
            '<response>',
            '  <plotThreads>',
            '    <plotThread>',
            '      <description>Find the missing courier before the trail goes cold.</description>',
            '      <isCurrentFocus>true</isCurrentFocus>',
            '    </plotThread>',
            '  </plotThreads>',
            '  <currentPlotComplications>',
            '    <complication>',
            '      <description>Find the missing courier.</description>',
            '    </complication>',
            '    <complication>',
            '      <description>Get access to the locked customs ledger.</description>',
            '    </complication>',
            '  </currentPlotComplications>',
            '</response>'
        ].join('\n'),
        updatedAt: '2026-05-20T12:00:00.000Z',
        startedAt: '2026-05-20T11:59:58.000Z',
        completedAt: '2026-05-20T12:00:00.000Z',
        sequence: 7,
        sourceRequestId: 'request_123',
        locationId: 'loc_1',
        plotThreads: [
            {
                description: 'Find the missing courier before the trail goes cold.',
                isCurrentFocus: true
            }
        ],
        currentPlotComplications: [
            { description: 'Find the missing courier.' },
            { description: 'Get access to the locked customs ledger.' }
        ]
    };
}

function installSerializableGlobals() {
    return {
        config: Globals.config,
        sceneSummaries: Globals.sceneSummaries,
        worldTime: Globals.worldTime,
        calendarDefinition: Globals.calendarDefinition
    };
}

function restoreSerializableGlobals(previous) {
    Globals.config = previous.config;
    Globals.sceneSummaries = previous.sceneSummaries;
    Globals.worldTime = previous.worldTime;
    Globals.calendarDefinition = previous.calendarDefinition;
}

function prepareSerializableGlobals() {
    Globals.config = {
        time: {}
    };
    Globals.sceneSummaries = {
        serialize: () => ({}),
        load: () => {}
    };
    Globals.worldTime = { dayIndex: 0, timeMinutes: 480 };
    Globals.calendarDefinition = Globals.generateCalendarDefinition({ settingName: 'Test Setting' });
}

test('Globals stores plot analysis as an isolated global object', () => {
    const previous = typeof Globals.getPlotAnalysis === 'function'
        ? Globals.getPlotAnalysis()
        : null;
    const fixture = createPlotAnalysisFixture();

    try {
        Globals.setPlotAnalysis(fixture);

        const stored = Globals.getPlotAnalysis();
        assert.deepEqual(stored, fixture);

        stored.plotThreads[0].description = 'Mutated outside copy.';
        assert.equal(
            Globals.getPlotAnalysis().plotThreads[0].description,
            'Find the missing courier before the trail goes cold.'
        );

        Globals.setPlotAnalysis(null);
        assert.equal(Globals.getPlotAnalysis(), null);
    } finally {
        if (typeof Globals.setPlotAnalysis === 'function') {
            Globals.setPlotAnalysis(previous);
        }
    }
});

test('serialized game state persists plot analysis metadata', () => {
    const previousGlobals = installSerializableGlobals();
    const previousPlotAnalysis = typeof Globals.getPlotAnalysis === 'function'
        ? Globals.getPlotAnalysis()
        : null;
    const fixture = createPlotAnalysisFixture();

    try {
        prepareSerializableGlobals();
        Globals.setPlotAnalysis(fixture);

        const serialized = Utils.serializeGameState({
            currentPlayer: { id: 'player_1', name: 'Tester', level: 3 },
            gameLocations: new Map(),
            gameLocationExits: new Map(),
            regions: new Map(),
            chatHistory: [],
            generatedImages: new Map(),
            things: new Map(),
            players: new Map(),
            skills: new Map(),
            factions: new Map(),
            currentSetting: null,
            pendingRegionStubs: new Map()
        });

        assert.deepEqual(serialized.metadata.plotAnalysis, fixture);
    } finally {
        if (typeof Globals.setPlotAnalysis === 'function') {
            Globals.setPlotAnalysis(previousPlotAnalysis);
        }
        restoreSerializableGlobals(previousGlobals);
    }
});

test('hydrating game state restores plot analysis metadata', () => {
    const previousGlobals = installSerializableGlobals();
    const previousPlotAnalysis = typeof Globals.getPlotAnalysis === 'function'
        ? Globals.getPlotAnalysis()
        : null;
    const fixture = createPlotAnalysisFixture();

    try {
        prepareSerializableGlobals();
        Globals.setPlotAnalysis(null);

        Utils.hydrateGameState({
            metadata: {
                idCounters: {},
                plotAnalysis: fixture
            },
            gameWorld: {
                locations: {},
                locationExits: {},
                regions: {}
            },
            chatHistory: [],
            generatedImages: {},
            things: {},
            players: {},
            factions: {},
            mysteryBoxes: {},
            mysteryThreads: {},
            skills: [],
            pendingRegionStubs: {},
            chatSummaries: {},
            sceneSummaries: {},
            worldTime: { dayIndex: 0, timeMinutes: 480 },
            calendarDefinition: Globals.generateCalendarDefinition({ settingName: 'Test Setting' })
        }, {
            gameLocations: new Map(),
            gameLocationExits: new Map(),
            regions: new Map(),
            chatHistoryRef: [],
            generatedImages: new Map(),
            things: new Map(),
            players: new Map(),
            skills: new Map(),
            factions: new Map(),
            jobQueue: [],
            imageJobs: new Map(),
            pendingLocationImages: new Map(),
            npcGenerationPromises: new Map(),
            pendingRegionStubs: new Map()
        });

        assert.deepEqual(Globals.getPlotAnalysis(), fixture);
    } finally {
        if (typeof Globals.setPlotAnalysis === 'function') {
            Globals.setPlotAnalysis(previousPlotAnalysis);
        }
        restoreSerializableGlobals(previousGlobals);
    }
});
