'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Player = require('../Player.js');
const TechniqueService = require('../TechniqueService.js');
const StatusEffect = require('../StatusEffect.js');
const { withTempPlayerEnvironment } = require('./helpers/needBarFixtures.js');
const { withTechniqueWorld, mechanics, addDefinition, learn } = require('./helpers/techniqueIntegrationFixtures.js');

const ability = { id: 'sturdy', name: 'Sturdy Frame', description: 'Tougher and stronger.', type: 'Passive', level: 1 };
const effect = { id: 'sturdy-status', name: 'Sturdy Frame', description: 'Tougher and stronger.', duration: -1, maxHealthPercent: 20, attributes: [{ attribute: 'strength', modifier: 2, percentModifier: 10 }], skills: [{ skill: 'Spellcasting', modifier: 2, percentModifier: -10 }] };

test('attachment drafts tolerate resource and unrelated catalogue changes before application', async () => {
    await withTechniqueWorld(({ player }) => {
        player.setAbilities([ability]);
        const preview = TechniqueService.previewAbilityAttachmentBatch({ actor: player,
            entries: [{ abilityId: ability.id, statusEffects: [effect] }] });
        player.setHealth(1);
        player.setNeedBarValue('mana', 10);
        addDefinition('unrelated-attachment-technique', mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 2 }] }));
        TechniqueService.applyAbilityAttachmentBatch({ actor: player, entries: preview.entries, expected: preview.expected });
        assert.equal(player.getAbilities()[0].statusEffects[0].id, effect.id);
        assert.ok(TechniqueService.getDefinition('unrelated-attachment-technique'));
    }, { includeMana: true });
});

test('attachment drafts remain bound to their character and game', async () => {
    await withTechniqueWorld(({ player, npc }) => {
        player.setAbilities([ability]);
        npc.setAbilities([ability]);
        const preview = TechniqueService.previewAbilityAttachmentBatch({ actor: player,
            entries: [{ abilityId: ability.id, statusEffects: [effect] }] });
        assert.throws(() => TechniqueService.applyAbilityAttachmentBatch({ actor: npc,
            entries: preview.entries, expected: preview.expected }), /changed after generation/);
        TechniqueService.reset();
        assert.throws(() => TechniqueService.applyAbilityAttachmentBatch({ actor: player,
            entries: preview.entries, expected: preview.expected }), /changed after generation/);
        assert.deepEqual(player.getAbilities()[0].statusEffects, []);
        assert.deepEqual(npc.getAbilities()[0].statusEffects, []);
    }, { includeMana: true });
});

test('owned health and signed fixed plus percentage modifiers reconcile once and round trip', () => {
    withTempPlayerEnvironment({ prefix: 'ability-attachment-', attributes: [{ id: 'constitution', label: 'Constitution', default: 10 }, { id: 'strength', label: 'Strength', default: 10 }] }, () => {
        const player = new Player({ id: 'attachment-health', name: 'Fixture', attributes: { constitution: 10, strength: 10 } });
        player.setSkillValue('Spellcasting', 10);
        player.setHealth(10);
        player.setAbilities([{ ...ability, statusEffects: [effect] }]);
        assert.equal(player.maxHealth, 24);
        assert.equal(player.health, 14);
        assert.ok(Math.abs(player.getModifiedAttribute('strength') - 13.2) < 1e-9);
        assert.ok(Math.abs(player.getSkillModifiers('Spellcasting').reduce((sum, entry) => sum + entry.modifier, 0) - 0.8) < 1e-9);
        for (let i = 0; i < 3; i++) { assert.equal(player.maxHealth, 24); assert.equal(player.health, 14); }
        const saved = player.toJSON();
        const restored = Player.fromJSON(saved);
        assert.equal(restored.health, 14);
        assert.equal(restored.maxHealth, 24);
        assert.ok(Math.abs(restored.getModifiedAttribute('strength') - 13.2) < 1e-9);
        assert.deepEqual(restored.getAbilities()[0].statusEffects[0], player.getAbilities()[0].statusEffects[0]);
        restored.setAbilities([]);
        assert.equal(restored.maxHealth, 20);
        assert.equal(restored.health, 14);
    });
});

