'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Player = require('../Player.js');
const TechniqueService = require('../TechniqueService.js');
const { registerTechniqueApiRoutes } = require('../TechniqueApi.js');
const IdGenerator = require('../IdGenerator.js');
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

test('discipline creation assigns Unicode names, reuses equivalent titles, and suffixes collisions', async () => {
    IdGenerator.reset();
    try {
        await withTechniqueWorld(async world => withApi(world, async request => {
            const create = (name, description = 'A canonical practice.') => request('/api/techniques/disciplines', 'POST', { name, description, publicAccess: true });
            const martialArts = await create('Martial Arts');
            assert.equal(martialArts.status, 200, martialArts.body.error);
            assert.equal(martialArts.body.discipline.id, 'discipline_martial_arts');
            const samePractice = await create('Martial--Arts');
            assert.equal(samePractice.status, 200, samePractice.body.error);
            assert.equal(samePractice.body.discipline.id, martialArts.body.discipline.id);
            assert.equal(TechniqueService.getDisciplines().filter(item => item.id === 'discipline_martial_arts').length, 1);

            const fireball = await create('Fireball');
            const fireBall = await create('Fire ball');
            assert.equal(fireball.body.discipline.id, 'discipline_fireball');
            assert.equal(fireBall.body.discipline.id, 'discipline_fire_ball');
            assert.notEqual(fireball.body.discipline.id, fireBall.body.discipline.id, 'word boundaries remain part of the canonical title');

            const unicode = await create('Élan');
            assert.equal(unicode.body.discipline.id, 'discipline_élan', 'Unicode letters remain literal rather than transliterated');
            const punctuationOnly = await create('!?');
            assert.equal(punctuationOnly.status, 400);
            assert.match(punctuationOnly.body.error, /name|punctuation|letter|number/i);

            TechniqueService.addDiscipline({ id: 'discipline_reserved_style', name: 'Other Style', description: 'An existing unrelated record.' });
            const collision = await create('Reserved Style');
            assert.equal(collision.status, 200);
            assert.equal(collision.body.discipline.id, 'discipline_reserved_style_2');
        }));
    } finally { IdGenerator.reset(); }
});

test('discipline resolution preserves legacy IDs and rules, rejects ambiguous legacy names, and prevents derived-ID overwrite', async () => {
    IdGenerator.reset();
    try {
        await withTechniqueWorld(({ player }) => {
            const existing = TechniqueService.addDiscipline({
                id: 'discipline_legacy_martial', name: 'Martial Arts', description: 'Saved legacy description.',
                accessRequirements: [{ kind: 'skill', name: 'Brawling', minimum: 2 }], publicAccess: false
            });
            const reused = TechniqueService.resolveDiscipline({
                name: 'Martial--Arts', description: 'Proposed replacement description.', publicAccess: true,
                accessRequirements: []
            });
            assert.deepEqual(reused, existing, 'a normalized same-title proposal reuses canonical ID and saved rules');
            assert.throws(() => TechniqueService.resolveDiscipline({
                id: 'discipline_new_claim', name: 'Martial Arts', description: 'A draft with a different identity.'
            }), /conflicts with canonical discipline discipline_legacy_martial/);

            const ambiguous = [
                { id: 'discipline_legacy_a', name: 'Old Practice', description: 'A.' },
                { id: 'discipline_legacy_b', name: 'Old--Practice', description: 'B.' }
            ];
            assert.throws(() => TechniqueService.resolveDiscipline({ name: 'Old Practice', description: 'Proposal.' }, { disciplines: ambiguous }), /matches multiple existing discipline IDs.*discipline_legacy_a.*discipline_legacy_b/);

            TechniqueService.addDiscipline({ id: 'discipline_fire_ball', name: 'Unrelated Renamed Practice', description: 'Occupies a title-derived ID.' });
            assert.equal(TechniqueService.resolveDiscipline({ name: 'Fire ball', description: 'A new field.' }).id, 'discipline_fire_ball_2');
            assert.equal(TechniqueService.getDisciplines().length, 3, 'rejected resolutions do not merge or overwrite catalogue entries');
            assert.equal(player.techniques.length, 0);
        });
    } finally { IdGenerator.reset(); }
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

test('personal rebase routes preview, reject stale guards, apply and replay', async () => {
    const { mechanics, addDefinition, learn } = require('./helpers/techniqueIntegrationFixtures.js');
    await withTechniqueWorld(async world => withApi(world, async request => {
        const { player } = world;
        const id = 'technique-route-rebase';
        const base = mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 2 }] });
        addDefinition(id, base);
        learn(player, id);
        TechniqueService.reviseDefinition(id, { ...base, revision: 2, effects: [{ id: 'heal', kind: 'healing', amount: 5 }] }, { actor: player, origin: 'editor' });
        const body = { actorId: player.id, expectedDefinitionRevision: 1, expectedPersonalRevision: 1, expectedCatalogRevision: 2, targetDefinitionRevision: 2 };
        const preview = await request(`/api/techniques/${id}/personal-reset/preview`, 'POST', body);
        assert.equal(preview.status, 200);
        assert.equal(preview.body.mode, 'rebase');
        assert.equal(player.techniques.find(entry => entry.techniqueId === id).definitionRevision, 1);
        const stale = await request(`/api/techniques/${id}/personal-reset`, 'POST', { ...body, expectedCatalogRevision: 1, operationId: 'route-stale', provenance: { kind: 'editor', reason: 'Review.' } });
        assert.notEqual(stale.status, 200);
        assert.match(stale.body.error, /stale/i);
        const applyBody = { ...body, operationId: 'route-rebase', provenance: { kind: 'editor', reason: 'Review.' } };
        const applied = await request(`/api/techniques/${id}/personal-reset`, 'POST', applyBody);
        assert.equal(applied.status, 200);
        assert.equal(player.techniques.find(entry => entry.techniqueId === id).definitionRevision, 2);
        const replay = await request(`/api/techniques/${id}/personal-reset`, 'POST', applyBody);
        assert.deepEqual(replay.body.receipt, applied.body.receipt);
    }));
});

test('HTTP mechanics preview evaluates percent-only status modifiers without fabricating fixed values', async () => {
    await withTechniqueWorld(async world => withApi(world, async request => {
        const revision = { revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'ward', kind: 'buff', status: { name: 'Ward', description: 'A percentage ward.', duration: 3, attributes: [{ attribute: 'strength', percentModifier: 5 }], skills: [{ skill: 'Spellcasting', percentModifier: -5 }] } }] };
        const result = await request('/api/techniques/preview', 'POST', { actorId: world.player.id, mechanics: revision });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.deepEqual(result.body.mechanics.effects[0].status.attributes, [{ attribute: 'strength', percentModifier: 5 }]);
        assert.deepEqual(result.body.mechanics.effects[0].status.skills, [{ skill: 'Spellcasting', percentModifier: -5 }]);
    }));
});
