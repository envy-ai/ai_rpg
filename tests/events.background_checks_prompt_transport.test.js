const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

function installCommonEventDeps(overrides = {}, configOverrides = {}) {
    const config = {
        ai: {},
        event_checks: { enabled: true, use_xml: true },
        quest_checks: { enabled: true },
        ...configOverrides,
    };

    Events.initialize({
        promptEnv: {
            render: (_template, context) => JSON.stringify(context),
        },
        parseXMLTemplate: (rendered) => ({
            systemPrompt: 'system',
            generationPrompt: rendered,
        }),
        prepareBasePromptContext: async () => ({}),
        getConfig: () => config,
        getCurrentPlayer: () => null,
        Location: { get: () => null },
        findRegionByLocationId: () => null,
        ...overrides,
    });
}

test('runQuestChecks skips prompt construction when there are no active quests', async () => {
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousConfig = Globals.config;
    let chatCompletionCalls = 0;
    let baseContextCalls = 0;

    try {
        Globals.config = {};
        LLMClient.chatCompletion = async () => {
            chatCompletionCalls += 1;
            throw new Error('quest check should not call LLMClient.chatCompletion');
        };
        LLMClient.logPrompt = () => {};

        installCommonEventDeps({
            prepareBasePromptContext: async () => {
                baseContextCalls += 1;
                throw new Error('quest check should not build base context without active quests');
            },
            getCurrentPlayer: () => ({
                currentQuests: [],
                getQuestByIndex: () => null,
            }),
        });

        const result = await Events.runQuestChecks();

        assert.equal(result, null);
        assert.equal(baseContextCalls, 0);
        assert.equal(chatCompletionCalls, 0);
        assert.equal(Events.getMaintenancePromptTurnCounters().questCheckTurnCounter, 0);
    } finally {
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        Globals.config = previousConfig;
        Events.initialize({});
    }
});

test('runQuestChecks still sends a prompt when there is an active quest', async () => {
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousConfig = Globals.config;
    let capturedOptions = null;
    const quest = {
        id: 'quest-1',
        name: 'Find the Key',
        description: 'Find the missing key.',
        objectives: [],
    };

    try {
        Globals.config = {};
        LLMClient.chatCompletion = async (options) => {
            capturedOptions = options;
            return '<quests></quests>';
        };
        LLMClient.logPrompt = () => {};

        installCommonEventDeps({
            prepareBasePromptContext: async () => ({ recentGameHistory: '' }),
            getCurrentPlayer: () => ({
                currentQuests: [quest],
                getQuestByIndex: (index) => (index === 0 ? quest : null),
            }),
        });

        await Events.runQuestChecks();

        assert.equal(capturedOptions?.metadataLabel, 'quest_check');
        assert.notEqual(capturedOptions?.stream, false);
    } finally {
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        Globals.config = previousConfig;
        Events.initialize({});
    }
});

test('runQuestChecks honors quest_checks.interval for active quests', async () => {
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousConfig = Globals.config;
    let chatCompletionCalls = 0;
    const quest = {
        id: 'quest-interval',
        name: 'Wait for the Signal',
        description: 'Wait until the interval is reached.',
        objectives: [],
    };

    try {
        Globals.config = {};
        LLMClient.chatCompletion = async () => {
            chatCompletionCalls += 1;
            return '<quests></quests>';
        };
        LLMClient.logPrompt = () => {};

        installCommonEventDeps({
            prepareBasePromptContext: async () => ({ recentGameHistory: '' }),
            getCurrentPlayer: () => ({
                currentQuests: [quest],
                getQuestByIndex: (index) => (index === 0 ? quest : null),
            }),
        }, {
            quest_checks: { enabled: true, interval: 2 },
        });

        assert.equal(await Events.runQuestChecks(), null);
        assert.equal(chatCompletionCalls, 0);

        await Events.runQuestChecks();
        assert.equal(chatCompletionCalls, 1);
        assert.equal(Events.getMaintenancePromptTurnCounters().questCheckTurnCounter, 2);
    } finally {
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        Globals.config = previousConfig;
        Events.initialize({});
    }
});

test('runQuestChecks can bypass and explicitly reset the quest interval counter', async () => {
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousConfig = Globals.config;
    let chatCompletionCalls = 0;
    const quest = {
        id: 'quest-immediate',
        name: 'Open the Seal',
        description: 'Open the ancient seal.',
        objectives: [],
    };

    try {
        Globals.config = {};
        LLMClient.chatCompletion = async () => {
            chatCompletionCalls += 1;
            return '<quests></quests>';
        };
        LLMClient.logPrompt = () => {};

        installCommonEventDeps({
            prepareBasePromptContext: async () => ({ recentGameHistory: '' }),
            getCurrentPlayer: () => ({
                currentQuests: [quest],
                getQuestByIndex: (index) => (index === 0 ? quest : null),
            }),
        }, {
            quest_checks: { enabled: true, interval: 5 },
        });

        assert.equal(await Events.runQuestChecks(), null);
        assert.equal(Events.getMaintenancePromptTurnCounters().questCheckTurnCounter, 1);

        assert.equal(
            await Events.runQuestChecks({ bypassInterval: true }),
            '<quests></quests>'
        );
        assert.equal(chatCompletionCalls, 1);
        assert.equal(Events.getMaintenancePromptTurnCounters().questCheckTurnCounter, 1);

        Events.resetQuestCheckTurnCounter();
        assert.equal(Events.getMaintenancePromptTurnCounters().questCheckTurnCounter, 0);
    } finally {
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        Globals.config = previousConfig;
        Events.initialize({});
    }
});