test('status source disappears after removal or expiry while independently learned knowledge remains, and prepared use rejects stale source', async () => {
    await withTechniqueWorld(async ({ player }) => {
        addDefinition('attachment-ward', mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 2 }] }));
        const status = { id: 'grant-status', name: 'Granted Ward', description: 'A temporary ward.', duration: 1, techniqueGrants: [{ id: 'grant-ward', sourceStatusId: 'grant-status', techniqueId: 'attachment-ward', definitionRevision: 1 }] };
        player.addStatusEffect(status);
        let group = TechniqueService.getAvailable(player, { includeBlocked: true }).find(item => item.techniqueId === 'attachment-ward');
        assert.equal(group.sources[0].sourceKind, 'status');
        const sourceId = group.sources[0].sourceId;
        const prepared = await TechniqueService.prepare({ operationId: 'status-grant-prepared', turnId: 'turn-status', actor: player, techniqueId: 'attachment-ward', sourceId });
        player.removeStatusEffect('Granted Ward');
        assert.throws(() => TechniqueService.commit(prepared), /no longer available/);
        assert.equal(TechniqueService.getAvailable(player, { includeBlocked: true }).some(item => item.techniqueId === 'attachment-ward'), false);
        player.addStatusEffect(status);
        learn(player, 'attachment-ward');
        player.tickStatusEffects(1);
        player.clearExpiredStatusEffects();
        group = TechniqueService.getAvailable(player, { includeBlocked: true }).find(item => item.techniqueId === 'attachment-ward');
        assert.deepEqual(group.sources.map(source => source.sourceKind), ['learned']);
    });
});

test('preview is detached, stale apply and invalid reference reject without catalogue or actor changes', async () => {
    await withTechniqueWorld(({ player }) => {
        player.setSkillValue('Spellcasting', 3);
        player.setAbilities([ability]);
        addDefinition('attachment-ward', mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 2 }] }));
        const draft = [{ abilityId: 'sturdy', statusEffects: [{ ...effect, techniqueEntries: [{ techniqueId: 'attachment-ward', definitionRevision: 1 }] }] }];
        const before = JSON.stringify(TechniqueService.toJSON()), original = player.getAbilities();
        const preview = TechniqueService.previewAbilityAttachmentBatch({ actor: player, entries: draft });
        assert.equal(JSON.stringify(TechniqueService.toJSON()), before);
        assert.deepEqual(player.getAbilities(), original);
        assert.throws(() => TechniqueService.previewAbilityAttachmentBatch({ actor: player, entries: [{ abilityId: 'sturdy', statusEffects: [{ ...effect, techniqueEntries: [{ techniqueId: 'missing' }] }] }] }), /Unknown attached technique/);
        assert.equal(JSON.stringify(TechniqueService.toJSON()), before);
        player.setAbilities([{ ...ability, description: 'Changed after preview.' }]);
        const changed = player.getAbilities();
        assert.throws(() => TechniqueService.applyAbilityAttachmentBatch({ actor: player, entries: preview.entries, expected: preview.expected }), /changed after generation/);
        assert.deepEqual(player.getAbilities(), changed);
        assert.equal(JSON.stringify(TechniqueService.toJSON()), before);
    });
});

test('attachment preflight reports independent invalid references without installing any draft', async () => {
    await withTechniqueWorld(({ player }) => {
        player.setAbilities([ability]);
        const before = player.getAbilities();
        const catalogueBefore = TechniqueService.toJSON();
        const statuses = [
            { ...effect, techniqueEntries: [{ techniqueId: 'missing-one' }] },
            { ...effect, id: 'other-status', techniqueEntries: [{ techniqueId: 'missing-two' }] }
        ];
        assert.throws(() => TechniqueService.previewAbilityAttachmentBatch({ actor: player, entries: [{ abilityId: ability.id, statusEffects: statuses }] }), error => {
            assert.match(error.message, /missing-one/);
            assert.match(error.message, /missing-two/);
            return true;
        });
        assert.deepEqual(player.getAbilities(), before);
        assert.deepEqual(TechniqueService.toJSON(), catalogueBefore);
    });
});

test('status modifier validation preserves both magnitudes and rejects invalid values', () => {
    const status = new StatusEffect({ description: 'Test', attributes: [{ attribute: 'strength', modifier: -2, percentModifier: -10 }], skills: [{ skill: 'Spellcasting', percentModifier: 15 }], maxHealthPercent: -20 });
    assert.deepEqual(status.toJSON().attributes, [{ attribute: 'strength', modifier: -2, percentModifier: -10 }]);
    assert.equal(status.toJSON().skills[0].percentModifier, 15);
    assert.throws(() => new StatusEffect({ description: 'Bad', maxHealthPercent: 'not-a-number' }), /maxHealthPercent/);
});

