const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../Player.js');
const {
    withTempPlayerEnvironment: withTempPlayerEnvironmentBase
} = require('./helpers/needBarFixtures.js');

function withTempPlayerEnvironment(run) {
    return withTempPlayerEnvironmentBase({
        prefix: 'ai-rpg-status-health-',
        attributes: [
            { id: 'constitution', label: 'Constitution', default: 10 },
            { id: 'strength', label: 'Strength', default: 5 }
        ]
    }, run);
}

test('status-effect-driven constitution increases raise current health by the same max-health delta', () => {
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
        assert.equal(player.health, 14);
    });
});

test('removing or expiring a max-health buff does not subtract the gained health back out', () => {
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
        assert.equal(player.health, 14);

        player.tickStatusEffects(1);
        player.clearExpiredStatusEffects();

        assert.equal(player.maxHealth, 20);
        assert.equal(player.health, 14);
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

test('status-effect-driven max-health decreases only clamp instead of subtracting a matching delta', () => {
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
        assert.equal(player.health, 10);

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
