'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Player = require('../Player.js');
const TechniqueService = require('../TechniqueService.js');
const { registerTechniqueApiRoutes } = require('../TechniqueApi.js');
const { withTechniqueWorld } = require('./helpers/techniqueIntegrationFixtures.js');

async function withApi(world, run) {
    const app = express();
    app.use(express.json());
    registerTechniqueApiRoutes(app, {
        getCurrentPlayer: () => world.player,
        getActors: () => world.actors,
        effectiveTechniqueLocation: actor => actor.location?.id ?? null
    });
    const server = app.listen(0, '0.0.0.0');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://0.0.0.0:${server.address().port}`;
    const request = async (route, method = 'GET', body) => {
        const response = await fetch(`${base}${route}`, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : {},
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        return { status: response.status, body: await response.json() };
    };
    try {
        await run(request);
    } finally {
        if (server.listening) {
            server.closeAllConnections();
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
    }
}

test('technique HTTP routes expose authoritative catalog, preview without mutation, access, learning, personal edits, and stack-bearing errors', async () => {
    await withTechniqueWorld(async world => withApi(world, async request => {
        const { player, npc, target } = world;
        const current = await request('/api/techniques');
        assert.equal(current.status, 200);
        assert.equal(current.body.actorId, player.id);
        assert.equal(current.body.canUse, true);
        assert.ok(current.body.targets.some(entry => entry.id === target.id));

        const npcPanel = await request(`/api/techniques?actor=${npc.id}&catalog=true`);
        assert.equal(npcPanel.status, 200);
        assert.equal(npcPanel.body.canUse, false);
        assert.equal(npcPanel.body.catalog.length, 0);

        const disciplineResponse = await request('/api/techniques/disciplines', 'POST', {
            id: 'discipline-api-contract', name: 'API Contract', description: 'Route fixture.', publicAccess: true
        });
        assert.equal(disciplineResponse.status, 200);
        assert.equal(TechniqueService.getDisciplines().some(entry => entry.id === disciplineResponse.body.discipline.id), true);

        const revision = {
            revision: 1,
            target: { kind: 'self' },
            check: { kind: 'automatic' },
            costs: [],
            effects: [{ id: 'restore', kind: 'healing', amount: { formula: 'level * 2', bindings: { level: { kind: 'level' } } } }]
        };
        const created = await request('/api/techniques/catalog', 'POST', {
            id: 'technique-api-contract', disciplineId: 'discipline-api-contract', name: 'Mend', description: 'A route fixture.',
            semanticKey: 'api-contract-mend', aliases: [],
            provenance: { kind: 'editor', reason: 'API integration fixture.' }, revisions: [revision]
        });
        assert.equal(created.status, 200);
        assert.equal(created.body.definition.id, 'technique-api-contract');

        player.setHealth(player.health - 5);
        const healthBeforePreview = player.health;
        const preview = await request('/api/techniques/preview', 'POST', {
            actorId: player.id,
            formulaVariables: [{ key: 'level', label: 'Forged level', kind: 'level', value: 999 }],
            mechanics: revision
        });
        assert.equal(preview.status, 200);
        assert.equal(preview.body.mechanics.effects[0].amount, player.level * 2);
        assert.equal(player.health, healthBeforePreview, 'preview must remain advisory');
        assert.equal(player.techniques.length, 0);

        const access = await request('/api/techniques/access', 'PUT', {
            actorId: player.id,
            disciplineAccess: [{ disciplineId: 'discipline-api-contract', provenance: { kind: 'training', reason: 'Passed the route fixture.' } }]
        });
        assert.equal(access.status, 200);
        assert.equal(player.disciplineAccess[0].disciplineId, 'discipline-api-contract');

        const learned = await request('/api/techniques/technique-api-contract/learn', 'POST', {
            actorId: player.id, operationId: 'http-learn-technique-api-contract', definitionRevision: 1,
            provenance: { kind: 'editor', reason: 'Explicit test acquisition.' }
        });
        assert.equal(learned.status, 200);
        assert.equal(learned.body.receipt.kind, 'learn');
        assert.equal(player.techniques[0].techniqueId, 'technique-api-contract');

        const edited = await request('/api/techniques/technique-api-contract/personal', 'PUT', {
            actorId: player.id,
            operationId: 'http-edit-technique-api-contract',
            mechanics: { ...revision, revision: 2, effects: [{ id: 'restore', kind: 'healing', amount: 11 }] },
            provenance: { kind: 'editor', reason: 'Personal mechanics route edit.' }
        });
        assert.equal(edited.status, 200);
        assert.equal(edited.body.receipt.kind, 'improve');
        assert.equal(player.techniques[0].mechanics.effects[0].amount, 11);
        assert.equal(TechniqueService.getDefinition('technique-api-contract').revisions[0].effects[0].amount.formula, 'level * 2');

        const invalidAccess = await request('/api/techniques/access', 'PUT', {
            actorId: player.id, disciplineAccess: [{ disciplineId: 'missing-discipline', provenance: { kind: 'training', reason: 'invalid' } }]
        });
        assert.equal(invalidAccess.status, 400);
        assert.match(invalidAccess.body.error, /Unknown discipline missing-discipline/);
        assert.match(invalidAccess.body.stack, /Error/);
        const missingActor = await request('/api/techniques?actor=missing-actor');
        assert.equal(missingActor.status, 400);
        assert.match(missingActor.body.error, /does not exist/);
        assert.match(missingActor.body.stack, /Error/);
    }));
});

test('combined discipline edit renames shared metadata and updates only the selected actor access atomically', async () => {
    await withTechniqueWorld(async world => withApi(world, async request => {
        const { player, npc } = world;
        const disciplineId = 'discipline-edit-shared';
        TechniqueService.addDiscipline({ id: disciplineId, name: 'Old Circle', description: 'Old description.', publicAccess: true });
        TechniqueService.addDefinition({
            id: 'technique-discipline-edit-pin', disciplineId, name: 'Pinned Mend', description: 'A pinned technique.',
            semanticKey: 'discipline edit pinned mend', aliases: [], provenance: { kind: 'editor', reason: 'Discipline edit fixture.' },
            revisions: [{ revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'restore', kind: 'healing', amount: 4 }] }]
        }, { actor: player, origin: 'editor' });
        await TechniqueService.learn({ operationId: 'discipline-edit-learn-player', actor: player, techniqueId: 'technique-discipline-edit-pin', provenance: { kind: 'editor', reason: 'Learned for the discipline edit fixture.' } });
        await TechniqueService.learn({ operationId: 'discipline-edit-learn-npc', actor: npc, techniqueId: 'technique-discipline-edit-pin', provenance: { kind: 'editor', reason: 'Learned for the discipline edit fixture.' } });
        player.setDisciplineAccess([]);
        npc.setDisciplineAccess([{ disciplineId, provenance: { kind: 'training', reason: 'NPC-specific prior access.' } }]);

        const originalDefinition = TechniqueService.getDefinition('technique-discipline-edit-pin');
        const originalPlayerMechanics = player.techniques;
        const originalNpcMechanics = npc.techniques;
        const originalNpcAccess = npc.disciplineAccess;
        const panel = await request(`/api/techniques?actor=${player.id}`);
        assert.equal(panel.status, 200);
        assert.deepEqual(panel.body.disciplineEditContext.disciplines.find(item => item.id === disciplineId), { id: disciplineId, name: 'Old Circle', description: 'Old description.' });
        const edit = {
            actorId: player.id,
            edits: [{ id: disciplineId, name: 'Fieldcraft', description: 'Shared edited discipline description.' }],
            accessIds: [disciplineId],
            accessReason: 'Granted by the edited-discipline authoring dialog.',
            expected: panel.body.disciplineEditContext
        };
        const saved = await request('/api/techniques/disciplines', 'PUT', edit);
        assert.equal(saved.status, 200, saved.body.error);
        assert.equal(saved.body.disciplinesChanged, true);
        assert.deepEqual(TechniqueService.getDisciplines().find(item => item.id === disciplineId), { id: disciplineId, name: 'Fieldcraft', description: 'Shared edited discipline description.', publicAccess: true, accessRequirements: [] });
        assert.deepEqual(player.disciplineAccess.map(entry => entry.disciplineId), [disciplineId]);
        assert.equal(player.disciplineAccess[0].provenance.reason, edit.accessReason);
        assert.deepEqual(npc.disciplineAccess, originalNpcAccess);
        assert.deepEqual(player.techniques, originalPlayerMechanics);
        assert.deepEqual(npc.techniques, originalNpcMechanics);
        assert.deepEqual(TechniqueService.getDefinition('technique-discipline-edit-pin'), originalDefinition);
        for (const actor of [player, npc]) {
            const source = TechniqueService.getAvailable(actor).find(entry => entry.techniqueId === 'technique-discipline-edit-pin').sources[0];
            assert.equal(source.sourceId, 'learned:technique-discipline-edit-pin');
            assert.equal(source.definitionRevision, 1);
            assert.equal(source.personalRevision, 1);
        }

        const assertAtomicFailure = async mutation => {
            const current = await request(`/api/techniques?actor=${player.id}`);
            const priorShared = TechniqueService.getDisciplines();
            const priorAccess = player.disciplineAccess;
            const response = await request('/api/techniques/disciplines', 'PUT', { ...edit, ...mutation, expected: current.body.disciplineEditContext });
            assert.equal(response.status, 400);
            assert.deepEqual(TechniqueService.getDisciplines(), priorShared);
            assert.deepEqual(player.disciplineAccess, priorAccess);
            assert.deepEqual(npc.disciplineAccess, originalNpcAccess);
            assert.deepEqual(player.techniques, originalPlayerMechanics);
            assert.deepEqual(npc.techniques, originalNpcMechanics);
        };
        await assertAtomicFailure({ edits: [{ id: disciplineId, name: '   ', description: 'Should not partially save.' }] });
        await assertAtomicFailure({ edits: [{ id: disciplineId, name: 'Must not partially save', description: 'Valid edit.' }], accessIds: ['missing-discipline'] });

        const saveSnapshot = { techniques: TechniqueService.toJSON(), player: player.toJSON(), npc: npc.toJSON() };
        TechniqueService.hydrate(saveSnapshot.techniques);
        Player.unregister(player);
        Player.unregister(npc);
        const loadedPlayer = Player.fromJSON(saveSnapshot.player);
        const loadedNpc = Player.fromJSON(saveSnapshot.npc);
        assert.deepEqual(TechniqueService.getDisciplines().find(item => item.id === disciplineId), { id: disciplineId, name: 'Fieldcraft', description: 'Shared edited discipline description.', publicAccess: true, accessRequirements: [] });
        assert.deepEqual(loadedPlayer.disciplineAccess, player.disciplineAccess);
        assert.deepEqual(loadedNpc.disciplineAccess, originalNpcAccess);
        assert.equal(loadedPlayer.techniques[0].techniqueId, 'technique-discipline-edit-pin');
        assert.equal(loadedPlayer.techniques[0].definitionRevision, 1);
    }));
});