test('candidate preview stages a definition and owned status grant; apply installs and removal revokes it', async () => {
    await withTechniqueWorld(({ player }) => {
        player.setAbilities([ability]);
        const candidate = { name: 'Attached Mend', description: 'A stored healing action.', semanticKey: 'attached-mend', disciplineId: 'discipline-integration', aliases: [], revisions: [mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 2 }] })] };
        const entries = [{ abilityId: 'sturdy', statusEffects: [{ id: 'owned-status', name: 'Ward', description: 'Grants a mend.', duration: -1, techniqueEntries: [{ id: 'owned-grant', candidate }] }] }];
        const before = TechniqueService.toJSON();
        const preview = TechniqueService.previewAbilityAttachmentBatch({ actor: player, entries, origin: 'editor' });
        assert.equal(preview.newDefinitions.length, 1);
        assert.deepEqual(TechniqueService.toJSON(), before);
        TechniqueService.applyAbilityAttachmentBatch({ actor: player, entries: preview.entries, expected: preview.expected, origin: 'editor' });
        const id = preview.newDefinitions[0].id;
        const available = TechniqueService.getAvailable(player, { includeBlocked: true }).find(entry => entry.techniqueId === id);
        assert.equal(available.sources[0].sourceKind, 'status');
        assert.equal(available.sources[0].abilityId, 'sturdy');
        assert.equal(player.getAbilities()[0].statusEffects[0].techniqueGrants[0].id, 'owned-grant');
        player.setAbilities([]);
        assert.equal(TechniqueService.getAvailable(player, { includeBlocked: true }).some(entry => entry.techniqueId === id), false);
    });
});

test('save validation rejects dangling owned status grant before changing the live catalogue', async () => {
    await withTechniqueWorld(({ player }) => {
        const savedWorld = TechniqueService.toJSON();
        const invalidActor = { ...player.toJSON(), abilities: [{ ...ability, statusEffects: [{ id: 'bad-status', description: 'Invalid reference.', duration: -1, techniqueGrants: [{ id: 'bad-grant', sourceStatusId: 'bad-status', techniqueId: 'missing-technique', definitionRevision: 1 }] }] }] };
        assert.throws(() => TechniqueService.validateState(savedWorld, { actors: [invalidActor] }), /missing|unknown/i);
        assert.deepEqual(TechniqueService.toJSON(), savedWorld);
        assert.deepEqual(player.getAbilities(), []);
    });
});

test('technique-applied grants have unique stacked sources, survive save, and refresh without collisions', async () => {
    await withTechniqueWorld(async ({ player }) => {
        addDefinition('granted-mend', mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 2 }] }));
        const grantEffect = stacking => ({ id: 'grant-effect', kind: 'buff', stacking, refreshPolicy: 'replace', status: {
            name: `${stacking} grant`, description: 'Temporarily grants a technique.', duration: 5,
            techniqueGrants: [{ id: 'template-grant', techniqueId: 'granted-mend', definitionRevision: 1 }]
        } });
        addDefinition('grant-stacking', mechanics({ effects: [grantEffect('stack')] }));
        addDefinition('grant-refreshing', mechanics({ effects: [grantEffect('refresh')] }));
        learn(player, 'grant-stacking');
        learn(player, 'grant-refreshing');
        const use = (techniqueId, operationId) => TechniqueService.execute({ actor: player, techniqueId, operationId, turnId: `turn-${operationId}` });
        await use('grant-stacking', 'stack-one');
        await use('grant-stacking', 'stack-two');
        let statuses = player.getIntrinsicStatusEffects().filter(entry => entry.techniqueProvenance?.techniqueId === 'grant-stacking');
        assert.equal(statuses.length, 2);
        assert.notEqual(statuses[0].techniqueGrants[0].id, statuses[1].techniqueGrants[0].id);
        const sources = TechniqueService.getAvailable(player, { includeBlocked: true }).find(entry => entry.techniqueId === 'granted-mend').sources;
        assert.equal(sources.length, 2);
        assert.equal(new Set(sources.map(source => source.sourceId)).size, 2);
        assert.ok(sources.every(source => source.sourceKind === 'status' && source.definitionRevision === 1));
        const saved = player.toJSON();
        TechniqueService.validateState(TechniqueService.toJSON(), { actors: [saved] });
        await use('grant-refreshing', 'refresh-one');
        await use('grant-refreshing', 'refresh-two');
        statuses = player.getIntrinsicStatusEffects().filter(entry => entry.techniqueProvenance?.techniqueId === 'grant-refreshing');
        assert.equal(statuses.length, 1);
        const afterRefresh = TechniqueService.getAvailable(player, { includeBlocked: true }).find(entry => entry.techniqueId === 'granted-mend').sources;
        assert.equal(afterRefresh.length, 3);
        assert.equal(new Set(afterRefresh.map(source => source.sourceId)).size, 3);
        const grants = actor => actor.getIntrinsicStatusEffects().flatMap(status => status.techniqueGrants).sort((a, b) => a.id.localeCompare(b.id));
        const expectedGrants = grants(player);
        const restored = Player.fromJSON(player.toJSON());
        assert.deepEqual(grants(restored), expectedGrants);
    });
});

