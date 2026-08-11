const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

const { TinyBrainPromptExtension, TinyBrainPromptRunner } = require('../TinyBrainPromptRunner.js');
const {
    formatPlayerActionDestinationAbsence,
    resolvePlayerActionDestinationContext
} = require('../PlayerActionDestinationContext.js');

function addPlayerActionDestinationGlobals(promptEnv) {
    promptEnv.addGlobal(
        'resolvePlayerActionDestinationContext',
        (destination, originLocationId = null, currentWorldMinutes = 0) => (
            resolvePlayerActionDestinationContext(destination, {
                originLocationId,
                currentWorldMinutes
            })
        )
    );
    promptEnv.addGlobal('formatPlayerActionDestinationAbsence', formatPlayerActionDestinationAbsence);
}

test('chat API passes committed travel movement type with the authoritative destination', () => {
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
    assert.match(
        apiSource,
        /const playerActionTravelMovementKind = playerActionTravelDestination[\s\S]*?PLAYER_ACTION_MOVEMENT\.DISEMBARK[\s\S]*?PLAYER_ACTION_MOVEMENT\.DESTINATION/
    );
    assert.match(
        apiSource,
        /playerActionTravelDestination,\s*playerActionTravelMovementKind,\s*playerActionAccompanyingCharacters/
    );
    assert.match(
        apiSource,
        /const authoritativeMovementType = useTinyBrainPlayerAction[\s\S]*promptVariablesSnapshot\?\.playerActionTravelMovementKind[\s\S]*responseData\.authoritativeMovementType = authoritativeMovementType/
    );
    assert.match(
        apiSource,
        /locationId:\s*destinationLocation\.id\s*\|\|\s*null[\s\S]*regionId:\s*destinationRegion\?\.id\s*\|\|\s*null/
    );
    assert.match(
        apiSource,
        /playerActionOriginLocationId:[\s\S]*playerActionWorldTimeMinutes:\s*Globals\.getTotalWorldMinutes\(\)/
    );
    assert.match(
        apiSource,
        /const authoritativeMovementCompanionNames = Array\.isArray\([\s\S]*moveTurnResultPayload\.accompanyingCharacters[\s\S]*Events\.runEventChecks\([\s\S]*authoritativeMovementCompanionNames/,
        'sectioned event checks must receive authoritative player-movement companions'
    );
});

test('chat API suppresses visible WYWA prose only for TinyBrain destination prose with TinyBrain WYWA', () => {
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
    assert.match(
        apiSource,
        /const suppressTinyBrainWhileAwayVisibleProse = Boolean\([\s\S]*useTinyBrainPlayerAction[\s\S]*promptType === 'player-action'[\s\S]*moveTurnResultPayload\?\.destinationProse[\s\S]*isTinyBrainPromptEnabled\(Globals\.config\?\.ai, 'while_you_were_away'\)/
    );
    assert.match(
        apiSource,
        /suppressVisibleProse:\s*suppressTinyBrainWhileAwayVisibleProse[\s\S]*replacementArrivalEntry:\s*suppressTinyBrainWhileAwayVisibleProse[\s\S]*\?\s*aiResponseEntry/
    );
});

test('tiny-brain exterior branch renders the resolved travel target name and description', () => {
    const promptEnv = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }),
        { autoescape: false }
    );
    promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    addPlayerActionDestinationGlobals(promptEnv);
    promptEnv.addGlobal('getLocationInfo', (name, id) => {
        assert.equal(name, 'Community Kitchen Exterior');
        assert.equal(id, 'loc_community_kitchen_exterior');
        return {
            name,
            description: 'A broad covered terrace outside the community kitchen.'
        };
    });

    const rendered = promptEnv.render('_includes/player-action.tinybrain.njk', {
        __tinyBrainState: TinyBrainPromptRunner.createRenderState(),
        actionText: 'Walk to the Community Kitchen Exterior.',
        characterName: 'The player',
        config: {
            prose_instructions: 'Write clear prose.',
            prose_length: 'three paragraphs',
            prose_prompt_suffix: '',
            repetition_buster: true,
            use_legacy_prompt_checks: false
        },
        currentLocationLastSeenNpcs: [],
        currentVehicle: {
            destination: '',
            name: '',
            timeToDestination: '',
            vehicleInfo: {
                hasArrived: false,
                isUnderway: false
            }
        },
        isAttack: false,
        isExterior: true,
        modPlayerActionPromptSteps: [],
        npcs: [],
        party: [],
        playerActionAccompanyingCharacters: [],
        setting: {
            writingStyleNotes: 'Keep it concrete.'
        },
        travelTargetLocationId: 'loc_community_kitchen_exterior',
        travelTargetLocationName: 'Community Kitchen Exterior'
    });

    assert.match(rendered, /Destination name: Community Kitchen Exterior/);
    assert.match(
        rendered,
        /Destination description: A broad covered terrace outside the community kitchen\./
    );
});

