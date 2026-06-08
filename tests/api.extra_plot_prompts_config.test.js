const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const { DOMParser } = require('@xmldom/xmldom');

function loadExtraPlotPromptHelpers({
    config = {},
    supplementalStoryInfoTurnCounter = 0,
    plotSummaryTurnCounter = 0,
    plotSummaryRunOnNextEligibleTurn = false,
    plotExpanderTurnCounter = 0,
    offscreenNpcActivityState = null,
    chatHistory = []
} = {}) {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        function normalizeNpcNameKey(value) {');
    const end = source.indexOf('\n        function resolveRegionNameForLocationId(locationId) {', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate extra plot prompt helpers in api.js');
    }

    const functionSource = source.slice(start, end);
    const context = {
        Object,
        Array,
        Number,
        Math,
        Set,
        Map,
        console,
        config,
        supplementalStoryInfoTurnCounter,
        plotSummaryTurnCounter,
        plotSummaryRunOnNextEligibleTurn,
        plotExpanderTurnCounter,
        offscreenNpcActivityState: offscreenNpcActivityState || {
            dailyMentionedNpcNamesByWeek: {},
            turnsSinceDailyPrompt: 0,
            turnsSinceWeeklyPrompt: 0,
            lastDailyPromptWorldTime: null,
            lastWeeklyPromptWorldTime: null
        },
        OFFSCREEN_NPC_ACTIVITY_DEFAULT_DAILY_COUNT: 5,
        OFFSCREEN_NPC_ACTIVITY_DEFAULT_DAILY_MAX_TURNS_BETWEEN_PROMPTS: 20,
        OFFSCREEN_NPC_ACTIVITY_DEFAULT_WEEKLY_MAX_TURNS_BETWEEN_PROMPTS: 100,
        OFFSCREEN_NPC_ACTIVITY_DAILY_MINUTES: [7 * 60, 19 * 60],
        OFFSCREEN_NPC_ACTIVITY_WEEKLY_MINUTE: 7 * 60,
        PLOT_SUMMARY_PROMPT_FREQUENCY: 10,
        PLOT_EXPANDER_DEFAULT_PROMPT_FREQUENCY: 10,
        Globals: {
            getTimeConfig: () => ({
                cycleLengthMinutes: 24 * 60
            })
        }
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.resolveExtraPlotPromptSettings = resolveExtraPlotPromptSettings;
this.isExtraPlotPromptEnabled = isExtraPlotPromptEnabled;
this.incrementOffscreenNpcActivityTurnCounters = incrementOffscreenNpcActivityTurnCounters;
this.resolveOffscreenNpcActivityRunPlan = resolveOffscreenNpcActivityRunPlan;
this.shouldRunSupplementalStoryInfoThisTurn = shouldRunSupplementalStoryInfoThisTurn;
this.shouldRunPlotSummaryThisTurn = shouldRunPlotSummaryThisTurn;
this.shouldRunPlotExpanderThisTurn = shouldRunPlotExpanderThisTurn;`,
        context
    );

    return {
        resolveExtraPlotPromptSettings: context.resolveExtraPlotPromptSettings,
        isExtraPlotPromptEnabled: context.isExtraPlotPromptEnabled,
        incrementOffscreenNpcActivityTurnCounters: context.incrementOffscreenNpcActivityTurnCounters,
        resolveOffscreenNpcActivityRunPlan: context.resolveOffscreenNpcActivityRunPlan,
        shouldRunSupplementalStoryInfoThisTurn: context.shouldRunSupplementalStoryInfoThisTurn,
        shouldRunPlotSummaryThisTurn: context.shouldRunPlotSummaryThisTurn,
        shouldRunPlotExpanderThisTurn: context.shouldRunPlotExpanderThisTurn,
        context
    };
}

function loadCollectNpcLastMention({ chatHistory = [] } = {}) {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const helperStart = source.indexOf('        function isXmlCompatibleCodePoint(codePoint) {');
    const collectStart = source.indexOf('        function collectNpcLastMention(name) {');
    const start = helperStart >= 0 ? helperStart : collectStart;
    const end = source.indexOf('\n        function collectOffscreenNpcCandidates', collectStart);
    if (collectStart < 0 || end < 0) {
        throw new Error('Unable to locate collectNpcLastMention in api.js');
    }

    const context = {
        chatHistory
    };

    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}
this.collectNpcLastMention = collectNpcLastMention;`,
        context
    );

    return context.collectNpcLastMention;
}

function hasUnpairedSurrogate(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xD800 && code <= 0xDBFF) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xDC00 && next <= 0xDFFF)) {
                return true;
            }
            index += 1;
        } else if (code >= 0xDC00 && code <= 0xDFFF) {
            return true;
        }
    }
    return false;
}

test('extra_plot_prompts defaults all supported prompt categories to enabled when omitted', () => {
    const { resolveExtraPlotPromptSettings } = loadExtraPlotPromptHelpers();

    assert.deepEqual(
        JSON.parse(JSON.stringify(resolveExtraPlotPromptSettings())),
        {
            plot_summary: true,
            plot_expander: true,
            supplemental_story_info: true,
            'offscreen-npc-activity-daily': true,
            'offscreen-npc-activity-weekly': true
        }
    );
});