test('detached pending drafts round trip and only the selected candidate is committed without reauthoring', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const { authorNewAbilityAttachments } = require('../AbilityAttachmentAuthoring.js');
        const choices = [ability, { ...ability, id: 'other', name: 'Other Choice' }];
        player.setPendingAbilityOptionsForLevel(1, choices);
        const beforeWorld = TechniqueService.toJSON();
        const drafts = choices.map(choice => {
            const candidate = { name: `${choice.name} Technique`, description: 'A proposed action.', semanticKey: `${choice.id}-technique`, disciplineId: 'discipline-integration', aliases: [], revisions: [mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name: 'Ward', description: 'Protective.', duration: 5, attributes: [{ attribute: 'strength', modifier: 1 }] } }] })] };
            const preview = TechniqueService.previewAbilityAttachmentBatch({ actor: player, pendingAbility: choice, entries: [{ abilityId: choice.id, statusEffects: [{ name: 'Ward', description: 'A proposed ward.', duration: -1, attributes: [{ attribute: 'strength', modifier: 2, percentModifier: 10 }], techniqueEntries: [{ candidate }] }] }] });
            return { abilityId: choice.id, draft: { statusEffects: preview.entries[0].statusEffects } };
        });
        player.setPendingAbilityAttachmentDraftsForLevel(1, drafts);
        assert.deepEqual(TechniqueService.toJSON(), beforeWorld);
        assert.deepEqual(player.getAbilities(), []);
        const restored = Player.fromJSON(player.toJSON());
        assert.deepEqual(restored.getPendingAbilityAttachmentDraftsForLevel(1), drafts);
        restored.setAbilities([choices[0]]);
        const LLMClient = require('../LLMClient.js');
        const previous = LLMClient.chatCompletion;
        LLMClient.chatCompletion = async () => { throw new Error('Unexpected reauthoring'); };
        try {
            await authorNewAbilityAttachments({ actor: restored, abilityIds: [choices[0].id], draftsByAbilityId: { [choices[0].id]: drafts[0].draft } });
        } finally { LLMClient.chatCompletion = previous; }
        const ownedStatus = restored.getAbilities()[0].statusEffects[0];
        assert.equal(ownedStatus.id, drafts[0].draft.statusEffects[0].id);
        assert.deepEqual(ownedStatus.attributes, drafts[0].draft.statusEffects[0].attributes);
        const definitions = TechniqueService.toJSON().definitions;
        assert.ok(definitions.some(definition => definition.name === 'Sturdy Frame Technique'));
        assert.ok(!definitions.some(definition => definition.name === 'Other Choice Technique'));
    });
});

test('invalid pending attachment data is rejected without changing the stored drafts', async () => {
    await withTechniqueWorld(({ player }) => {
        player.setPendingAbilityOptionsForLevel(1, [ability]);
        player.setPendingAbilityAttachmentDraftsForLevel(1, [{ abilityId: ability.id, draft: { statusEffects: [] } }]);
        const before = player.toJSON(), world = TechniqueService.toJSON();
        assert.throws(() => player.setPendingAbilityAttachmentDraftsForLevel(1, [{ abilityId: 'unknown', draft: { statusEffects: [] } }]), /invalid pending/i);
        assert.throws(() => player.setPendingAbilityAttachmentDraftsForLevel(1, [{ abilityId: ability.id, draft: { statusEffects: 'invalid' } }]), /invalid pending/i);
        assert.deepEqual(player.toJSON(), before);
        assert.deepEqual(TechniqueService.toJSON(), world);
    });
});

