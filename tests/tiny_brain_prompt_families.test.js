const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const nunjucks = require('nunjucks');
const { addXmlTextFilter } = require('../nunjucks_filters.js');

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
    addXmlTextFilter(env);
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
        abilityAttachmentRequests: [{ index: 0, name: 'Fixture ability', facts: 'Fixture mechanics.' }],
        abilityAttachmentHasCatalogue: false,
        abilityAttachmentAuthoringContext: () => 'Author this ability.',
        statusRepairActors: [],
        statusRepairCandidates: [{ actorName: 'Tester', ownerKind: 'intrinsic', effectXml: '<effect/>' }],
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
            event: 'Mira rings the workshop bell exactly once.',
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

test('tiny-brain family routing honors the effective per-prompt AI override', () => {
    const config = {
        ai: {
            tinybrain: true,
            tinybrain_prompts: {
                player_action: true,
                event_checks: true
            }
        },
        ai_model_overrides: {
            prose: {
                prompts: ['player_action'],
                tinybrain: false,
                backend: 'kimi_cli_bridge'
            }
        }
    };

    assert.equal(isTinyBrainPromptEnabled(config, 'player_action'), false);
    assert.equal(isTinyBrainPromptEnabled(config, 'event_checks'), true);
});

test('location Things TinyBrain routing defaults on and follows its effective prompt override', () => {
    assert.equal(isTinyBrainPromptEnabled({ ai: { tinybrain: true } }, 'location_things_generation'), true);
    assert.equal(isTinyBrainPromptEnabled({
        ai: { tinybrain: true, tinybrain_prompts: { location_things_generation: false } }
    }, 'location_things_generation'), false);

    const config = {
        ai: { tinybrain: true },
        ai_model_overrides: {
            local_generation: {
                prompts: ['location_things_generation'],
                tinybrain: false,
                backend: 'openai_compatible'
            }
        }
    };
    assert.equal(isTinyBrainPromptEnabled(config, 'location_things_generation'), false);
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

test('location Things TinyBrain template keeps the compact roster checkpoint before exact-roster expansion', () => {
    const templatePath = path.join(__dirname, '..', 'prompts', '_includes', 'location-generator-things.tinybrain.njk');
    const template = fs.readFileSync(templatePath, 'utf8');
    const sharedTemplate = fs.readFileSync(
        path.join(__dirname, '..', 'prompts', '_includes', 'location-generator-things.njk'),
        'utf8'
    );
    const rosterMarker = template.indexOf("{% llmparse('location_things_plan') as locationThingsPlan %}");
    const expansionMarker = template.indexOf('{% set locationThingsExpansion = true %}');
    assert.ok(rosterMarker > 0, 'the compact roster must be a parsed checkpoint');
    assert.ok(expansionMarker > rosterMarker, 'full Thing generation must follow the approved roster');
    assert.match(template, /approvedThingsPlan/);
    assert.match(template, /Do not add, omit, duplicate, combine, or rename entries/);
    assert.match(sharedTemplate, /Return exactly one complete <things>\.\.\.<\/things> block/);
    assert.match(sharedTemplate, /Preserve the approved names, itemOrScenery values, and rarities exactly/);
});

test('scheduled interruption chronology has one authoritative prompt-local contract', () => {
    const env = createPromptEnv();
    const context = buildContext();
    configureTinyBrainPromptContext(context, 'scheduled_event_interruption_rewrite');
    const rendered = env.render('_includes/scheduled-event-interruption-rewrite.njk', context);

    assert.equal((rendered.match(/Temporal contract:/g) || []).length, 1);
    assert.match(rendered, /unless the event supplies a specific reason it cannot or would not continue/);
    assert.doesNotMatch(rendered, /do not end the revised prose while the action is still ongoing/);
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
    const toolSource = fs.readFileSync(path.join(__dirname, '..', 'chat_tool_calls.js'), 'utf8');
    assert.match(toolSource, /const TINY_BRAIN_LOOKUP_TOOL_NAMES = new Set/);
    assert.match(apiSource, /TINY_BRAIN_LOOKUP_TOOL_NAMES/);
    assert.match(apiSource, /return TINY_BRAIN_LOOKUP_TOOL_NAMES\.has\(toolName\)/);
    assert.match(apiSource, /const isLookupCheckpoint = !stage\.isFinal\s*&& stage\.checkpoint\?\.index === 1/);
    assert.match(apiSource, /isLookupCheckpoint \? tinyBrainNpcLookupTools : \[\]/);
    assert.match(apiSource, /runTinyBrainNarrativePrompt\(\{\s*family: 'npc_action',\s*toolDefinitions: tinyBrainNpcLookupTools/);
    assert.match(apiSource, /runnerOptions:\s*\{[\s\S]*?metadataLabel,\s*toolDefinitions,/);
});

test('TinyBrain narrative families omit unavailable tool schemas and retain only explicit read-only lookup schemas', () => {
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
    const toolSource = fs.readFileSync(path.join(__dirname, '..', 'chat_tool_calls.js'), 'utf8');
    const eventsSource = fs.readFileSync(path.join(__dirname, '..', 'Events.js'), 'utf8');
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const helperStart = apiSource.indexOf('const runTinyBrainNarrativePrompt = async ({');
    const helperEnd = apiSource.indexOf('\n        const ', helperStart + 1);
    assert.notEqual(helperStart, -1, 'Expected shared TinyBrain narrative runner helper.');
    assert.ok(helperEnd > helperStart, 'Expected end of shared TinyBrain narrative runner helper.');

    const helperSource = apiSource.slice(helperStart, helperEnd);
    assert.match(helperSource, /toolDefinitions = \[\]/,
        'narrative families with no callable native tools must default to an empty schema');
    assert.match(helperSource, /runnerOptions:\s*\{[\s\S]*?toolDefinitions,/,
        'the selected family schema must reach TinyBrainPromptRunner and its wire payload');

    assert.match(apiSource, /toolDefinitions: scheduledEventTools\.filter\(definition => \([\s\S]*?isNonMutatingScheduledEventToolName/,
        'scheduled resolution exposes only its explicitly read-only lookup subset');
    assert.match(apiSource, /metadataLabel: promptMetadataLabel,[\s\S]*?toolDefinitions: promptChatTools,/,
        'player-action and creative-mode prompts retain schemas for tools they can actually call');
    assert.match(toolSource, /const TINY_BRAIN_LOOKUP_TOOL_NAMES = new Set\(/,
        'NPC lookup schema must remain an explicit allowlist');
    assert.match(apiSource, /isLookupCheckpoint \? tinyBrainNpcLookupTools : \[\]/,
        'NPC native tools must be removed at other checkpoints');

    assert.ok((eventsSource.match(/toolDefinitions: \[\]/g) || []).length >= 3,
        'direct Events TinyBrain runners must use empty native tool schemas');
    assert.match(eventsSource, /withTinyBrainToolSchema\(\{[\s\S]*?queueReservation, toolDefinitions: \[\]/,
        'combined need-bar checkpoints retain their empty native tool schema');
    assert.match(serverSource, /metadataLabel: 'scene_summarize',[\s\S]*?toolDefinitions: \[\]/,
        'scene summary must use an empty native tool schema');
});

test('tiny-brain player-action destination context checkpoint exposes no tools', () => {
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
    assert.doesNotMatch(apiSource, /TINY_BRAIN_PLAYER_ACTION_DESTINATION_LOOKUP_TOOL_NAMES/);
    assert.match(
        apiSource,
        /checkpoint\?\.parserName === 'player_action_destination_name_or_na'/
    );
    assert.match(
        apiSource,
        /isDestinationContextCheckpoint\s*\? \[\]\s*:\s*\(isHiddenContestCheckpoint\s*\? tinyBrainPlayerActionHiddenContestTools\s*:\s*promptChatTools\)/
    );
    assert.match(
        apiSource,
        /const tinyBrainPlayerActionHiddenContestTools = promptChatTools\.filter\([\s\S]*?return TINY_BRAIN_LOOKUP_TOOL_NAMES\.has\(toolName\)/
    );
    assert.match(
        apiSource,
        /configureTinyBrainToolPolicy\(\s*stageRequestOptions,\s*stageToolDefinitions\s*\)/
    );
    assert.match(
        apiSource,
        /configured\.allowToolCalls = allowedToolDefinitions\.length > 0/,
        'the direct destination checkpoint has an empty stage schema and must forbid tool calls even though its run schema is fixed'
    );
    assert.match(
        apiSource,
        /delete additionalPayload\.tool_choice/,
        'checkpoint restrictions must not change the run-wide wire tool choice'
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