test('technique formula catalog and preview use current actor facts and reject unknown variables before catalog writes', async () => {
    await withTechniqueWorld(async world => withApi(world, async request => {
        const { player } = world;
        player.setLevel(5);
        assert.equal(player.setSkillValue('Spellcasting', 4), true);
        player.setAttribute('strength', 14);

        const response = await request(`/api/techniques?actor=${player.id}`);
        assert.equal(response.status, 200);
        const variables = new Map(response.body.formulaVariables.map(row => [row.key, row]));
        assert.deepEqual(variables.get('level'), { key: 'level', label: 'Level', kind: 'level', value: 5 });
        assert.deepEqual(variables.get('skill_spellcasting'), { key: 'skill_spellcasting', label: 'Spellcasting rank', kind: 'skill', name: 'Spellcasting', value: 4 });
        assert.deepEqual(variables.get('attribute_strength_modifier'), { key: 'attribute_strength_modifier', label: 'strength modifier', kind: 'attribute', name: 'strength', value: player.getAttributeModifier('strength') });
        assert.deepEqual(response.body.formulaVariables.filter(row => row.kind === 'skill').map(row => row.name).sort(), [...player.getSkills().keys()].sort());
        assert.deepEqual(response.body.formulaVariables.filter(row => row.kind === 'attribute').map(row => row.name).sort(), player.getAttributeNames().sort());
        assert.equal(response.body.formulaVariables.length, 1 + player.getSkills().size + player.getAttributeNames().length);

        const revision = {
            revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' }, costs: [],
            effects: [{ id: 'restore', kind: 'healing', amount: { formula: 'level + skill_spellcasting + attribute_strength_modifier' } }]
        };
        const preview = await request('/api/techniques/preview', 'POST', { actorId: player.id, mechanics: revision });
        assert.equal(preview.status, 200);
        assert.equal(preview.body.mechanics.effects[0].amount, 11);

        const created = await request('/api/techniques/catalog', 'POST', {
            actorId: player.id, id: 'technique-automatic-formula-api', disciplineId: 'discipline-integration',
            name: 'Automatic Formula', description: 'A formula API fixture.', semanticKey: 'automatic formula api', aliases: [],
            provenance: { kind: 'editor', reason: 'Formula API integration fixture.' }, revisions: [revision]
        });
        assert.equal(created.status, 200);
        assert.deepEqual(created.body.definition.revisions[0].effects[0].amount, { formula: 'level + skill_spellcasting + attribute_strength_modifier' });

        const invalid = await request('/api/techniques/catalog', 'POST', {
            actorId: player.id, id: 'technique-unknown-formula-api', disciplineId: 'discipline-integration',
            name: 'Unknown Formula', description: 'Must fail.', semanticKey: 'unknown formula api', aliases: [],
            provenance: { kind: 'editor', reason: 'Unknown formula API fixture.' },
            revisions: [{ ...revision, effects: [{ id: 'restore', kind: 'healing', amount: { formula: 'skill_not_available + 1' } }] }]
        });
        assert.equal(invalid.status, 400);
        assert.match(invalid.body.error, /unknown formula variable skill_not_available/);
        assert.match(invalid.body.stack, /Error/);
        assert.equal(TechniqueService.getDefinition('technique-unknown-formula-api'), null);
    }));
});
