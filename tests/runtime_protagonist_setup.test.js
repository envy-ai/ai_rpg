'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const RuntimeProtagonistSetup = require('../RuntimeProtagonistSetup');

test('reviewed protagonist initialization preserves abilities and prepares canonical player choices', async () => {
    const player = { abilities: ['Previously chosen ability'], setAbilities() { throw new Error('Initialization must not replace chosen player abilities.'); } };
    const pending = { pending: true, level: 1, options: ['Steady Voice', 'Sure Step'] };
    const recorded = [];
    const sequence = [];
    const scope = {
        config: {},
        getActiveSettingSnapshot() { return {}; },
        async generateInventoryForCharacter({ character, location }) {
            assert.equal(character, player);
            assert.equal(location.id, 'room');
            sequence.push('inventory');
        },
        requestNpcAbilityAssignments() { throw new Error('Player initialization must not run an NPC XML post-generation prompt.'); },
        async generateStartingTechniques({ actors, location }) {
            assert.deepEqual(actors, [player]);
            assert.equal(location.id, 'room');
            assert.equal(sequence.at(-1), 'abilities');
            sequence.push('techniques');
        },
        async resolvePlayerAbilitySelectionState(actualPlayer, options) {
            assert.equal(actualPlayer, player);
            assert.equal(options.ensureOptionsForNext, true);
            sequence.push('abilities');
            return pending;
        }
    };
    const stages = { standingsReady: true };
    const setup = new RuntimeProtagonistSetup(scope);
    const result = await setup.initialize(player, { id: 'room' }, {}, {
        stages, record: async stage => { recorded.push(stage); stages[stage] = true; }
    });
    sequence.push('intro');
    assert.equal(result, pending);
    assert.deepEqual(player.abilities, ['Previously chosen ability']);
    assert.deepEqual(recorded, ['inventoryReady', 'abilitiesReady', 'techniquesReady']);
    assert.deepEqual(sequence, ['inventory', 'abilities', 'techniques', 'intro']);
    await setup.initialize(player, { id: 'room' }, {}, { stages, record: async stage => recorded.push(stage) });
    assert.equal(sequence.filter(entry => entry === 'techniques').length, 1);
});

test('a failed player choice preparation propagates its original error without recording readiness', async () => {
    const original = new Error('Canonical ability offer generation failed.');
    const recorded = [];
    const setup = new RuntimeProtagonistSetup({
        async resolvePlayerAbilitySelectionState() { throw original; },
        async generateStartingTechniques() { assert.fail('Technique initialization must wait for ability initialization.'); }
    });
    await assert.rejects(setup.initialize({}, {}, {}, {
        stages: { standingsReady: true, inventoryReady: true }, record: async stage => recorded.push(stage)
    }), error => error === original);
    assert.deepEqual(recorded, []);
});

test('starting-technique failure leaves its stage pending and setup retry records it after success', async () => {
    const original = new Error('Starting technique provider canceled.');
    const player = { id: 'runtime-retry-player', abilities: [] };
    const stages = { standingsReady: true, inventoryReady: true, protagonistConstructed: player.id };
    const recorded = [];
    let generationCalls = 0;
    const scope = {
        config: {},
        getActiveSettingSnapshot() { return {}; },
        async resolvePlayerAbilitySelectionState() { return { pending: true }; },
        async generateStartingTechniques() {
            generationCalls += 1;
            if (generationCalls === 1) throw original;
            return [];
        }
    };
    const setup = new RuntimeProtagonistSetup(scope);
    const record = async stage => { recorded.push(stage); stages[stage] = true; };
    await assert.rejects(setup.initialize(player, {}, {}, { stages, record }), error => error === original);
    assert.equal(stages.abilitiesReady, true);
    assert.equal(stages.techniquesReady, undefined, 'failed generation must not write its completion marker');
    assert.deepEqual(recorded, ['abilitiesReady']);

    await setup.initialize(player, {}, {}, { stages, record });
    assert.equal(stages.techniquesReady, true);
    assert.deepEqual(recorded, ['abilitiesReady', 'techniquesReady']);
    assert.equal(generationCalls, 2);
});

test('selected existing protagonists resume only their own unfinished constructed setup', () => {
    const player = { id: 'selected-existing' };
    assert.equal(RuntimeProtagonistSetup.shouldResumeInitialization(player, {}), false, 'a selected existing protagonist has no construction marker');
    assert.equal(RuntimeProtagonistSetup.shouldResumeInitialization(player, { protagonistConstructed: 'another-player' }), false);
    assert.equal(RuntimeProtagonistSetup.shouldResumeInitialization(player, { protagonistConstructed: player.id, abilitiesReady: true, techniquesReady: false }), true);
    assert.equal(RuntimeProtagonistSetup.shouldResumeInitialization(player, { protagonistConstructed: player.id, abilitiesReady: false, techniquesReady: true }), true);
    assert.equal(RuntimeProtagonistSetup.shouldResumeInitialization(player, { protagonistConstructed: player.id, abilitiesReady: true, techniquesReady: true }), false);
});
