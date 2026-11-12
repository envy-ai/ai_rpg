'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPromptEnv, buildBaseRenderContext } = require('./helpers/baseContextFixtures.js');

test('base context describes conditional need mechanics as engine-applied with escaped identities', () => {
    const context = buildBaseRenderContext();
    context.currentPlayer.statusEffects = [{ name: 'Exhausted', description: 'Low rest.', duration: -1,
        needBarSource: { barId: 'rest', barName: 'Rest & recovery', threshold: 0, key: 'low', levelName: 'Very <tired>' },
        attributes: [{ attribute: 'strength', modifier: 0, percentModifier: -10 }], skills: [], maxHealthPercent: 0,
        needBars: [{ name: 'Health', delta: 0, percentDelta: -0.01 }], needBarMaximums: [{ name: 'stamina', percentModifier: -10 }],
        inactiveNeedBarTargets: ['stamina'] }];
    const rendered = createPromptEnv().render('base-context.xml.njk', context);
    assert.match(rendered, /<condition>While Rest &amp; recovery is Very &lt;tired&gt;<\/condition>/);
    assert.match(rendered, /<duration>Conditional<\/duration>/);
    assert.match(rendered, /<engineApplied>true<\/engineApplied>/);
    assert.match(rendered, /<needBarMaximum><name>stamina<\/name><percentModifier>-10<\/percentModifier><\/needBarMaximum>/);
    assert.match(rendered, /<percentDelta>-0\.01<\/percentDelta>/);
    assert.match(rendered, /<inactiveNeedBarTargets><name>stamina<\/name><\/inactiveNeedBarTargets>/);
});
