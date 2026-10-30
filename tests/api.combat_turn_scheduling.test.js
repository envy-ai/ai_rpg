const test = require('node:test');
const assert = require('node:assert/strict');
const Player = require('../Player.js');
const TechniqueService = require('../TechniqueService.js');
const { receiptInvocation } = require('../TechniquePrompt.js');
const { mechanics, addDefinition, learn, withTechniqueWorld } = require('./helpers/techniqueIntegrationFixtures.js');

const {
    assertActorCanInitiateAttack,
    collectSuccessfulNpcAttackActorIds,
    getCombatActionUnavailableReason
} = require('../api.js');

test('combat action availability rejects dead and incapacitated attackers', () => {
    const living = { id: 'char_living', name: 'Living Raider', isDead: false, health: 1 };
    const dead = { id: 'char_dead', name: 'Dead Raider', isDead: true, health: 0 };
    const incapacitated = { id: 'char_incapacitated', name: 'Fallen Guard', isDead: false, health: 0 };

    assert.equal(getCombatActionUnavailableReason(living), null);
    assert.equal(getCombatActionUnavailableReason(dead), 'dead');
    assert.equal(getCombatActionUnavailableReason(incapacitated), 'incapacitated');
    assert.equal(assertActorCanInitiateAttack(living, { toolName: 'resolveAttack' }), living);
    assert.throws(
        () => assertActorCanInitiateAttack(dead, { toolName: 'resolveAttack' }),
        /resolveAttack attacker "Dead Raider" cannot attack because the actor is dead/
    );
    assert.throws(
        () => assertActorCanInitiateAttack(incapacitated, { toolName: 'resolveAreaAttack' }),
        /resolveAreaAttack attacker "Fallen Guard" cannot attack because the actor is incapacitated/
    );
});

test('successful NPC attack tools identify actors to exclude from post-player NPC turns', () => {
    const actors = new Map([
        ['ash', { id: 'char_ash', name: 'QA Ash Beetle', isNPC: true }],
        ['shieldhand', { id: 'char_shield', name: 'QA Shieldhand', isNPC: true }],
        ['baato', { id: 'char_player', name: 'Baato', isNPC: false }],
        ['failed', { id: 'char_failed', name: 'Failed Attacker', isNPC: true }]
    ]);
    const invocations = [
        {
            name: 'resolveAttack',
            metadata: { attacker: 'Ash', hit: true }
        },
        {
            name: 'resolveAreaAttack',
            metadata: { summary: { attacker: { name: 'Shieldhand' } }, hitCount: 2 }
        },
        {
            name: 'resolveAttack',
            metadata: { attacker: 'Failed', error: true }
        },
        {
            name: 'resolveAttack',
            metadata: { attacker: 'player', hit: true }
        },
        {
            name: 'resolveAttack',
            metadata: { attacker: 'Baato', hit: true }
        },
        {
            name: 'resolveSkillCheck',
            metadata: { actor: 'Ash' }
        },
        {
            name: 'resolveAttack',
            metadata: { attacker: 'Ash', cached: true }
        }
    ];

    const ids = collectSuccessfulNpcAttackActorIds(
        invocations,
        name => actors.get(name.trim().toLowerCase()) || null
    );

    assert.deepEqual(Array.from(ids).sort(), ['char_ash', 'char_shield']);
});

test('successful NPC attack actor collection rejects corrupt unresolved metadata', () => {
    assert.throws(
        () => collectSuccessfulNpcAttackActorIds([
            { name: 'resolveAttack', metadata: { attacker: 'Missing Raider' } }
        ], () => null),
        /references unresolved attacker "Missing Raider"/
    );
});

test('committed NPC technique misses and helpful uses consume only their recorded turn opportunity', async () => {
    await withTechniqueWorld(async ({ npc, target }) => {
        addDefinition('technique-scheduler-miss', mechanics({
            target: 'single',
            check: { kind: 'skill', skill: 'Strength', difficulty: 'Easy' },
            effects: [{ id: 'strike', kind: 'damage', amount: 4, damageMode: 'technique' }]
        }));
        addDefinition('technique-scheduler-aid', mechanics({
            effects: [{ id: 'aid', kind: 'healing', amount: 2 }]
        }));
        learn(npc, 'technique-scheduler-miss');
        learn(npc, 'technique-scheduler-aid');

        const miss = await TechniqueService.execute({
            operationId: 'scheduler-technique-miss', turnId: 'player-turn-42', actor: npc,
            techniqueId: 'technique-scheduler-miss', targetIds: [target.id],
            prepareCheck: async () => ({ success: false, roll: 2 })
        });
        assert.equal(miss.committed, true);
        assert.equal(miss.success, false);
        assert.equal(miss.effects[0].success, false);

        const aid = await TechniqueService.execute({
            operationId: 'scheduler-technique-aid', turnId: 'player-turn-42', actor: npc,
            techniqueId: 'technique-scheduler-aid', targetIds: [npc.id]
        });
        assert.equal(aid.committed, true);
        assert.equal(aid.effects[0].kind, 'healing');
        assert.equal(aid.effects[0].success, true);

        const missInvocation = receiptInvocation(miss, 'Missed practiced strike.');
        const aidInvocation = receiptInvocation(aid, 'Used a helpful technique.');
        const resolver = id => Player.getById(id);
        assert.deepEqual(
            [...collectSuccessfulNpcAttackActorIds([missInvocation, aidInvocation], resolver, { turnId: 'player-turn-42' })],
            [npc.id],
            'misses and committed non-damaging techniques both use the actor’s current action opportunity'
        );
        assert.equal(
            collectSuccessfulNpcAttackActorIds([missInvocation], resolver, { turnId: 'later-player-turn' }).size,
            0,
            'a saved old receipt does not exclude a later scheduled opportunity'
        );

        const invalid = {
            ...missInvocation,
            id: 'rejected-technique-attempt',
            metadata: { ...missInvocation.metadata, error: true, techniqueReceipt: { ...miss, committed: false } }
        };
        assert.equal(TechniqueService.getReceipt('rejected-technique-attempt'), null);
        assert.equal(collectSuccessfulNpcAttackActorIds([invalid], resolver, { turnId: 'player-turn-42' }).size, 0);
    });
});