test('malformed selected draft cannot mutate the actor or catalogue during commit', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const { authorNewAbilityAttachments } = require('../AbilityAttachmentAuthoring.js');
        player.setAbilities([ability]);
        const before = player.getAbilities(), world = TechniqueService.toJSON();
        const malformed = { statusEffects: [{ name: 'Broken', description: 'Invalid modifier.', duration: -1, attributes: [{ attribute: 'strength', modifier: 'bad' }] }] };
        await assert.rejects(authorNewAbilityAttachments({ actor: player, abilityIds: [ability.id], draftsByAbilityId: { [ability.id]: malformed } }), /modifier|number|finite/i);
        assert.deepEqual(player.getAbilities(), before);
        assert.deepEqual(TechniqueService.toJSON(), world);
    });
});

test('ability status grants expose scoped discipline access only while the ability is active', async () => {
    await withTechniqueWorld(({ player }) => {
        TechniqueService.addDiscipline({ id: 'private-ability-discipline', name: 'Secret Practice', description: 'Restricted training.', publicAccess: false });
        TechniqueService.addDefinition({ id: 'private-ability-technique', disciplineId: 'private-ability-discipline', name: 'Gifted Ward', description: 'An ability-granted action.', semanticKey: 'gifted-ward', aliases: [], provenance: { kind: 'generation', reason: 'Ability test.' }, revisions: [mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 2 }] })] }, { origin: 'editor' });
        for (const suffix of ['learn', 'after-removal']) TechniqueService.addDefinition({ id: `private-ability-${suffix}`, disciplineId: 'private-ability-discipline', name: `Secret ${suffix}`, description: 'Another private action.', semanticKey: `secret-${suffix}`, aliases: [], provenance: { kind: 'generation', reason: 'Ability test.' }, revisions: [mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 2 }] })] }, { origin: 'editor' });
        TechniqueService.addDiscipline({ id: 'dependent-ability-discipline', name: 'Dependent Practice', description: 'Requires the private practice.', publicAccess: false, accessRequirements: [{ kind: 'discipline', id: 'private-ability-discipline' }] });
        TechniqueService.addDefinition({ id: 'dependent-ability-technique', disciplineId: 'dependent-ability-discipline', name: 'Dependent Ward', description: 'A dependent action.', semanticKey: 'dependent-ward', aliases: [], provenance: { kind: 'generation', reason: 'Ability test.' }, revisions: [mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 2 }] })] }, { origin: 'editor' });
        const attached = { ...ability, statusEffects: [{ id: 'ability-gift-status', name: 'Gift', description: 'Ability grants a ward.', duration: -1, techniqueGrants: [{ id: 'ability-gift', sourceStatusId: 'ability-gift-status', techniqueId: 'private-ability-technique', definitionRevision: 1 }] }] };
        player.setAbilities([attached]);
        const context = () => TechniqueService.getPromptContext([player])[0].disciplineAccess.filter(entry => entry.id === 'private-ability-discipline');
        assert.deepEqual(context(), [{ id: 'private-ability-discipline', name: 'Secret Practice', description: 'Restricted training.', sourceKind: 'ability_status', sourceId: `status:${player.id}:ability-gift`, statusId: 'ability-gift-status', abilityId: 'sturdy', abilityName: 'Sturdy Frame' }]);
        assert.equal(player.disciplineAccess.some(entry => entry.disciplineId === 'private-ability-discipline'), false);
        assert.ok(TechniqueService.getEffectiveDisciplineAccess(player).some(entry => entry.id === 'dependent-ability-discipline'));
        TechniqueService.learn({ operationId: 'ordinary-ability-access', actor: player, techniqueId: 'private-ability-learn', provenance: { kind: 'training', reason: 'Ordinary independent training.' } });
        TechniqueService.learn({ operationId: 'dependent-ability-access', actor: player, techniqueId: 'dependent-ability-technique', provenance: { kind: 'training', reason: 'Practice built on the gift.' } });
        assert.equal(player.techniques.some(entry => entry.techniqueId === 'private-ability-learn'), true);
        assert.equal(player.disciplineAccess.some(entry => entry.disciplineId === 'private-ability-discipline'), false);
        player.setAbilities([]);
        player.setSkillValue('Spellcasting', 5);
        assert.deepEqual(context(), []);
        assert.equal(TechniqueService.getEffectiveDisciplineAccess(player).some(entry => entry.id === 'dependent-ability-discipline'), false);
        assert.equal(player.disciplineAccess.some(entry => entry.disciplineId === 'private-ability-discipline'), false);
        assert.throws(() => TechniqueService.learn({ operationId: 'access-after-ability-removal', actor: player, techniqueId: 'private-ability-after-removal', provenance: { kind: 'training', reason: 'Ordinary independent training.' } }), /access/i);
    });
});

