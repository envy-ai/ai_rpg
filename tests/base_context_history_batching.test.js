const test = require('node:test');
const assert = require('node:assert/strict');

const {
    loadBuildBasePromptContext
} = require('./helpers/baseContextFixtures.js');

function appendTurn(chatHistory, turnNumber) {
    chatHistory.push(
        {
            id: `user-${turnNumber}`,
            role: 'user',
            content: `User action ${turnNumber}.`
        },
        {
            id: `prose-${turnNumber}`,
            role: 'assistant',
            type: 'player-action',
            content: `Assistant prose ${turnNumber}.`
        }
    );
}

test('base-context older history changes only at configured batch boundaries', () => {
    const chatHistory = [];
    const config = {
        prompt_uses_caching: true,
        recent_history_turns: 2,
        recent_history_batch_interval: 3,
        summaries: {
            max_unsummarized_log_entries: 100,
            max_summarized_log_entries: 0
        }
    };
    const buildBasePromptContext = loadBuildBasePromptContext({
        chatHistory,
        config,
        includeMysteryCleanup: true
    });

    for (let turn = 1; turn <= 4; turn += 1) {
        appendTurn(chatHistory, turn);
    }
    const beforeFirstRollover = buildBasePromptContext();
    assert.doesNotMatch(beforeFirstRollover.gameHistory, /Assistant prose 1\./);
    assert.match(beforeFirstRollover.recentGameHistory, /Assistant prose 1\./);
    assert.match(beforeFirstRollover.recentGameHistory, /Assistant prose 4\./);

    appendTurn(chatHistory, 5);
    const firstRollover = buildBasePromptContext();
    assert.match(firstRollover.gameHistory, /Assistant prose 1\./);
    assert.match(firstRollover.gameHistory, /Assistant prose 3\./);
    assert.doesNotMatch(firstRollover.gameHistory, /Assistant prose 4\./);
    assert.match(firstRollover.recentGameHistory, /Assistant prose 4\./);
    assert.match(firstRollover.recentGameHistory, /Assistant prose 5\./);

    appendTurn(chatHistory, 6);
    const oneTurnAfterRollover = buildBasePromptContext();
    assert.equal(oneTurnAfterRollover.gameHistory, firstRollover.gameHistory);

    appendTurn(chatHistory, 7);
    const twoTurnsAfterRollover = buildBasePromptContext();
    assert.equal(twoTurnsAfterRollover.gameHistory, firstRollover.gameHistory);

    appendTurn(chatHistory, 8);
    const secondRollover = buildBasePromptContext();
    assert.notEqual(secondRollover.gameHistory, firstRollover.gameHistory);
    assert.match(secondRollover.gameHistory, /Assistant prose 6\./);
    assert.doesNotMatch(secondRollover.gameHistory, /Assistant prose 7\./);
    assert.match(secondRollover.recentGameHistory, /Assistant prose 7\./);
    assert.match(secondRollover.recentGameHistory, /Assistant prose 8\./);
});

test('default config batches recent-history rollover every ten turns', () => {
    const fs = require('node:fs');
    const yaml = require('js-yaml');
    const defaultConfig = yaml.load(fs.readFileSync(require.resolve('../config.default.yaml'), 'utf8'));
    const serverSource = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const historySource = fs.readFileSync(require.resolve('../base_context_history.js'), 'utf8');

    assert.equal(defaultConfig.recent_history_batch_interval, 10);
    assert.match(
        historySource,
        /recent_history_batch_interval must be an integer greater than or equal to 1 when provided/
    );
    assert.match(
        serverSource,
        /resolveRecentHistoryBatchInterval\(config\.recent_history_batch_interval\)/
    );
});

test('cache-enabled shared history stays identical across craft and all-entry options', () => {
    const chatHistory = [
        { id: 'craft', role: 'user', content: 'Crafted a lantern.', metadata: { actionType: 'craft' } },
        { id: 'craft-child', parentId: 'craft', role: 'assistant', type: 'player-action', content: 'Lantern completed.' },
        { id: 'status', role: 'assistant', type: 'status-summary', content: 'STATUS EXCLUDED' },
        { id: 'level', role: 'assistant', type: 'level-up', content: 'LEVEL EXCLUDED' },
        { id: 'extra', role: 'assistant', type: 'generic-prompt-response', content: 'Administrative note.', metadata: { excludeFromBaseContextHistory: true } },
        { id: 'diagnostic', role: 'assistant', type: 'check-results', content: 'DIAGNOSTIC EXCLUDED' },
        { id: 'story', role: 'assistant', type: 'player-action', content: 'The journey continues.' }
    ];
    const config = { prompt_uses_caching: true, recent_history_turns: 1, recent_history_batch_interval: 1,
        summaries: { max_unsummarized_log_entries: 100, max_summarized_log_entries: 0 }, base_context: { omit_craft_history: true } };
    const build = loadBuildBasePromptContext({ chatHistory, config });
    const normal = build();
    const omit = build({ omitCraftHistory: true });
    const all = build({ includeAllHistoryEntryTypes: true });
    for (const field of ['gameHistory', 'recentGameHistory', 'fullGameHistory']) {
        assert.equal(omit[field], normal[field], field);
        assert.equal(all[field], normal[field], field);
    }
    assert.match(normal.fullGameHistory, /Crafted a lantern/);
    assert.match(normal.fullGameHistory, /Lantern completed/);
    assert.doesNotMatch(normal.fullGameHistory, /STATUS EXCLUDED|LEVEL EXCLUDED|Administrative note|DIAGNOSTIC EXCLUDED/);
    assert.equal(normal.supplementalPromptHistory, '');
    assert.match(all.supplementalPromptHistory, /Administrative note/);
    assert.doesNotMatch(all.supplementalPromptHistory, /STATUS EXCLUDED|LEVEL EXCLUDED|DIAGNOSTIC EXCLUDED|Crafted a lantern|journey continues/);
    const { createPromptEnv, buildBaseRenderContext } = require('./helpers/baseContextFixtures.js');
    const rendered = createPromptEnv().render('base-context.xml.njk', buildBaseRenderContext({ promptUsesCaching: true, overrides: { supplementalPromptHistory: all.supplementalPromptHistory } }));
    const boundary = rendered.indexOf('[[[AI_RPG_INTERNAL_BASE_CONTEXT_END_V1]]]');
    assert.ok(boundary >= 0 && rendered.indexOf('<supplementalPromptHistory>') > boundary);
    assert.match(rendered, /Administrative note/);
});

