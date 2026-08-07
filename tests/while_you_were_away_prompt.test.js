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

test('while-you-were-away include still requests return prose when no NPCs are supplied', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('_includes/while-you-were-away.njk', {
        whileYouWereAwayNpcs: []
    });

    assert.match(rendered, /No current-location NPCs require individual while-you-were-away character updates\./);
    assert.match(rendered, /Always write proseForPlayer/);
    assert.match(rendered, /<characterUpdates>/);
    assert.doesNotMatch(rendered, /<name>[^<]+<\/name>/);
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
    assert.match(rendered, /do not nest a second <characterUpdates> wrapper/);
});
