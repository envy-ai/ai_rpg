const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Player = require('../Player.js');
const Thing = require('../Thing.js');
const Location = require('../Location.js');
const LocationExit = require('../LocationExit.js');
const Globals = require('../Globals.js');

const rootDir = path.join(__dirname, '..');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');

const previousBaseDir = Globals.baseDir;
const previousConfig = Globals.config;

test.before(() => {
    Player.clearRuntimeRegistries();
    Globals.baseDir = rootDir;
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10,
        formulas: {
            character_creation: {
                attribute_pool_formula: '0',
                skill_pool_formula: '0',
                max_attribute: '18',
                max_skill: '10'
            }
        }
    };
    Player.reloadDefinitionCaches({ refreshInstances: false });
});

test.after(() => {
    Player.clearRuntimeRegistries();
    Thing.clear();
    Globals.baseDir = previousBaseDir;
    Globals.config = previousConfig;
    Player.reloadDefinitionCaches({ refreshInstances: false });
});

test('image-capable entities default imagePrompt to blank without generating anything', () => {
    const player = new Player({ name: `Image Prompt Player ${Date.now()}` });
    const thing = new Thing({
        name: `Image Prompt Thing ${Date.now()}`,
        description: 'A test thing.',
        thingType: 'item'
    });
    const location = new Location({
        name: `Image Prompt Location ${Date.now()}`,
        description: 'A test location.',
        regionId: 'test-region',
        checkRegionId: false
    });
    const exit = new LocationExit({
        description: 'A test exit.',
        destination: 'destination-location'
    });

    assert.equal(player.imagePrompt, '');
    assert.equal(thing.imagePrompt, '');
    assert.equal(location.imagePrompt, '');
    assert.equal(exit.imagePrompt, '');
});

test('imagePrompt is trimmed, editable, and serialized for every image-capable entity', () => {
    const player = new Player({ name: `Prompted Player ${Date.now()}`, imagePrompt: '  player prompt  ' });
    const thing = new Thing({
        name: `Prompted Thing ${Date.now()}`,
        description: 'A test thing.',
        thingType: 'scenery',
        imagePrompt: '  thing prompt  '
    });
    const location = new Location({
        name: `Prompted Location ${Date.now()}`,
        description: 'A test location.',
        regionId: 'test-region',
        checkRegionId: false,
        imagePrompt: '  location prompt  '
    });
    const exit = new LocationExit({
        description: 'A test exit.',
        destination: 'destination-location',
        imagePrompt: '  exit prompt  '
    });

    assert.equal(player.toJSON().imagePrompt, 'player prompt');
    assert.equal(player.getStatus().imagePrompt, 'player prompt');
    assert.equal(Thing.fromJSON(thing.toJSON()).imagePrompt, 'thing prompt');
    assert.equal(new Location({ ...location.toJSON(), checkRegionId: false }).imagePrompt, 'location prompt');
    assert.equal(new LocationExit(exit.toJSON()).imagePrompt, 'exit prompt');

    const thingChecksumBeforePromptEdit = thing.checksum;
    player.imagePrompt = '';
    thing.imagePrompt = ' replacement thing prompt ';
    location.imagePrompt = ' replacement location prompt ';
    exit.imagePrompt = ' replacement exit prompt ';

    assert.equal(player.imagePrompt, '');
    assert.equal(thing.imagePrompt, 'replacement thing prompt');
    assert.equal(thing.checksum, thingChecksumBeforePromptEdit);
    assert.equal(location.imagePrompt, 'replacement location prompt');
    assert.equal(exit.imagePrompt, 'replacement exit prompt');
});

test('image generation stores final prompts and same-prompt requests bypass prompt generation', () => {
    assert.match(serverSource, /finalImagePrompt = assignEntityImagePrompt\(player, finalImagePrompt, 'Character'\)/);
    assert.match(serverSource, /finalImagePrompt = assignEntityImagePrompt\(location, finalImagePrompt, 'Location'\)/);
    assert.match(serverSource, /finalImagePrompt = assignEntityImagePrompt\(thing, finalImagePrompt, 'Thing'\)/);
    assert.match(serverSource, /assignEntityImagePrompt\(locationExit, finalImagePromptOverride, 'Location exit'\)/);
    assert.match(apiSource, /else if \(useExistingPrompt\)/);
    assert.match(apiSource, /generatorOptions\.finalImagePrompt = existingPrompt/);
    assert.match(apiSource, /does not have a saved image prompt/);
});

test('entity editors and existing image context menus expose imagePrompt controls', () => {
    for (const id of [
        'npcEditImagePrompt',
        'thingEditImagePrompt',
        'locationEditImagePrompt',
        'newExitImagePrompt'
    ]) {
        assert.match(viewSource, new RegExp(`id="${id}"`));
    }

    assert.equal(
        (viewSource.match(/Regenerate Image \(same prompt\)/g) || []).length,
        4,
        'expected location, map-location, thing, and character menu labels'
    );
    assert.match(viewSource, /payload\.useExistingPrompt = true/);
    assert.match(viewSource, /payload\.imagePrompt = npcEditImagePromptInput\.value/);
    assert.match(viewSource, /payload\.imagePrompt = thingEditImagePromptInput\.value/);
    assert.match(viewSource, /payload\.imagePrompt = locationEditImagePromptInput\?\.value/);
    assert.match(viewSource, /payload\.imagePrompt = newExitImagePromptInput\.value/);
});
