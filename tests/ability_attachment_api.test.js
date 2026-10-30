'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Technique = require('../Technique.js');
const TechniqueService = require('../TechniqueService.js');
const { requireOwnedAbility } = require('../AbilityAttachmentAuthoring.js');
const { withTechniqueWorld, mechanics, addDefinition } = require('./helpers/techniqueIntegrationFixtures.js');

function registerActualRoutes(players, generate = async () => { throw new Error("Unexpected generation"); }) {
    const source = fs.readFileSync(path.join(__dirname, '../api.js'), 'utf8');
    const begin = source.indexOf('        const resolveAbilityAttachmentActor =');
    const end = source.indexOf("        app.post('/api/chat/action-suggestions'", begin);
    assert.ok(begin >= 0 && end > begin, 'attachment routes are present');
    const handlers = new Map();
    const app = Object.fromEntries(['get', 'post', 'put'].map(method => [method, (route, handler) => handlers.set(`${method} ${route}`, handler)]));
    const build = new Function('app', 'players', 'TechniqueService', 'Technique', 'requireOwnedAbility', 'serializeNpcForClient', 'gameLoadInProgress', 'generateAbilityAttachmentDraft', 'config', 'getActiveSettingSnapshot', source.slice(begin, end));
    build(app, players, TechniqueService, Technique, requireOwnedAbility, actor => actor.toJSON(), false, generate, {}, () => ({}));
    return handlers;
}
async function invoke(handler, params, body) {
    let status = 200, payload;
    const res = { status(code) { status = code; return this; }, json(value) { payload = value; return value; } };
    await handler({ params, body }, res);
    return { status, payload };
}

test('attachment GET and PUT preserve pinned status grant identity and provenance; stale draft fails with original state intact', async () => {
    await withTechniqueWorld(async ({ player, actors }) => {
        addDefinition('api-ward', mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 2 }] }));
        player.setAbilities([{ id: 'api-ability', name: 'Ward', description: 'Provides a ward.', statusEffects: [{ id: 'api-status', name: 'Ward', description: 'Grants a ward.', duration: -1, maxHealthPercent: 20, techniqueGrants: [{ id: 'api-grant', sourceStatusId: 'api-status', techniqueId: 'api-ward', definitionRevision: 1, provenance: { kind: 'training', reason: 'Saved origin.' } }] }] }]);
        const handlers = registerActualRoutes(actors), params = { actorId: player.id, abilityId: 'api-ability' };
        const base = '/api/players/:actorId/abilities/:abilityId/attachments';
        const get = await invoke(handlers.get(`get ${base}`), params);
        assert.equal(get.status, 200);
        const saved = player.getAbilities();
        assert.equal(get.payload.draft.statusEffects[0].id, 'api-status');
        assert.deepEqual(get.payload.draft.statusEffects[0].techniqueEntries[0], { id: 'api-grant', techniqueId: 'api-ward', definitionRevision: 1, provenance: { kind: 'training', reason: 'Saved origin.' } });
        const put = await invoke(handlers.get(`put ${base}`), params, { draft: get.payload.draft, expected: get.payload.expected });
        assert.equal(put.status, 200, put.payload.error);
        assert.deepEqual(player.getAbilities(), saved);
        player.setAbilities([{ ...player.getAbilities()[0], description: 'Changed independently.' }]);
        const changed = player.getAbilities();
        const stale = await invoke(handlers.get(`put ${base}`), params, { draft: get.payload.draft, expected: get.payload.expected });
        assert.equal(stale.status, 400);
        assert.match(stale.payload.error, /changed after generation/);
        assert.match(stale.payload.stack, /TechniqueService/);
        assert.deepEqual(player.getAbilities(), changed);
    });
});


test('generate endpoint returns only a detached draft with a baseline', async () => {
    await withTechniqueWorld(async ({ player, actors }) => {
        player.setAbilities([{ id: 'api-ability', name: 'Ward', description: 'Provides a ward.' }]);
        const before = player.getAbilities();
        const expected = TechniqueService.getAbilityAttachmentExpected(player, ['api-ability']);
        const draft = { statusEffects: [{ name: 'Ward', description: 'Tougher.', duration: -1, maxHealthPercent: 20 }] };
        const calls = [];
        const handlers = registerActualRoutes(actors, async args => { calls.push(args); return { draft, expected }; });
        const route = handlers.get('post /api/players/:actorId/abilities/:abilityId/attachments/generate');
        const result = await invoke(route, { actorId: player.id, abilityId: 'api-ability' }, { clientId: 'fixture-client' });
        assert.equal(result.status, 200);
        assert.deepEqual(result.payload, { success: true, draft, expected });
        assert.equal(calls[0].actor, player);
        assert.equal(calls[0].clientId, 'fixture-client');
        assert.deepEqual(player.getAbilities(), before);
    });
});
