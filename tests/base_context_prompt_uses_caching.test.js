const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
    createPromptEnv,
    buildBaseRenderContext,
    loadBuildBasePromptContext
} = require('./helpers/baseContextFixtures.js');
const LLMClient = require('../LLMClient.js');
const Globals = require('../Globals.js');

Globals.config = {
    ai: {
        backend: 'openai_compatible',
        endpoint: 'https://example.invalid/v1/chat/completions',
        apiKey: 'test-key',
        model: 'test-model',
        tinybrain: false,
        tinybrain_prompts: { player_action: false }
    },
    chat_tools: { request_user_input_enabled: true },
    use_legacy_prompt_checks: false
};

function extractGenerationPrompt(rendered) {
    const generationPromptMatch = rendered.match(
        /<generationPrompt><!\[CDATA\[([\s\S]*?)]]><\/generationPrompt>/
    );
    assert.ok(generationPromptMatch, 'Expected the rendered base context to contain a generation prompt.');
    return generationPromptMatch[1];
}

function buildRenderContext({
    promptUsesCaching,
    omitGameHistory,
    omitInventoryItems = false,
    omitAbilities = false,
    suppressQuestList = false
}) {
    const context = buildBaseRenderContext({
        question: 'What happened?',
        currencyName: 'Gold',
        regionName: '',
        promptUsesCaching,
        overrides: {
            gameHistory: 'Older story entry.',
            recentGameHistory: 'Recent story entry.',
            omitGameHistory,
            omitInventoryItems,
            omitAbilities,
            suppressQuestList
        }
    });
    context.currentPlayer.inventory = [{
        name: 'Cache Blade',
        count: 1,
        rarity: 'common',
        level: 1,
        value: 1,
        shortDescription: 'A test blade.'
    }];
    context.currentPlayer.abilities = [{
        name: 'Cache Step',
        level: 1,
        shortDescription: 'A test ability.'
    }];
    context.currentPlayer.currentQuests = [{
        name: 'Cache Quest',
        description: 'A test quest.',
        rewardXp: 0,
        objectives: [],
        giver: 'Tester'
    }];
    return context;
}

test('base-context omits olderStoryHistory when omitGameHistory is set and prompt_uses_caching is false', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        promptUsesCaching: false,
        omitGameHistory: true
    }));

    assert.doesNotMatch(rendered, /<olderStoryHistory>/);
    assert.match(rendered, /<recentStoryHistory>Recent story entry\.<\/recentStoryHistory>/);
});

test('base-context keeps olderStoryHistory when prompt_uses_caching is true', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        promptUsesCaching: true,
        omitGameHistory: true
    }));

    assert.match(rendered, /<olderStoryHistory>Older story entry\.<\/olderStoryHistory>/);
    assert.match(
        rendered,
        /\[\[\[AI_RPG_INTERNAL_MESSAGE_BOUNDARY_RECENT_STORY_HISTORY_V1]]]\s*<recentStoryHistory>/
    );
    assert.match(rendered, /AI_RPG_INTERNAL_MESSAGE_BOUNDARY_BASE_CONTEXT_SECTION_V1/);
});

test('base-context does not add a recent-story message boundary when prompt_uses_caching is false', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        promptUsesCaching: false,
        omitGameHistory: false
    }));

    assert.doesNotMatch(rendered, /AI_RPG_INTERNAL_MESSAGE_BOUNDARY_RECENT_STORY_HISTORY_V1/);
    assert.doesNotMatch(rendered, /AI_RPG_INTERNAL_MESSAGE_BOUNDARY_BASE_CONTEXT_SECTION_V1/);
    assert.match(rendered, /AI_RPG_INTERNAL_BASE_CONTEXT_END_V1/);
    assert.match(rendered, /<recentStoryHistory>Recent story entry\.<\/recentStoryHistory>/);
});

