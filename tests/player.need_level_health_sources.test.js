'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withTechniqueWorld } = require('./helpers/techniqueIntegrationFixtures.js');

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('intrinsic, ability, and location max-health changes preserve one exact health ratio', async () => {
    await withTechniqueWorld(async ({ player, location }) => {
        const base = player.maxHealth;
        player.setHealth(base * 0.3725);
        player.setStatusEffects([{ name: 'Fortitude', description: 'A health bonus.', duration: -1, maxHealthPercent: 10 }]);
        near(player.maxHealth, base * 1.1);
        near(player.health, base * 1.1 * 0.3725);
        player.setAbilities([{ id: 'health_trait', name: 'Health trait', description: 'More health.', type: 'Passive', level: 1,
            statusEffects: [{ name: 'Vitality', description: 'A health bonus.', duration: -1, maxHealthPercent: 10 }] }]);
        near(player.maxHealth, base * 1.2);
        near(player.health, base * 1.2 * 0.3725);
        location.setStatusEffects([{ name: 'Sanctuary', description: 'A health bonus.', duration: -1, maxHealthPercent: 10 }]);
        near(player.maxHealth, base * 1.3);
        near(player.health, base * 1.3 * 0.3725);
        location.setStatusEffects([]);
        near(player.health, base * 1.2 * 0.3725);
    });
});
