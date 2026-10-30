const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const { addEvalFilter } = require('../nunjucks_filters.js');
const {
    TinyBrainPromptExtension,
    createTinyBrainRenderState
} = require('../TinyBrainPromptRunner.js');
const {
    createTempDefsDir,
    withMergedTestConfig
} = require('./helpers/needBarFixtures.js');

function createPromptEnv() {
    const env = nunjucks.configure(path.join(process.cwd(), 'prompts'), {
        autoescape: false,
        throwOnUndefined: true
    });
    addEvalFilter(env);
    env.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    return env;
}

function createTempNeedBarDefs() {
    return createTempDefsDir({
        prefix: 'ai-rpg-while-away-needs-',
        attributes: [
            { id: 'constitution', label: 'Constitution', default: 5 }
        ],
        needBarsYaml: `
need_bars:
  social:
    name: Social
    description: Social connection
    player: true
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 50
    while_you_were_away_prompt_notes: Characters with friendly company nearby should usually recover this need.
`
    });
}

test('while-you-were-away include renders current-location reunion candidates', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('_includes/while-you-were-away.njk', {
        whileYouWereAwayNpcs: [
            {
                name: 'Bob',
                lastSeenTimeAgo: '2 hours ago',
                lastSeenLocationName: 'Town Square',
                last_seen_location: 'town-square'
            }
        ]
    });

    assert.match(rendered, /Bob \(last seen 2 hours ago at Town Square\)/);
    assert.match(rendered, /<name>Bob<\/name>/);
    assert.match(rendered, /Only use the optional arrival section for a character who is physically in the exact current location right now but was not listed above\./);
    assert.match(rendered, /<travelDestination>HERE<\/travelDestination>/);
    assert.match(rendered, /<proseForPlayer>/);
});

test('while-you-were-away include renders need bar prompt notes from definitions', () => {
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const tempBaseDir = createTempNeedBarDefs();

    Player.clearRuntimeRegistries();
    Globals.baseDir = tempBaseDir;
    Globals.config = withMergedTestConfig(previousConfig);
    Player.reloadDefinitionCaches({ refreshInstances: false });

    try {
        const needBarDefinitions = Player.getNeedBarDefinitionsForContext();
        assert.equal(
            needBarDefinitions[0].while_you_were_away_prompt_notes,
            'Characters with friendly company nearby should usually recover this need.'
        );

        const promptEnv = createPromptEnv();
        const rendered = promptEnv.render('_includes/while-you-were-away.njk', {
            needBarDefinitions,
            whileYouWereAwayNpcs: [
                {
                    name: 'Mira',
                    lastSeenTimeAgo: '5 hours ago',
                    lastSeenLocationName: 'Common Room',
                    last_seen_location: 'common-room'
                }
            ]
        });

        assert.match(
            rendered,
            /- social: Characters with friendly company nearby should usually recover this need\./
        );
        assert.match(rendered, /or N\/A if this character does not have that need bar/);
    } finally {
        Player.clearRuntimeRegistries();
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
});

test('while-you-were-away include allows return prose to be omitted when no NPCs are supplied', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('_includes/while-you-were-away.njk', {
        whileYouWereAwayNpcs: []
    });

    assert.match(rendered, /No current-location NPCs require individual while-you-were-away character updates\./);
    assert.match(rendered, /Otherwise omit proseForPlayer or leave it empty\./);
    assert.doesNotMatch(rendered, /Always write proseForPlayer/);
    assert.match(rendered, /<characterUpdates>/);
    assert.doesNotMatch(rendered, /<name>[^<]+<\/name>/);
});

test('while-you-were-away include requires return prose when no other arrival narration exists', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('_includes/while-you-were-away.njk', {
        whileYouWereAwayNpcs: [],
        whileAwayVisibleProseRequired: true
    });

    assert.match(rendered, /This arrival has no other narration./);
    assert.match(rendered, /MUST include non-empty proseForPlayer/);
    assert.match(rendered, /proseForPlayer is mandatory/);
    assert.doesNotMatch(rendered, /proseForPlayer is optional/);
});

test('while-you-were-away guidance distinguishes new information from paraphrased repetition in both prompt modes', () => {
    const promptEnv = createPromptEnv();
    const normal = promptEnv.render('_includes/while-you-were-away.njk', {
        whileYouWereAwayNpcs: [],
        whileAwayVisibleProseRequired: false
    });
    const tinyBrain = promptEnv.render('_includes/while-you-were-away.tinybrain.njk', {
        whileYouWereAwayNpcs: [],
        whileAwayVisibleProseRequired: false,
        __tinyBrainState: createTinyBrainRenderState()
    });

    for (const rendered of [normal, tinyBrain]) {
        assert.match(rendered, /immediately preceding player-facing player-action response in THIS turn/);
        assert.match(rendered, /Do not rehash that response/);
        assert.match(rendered, /Rewording the same information still repeats it/);
        assert.match(rendered, /do not invent filler or a new event merely to avoid duplication/);
        assert.match(rendered, /Continue all required hidden character updates, need-bar changes, exact-location arrival updates, and item\/scenery moves even when player-facing prose is omitted/);
    }
    assert.match(normal, /proseForPlayer only when there is useful player-facing return narration that has not already been covered/);
    assert.match(tinyBrain, /return exactly N\/A/);
});