test('base-context section markers expand at complete top-level XML boundaries', () => {
    const promptEnv = createPromptEnv();
    const context = buildRenderContext({
        promptUsesCaching: true,
        omitGameHistory: false
    });
    context.currentLocation = {
        name: 'Cache Plaza',
        description: 'A location used to verify cache boundaries.',
        statusEffects: [],
        exits: [],
        items: []
    };
    context.trackers = [{
        id: 'tracker_1',
        name: 'Cache Tracker',
        type: 'percentage',
        value: '50%',
        hidden: false,
        lastUpdated: 'now',
        guidance: 'Test the continuity boundary.',
        note: ''
    }];
    const rendered = promptEnv.render('base-context.xml.njk', context);
    const generationPrompt = extractGenerationPrompt(rendered);
    const recentStoryMarker = LLMClient.getRecentStoryMessageBoundaryMarker();
    const sectionMarker = LLMClient.getBaseContextSectionMessageBoundaryMarker();
    const stableContextMarker = LLMClient.getStableContextMessageBoundaryMarker();
    const expanded = LLMClient.expandPromptMessageBoundaries([
        { role: 'system', content: 'System.' },
        { role: 'user', content: generationPrompt }
    ]);
    const userMessages = expanded.slice(1);

    assert.equal(generationPrompt.split(sectionMarker).length - 1, 7);
    assert.equal(userMessages.length, 10);
    assert.match(userMessages[0].content, /<setting>/);
    assert.match(userMessages[1].content, /^\s*<olderStoryHistory>/);
    assert.match(userMessages[2].content, /^\s*<allNpcs>/);
    assert.match(userMessages[3].content, /^\s*<currentRegion>/);
    assert.match(userMessages[4].content, /^\s*<currentLocation>/);
    assert.match(userMessages[5].content, /^\s*<player>/);
    assert.match(userMessages[6].content, /^\s*<playerParty>/);
    assert.match(userMessages[7].content, /^\s*<additionalLore>/);
    assert.match(userMessages[8].content, /^\s*<trackers>/);
    assert.match(userMessages[9].content, /^\s*<recentStoryHistory>Recent story entry\.<\/recentStoryHistory>/);
    assert.equal(userMessages.every(message => message.role === 'user'), true);
    assert.equal(
        userMessages.map(message => message.content).join(''),
        generationPrompt
            .split(sectionMarker).join('')
            .split(stableContextMarker).join('')
            .replace(recentStoryMarker, '')
    );
});

test('base-context section expansion remains valid when optional sections are absent', () => {
    const promptEnv = createPromptEnv();
    const generationPrompt = extractGenerationPrompt(promptEnv.render(
        'base-context.xml.njk',
        buildRenderContext({
            promptUsesCaching: true,
            omitGameHistory: false
        })
    ));
    const expanded = LLMClient.expandPromptMessageBoundaries([
        { role: 'system', content: 'System.' },
        { role: 'user', content: generationPrompt }
    ]);

    assert.equal(expanded.length > 3, true);
    assert.equal(
        expanded.slice(1).every(message => typeof message.content === 'string' && message.content.trim()),
        true
    );
});

test('base-context prompts preserve caller tool subsets without mutating request guidance', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        promptUsesCaching: true,
        omitGameHistory: false
    }));
    const generationPrompt = extractGenerationPrompt(rendered);
    const marker = LLMClient.getBaseContextEndMarker();
    const markerIndex = generationPrompt.indexOf(marker);
    assert.ok(markerIndex > generationPrompt.indexOf('</currentConditions>'));

    const toolLessPolicy = LLMClient.applyBaseContextToolPolicy([
        { role: 'system', content: 'System.' },
        { role: 'user', content: generationPrompt }
    ], {
        metadataLabel: 'slop_remover',
        additionalPayload: {}
    });
    assert.equal(toolLessPolicy.isBaseContextPrompt, true);
    assert.equal(toolLessPolicy.sharedToolsApplied, false);
    assert.equal(toolLessPolicy.additionalPayload.tools, undefined);
    assert.equal(toolLessPolicy.messages.length, 3);
    assert.doesNotMatch(toolLessPolicy.messages[1].content, /AI_RPG_INTERNAL_BASE_CONTEXT_END_V1/);
    assert.match(toolLessPolicy.messages[1].content, /<\/currentConditions>/);
    assert.doesNotMatch(toolLessPolicy.messages[1].content, /What happened\?/);
    assert.match(toolLessPolicy.messages[2].content, /What happened\?/);

    const playerActionTools = LLMClient.resolvePlayerActionToolDefinitions();
    const existingToolPolicy = LLMClient.applyBaseContextToolPolicy([
        { role: 'system', content: 'System.' },
        { role: 'user', content: generationPrompt }
    ], {
        metadataLabel: 'player_action',
        additionalPayload: {
            tools: playerActionTools.slice(0, 2),
            tool_choice: 'auto'
        }
    });
    assert.equal(existingToolPolicy.sharedToolsApplied, false);
    assert.equal(existingToolPolicy.messages.length, 3);
    assert.doesNotMatch(JSON.stringify(existingToolPolicy.messages), /Tool execution permissions for this completion:/);
    assert.deepEqual(
        existingToolPolicy.messages.slice(0, 2),
        toolLessPolicy.messages.slice(0, 2),
        'player-action and slop-remover requests should be identical through the base-context boundary'
    );
    assert.deepEqual(
        existingToolPolicy.additionalPayload.tools,
        playerActionTools.slice(0, 2),
        'a player-action schema subset remains scoped to the caller'
    );
});

