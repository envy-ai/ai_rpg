const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

function snapshotEventsState() {
    return {
        config: Globals.config,
        currentPlayer: Globals.currentPlayer,
        chatCompletion: LLMClient.chatCompletion,
        logPrompt: LLMClient.logPrompt,
        deps: Events._deps,
        timeout: Events._baseTimeout,
        parsers: Events._parsers,
        aggregators: Events._aggregators,
        handlers: Events._handlers,
        housekeepingRunner: Events._housekeepingPromptRunner,
        maintenancePromptTurnCounters: Events.getMaintenancePromptTurnCounters()
    };
}

function restoreEventsState(snapshot) {
    Events._deps = snapshot.deps;
    Events._baseTimeout = snapshot.timeout;
    Events._parsers = snapshot.parsers;
    Events._aggregators = snapshot.aggregators;
    Events._handlers = snapshot.handlers;
    Events._housekeepingPromptRunner = snapshot.housekeepingRunner;
    Events.hydrateMaintenancePromptTurnCounters(snapshot.maintenancePromptTurnCounters);
    LLMClient.chatCompletion = snapshot.chatCompletion;
    LLMClient.logPrompt = snapshot.logPrompt;
    Globals.config = snapshot.config;
    Globals.currentPlayer = snapshot.currentPlayer;
}

function initializeEventsForHousekeepingTest({
    useXml = true,
    player,
    housekeepingCalls,
    housekeepingInterval = 1
}) {
    Globals.config = {
        ai: {},
        event_checks: useXml ? { enabled: true } : { enabled: true, use_xml: false },
        housekeeping: { interval: housekeepingInterval },
        quests: { enabled: false },
        omit_npc_generation: true
    };
    Globals.currentPlayer = player;

    LLMClient.logPrompt = () => {};
    LLMClient.chatCompletion = async (options = {}) => {
        const message = Array.isArray(options.messages) ? options.messages[1]?.content : null;
        const payload = typeof message === 'string' ? JSON.parse(message) : {};
        if (payload.promptType === 'events-xml') {
            return '<events><currency><amount>7</amount></currency></events>';
        }
        if (payload.promptType === 'event-checks') {
            const questionCount = Array.isArray(payload.eventQuestions)
                ? payload.eventQuestions.length
                : 0;
            const answers = Array.from({ length: questionCount }, (_, index) => `${index + 1}. N/A`).join('\n');
            return `<final>\n${answers}\n</final>`;
        }
        throw new Error(`Unexpected prompt type in housekeeping test: ${payload.promptType || 'unknown'}`);
    };

    Events.initialize({
        promptEnv: {
            render: (_template, context) => JSON.stringify({
                promptType: context.promptType,
                eventQuestions: context.eventQuestions || [],
                needBarDefinitions: []
            })
        },
        parseXMLTemplate: (rendered) => ({
            systemPrompt: 'system',
            generationPrompt: rendered
        }),
        prepareBasePromptContext: async () => ({
            needBarDefinitions: [],
            npcs: [],
            party: []
        }),
        Location: {
            get: () => null
        },
        findRegionByLocationId: () => null,
        getCurrentPlayer: () => player,
        getConfig: () => Globals.config
    });
    Events.setHousekeepingPromptRunner(async (payload) => {
        housekeepingCalls.push({
            textToCheck: payload.textToCheck,
            actionText: payload.actionText,
            playerCurrencyAfterEvents: player.currency,
            structured: payload.eventResult?.structured || null
        });
        return { status: 'ok' };
    });
}

test('XML event checks run silent housekeeping after applying event outcomes', async () => {
    const snapshot = snapshotEventsState();
    const housekeepingCalls = [];
    const player = {
        isNPC: false,
        name: 'Wanderer',
        currency: 0,
        getCurrency() {
            return this.currency;
        },
        adjustCurrency(amount) {
            this.currency += amount;
        }
    };

    try {
        initializeEventsForHousekeepingTest({ useXml: true, player, housekeepingCalls });

        const result = await Events.runEventChecks({
            textToCheck: 'Wanderer finds seven coins.',
            actionText: 'Search the wreckage.',
            suppressNeedBarEventChecks: true
        });

        assert.equal(result.currencyChanges[0].amount, 7);
        assert.equal(player.currency, 7);
        assert.equal(housekeepingCalls.length, 1);
        assert.equal(housekeepingCalls[0].textToCheck, 'Wanderer finds seven coins.');
        assert.equal(housekeepingCalls[0].actionText, 'Search the wreckage.');
        assert.equal(housekeepingCalls[0].playerCurrencyAfterEvents, 7);
        assert.ok(housekeepingCalls[0].structured);
    } finally {
        restoreEventsState(snapshot);
    }
});

