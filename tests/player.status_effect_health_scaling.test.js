const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../Player.js');
const Globals = require('../Globals.js');
const {
    withTempPlayerEnvironment: withTempPlayerEnvironmentBase
} = require('./helpers/needBarFixtures.js');

function withTempPlayerEnvironment(run) {
    return withTempPlayerEnvironmentBase({
        prefix: 'ai-rpg-status-health-',
        attributes: [
            { id: 'constitution', label: 'Constitution', default: 10 },
            { id: 'strength', label: 'Strength', default: 5 }
        ], manageWorldTime: true
    }, () => { Globals.worldTime = { dayIndex: 0, timeMinutes: 0 }; return run(); });
}

test('status-effect-driven constitution increases preserve the current health ratio', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'status-health-buff',
            name: 'Baato',
            attributes: {
                constitution: 10,
                strength: 5
            }
        });

        assert.equal(player.maxHealth, 20);
        player.setHealth(10);

        player.addStatusEffect({
            name: 'Fortified',
            description: 'Constitution boosted.',
            duration: 5,
            attributes: [
                { attribute: 'constitution', modifier: 4 }
            ]
        });

        assert.equal(player.maxHealth, 24);
        assert.equal(player.health, 12);
    });
});

test('expiring a max-health buff preserves the current health ratio', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'status-health-expire',
            name: 'Cabnia',
            attributes: {
                constitution: 10,
                strength: 5
            }
        });

        player.setHealth(10);
        player.addStatusEffect({
            name: 'Fortified',
            description: 'Constitution boosted.',
            duration: 1,
            attributes: [
                { attribute: 'constitution', modifier: 4 }
            ]
        });

        assert.equal(player.maxHealth, 24);
        assert.equal(player.health, 12);

        player.tickStatusEffects(1);
        player.clearExpiredStatusEffects();

        assert.equal(player.maxHealth, 20);
        assert.equal(player.health, 10);
    });
});

test('removeStatusEffect removes intrinsic status effects by exact name or exact description', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'status-effect-removal',
            name: 'Exis',
            attributes: {
                constitution: 10,
                strength: 5
            },
            statusEffects: [
                {
                    name: 'Plasma Burn',
                    description: 'A plasma-inflicted wound continues to smolder.',
                    duration: 3
                },
                {
                    name: 'Claw Marks on Back',
                    description: 'Parallel scratches score the skin.',
                    duration: 121
                }
            ]
        });

        assert.equal(player.removeStatusEffect('Plasma Burn'), true);
        assert.deepEqual(
            player.getIntrinsicStatusEffects().map(effect => effect.name),
            ['Claw Marks on Back']
        );

        assert.equal(player.removeStatusEffect('Parallel scratches score the skin.'), true);
        assert.deepEqual(player.getIntrinsicStatusEffects(), []);
    });
});

test('new intrinsic status starts at current world time instead of stale actor elapsed time', () => {
    withTempPlayerEnvironment(() => {
        Globals.worldTime = { dayIndex: 0, timeMinutes: 480 };
        const actor = new Player({ id: 'status-world-clock', name: 'Clock Tester' });
        actor.addStatusEffect({ name: 'Recent', description: 'Just applied.', duration: 2 });
        assert.equal(actor.getIntrinsicStatusEffects()[0].appliedAt, 480);
        Globals.worldTime = { dayIndex: 0, timeMinutes: 481 };
        Player.applyStatusEffectNeedBarsToAll();
        assert.equal(actor.getIntrinsicStatusEffects()[0].duration, 1);
    });
});

test('status-effect-driven max-health decreases preserve the current health ratio', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'status-health-debuff',
            name: 'Kess',
            attributes: {
                constitution: 10,
                strength: 5
            }
        });

        player.setHealth(10);
        player.setStatusEffects([
            {
                name: 'Weakened',
                description: 'Constitution reduced.',
                duration: 5,
                attributes: [
                    { attribute: 'constitution', modifier: -4 }
                ]
            }
        ]);

        assert.equal(player.maxHealth, 16);
        assert.equal(player.health, 8);

        player.setHealth(24);
        assert.equal(player.health, 16);

        player.setStatusEffects([
            {
                name: 'Fortified',
                description: 'Constitution boosted.',
                duration: 5,
                attributes: [
                    { attribute: 'constitution', modifier: 4 }
                ]
            }
        ]);
        assert.equal(player.maxHealth, 24);
        assert.equal(player.health, 24);

        player.setStatusEffects([
            {
                name: 'Weakened',
                description: 'Constitution reduced.',
                duration: 5,
                attributes: [
                    { attribute: 'constitution', modifier: -4 }
                ]
            }
        ]);

        assert.equal(player.maxHealth, 16);
        assert.equal(player.health, 16);
    });
});
