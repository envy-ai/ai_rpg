const test = require('node:test');
const assert = require('node:assert/strict');

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
