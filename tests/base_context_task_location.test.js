const test = require('node:test');
const assert = require('node:assert/strict');
const { createPromptEnv, buildBaseRenderContext } = require('./helpers/baseContextFixtures.js');

const location = (id, name) => ({ id, name, description: `${name} description.`, statusEffects: [], exits: [], items: [] });
const region = name => ({ name, description: `${name} region.`, locations: [], connectedRegions: [] });

function render(extra) {
    const context = buildBaseRenderContext({ promptUsesCaching: true });
    return createPromptEnv().render('base-context.xml.njk', { ...context, ...extra });
}

const gameState = text => text.slice(0, text.indexOf('[[[AI_RPG_INTERNAL_BASE_CONTEXT_END_V1]]]'));
const task = text => text.slice(text.indexOf('[[[AI_RPG_INTERNAL_BASE_CONTEXT_END_V1]]]'));

test('a different task location keeps the shared game state on the player location and adds a task block', () => {
    const shared = { regionContext: region('Harbor'), currentLocation: location('loc_docks', 'Docks'), npcs: [], itemsInScene: [] };
    const output = render({
        sharedLocationScope: shared,
        currentRegion: region('Retro Ward'),
        currentLocation: location('loc_museum', 'Pixel Museum'),
        npcs: [], itemsInScene: []
    });
    assert.match(gameState(output), /<name>Docks<\/name>/);
    assert.doesNotMatch(gameState(output), /Pixel Museum/);
    assert.match(task(output), /<taskLocation>[\s\S]*<name>Pixel Museum<\/name>[\s\S]*<\/taskLocation>/);
    assert.match(task(output), /replace the currentRegion and currentLocation/);
});

test('the game state is byte-identical whatever task location is requested', () => {
    const shared = { regionContext: region('Harbor'), currentLocation: location('loc_docks', 'Docks'), npcs: [], itemsInScene: [] };
    const a = gameState(render({ sharedLocationScope: shared, currentRegion: region('Retro Ward'), currentLocation: location('loc_a', 'Arcade Alley'), npcs: [], itemsInScene: [] }));
    const b = gameState(render({ sharedLocationScope: shared, currentRegion: region('Retro Ward'), currentLocation: location('loc_b', 'Server Graveyard'), npcs: [], itemsInScene: [] }));
    const c = gameState(render({ sharedLocationScope: shared, currentRegion: region('Retro Ward'), currentLocation: null, npcs: [], itemsInScene: [] }));
    assert.equal(a, b);
    assert.equal(a, c);
});

test('no task block when the task location is the player location, and older callers without a shared scope are unchanged', () => {
    const docks = location('loc_docks', 'Docks');
    const same = render({ sharedLocationScope: { regionContext: region('Harbor'), currentLocation: docks, npcs: [], itemsInScene: [] }, currentRegion: region('Harbor'), currentLocation: docks, npcs: [], itemsInScene: [] });
    assert.doesNotMatch(same, /<taskLocation>/);
    const legacy = render({ currentRegion: region('Harbor'), currentLocation: docks, npcs: [], itemsInScene: [] });
    assert.match(gameState(legacy), /<name>Docks<\/name>/);
    assert.doesNotMatch(legacy, /<taskLocation>/);
});

test('a null task location (generated region/location XML) adds no task block unless the region differs', () => {
    const shared = { regionContext: region('Harbor'), currentLocation: location('loc_docks', 'Docks'), npcs: [], itemsInScene: [] };
    const sameRegion = render({ sharedLocationScope: shared, currentRegion: region('Harbor'), regionContext: region('Harbor'), currentLocation: null, npcs: [], itemsInScene: [] });
    assert.doesNotMatch(sameRegion, /<taskLocation>/);
    const otherRegion = render({ sharedLocationScope: shared, currentRegion: region('Retro Ward'), regionContext: region('Retro Ward'), currentLocation: null, npcs: [], itemsInScene: [] });
    assert.match(task(otherRegion), /<taskLocation>[\s\S]*Retro Ward[\s\S]*<\/taskLocation>/);
});