test('without caching craft omission and all-entry history retain their established behavior', () => {
    const chatHistory = [
        { id: 'craft', role: 'user', content: 'Crafted a lantern.', metadata: { actionType: 'craft' } },
        { id: 'child', parentId: 'craft', role: 'assistant', type: 'player-action', content: 'Lantern completed.' },
        { id: 'status', role: 'assistant', type: 'status-summary', content: 'Status report.' },
        { id: 'extra', role: 'assistant', type: 'generic-prompt-response', content: 'Administrative note.', metadata: { excludeFromBaseContextHistory: true } }
    ];
    const build = loadBuildBasePromptContext({ chatHistory, config: { prompt_uses_caching: false, summaries: { max_unsummarized_log_entries: 100, max_summarized_log_entries: 0 } } });
    const omitted = build({ omitCraftHistory: true });
    assert.doesNotMatch(omitted.fullGameHistory, /Crafted a lantern|Lantern completed/);
    const all = build({ includeAllHistoryEntryTypes: true });
    assert.match(all.fullGameHistory, /Crafted a lantern/);
    assert.match(all.fullGameHistory, /Status report/);
    assert.match(all.fullGameHistory, /Administrative note/);
    assert.equal(all.supplementalPromptHistory, '');
});

test('recent status and level-up notices follow source chronology without shifting story rollover', () => {
    const story = [];
    for (let turn = 1; turn <= 4; turn++) appendTurn(story, turn);
    const notices = [
        { id: 'old-status', role: 'assistant', type: 'status-summary', content: 'Old status notice.' },
        { id: 'recent-status', role: 'assistant', type: 'status-summary', content: 'Recent status notice.' },
        { id: 'recent-level', role: 'assistant', type: 'level-up', content: 'Recent level notice.' }
    ];
    const withNotices = [...story.slice(0, 2), notices[0], ...story.slice(2, 6), notices[1], story[6], notices[2], story[7]];
    for (const caching of [false, true]) {
        const config = { prompt_uses_caching: caching, recent_history_turns: 2, recent_history_batch_interval: 1,
            summaries: { max_unsummarized_log_entries: 100, max_summarized_log_entries: 0 } };
        const plain = loadBuildBasePromptContext({ chatHistory: story, config })();
        const enriched = loadBuildBasePromptContext({ chatHistory: withNotices, config })();
        assert.equal(enriched.gameHistory, plain.gameHistory, 'notices must not alter old story or rollover');
        assert.doesNotMatch(enriched.gameHistory, /status notice|level notice/i);
        assert.doesNotMatch(enriched.recentGameHistory, /Old status notice/);
        assert.match(enriched.recentGameHistory, /Recent status notice/);
        assert.match(enriched.recentGameHistory, /Recent level notice/);
        assert.ok(enriched.recentGameHistory.indexOf('Recent status notice') < enriched.recentGameHistory.indexOf('User action 4.'));
        assert.ok(enriched.recentGameHistory.indexOf('User action 4.') < enriched.recentGameHistory.indexOf('Recent level notice'));
        assert.ok(enriched.recentGameHistory.indexOf('Recent level notice') < enriched.recentGameHistory.indexOf('Assistant prose 4.'));
        assert.match(enriched.fullGameHistory, /Recent level notice/);
    }
});

test('recent notices use nonblank summaries when content is missing or blank', () => {
    const history = [
        { id: 'story', role: 'assistant', type: 'player-action', content: 'Recent story.' },
        { id: 'summary', role: 'assistant', type: 'status-summary', summary: 'Summary-only status.' },
        { id: 'whitespace', role: 'assistant', type: 'level-up', content: '  \n ', summary: 'Level summary.' },
        { id: 'empty', role: 'assistant', type: 'status-summary', content: '  ', summary: ' ' },
        { id: 'nonstring', role: 'assistant', type: 'level-up', content: { text: 'not prose' }, summary: '' }
    ];
    const config = { prompt_uses_caching: true, recent_history_turns: 1, recent_history_batch_interval: 1,
        summaries: { max_unsummarized_log_entries: 100, max_summarized_log_entries: 0 } };
    const context = loadBuildBasePromptContext({ chatHistory: history, config })();
    assert.match(context.recentGameHistory, /Recent story\.[\s\S]*Summary-only status\.[\s\S]*Level summary\./);
    assert.doesNotMatch(context.gameHistory, /Summary-only status|Level summary/);
    assert.doesNotMatch(context.recentGameHistory, /\[object Object\]/);
    const lines = context.recentGameHistory.split('\n').filter(Boolean);
    assert.equal(lines.length, 3, 'blank notices must not produce speaker-only lines');
});
