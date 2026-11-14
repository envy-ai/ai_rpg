const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBuildBasePromptContext } = require('./helpers/baseContextFixtures.js');

const plain = value => JSON.parse(JSON.stringify(value));

function location(id, name, npcIds) {
    return { id, name, description: `${name}.`, items: [], scenery: [], npcIds,
        getDetails: () => ({ name, description: `${name}.`, exits: {}, npcIds }),
        getAvailableDirections: () => [], getExit: () => null };
}

function npc(id, name, traits) {
    return { id, name, isNPC: true, sexualTraits: traits, importantMemories: [`${name} remembers the market.`],
        currentQuests: [], getAbilities: () => [], getPartyMembers: () => [],
        getStatus: () => ({ name, description: '', inventory: [], gear: {}, skills: [] }) };
}

// Contributes text derived from the characters in the scene, like nsfw-boost's trait list.
const registry = {
    getEntityFields: () => [],
    collectBaseContextContributions: ({ context }) => [{ placement: 'scene',
        value: `traits:${(context.npcs || []).map(entry => entry.name).join(',')}` }]
};

test('a differing task location leaves every scene-derived shared field on the player location', () => {
    const docks = location('loc_docks', 'Docks', ['npc_a']);
    const museum = location('loc_museum', 'Museum', ['npc_b']);
    const players = new Map([['npc_a', npc('npc_a', 'Ada', 'romantic')], ['npc_b', npc('npc_b', 'Bo', 'intense')]]);
    const currentPlayer = { id: 'player_1', name: 'Tester', currentLocation: 'loc_docks', currentQuests: [],
        getAbilities: () => [], getPartyMembers: () => [],
        getStatus: () => ({ name: 'Tester', description: '', inventory: [], gear: {}, skills: [] }) };
    const build = loadBuildBasePromptContext({ players, currentPlayer, registry, globals: { location: docks }, sandbox: {
        sanitizeImportantMemories: list => (Array.isArray(list) ? list.slice() : []),
        computeDispositionsTowardsPlayer: () => [],
        collectActorSkills: () => [],
        collectNeedBarsForPrompt: () => [],
        collectNeedSentencesForPrompt: () => []
    } });

    const playerOnly = build();
    const task = build({ locationOverride: museum });

    assert.deepEqual(plain(task.modSceneContext), plain(playerOnly.modSceneContext));
    assert.deepEqual(plain(task.modSceneContext), plain(['traits:Ada']));
    assert.deepEqual(plain(task.sharedLocationScope.npcs.map(entry => entry.name)), plain(['Ada']));
    assert.deepEqual(plain(task.sharedLocationScope.currentLocation), plain(playerOnly.currentLocation));
    assert.deepEqual(plain(task.currentPlayer), plain(playerOnly.currentPlayer));
    // Callers and the <taskLocation> block still see the task location.
    assert.equal(task.currentLocation.name, 'Museum');
    assert.deepEqual(plain(task.npcs.map(entry => entry.name)), plain(['Bo']));
    // The same location as the player's keeps a single build.
    assert.deepEqual(plain(build({ locationOverride: docks }).modSceneContext), plain(['traits:Ada']));
});