test('player-action actor roster excludes mechanically dead NPCs and party members', () => {
    const promptEnv = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }),
        { autoescape: false }
    );
    promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    addPlayerActionDestinationGlobals(promptEnv);

    const rendered = promptEnv.render('_includes/player-action.tinybrain.njk', {
        __tinyBrainState: TinyBrainPromptRunner.createRenderState(),
        actionText: 'Wait and observe.',
        characterName: 'The player',
        config: {
            prose_instructions: 'Write clear prose.',
            prose_length: 'three paragraphs',
            prose_prompt_suffix: '',
            repetition_buster: true,
            use_legacy_prompt_checks: false
        },
        currentLocationLastSeenNpcs: [],
        currentVehicle: null,
        isAttack: false,
        isExterior: false,
        modPlayerActionPromptSteps: [],
        npcs: [
            { name: 'Living Local', race: 'Human', class: 'Scout', isDead: false, aiNotes: 'Keep watch.' },
            { name: 'Dead Local', race: 'Human', class: 'Scout', isDead: true, aiNotes: 'Cannot act.' }
        ],
        party: [
            { name: 'Living Ally', race: 'Human', class: 'Guard', isDead: false, aiNotes: 'Stay close.' },
            { name: 'Dead Ally', race: 'Human', class: 'Guard', isDead: true, aiNotes: 'Cannot act.' }
        ],
        playerActionAccompanyingCharacters: [],
        setting: { writingStyleNotes: 'Keep it concrete.' }
    });

    const roster = rendered.match(/These characters are present and aware[\s\S]*?Pick ONE/)?.[0] || '';
    assert.match(roster, /Living Local/);
    assert.match(roster, /Living Ally/);
    assert.doesNotMatch(roster, /Dead Local/);
    assert.doesNotMatch(roster, /Dead Ally/);

    const aiNotes = rendered.match(/Character AI notes[\s\S]*?Write clear prose\./)?.[0] || '';
    assert.match(aiNotes, /Living Local: Keep watch\./);
    assert.match(aiNotes, /Living Ally: Stay close\./);
    assert.doesNotMatch(aiNotes, /Dead Local/);
    assert.doesNotMatch(aiNotes, /Dead Ally/);
});

test('tiny-brain player-action stages and allowlists checked-action actor identity', () => {
    const promptEnv = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }),
        { autoescape: false }
    );
    promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    addPlayerActionDestinationGlobals(promptEnv);
    const renderState = TinyBrainPromptRunner.createRenderState();

    const rendered = promptEnv.render('_includes/player-action.tinybrain.njk', {
        __tinyBrainState: renderState,
        actionText: 'Signal Decoy and observe her hiding attempt.',
        characterName: 'The player',
        config: {
            prose_instructions: 'Write clear prose.',
            prose_length: 'three paragraphs',
            prose_prompt_suffix: '',
            repetition_buster: true,
            use_legacy_prompt_checks: false
        },
        currentLocationLastSeenNpcs: [],
        currentVehicle: null,
        isAttack: false,
        isExterior: false,
        modPlayerActionPromptSteps: [],
        npcs: [{ name: 'QA Loud Decoy', race: 'Harpy', class: 'Guard', isDead: false }],
        party: [],
        playerActionAccompanyingCharacters: [],
        playerActionSkillCheckActors: [
            { name: 'Baato', aliases: ['player'] },
            { name: 'QA Loud Decoy', aliases: ['Decoy'] }
        ],
        setting: { writingStyleNotes: 'Keep it concrete.' }
    });

    assert.match(rendered, /Do not list a character who merely observes/);
    assert.match(rendered, /QA Loud Decoy \(accepted aliases: Decoy\)/);
    const checkpoint = renderState.checkpoints.find(candidate => (
        candidate.parserName === 'player_action_checked_action_actors'
    ));
    assert.ok(checkpoint);
    assert.deepEqual(checkpoint.parserArgs[0], [
        { name: 'Baato', aliases: ['player'] },
        { name: 'QA Loud Decoy', aliases: ['Decoy'] }
    ]);
});

test('tiny-brain committed travel uses authoritative destination without a movement or destination checkpoint', () => {
    const promptEnv = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }),
        { autoescape: false }
    );
    promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    addPlayerActionDestinationGlobals(promptEnv);
    const renderState = TinyBrainPromptRunner.createRenderState();
    const rendered = promptEnv.render('_includes/player-action.tinybrain.njk', {
        __tinyBrainState: renderState,
        actionText: 'Walk to the Community Kitchen Exterior.',
        characterName: 'The player',
        config: {
            prose_instructions: 'Write clear prose.',
            prose_length: 'three paragraphs',
            prose_prompt_suffix: '',
            repetition_buster: true,
            use_legacy_prompt_checks: false
        },
        currentLocationLastSeenNpcs: [],
        currentVehicle: null,
        isAttack: false,
        isExterior: false,
        modPlayerActionPromptSteps: [],
        npcs: [],
        party: [],
        playerActionTravelDestination: {
            location: 'Community Kitchen Exterior',
            region: 'Ember Hollow',
            travelTimeMinutes: 8
        },
        playerActionTravelMovementKind: 'destination',
        playerActionAccompanyingCharacters: [{ name: 'Mira Vale', aliases: ['Mira'] }],
        playerActionWorldTimeMinutes: 0,
        setting: { writingStyleNotes: 'Keep it concrete.' }
    });

    assert.match(rendered, /game has already committed this action/i);
    assert.match(rendered, /Community Kitchen Exterior/);
    assert.match(rendered, /Ember Hollow/);
    assert.ok(!renderState.checkpoints.some(checkpoint => (
        checkpoint.parserName === 'player_action_movement'
        || checkpoint.parserName === 'player_action_destination'
    )));
    assert.ok(renderState.checkpoints.some(checkpoint => checkpoint.parserName === 'player_action_prose_scope'));
    assert.ok(renderState.checkpoints.some(checkpoint => (
        checkpoint.parserName === 'player_action_accompanying_characters'
    )));
    assert.match(
        rendered,
        /Keep carried and equipped items in their current owner's possession unless the <playerAction> or a mechanical tool result explicitly commits an inventory change/,
        'travel prose must preserve authoritative inventory ownership'
    );
    assert.match(
        rendered,
        /if the action and second draft establish that an eligible character deliberately travels with the player, report that character even when an alias was used/,
        'companion selection must retain deliberate alias-named travelers'
    );
});