test('while-you-were-away bare-arrival guidance requires new non-empty prose in both prompt modes', () => {
    const promptEnv = createPromptEnv();
    const normal = promptEnv.render('_includes/while-you-were-away.njk', {
        whileYouWereAwayNpcs: [],
        whileAwayVisibleProseRequired: true
    });
    const tinyBrain = promptEnv.render('_includes/while-you-were-away.tinybrain.njk', {
        whileYouWereAwayNpcs: [],
        whileAwayVisibleProseRequired: true,
        __tinyBrainState: createTinyBrainRenderState()
    });

    for (const rendered of [normal, tinyBrain]) {
        assert.match(rendered, /bare arrival has no other narration/);
        assert.match(rendered, /required non-empty arrival prose/);
        assert.doesNotMatch(rendered, /If there is nothing new to show or learn, provide no optional player-facing prose/);
    }
    assert.match(normal, /MUST include non-empty proseForPlayer/);
});

test('while-you-were-away tiny-brain uses strict structured parsers and allows optional moves to be empty', () => {
    const promptEnv = createPromptEnv();
    const state = createTinyBrainRenderState();
    promptEnv.render('_includes/while-you-were-away.tinybrain.njk', {
        whileYouWereAwayNpcs: [],
        __tinyBrainState: state
    });

    assert.equal(state.checkpoints[0].parserName, 'while_away_arrival_updates');
    assert.deepEqual(state.checkpoints[0].parserArgs, []);
    assert.equal(state.checkpoints[1].parserName, 'exact_xml_root');
    assert.deepEqual(state.checkpoints[1].parserArgs, [
        'itemSceneryMoves',
        { allowEmptyRoot: true }
    ]);
    assert.equal(state.checkpoints[2].kind, 'dummy');
    assert.equal(state.checkpoints[3].parserName, 'player_action_optional_prose');
});

test('while-you-were-away tiny-brain requires prose when no other arrival narration exists', () => {
    const promptEnv = createPromptEnv();
    const state = createTinyBrainRenderState();
    const rendered = promptEnv.render('_includes/while-you-were-away.tinybrain.njk', {
        whileYouWereAwayNpcs: [],
        whileAwayVisibleProseRequired: true,
        __tinyBrainState: state
    });

    assert.equal(state.checkpoints[3].parserName, 'player_action_required_prose');
    assert.match(rendered, /This arrival has no other narration./);
    assert.doesNotMatch(rendered, /return exactly N\/A/);
});

test('while-you-were-away audit revisions use optional prose only for optional arrival narration', () => {
    const promptEnv = createPromptEnv();
    const completed = {
        0: { value: '<characterUpdates></characterUpdates>' },
        1: { value: '<itemSceneryMoves></itemSceneryMoves>' },
        2: { value: '' },
        3: { value: 'The preceding reply already described the room.' },
        4: { value: { revise: true, issues: 'This repeats the previous response.' } }
    };

    const optionalState = createTinyBrainRenderState();
    optionalState.completedCheckpoints = structuredClone(completed);
    promptEnv.render('_includes/while-you-were-away.tinybrain.njk', {
        whileYouWereAwayNpcs: [],
        whileAwayVisibleProseRequired: false,
        __tinyBrainState: optionalState
    });
    assert.equal(optionalState.checkpoints[5].parserName, 'player_action_optional_prose');

    const requiredState = createTinyBrainRenderState();
    requiredState.completedCheckpoints = structuredClone(completed);
    promptEnv.render('_includes/while-you-were-away.tinybrain.njk', {
        whileYouWereAwayNpcs: [],
        whileAwayVisibleProseRequired: true,
        __tinyBrainState: requiredState
    });
    assert.equal(requiredState.checkpoints[5].parserName, 'player_action_required_prose');
});

test('TinyBrain audits keep required revision prose as the default for other prompt families', () => {
    const promptEnv = createPromptEnv();
    const state = createTinyBrainRenderState();
    state.completedCheckpoints[0] = {
        value: { revise: true, issues: 'Required prose must retain its key detail.' }
    };

    promptEnv.render('_includes/tinybrain-prose-audit.njk', {
        tinyBrainAuditFocus: 'Preserve the requested facts.',
        __tinyBrainState: state
    });

    assert.equal(state.checkpoints[1].parserName, 'player_action_required_prose');
});

test('while-you-were-away tiny-brain requires the canonical character update schema', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('_includes/while-you-were-away.tinybrain.njk', {
        whileYouWereAwayNpcs: [{
            name: 'Mira',
            lastSeenTimeAgo: '2 hours ago',
            lastSeenLocationName: 'Town Square'
        }],
        __tinyBrainState: createTinyBrainRenderState()
    });

    assert.match(rendered, /<needBarChanges>/);
    assert.match(rendered, /<travelDestination><location>exact location if they left<\/location>/);
    assert.match(rendered, /<update>Concise hidden summary/);
    assert.match(rendered, /do not nest a second <characterUpdates> wrapper/i);
});
