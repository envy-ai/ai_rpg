const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

const { TinyBrainPromptExtension, TinyBrainPromptRunner } = require('../TinyBrainPromptRunner.js');

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
});

test('tiny-brain exterior branch renders the resolved travel target name and description', () => {
    const promptEnv = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }),
        { autoescape: false }
    );
    promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
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

test('tiny-brain committed travel uses authoritative destination without a movement or destination checkpoint', () => {
    const promptEnv = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }),
        { autoescape: false }
    );
    promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
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
});
