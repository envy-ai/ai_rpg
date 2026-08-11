const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const nunjucks = require('nunjucks');

const {
    TinyBrainPromptExtension,
    createTinyBrainRenderState
} = require('../TinyBrainPromptRunner.js');
const {
    TINY_BRAIN_PROMPT_FAMILIES,
    TINY_BRAIN_PROMPT_METADATA_LABELS,
    configureTinyBrainPromptContext,
    getTinyBrainPromptConfigurationErrors,
    isTinyBrainPromptEnabled
} = require('../TinyBrainPromptFamilies.js');
const { buildBaseRenderContext } = require('./helpers/baseContextFixtures.js');

function createPromptEnv() {
    const env = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }),
        { autoescape: false }
    );
    env.addGlobal('randomword', () => 'test');
    env.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    return env;
}

function buildContext() {
    const baseContext = buildBaseRenderContext({});
    return {
        ...baseContext,
        config: {
            ...(baseContext.config || {}),
            prose_instructions: 'Write concretely.',
            prose_length: 'three paragraphs',
            prose_prompt_suffix: '',
            repetition_buster: true
        },
        setting: {
            ...(baseContext.setting || {}),
            writingStyleNotes: 'Keep it concrete.'
        },
        questRewards: ['50 credits', 'Brass key'],
        eventText: 'A brass bell falls from the tower.',
        actionText: 'The old gate swings open.',
        characterName: 'Tester',
        character: { name: 'Tester' },
        npcs: [],
        party: [],
        isAttack: false,
        success_or_failure: 'Success',
        mode: 'craft',
        targetName: 'Brass key',
        intendedItemName: 'Brass key',
        producedItem: { name: 'Brass key' },
        recoveredItems: [],
        consumedItems: [{ name: 'Brass blank' }],
        otherEffect: null,
        authoritativeTimePassedMinutes: 12,
        modifiedLocation: { name: 'Workshop' },
        modificationNotes: 'Repair the latch.',
        alteration: 'The latch is repaired.',
        receivedItems: [],
        container: {
            id: 'box-1',
            name: 'Iron Box',
            description: 'A locked iron box.'
        },
        containerOpenAction: 'Pick the lock.',
        whileYouWereAwayNpcs: [{
            name: 'Mira',
            lastSeenTimeAgo: 'two hours ago',
            lastSeenLocationName: 'Workshop'
        }],
        scheduledEvent: {
            id: 'event-1',
            event: 'The bell rings.',
            locationName: 'Workshop'
        },
        scheduledEventPlayerPresent: true,
        scheduledEventCurrentWorldTime: {
            dateLabel: 'Day 2',
            timeLabel: '12:00'
        },
        originalXml: '<turnResult><prose>Work continues.</prose><hidden>note</hidden></turnResult>',
        interruptionDuration: '5 minutes',
        interruptionMinutes: 5,
        scheduledEvents: [{
            id: 'event-1',
            summary: 'The bell rang.',
            proseForPlayer: 'A bell rings.'
        }],
        currentLocationLastSeenNpcs: []
    };
}

test('tiny-brain family config validates names and booleans with enabled-by-default families', () => {
    assert.deepEqual(
        Object.keys(TINY_BRAIN_PROMPT_METADATA_LABELS),
        Object.keys(TINY_BRAIN_PROMPT_FAMILIES)
    );
    assert.deepEqual(getTinyBrainPromptConfigurationErrors({ tinybrain: true }), []);
    assert.equal(isTinyBrainPromptEnabled({ tinybrain: true }, 'game_intro'), true);
    assert.equal(isTinyBrainPromptEnabled({
        tinybrain: true,
        tinybrain_prompts: { game_intro: false }
    }, 'game_intro'), false);
    assert.deepEqual(getTinyBrainPromptConfigurationErrors({
        tinybrain_prompts: { game_intro: 'yes', unknown: true }
    }), [
        'ai.tinybrain_prompts.game_intro must be a boolean',
        'ai.tinybrain_prompts contains unknown prompt family "unknown"'
    ]);
});

test('all newly added tiny-brain prose programs render and register staged checkpoints', () => {
    const env = createPromptEnv();
    const context = buildContext();
    const newFamilies = Object.entries(TINY_BRAIN_PROMPT_FAMILIES)
        .filter(([family]) => family !== 'player_action' && family !== 'event_checks');

    for (const [family, templateName] of newFamilies) {
        const renderState = createTinyBrainRenderState();
        const rendered = env.render(templateName, {
            ...context,
            __tinyBrainState: renderState
        });
        assert.ok(rendered.trim(), `${family} rendered empty output`);
        assert.ok(renderState.checkpoints.length >= 1, `${family} did not stage its work`);
    }
});

test('base context routes only through the allowlisted configured tiny-brain template', () => {
    const env = createPromptEnv();
    const context = {
        ...buildContext(),
        promptType: 'game-intro'
    };
    const tinyBrain = configureTinyBrainPromptContext(context, 'game_intro');
    const rendered = env.render('base-context.xml.njk', context);

    assert.ok(rendered.includes(tinyBrain.renderState.programStartMarker));
    assert.match(rendered, /Write the opening narration shown before the first player turn/);
    assert.doesNotMatch(rendered, /Use this exact schema:/);
});

test('tiny-brain NPC stages expose lookup-only tools at the information checkpoint', () => {
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
    assert.match(apiSource, /const TINY_BRAIN_NPC_LOOKUP_TOOL_NAMES = new Set/);
    assert.match(apiSource, /const isLookupCheckpoint = !stage\.isFinal\s*&& stage\.checkpoint\?\.index === 1/);
    assert.match(apiSource, /isLookupCheckpoint \? tinyBrainNpcLookupTools : \[\]/);
});

test('tiny-brain player-action destination lookup exposes only moreInfo', () => {
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
    assert.match(
        apiSource,
        /const TINY_BRAIN_PLAYER_ACTION_DESTINATION_LOOKUP_TOOL_NAMES = new Set\(\[\s*'moreInfo'\s*\]\)/
    );
    assert.match(
        apiSource,
        /checkpoint\?\.parserName === 'player_action_more_info_or_na'/
    );
    assert.match(
        apiSource,
        /isDestinationLookupCheckpoint\s*\? tinyBrainPlayerActionDestinationLookupTools\s*:\s*enabledChatTools/
    );
    assert.match(
        apiSource,
        /configureRequestChatTools\(\s*stageRequestOptions,\s*stageToolDefinitions\s*\)/
    );
});

test('random and creative narrative-scope travel decisions render the full movement schema', () => {
    const env = createPromptEnv();
    for (const family of ['random_event', 'creative_mode_action']) {
        const renderState = createTinyBrainRenderState();
        renderState.completedCheckpoints[0] = {
            value: {
                travel: true,
                before: 'Origin beat',
                during: 'Journey beat',
                after: 'Destination beat'
            }
        };
        const rendered = env.render(TINY_BRAIN_PROMPT_FAMILIES[family], {
            ...buildContext(),
            __tinyBrainState: renderState
        });
        assert.match(rendered, /<moveTurnResult>/, `${family} omitted the movement schema`);
        assert.match(rendered, /<playerDestination>/, `${family} omitted the movement destination contract`);
    }
});
