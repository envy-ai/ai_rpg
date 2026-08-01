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
});

test('base-context does not add a recent-story message boundary when prompt_uses_caching is false', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        promptUsesCaching: false,
        omitGameHistory: false
    }));

    assert.doesNotMatch(rendered, /AI_RPG_INTERNAL_MESSAGE_BOUNDARY_RECENT_STORY_HISTORY_V1/);
    assert.match(rendered, /AI_RPG_INTERNAL_BASE_CONTEXT_END_V1/);
    assert.match(rendered, /<recentStoryHistory>Recent story entry\.<\/recentStoryHistory>/);
});

test('base-context recent-story marker expands at the exact rendered history boundary', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        promptUsesCaching: true,
        omitGameHistory: false
    }));
    const generationPrompt = extractGenerationPrompt(rendered);
    const marker = LLMClient.getRecentStoryMessageBoundaryMarker();
    const expanded = LLMClient.expandPromptMessageBoundaries([
        { role: 'system', content: 'System.' },
        { role: 'user', content: generationPrompt }
    ]);

    assert.equal(expanded.length, 3);
    assert.doesNotMatch(expanded[1].content, /<recentStoryHistory>/);
    assert.match(expanded[2].content, /^\s*<recentStoryHistory>Recent story entry\.<\/recentStoryHistory>/);
    assert.equal(
        expanded[1].content + expanded[2].content,
        generationPrompt.replace(marker, '')
    );
});

test('non-generic base-context prompts share one tool schema and mark formerly tool-less prompts', () => {
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
    assert.equal(toolLessPolicy.sharedToolsApplied, true);
    assert.equal(toolLessPolicy.noToolCallsInstructionAdded, true);
    assert.ok(Array.isArray(toolLessPolicy.additionalPayload.tools));
    assert.ok(toolLessPolicy.additionalPayload.tools.length > 0);
    assert.equal(toolLessPolicy.additionalPayload.tool_choice, 'auto');
    assert.doesNotMatch(toolLessPolicy.messages[1].content, /AI_RPG_INTERNAL_BASE_CONTEXT_END_V1/);
    assert.match(
        toolLessPolicy.messages[1].content,
        /<\/currentConditions>[\s\S]*Do not make tool calls\.[\s\S]*What happened\?/
    );

    const existingToolPolicy = LLMClient.applyBaseContextToolPolicy([
        { role: 'system', content: 'System.' },
        { role: 'user', content: generationPrompt }
    ], {
        metadataLabel: 'player_action',
        additionalPayload: {
            tools: [{ type: 'function', function: { name: 'callerSpecificTool', parameters: {} } }],
            tool_choice: 'auto'
        }
    });
    assert.equal(existingToolPolicy.sharedToolsApplied, true);
    assert.equal(existingToolPolicy.noToolCallsInstructionAdded, false);
    assert.doesNotMatch(existingToolPolicy.messages[1].content, /Do not make tool calls\./);
    assert.deepEqual(
        existingToolPolicy.additionalPayload.tools,
        toolLessPolicy.additionalPayload.tools,
        'all non-generic base-context prompts should receive the same ordered tool schema'
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
    assert.equal(policy.noToolCallsInstructionAdded, false);
    assert.deepEqual(policy.additionalPayload.tools, genericTools);
    assert.doesNotMatch(policy.messages[1].content, /AI_RPG_INTERNAL_BASE_CONTEXT_END_V1/);
    assert.doesNotMatch(policy.messages[1].content, /Do not make tool calls\./);
});

test('base-context shared schema preserves an explicit tool-choice disable', () => {
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
        metadataLabel: 'player_action',
        additionalPayload: {
            tool_choice: 'none',
            function_call: 'none'
        }
    });

    assert.equal(policy.sharedToolsApplied, true);
    assert.equal(policy.additionalPayload.tool_choice, 'none');
    assert.equal(policy.additionalPayload.function_call, 'none');
    assert.ok(policy.additionalPayload.tools.length > 0);
    assert.equal(policy.noToolCallsInstructionAdded, false);
    assert.doesNotMatch(policy.messages[1].content, /Do not make tool calls\./);
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
