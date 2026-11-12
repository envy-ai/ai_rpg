'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const NeedBarStatusEffects = require('../NeedBarStatusEffects.js');
const IdGenerator = require('../IdGenerator.js');

test('need-level definitions compile detached keyed templates with explicit zeros and no allocated IDs', () => {
    const before = IdGenerator.snapshotCounters();
    const templates = NeedBarStatusEffects.compile({ exhausted: { name: 'Exhausted', description: 'A tired character.',
        attributes: { strength: { modifier: 0, percent_modifier: -10 } },
        need_bars: { Health: { delta: 0, percent_delta: -0.01 } },
        need_bar_maximums: { stamina: { percent_modifier: 0 } } }, disabled: { enabled: false } }, { path: 'need_bars.rest.effect_thresholds.0.status_effects' });
    assert.equal(templates.length, 1);
    assert.equal(templates[0].key, 'exhausted');
    assert.deepEqual(templates[0].attributes, [{ attribute: 'strength', modifier: 0, percentModifier: -10 }]);
    assert.deepEqual(templates[0].needBars, [{ name: 'Health', delta: 0, percentDelta: -0.01 }]);
    assert.deepEqual(templates[0].needBarMaximums, [{ name: 'stamina', percentModifier: 0 }]);
    assert.equal(Object.isFrozen(templates[0].needBars[0]), true);
    assert.deepEqual(IdGenerator.snapshotCounters(), before);
});

test('need-level definitions reject unsupported metadata and unknown target names with paths', () => {
    assert.throws(() => NeedBarStatusEffects.compile({ bad: { name: 'Bad', description: 'Invalid.', duration: 5 } }, { path: 'need_bars.rest.effect_thresholds.0.status_effects' }), /status_effects\.bad\.duration.*unsupported/i);
    const [effect] = NeedBarStatusEffects.compile({ bad: { name: 'Bad', description: 'Invalid.', need_bars: { missing: { percent_delta: 1 } } } }, { path: 'need_bars.rest.effect_thresholds.0.status_effects' });
    assert.throws(() => NeedBarStatusEffects.validateReferences({ rest: { id: 'rest', name: 'Rest', effectThresholds: [{ threshold: 0, statusEffects: [effect] }] } }), /need_bars\.rest.*missing.*unknown/i);
});