test('generic base-context prompts keep their existing tools and skip the shared policy', () => {
    const promptEnv = createPromptEnv();
    const generationPrompt = extractGenerationPrompt(promptEnv.render(
        'base-context.xml.njk',
        buildRenderContext({
            promptUsesCaching: true,
            omitGameHistory: false
        })
    ));
    const genericTools = [{
        type: 'function',
        function: { name: 'genericOnlyTool', parameters: { type: 'object' } }
    }];
    const policy = LLMClient.applyBaseContextToolPolicy([
        { role: 'system', content: 'System.' },
        { role: 'user', content: generationPrompt }
    ], {
        metadataLabel: 'generic_prompt',
        additionalPayload: {
            tools: genericTools,
            tool_choice: 'auto'
        }
    });

    assert.equal(policy.isBaseContextPrompt, true);
    assert.equal(policy.sharedToolsApplied, false);
    assert.deepEqual(policy.additionalPayload.tools, genericTools);
    assert.doesNotMatch(policy.messages[1].content, /AI_RPG_INTERNAL_BASE_CONTEXT_END_V1/);
    assert.doesNotMatch(policy.messages[1].content, /Do not make tool calls\./);
});

test('base-context prompts preserve larger or custom caller tool schemas', () => {
    const promptEnv = createPromptEnv();
    const generationPrompt = extractGenerationPrompt(promptEnv.render(
        'base-context.xml.njk',
        buildRenderContext({
            promptUsesCaching: true,
            omitGameHistory: false
        })
    ));
    const restrictedTools = [{
        type: 'function',
        function: {
            name: 'generateRandomInteger',
            parameters: { type: 'object' }
        }
    }];
    const policy = LLMClient.applyBaseContextToolPolicy([
        { role: 'system', content: 'System.' },
        { role: 'user', content: generationPrompt }
    ], {
        metadataLabel: 'thing_generator_contents_test',
        additionalPayload: {
            tools: restrictedTools,
            tool_choice: 'auto'
        },
        preserveCallerToolDefinitions: true
    });

    assert.equal(policy.isBaseContextPrompt, true);
    assert.equal(policy.sharedToolsApplied, false);
    assert.equal(policy.callerToolDefinitionsPreserved, true);
    assert.deepEqual(policy.additionalPayload.tools, restrictedTools);
    assert.equal(policy.additionalPayload.tool_choice, 'auto');
    assert.doesNotMatch(policy.messages.at(-1).content, /Do not make tool calls\./);
});

test('player-action base-context policy recognizes its exact baseline schema', () => {
    const { getChatToolDefinitions } = require('../chat_tool_calls.js');
    const promptEnv = createPromptEnv();
    const generationPrompt = extractGenerationPrompt(promptEnv.render(
        'base-context.xml.njk',
        buildRenderContext({
            promptUsesCaching: true,
            omitGameHistory: false
        })
    ));
    const marker = LLMClient.getBaseContextEndMarker();
    assert.ok(generationPrompt.includes(marker));
    const callerTools = getChatToolDefinitions({ allowTechniqueExecution: true });
    const techniqueSchema = callerTools.find(definition => definition.function.name === 'useTechnique');
    assert.ok(techniqueSchema, 'the player-action caller schema includes useTechnique');

    const policy = LLMClient.applyBaseContextToolPolicy([
        { role: 'system', content: 'System.' },
        { role: 'user', content: generationPrompt }
    ], {
        metadataLabel: 'player_action',
        additionalPayload: { tools: callerTools, tool_choice: 'auto' }
    });

    assert.equal(policy.isBaseContextPrompt, true);
    assert.equal(policy.sharedToolsApplied, false);
    assert.deepEqual(policy.additionalPayload.tools, callerTools);
    assert.deepEqual(
        policy.additionalPayload.tools.find(definition => definition.function.name === 'useTechnique'),
        techniqueSchema,
        'the provider-bound schema retains candidate/discovery fields'
    );
    const subsetPolicy = LLMClient.applyBaseContextToolPolicy([
        { role: 'system', content: 'System.' },
        { role: 'user', content: generationPrompt }
    ], {
        metadataLabel: 'player_action',
        additionalPayload: { tools: callerTools.slice(0, 1), tool_choice: 'auto' }
    });
    assert.equal(subsetPolicy.sharedToolsApplied, false);
    assert.deepEqual(subsetPolicy.additionalPayload.tools, callerTools.slice(0, 1));
});