test('compact attachment draft IDs survive hydration and re-preview without collisions', async () => {
    const IdGenerator = require('../IdGenerator.js');
    IdGenerator.reset();
    try {
        await withTechniqueWorld(({ player }) => {
            player.setAbilities([{ name: 'New Talent', description: 'A new talent.', type: 'Passive', level: 1 }, { ...ability, id: 'ability_legacy-a1b2' }]);
            const [owned, legacy] = player.getAbilities();
            assert.equal(owned.id, 'ability_new_talent');
            assert.equal(legacy.id, 'ability_legacy-a1b2');
            const entries = [{ abilityId: owned.id, statusEffects: [{ name: 'Warding', description: 'Grants an action.', duration: -1, techniqueEntries: [{ candidate: { name: 'Private Ward', description: 'A defensive action.', semanticKey: 'private-ward', aliases: [], revisions: [mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name: 'Ward', description: 'A ward.', duration: 1, attributes: [{ attribute: 'strength', modifier: 1 }] } }] })] }, candidateDiscipline: { name: 'Private Practice', description: 'A private practice.', publicAccess: false, accessRequirements: [] } }] }] }];
            const preview = TechniqueService.previewAbilityAttachmentBatch({ actor: player, entries, origin: 'editor' });
            const status = preview.entries[0].statusEffects[0], proposed = status.techniqueEntries[0];
            assert.equal(status.id, 'status_warding');
            assert.equal(proposed.candidate.id, 'technique_private_ward');
            assert.equal(proposed.candidateDiscipline.id, 'discipline_private_practice');
            const again = TechniqueService.previewAbilityAttachmentBatch({ actor: player, entries: preview.entries, origin: 'editor' });
            assert.equal(again.entries[0].statusEffects[0].id, status.id);
            assert.equal(again.entries[0].statusEffects[0].techniqueEntries[0].candidate.id, proposed.candidate.id);
            assert.equal(again.entries[0].statusEffects[0].techniqueEntries[0].candidateDiscipline.id, proposed.candidateDiscipline.id);
            player.setPendingAbilityOptionsForLevel(1, [owned]);
            player.setPendingAbilityAttachmentDraftsForLevel(1, [{ abilityId: owned.id, draft: { statusEffects: preview.entries[0].statusEffects } }]);
            const saved = JSON.parse(JSON.stringify(player.toJSON()));
            TechniqueService.applyAbilityAttachmentBatch({ actor: player, entries: preview.entries, expected: preview.expected, origin: 'editor' });
            assert.equal(player.getAbilities().find(item => item.id === owned.id).statusEffects[0].id, status.id);
            assert.equal(TechniqueService.getDefinition(proposed.candidate.id).disciplineId, proposed.candidateDiscipline.id);
            IdGenerator.reset();
            const restored = Player.fromJSON(saved);
            assert.deepEqual(restored.getPendingAbilityAttachmentDraftsForLevel(1), saved.pendingAbilityAttachmentDraftsByLevel['1']);
            assert.notEqual(IdGenerator.next('ability', 'New Talent'), owned.id);
            assert.notEqual(IdGenerator.next('status', 'Warding'), status.id);
            assert.notEqual(IdGenerator.next('technique', 'Private Ward'), proposed.candidate.id);
            assert.notEqual(IdGenerator.next('discipline', 'Private Practice'), proposed.candidateDiscipline.id);
        });
    } finally { IdGenerator.reset(); }
});