test('automatic housekeeping honors housekeeping.interval', async () => {
    const snapshot = snapshotEventsState();
    const housekeepingCalls = [];
    const player = {
        isNPC: false,
        name: 'Wanderer',
        currency: 0,
        getCurrency() {
            return this.currency;
        },
        adjustCurrency(amount) {
            this.currency += amount;
        }
    };

    try {
        initializeEventsForHousekeepingTest({
            useXml: true,
            player,
            housekeepingCalls,
            housekeepingInterval: 2
        });

        await Events.runEventChecks({
            textToCheck: 'The first maintenance interval begins.',
            suppressNeedBarEventChecks: true
        });
        assert.equal(housekeepingCalls.length, 0);

        await Events.runEventChecks({
            textToCheck: 'The second maintenance interval completes.',
            suppressNeedBarEventChecks: true
        });
        assert.equal(housekeepingCalls.length, 1);
        assert.equal(Events.getMaintenancePromptTurnCounters().housekeepingTurnCounter, 2);
    } finally {
        restoreEventsState(snapshot);
    }
});

test('legacy event checks run silent housekeeping after grouped event prompts', async () => {
    const snapshot = snapshotEventsState();
    const housekeepingCalls = [];
    const player = {
        isNPC: false,
        name: 'Wanderer',
        currency: 0,
        getCurrency() {
            return this.currency;
        },
        adjustCurrency(amount) {
            this.currency += amount;
        }
    };

    try {
        initializeEventsForHousekeepingTest({ useXml: false, player, housekeepingCalls });

        await Events.runEventChecks({
            textToCheck: 'Nothing important changes.',
            suppressNeedBarEventChecks: true
        });

        assert.equal(housekeepingCalls.length, 1);
        assert.equal(housekeepingCalls[0].textToCheck, 'Nothing important changes.');
        assert.equal(housekeepingCalls[0].playerCurrencyAfterEvents, 0);
    } finally {
        restoreEventsState(snapshot);
    }
});

test('recursive follow-up event checks do not run duplicate housekeeping', async () => {
    const snapshot = snapshotEventsState();
    const housekeepingCalls = [];
    const player = {
        isNPC: false,
        name: 'Wanderer',
        currency: 0,
        getCurrency() {
            return this.currency;
        },
        adjustCurrency(amount) {
            this.currency += amount;
        }
    };

    try {
        initializeEventsForHousekeepingTest({ useXml: true, player, housekeepingCalls });

        await Events.runEventChecks({
            textToCheck: 'Follow-up reward prose.',
            suppressNeedBarEventChecks: true,
            _depth: 1
        });

        assert.equal(housekeepingCalls.length, 0);
        assert.equal(Events.getMaintenancePromptTurnCounters().housekeepingTurnCounter, 0);
    } finally {
        restoreEventsState(snapshot);
    }
});

test('runEventChecks suppressHousekeeping skips silent housekeeping', async () => {
    const snapshot = snapshotEventsState();
    const housekeepingCalls = [];
    const player = {
        isNPC: false,
        name: 'Wanderer',
        currency: 0,
        getCurrency() {
            return this.currency;
        },
        adjustCurrency(amount) {
            this.currency += amount;
        }
    };

    try {
        initializeEventsForHousekeepingTest({ useXml: true, player, housekeepingCalls });

        const result = await Events.runEventChecks({
            textToCheck: 'Scoped arrival prose changes the room.',
            suppressNeedBarEventChecks: true,
            suppressHousekeeping: true
        });

        assert.equal(result.currencyChanges[0].amount, 7);
        assert.equal(player.currency, 7);
        assert.equal(housekeepingCalls.length, 0);
    } finally {
        restoreEventsState(snapshot);
    }
});
