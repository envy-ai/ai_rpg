'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const Globals = require('../Globals.js');
const Player = require('../Player.js');
const { withTempPlayerEnvironment } = require('./helpers/needBarFixtures.js');

test('normal need definitions settle thirty days for twenty NPCs without truncating time', { timeout: 60000 }, () => {
    const root = path.resolve(__dirname, '..');
    const parsedAttributes = yaml.load(fs.readFileSync(path.join(root, 'defs/attributes.yaml'), 'utf8')).attributes;
    const attributes = Object.entries(parsedAttributes).map(([id, value]) => ({ id, label: value.label, default: value.default }));
    const needBarsYaml = fs.readFileSync(path.join(root, 'defs/need_bars.yaml'), 'utf8');
    withTempPlayerEnvironment({ prefix: 'need-long-travel-', attributes, needBarsYaml, manageWorldTime: true,
        configOverrides: { healthRegenPercentPerMinute: 0.01736111111 } }, () => {
        Globals.worldTime = { dayIndex: 0, timeMinutes: 0 };
        const actors = Array.from({ length: 20 }, (_, index) => new Player({ id: `travel_npc_${index}`, name: `Travel NPC ${index}`, isNPC: true }));
        for (const actor of actors) {
            assert.ok(actor.getNeedBars().some(bar => bar.id === 'stamina'));
            actor.setNeedBarValue('stamina', 0);
            actor.setNeedBarValue('mana', 0);
        }
        Player.applyStatusEffectNeedBarsToAll();
        Globals.worldTime = { dayIndex: 30, timeMinutes: 0 };
        const started = performance.now();
        Player.applyStatusEffectNeedBarsToAll();
        const durationMs = performance.now() - started;
        for (const actor of actors) {
            assert.equal(actor.toJSON().needBarRatesAppliedAt, 30 * 1440);
            assert.equal(actor.toJSON().healthRegenAppliedAt, 30 * 1440);
            assert.equal(actor.getNeedBarValue('stamina'), actor.getNeedBars().find(bar => bar.id === 'stamina').max);
        }
        console.log(`Need-level normal definitions: 20 NPCs, 30 days, ${durationMs.toFixed(1)} ms`);
    });
});

test('three-day optimized settlement matches minute stepping across starter need bands', { timeout: 60000 }, () => {
    const root = path.resolve(__dirname, '..');
    const parsedAttributes = yaml.load(fs.readFileSync(path.join(root, 'defs/attributes.yaml'), 'utf8')).attributes;
    const attributes = Object.entries(parsedAttributes).map(([id, value]) => ({ id, label: value.label, default: value.default }));
    const needBarsYaml = fs.readFileSync(path.join(root, 'defs/need_bars.yaml'), 'utf8');
    withTempPlayerEnvironment({ prefix: 'need-reference-travel-', attributes, needBarsYaml, manageWorldTime: true,
        configOverrides: { healthRegenPercentPerMinute: 0.01736111111 } }, () => {
        Globals.worldTime = { dayIndex: 0, timeMinutes: 0 };
        const fast = new Player({ id: 'fast_travel_actor', name: 'Fast', isNPC: true });
        const stepped = new Player({ id: 'step_travel_actor', name: 'Stepped', isNPC: true });
        for (const actor of [fast, stepped]) {
            actor.setNeedBarValue('stamina', 0);
            actor.setNeedBarValue('mana', 0);
            actor.setHealth(actor.maxHealth * 0.4);
            actor.settleNeedBarTime({ worldMinutes: 0 });
        }
        const duration = 3 * 1440;
        fast.settleNeedBarTime({ worldMinutes: duration });
        for (let minute = 1; minute <= duration; minute++) stepped.settleNeedBarTime({ worldMinutes: minute });
        assert.ok(Math.abs(fast.health - stepped.health) < 1e-8);
        for (const bar of fast.getNeedBars()) {
            const reference = stepped.getNeedBars().find(entry => entry.id === bar.id);
            assert.ok(Math.abs(bar.value - reference.value) < 1e-8, `${bar.id}: ${bar.value} vs ${reference.value}`);
            assert.equal(bar.currentThreshold?.threshold, reference.currentThreshold?.threshold);
        }
    });
});