test('attachment preview reuses one normalized new discipline across staged candidates', async () => {
    const IdGenerator = require('../IdGenerator.js');
    IdGenerator.reset();
    try {
        await withTechniqueWorld(({ player }) => {
            player.setAbilities([ability]);
            const makeCandidate = name => ({
                name,
                description: 'A defensive practice.',
                semanticKey: name.toLowerCase().replaceAll(' ', '-'),
                aliases: [],
                revisions: [mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name, description: 'A ward.', duration: 1, attributes: [{ attribute: 'strength', modifier: 1 }] } }] })]
            });
            const entries = [{ abilityId: ability.id, statusEffects: [{
                name: 'Warding', description: 'Grants two actions.', duration: -1,
                techniqueEntries: [
                    { candidate: makeCandidate('Quiet Ward'), candidateDiscipline: { name: 'Private Practice', description: 'A private practice.', publicAccess: false, accessRequirements: [] } },
                    { candidate: makeCandidate('Steady Ward'), candidateDiscipline: { name: 'Private--Practice', description: 'A private practice.', publicAccess: false, accessRequirements: [] } }
                ]
            }] }];

            const preview = TechniqueService.previewAbilityAttachmentBatch({ actor: player, entries, origin: 'editor' });
            const proposals = preview.entries[0].statusEffects[0].techniqueEntries;
            assert.equal(proposals[0].candidateDiscipline.id, 'discipline_private_practice');
            assert.equal(proposals[1].candidateDiscipline.id, proposals[0].candidateDiscipline.id);
            assert.equal(TechniqueService.getDisciplines().some(item => item.id === 'discipline_private_practice'), false, 'preview leaves catalogue state detached');

            TechniqueService.applyAbilityAttachmentBatch({ actor: player, entries: preview.entries, expected: preview.expected, origin: 'editor' });
            assert.equal(TechniqueService.getDisciplines().filter(item => item.id === 'discipline_private_practice').length, 1);
            assert.deepEqual(player.getAbilities()[0].statusEffects[0].techniqueGrants.map(grant => grant.techniqueId), proposals.map(proposal => proposal.techniqueId));
        });
    } finally { IdGenerator.reset(); }
});

test('new ability and status IDs do not collide with later explicit IDs in the same batch', async () => {
    const IdGenerator = require('../IdGenerator.js');
    IdGenerator.reset();
    try {
        await withTechniqueWorld(({ player }) => {
            player.setAbilities([
                { name: 'First', description: 'Generated identity.', type: 'Passive', level: 1, statusEffects: [{ name: 'First Status', description: 'A passive trait.', duration: -1, attributes: [{ attribute: 'strength', modifier: 1 }] }] },
                { ...ability, id: 'ability_1', statusEffects: [{ id: 'status_1', name: 'Reserved Status', description: 'A passive trait.', duration: -1, attributes: [{ attribute: 'strength', modifier: 1 }] }] }
            ]);
            const [first, reserved] = player.getAbilities();
            assert.notEqual(first.id, reserved.id);
            assert.equal(reserved.id, 'ability_1');
            assert.notEqual(first.statusEffects[0].id, reserved.statusEffects[0].id);
            assert.equal(reserved.statusEffects[0].id, 'status_1');
        });
    } finally { IdGenerator.reset(); }
});

test('ability attachment schema accepts unnamed permanent statuses accepted by real parser', async () => {
    await withTechniqueWorld(({ player }) => {
        const { parseAbilityAttachmentDraft } = require('../AbilityAttachmentAuthoring.js');
        const { loadXmlGenerationSchema } = require('../XmlGenerationSchema.js');
        const { XmlClosingTagGuard } = require('../XmlClosingTagGuard.js');
        player.setAbilities([ability]);
        const xml = '<abilityAttachments><statusEffects><statusEffect><description>A permanent trait.</description><duration>-1</duration><maxHealthPercent>10</maxHealthPercent></statusEffect></statusEffects></abilityAttachments>';
        assert.equal(parseAbilityAttachmentDraft(xml, { actor: player, abilityId: ability.id }).statusEffects.length, 1);
        assert.equal(new XmlClosingTagGuard({ schema: loadXmlGenerationSchema('ability-attachments.schema.xml') }).inspect(xml), null);
    }, { includeMana: true });
});