test('a caller with no tools retains no-call execution restrictions', () => {
    const promptEnv = createPromptEnv();
    const generationPrompt = extractGenerationPrompt(promptEnv.render(
        'base-context.xml.njk',
        buildRenderContext({
            promptUsesCaching: true,
            omitGameHistory: false
        })
    ));
    const policy = LLMClient.applyBaseContextToolPolicy([
        { role: 'system', content: 'System.' },
        { role: 'user', content: generationPrompt }
    ], {
        metadataLabel: 'slop_remover',
        additionalPayload: {}
    });

    assert.equal(policy.sharedToolsApplied, false);
    assert.equal(policy.toolCallsForbidden, true);
    assert.equal(policy.additionalPayload.tools, undefined);
    assert.doesNotMatch(JSON.stringify(policy.messages), /Tool execution permissions for this completion:/);
});

test('base-context honors inventory, ability, and quest omissions when prompt_uses_caching is false', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        promptUsesCaching: false,
        omitGameHistory: false,
        omitInventoryItems: true,
        omitAbilities: true,
        suppressQuestList: true
    }));

    assert.doesNotMatch(rendered, /Cache Blade/);
    assert.doesNotMatch(rendered, /Cache Step/);
    assert.doesNotMatch(rendered, /Cache Quest/);
});

test('base-context exposes active quest capacity even when detailed quest entries are omitted', () => {
    const promptEnv = createPromptEnv();
    const context = buildRenderContext({
        promptUsesCaching: false,
        omitGameHistory: false,
        suppressQuestList: true
    });
    context.config.soft_quest_limit = 3;
    const rendered = promptEnv.render('base-context.xml.njk', context);

    assert.match(rendered, /<activeQuestCount>1<\/activeQuestCount>/);
    assert.match(rendered, /<softQuestLimit>3<\/softQuestLimit>/);
    assert.doesNotMatch(rendered, /<quests>/);
});

test('base-context includes inventory, abilities, and quests when prompt_uses_caching is true', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        promptUsesCaching: true,
        omitGameHistory: true,
        omitInventoryItems: true,
        omitAbilities: true,
        suppressQuestList: true
    }));

    assert.match(rendered, /Cache Blade/);
    assert.match(rendered, /Cache Step/);
    assert.match(rendered, /Cache Quest/);
});

test('base-context includes event-summary history when caching ignores its omission request', () => {
    const eventSummaryEntry = {
        type: 'event-summary',
        role: 'assistant',
        content: 'A cache-visible event occurred.'
    };
    const buildWithoutCaching = loadBuildBasePromptContext({
        config: {
            prompt_uses_caching: false,
            summaries: {
                max_unsummarized_log_entries: 10,
                max_summarized_log_entries: 10
            }
        },
        chatHistory: [eventSummaryEntry],
        includeMysteryCleanup: true
    });
    const buildWithCaching = loadBuildBasePromptContext({
        config: {
            prompt_uses_caching: true,
            summaries: {
                max_unsummarized_log_entries: 10,
                max_summarized_log_entries: 10
            }
        },
        chatHistory: [eventSummaryEntry],
        includeMysteryCleanup: true
    });

    const omittedContext = buildWithoutCaching({ omitEventSummaryHistory: true });
    const cachedContext = buildWithCaching({ omitEventSummaryHistory: true });
    const omittedHistory = `${omittedContext.gameHistory}\n${omittedContext.recentGameHistory}`;
    const cachedHistory = `${cachedContext.gameHistory}\n${cachedContext.recentGameHistory}`;

    assert.doesNotMatch(omittedHistory, /A cache-visible event occurred\./);
    assert.match(cachedHistory, /A cache-visible event occurred\./);
});

test('base-context history assembly does not append an empty recent-story separator to older history', () => {
    const serverSource = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');

    assert.doesNotMatch(serverSource, /Recent story \(verbatim, not summarized\)/);
});
