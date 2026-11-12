'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const StatusEffect = require('../StatusEffect.js');
const { chooseTechniqueRefresh, normalizeStatusEffectInstances } = require('../status_effect_list.js');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { parseTechniqueXmlValue, writeTechniqueXmlValue, candidateSchema } = require('../TechniqueXml.js');

function effect({ delta, percentDelta, appliedAt }) {
    return new StatusEffect({ register: false, id: 'effect_need_rate', name: 'Recovery', description: 'A recovery rate.', duration: 5, appliedAt,
        needBars: [{ name: 'Health', delta, percentDelta }],
        techniqueProvenance: { techniqueId: 'tech_1', effectId: 'effect_1', actorId: 'actor_1', operationId: 'op_1', sourceId: 'source_1', sourceKind: 'learned', stacking: 'refresh', refreshPolicy: 'stronger', definitionRevision: 1, authoredDuration: 5 } });
}

test('technique stronger refresh compares mixed fixed and percentage rates against actual maximum', () => {
    const existing = effect({ delta: 0, percentDelta: 2, appliedAt: 0 });
    const weaker = effect({ delta: 1, percentDelta: 0.5, appliedAt: 2 });
    const stronger = effect({ delta: 1, percentDelta: 2, appliedAt: 3 });
    const basis = { rateBasis: name => { assert.equal(name, 'Health'); return 100; } };
    const retained = chooseTechniqueRefresh(existing, weaker, basis);
    assert.deepEqual(retained.needBars, existing.needBars);
    assert.equal(retained.appliedAt, 2);
    assert.deepEqual(chooseTechniqueRefresh(existing, stronger, basis).needBars, stronger.needBars);
    assert.throws(() => chooseTechniqueRefresh(existing, weaker), /actor|rateBasis/i);
});

test('technique XML round-trips mixed rates and maximum capacity modifiers', () => {
    const xml = '<candidate><revisions><revision><effects><effect><status><name>Flow</name><description>A sustained flow.</description><duration>5</duration><needBars><needBar><name>Health</name><delta>0</delta><percentDelta>-0.25</percentDelta></needBar></needBars><needBarMaximums><needBarMaximum><name>stamina</name><percentModifier>5</percentModifier></needBarMaximum></needBarMaximums></status></effect></effects></revision></revisions></candidate>';
    const document = new DOMParser().parseFromString(xml, 'text/xml');
    const parsed = parseTechniqueXmlValue(document.documentElement, candidateSchema, 'candidate');
    const status = parsed.revisions[0].effects[0].status;
    assert.deepEqual(status.needBars, [{ name: 'Health', delta: 0, percentDelta: -0.25 }]);
    assert.deepEqual(status.needBarMaximums, [{ name: 'stamina', percentModifier: 5 }]);
    const output = new DOMParser().parseFromString('<candidate/>', 'text/xml');
    writeTechniqueXmlValue(output.documentElement, parsed, candidateSchema);
    const reparsed = parseTechniqueXmlValue(new DOMParser().parseFromString(new XMLSerializer().serializeToString(output), 'text/xml').documentElement, candidateSchema, 'candidate');
    assert.deepEqual(reparsed, parsed);
});

test('owners without a rate ticker reject percentage rates, including explicit zero', () => {
    for (const percentDelta of [0, 0.25, -1]) {
        const status = { name: 'Unsupported', description: 'No rate ticker.', duration: 5, needBars: [{ name: 'Health', delta: 0, percentDelta }] };
        for (const input of [status, new StatusEffect({ ...status, register: false })]) {
            assert.throws(() => normalizeStatusEffectInstances([input], { includeNeedBars: false, ownerPath: 'location.statusEffects' }), /location\.statusEffects.*percentDelta/i);
        }
    }
    const allowed = normalizeStatusEffectInstances([{ name: 'Capacity', description: 'A valid capacity.', needBarMaximums: [{ name: 'stamina', percentModifier: 5 }] }], { includeNeedBars: false });
    assert.deepEqual(allowed[0].needBarMaximums, [{ name: 'stamina', percentModifier: 5 }]);
});