test('offscreen NPC last mention preview does not split surrogate pairs', () => {
    const content = `${'wolf '}${'a'.repeat(214)}🧸 trailing text`;
    const collectNpcLastMention = loadCollectNpcLastMention({
        chatHistory: [
            {
                content,
                timestamp: '2026-06-08T00:00:00.000Z'
            }
        ]
    });

    const mention = collectNpcLastMention('wolf');

    assert.ok(mention);
    assert.equal(hasUnpairedSurrogate(mention.preview), false);
    assert.match(mention.preview, /🧸\.\.\.$/);
    assert.doesNotThrow(() => {
        new DOMParser({
            onError(level, message) {
                if (level === 'fatalError') {
                    throw new Error(message);
                }
            }
        }).parseFromString(`<root><![CDATA[${mention.preview}]]></root>`, 'text/xml');
    });
});

test('extra_plot_prompts rejects non-boolean values', () => {
    const { resolveExtraPlotPromptSettings } = loadExtraPlotPromptHelpers({
        config: {
            extra_plot_prompts: {
                plot_summary: 'false'
            }
        }
    });

    assert.throws(
        () => resolveExtraPlotPromptSettings(),
        /extra_plot_prompts\.plot_summary must be a boolean/
    );
});

test('disabled supplemental story info prompt does not run or advance its turn counter', () => {
    const { shouldRunSupplementalStoryInfoThisTurn, context } = loadExtraPlotPromptHelpers({
        config: {
            extra_plot_prompts: {
                supplemental_story_info: false
            }
        },
        supplementalStoryInfoTurnCounter: 4
    });

    assert.equal(shouldRunSupplementalStoryInfoThisTurn({ generatedNpcOrThing: true }), false);
    assert.equal(context.supplementalStoryInfoTurnCounter, 4);
});

test('disabled plot summary prompt preserves deferred next-turn state and counter', () => {
    const { shouldRunPlotSummaryThisTurn, context } = loadExtraPlotPromptHelpers({
        config: {
            extra_plot_prompts: {
                plot_summary: false
            }
        },
        plotSummaryTurnCounter: 9,
        plotSummaryRunOnNextEligibleTurn: true
    });

    assert.equal(shouldRunPlotSummaryThisTurn(), false);
    assert.equal(context.plotSummaryTurnCounter, 9);
    assert.equal(context.plotSummaryRunOnNextEligibleTurn, true);
});

test('disabled plot expander prompt does not advance its counter', () => {
    const { shouldRunPlotExpanderThisTurn, context } = loadExtraPlotPromptHelpers({
        config: {
            extra_plot_prompts: {
                plot_expander: false
            }
        },
        plotExpanderTurnCounter: 9
    });

    assert.equal(shouldRunPlotExpanderThisTurn(), false);
    assert.equal(context.plotExpanderTurnCounter, 9);
});

test('disabled offscreen daily and weekly prompts pause counters and suppress due run plans', () => {
    const { incrementOffscreenNpcActivityTurnCounters, resolveOffscreenNpcActivityRunPlan, context } = loadExtraPlotPromptHelpers({
        config: {
            extra_plot_prompts: {
                'offscreen-npc-activity-daily': false,
                'offscreen-npc-activity-weekly': false
            },
            offscreen_npc_activity_prompt_count: 5,
            offscreen_npc_activity_daily_max_turns_between_prompts: 20,
            offscreen_npc_activity_weekly_max_turns_between_prompts: 100
        },
        offscreenNpcActivityState: {
            dailyMentionedNpcNamesByWeek: {},
            turnsSinceDailyPrompt: 99,
            turnsSinceWeeklyPrompt: 99,
            lastDailyPromptWorldTime: null,
            lastWeeklyPromptWorldTime: null
        }
    });

    incrementOffscreenNpcActivityTurnCounters();
    assert.equal(context.offscreenNpcActivityState.turnsSinceDailyPrompt, 99);
    assert.equal(context.offscreenNpcActivityState.turnsSinceWeeklyPrompt, 99);

    const runPlan = resolveOffscreenNpcActivityRunPlan({
        startWorldTime: { dayIndex: 7, timeMinutes: (7 * 60) - 1 },
        endWorldTime: { dayIndex: 7, timeMinutes: (7 * 60) + 1 }
    });

    assert.equal(runPlan, null);
});

test('offscreen weekly prompt can still run when only the daily cadence is disabled', () => {
    const { incrementOffscreenNpcActivityTurnCounters, resolveOffscreenNpcActivityRunPlan, context } = loadExtraPlotPromptHelpers({
        config: {
            extra_plot_prompts: {
                'offscreen-npc-activity-daily': false,
                'offscreen-npc-activity-weekly': true
            },
            offscreen_npc_activity_prompt_count: 5
        }
    });

    incrementOffscreenNpcActivityTurnCounters();
    assert.equal(context.offscreenNpcActivityState.turnsSinceDailyPrompt, 0);
    assert.equal(context.offscreenNpcActivityState.turnsSinceWeeklyPrompt, 1);

    const runPlan = resolveOffscreenNpcActivityRunPlan({
        startWorldTime: { dayIndex: 7, timeMinutes: (7 * 60) - 1 },
        endWorldTime: { dayIndex: 7, timeMinutes: (7 * 60) + 1 }
    });

    assert.deepEqual(JSON.parse(JSON.stringify(runPlan)), {
        point: {
            mode: 'weekly',
            dayIndex: 7,
            minute: 7 * 60,
            absoluteMinutes: (7 * 24 * 60) + (7 * 60),
            weekIndex: 1
        },
        skippedDueToSingleRunLimit: 0
    });
});
