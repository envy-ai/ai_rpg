const test = require('node:test');
const assert = require('node:assert/strict');
const Technique = require('../Technique.js');
const skill = { kind: 'skill', skill: 'Arcana', difficulty: 'Medium' };
const debuff = { id: 'weaken', kind: 'debuff', status: { name: 'Weakness', description: 'Weaker.', duration: 1, attributes: [{ attribute: 'strength', modifier: -1 }] } };
const revision = (check, effect = debuff) => ({ revision: 1, target: { kind: 'single' }, check, costs: [], effects: [effect] });

test('harmful effect diagnostics identify effective check and exact inherited versus override source', () => {
    for (const [input, sourcePath, origin] of [
        [revision({ kind: 'automatic' }), 'revision.check', /inherited/i],
        [revision(skill, { ...debuff, check: { kind: 'automatic' } }), 'revision.effects[0].check', /override/i]
    ]) {
        assert.throws(() => Technique.normalizeRevision(input, 'revision'), error => {
            assert.match(error.message, /debuff/i);
            assert.match(error.message, /automatic/i);
            assert.match(error.message, origin);
            assert.ok(error.message.includes(`${sourcePath}.kind`), error.message);
            assert.ok(error.message.includes('revision.effects[0]'), error.message);
            assert.match(error.message, /attack.*opposed.*skill/i);
            return true;
        });
    }
    assert.equal(Technique.normalizeRevision(revision(skill), 'revision').check.kind, 'skill');
    const overridden = Technique.normalizeRevision(revision({ kind: 'automatic' }, { ...debuff, check: skill }), 'revision');
    assert.equal(overridden.effects[0].check.kind, 'skill');
});
