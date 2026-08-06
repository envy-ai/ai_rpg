const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const nunjucks = require('nunjucks');

const { TinyBrainPromptExtension, TinyBrainPromptRunner } = require('../TinyBrainPromptRunner.js');

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
