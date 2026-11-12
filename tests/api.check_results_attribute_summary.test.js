const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');

function loadCheckResultsRecorder() {
    const helperStart = apiSource.indexOf('function resolveSkillCheckDisplayLabel(');
    const helperEnd = apiSource.indexOf('function filterNeedBarChangesForHistory(', helperStart);
    const start = apiSource.indexOf('        function createCheckResultsRecorder({');
    const end = apiSource.indexOf('        function recordActionOutcomeCheckResultsEntry(', start);
    assert.notEqual(helperStart, -1, 'Could not locate resolveSkillCheckDisplayLabel');
    assert.notEqual(helperEnd, -1, 'Could not locate the function after resolveSkillCheckDisplayLabel');
    assert.notEqual(start, -1, 'Could not locate createCheckResultsRecorder');
    assert.notEqual(end, -1, 'Could not locate the function after createCheckResultsRecorder');

    const context = {
        isCheckResultChatToolName: name => (
            name === 'resolveSkillCheck' || name === 'resolveOpposedSkillCheck'
        ),
        requireLocationId: value => value,
        pushChatEntry(entry, collector, locationId) {
            entry.id = 'check-results-1';
            collector.push(entry);
            return entry;
        }
    };
    vm.runInNewContext(`${apiSource.slice(helperStart, helperEnd)}\n${apiSource.slice(start, end)}\nglobalThis.createCheckResultsRecorder = createCheckResultsRecorder;`, context);
    return context.createCheckResultsRecorder;
}

const createCheckResultsRecorder = loadCheckResultsRecorder();

function recordCheck({name, parameters, resolution}) {
    const entryCollector = [];
    const recorder = createCheckResultsRecorder({
        promptLabel: 'Player action',
        locationId: 'location-1',
        entryCollector
    });
    const original = structuredClone({parameters, resolution});
    const record = phase => recorder.record({
        name,
        phase,
        sequence: 1,
        metadataLabel: 'player_action',
        parameters,
        ...(phase === 'completed' ? {
            result: {
                metadata: {
                    actor: 'Player',
                    actionResolution: resolution
                }
            }
        } : {})
    });

    record('started');
    const runningSummary = entryCollector[0].checkResults[0].summary;
    record('completed');
    const entry = recorder.getEntry();

    assert.deepEqual({parameters, resolution}, original, 'The recorder must not mutate input skill data');
    return {
        runningSummary,
        completedSummary: entry.checkResults[0].summary,
        record: entry.checkResults[0]
    };
}

test('normal stat-only checks use the actor attribute while running and completed', () => {
    const {runningSummary, completedSummary, record} = recordCheck({
        name: 'resolveSkillCheck',
        parameters: {actor: 'Player', skill: ' N/A ', attribute: 'Dexterity'},
        resolution: {
            skill: 'n/a',
            attribute: 'Dexterity',
            label: 'failure',
            degree: 'failure',
            success: false
        }
    });

    assert.equal(runningSummary, "Resolving Player's Dexterity");
    assert.equal(completedSummary, "❌ Player's Dexterity: Failure");
    assert.equal(record.kind, 'skill');
    assert.equal(record.skillCheck.skill, 'n/a');
    assert.equal(record.skillCheck.attribute, 'Dexterity');
});

test('opposed stat-only checks use the actor attribute and retain the opponent name', () => {
    const {runningSummary, completedSummary, record} = recordCheck({
        name: 'resolveOpposedSkillCheck',
        parameters: {
            actor: 'Player',
            skill: '   ',
            attribute: 'Dexterity',
            opponent: 'Rival',
            opponentSkill: '   ',
            opponentAttribute: 'Strength'
        },
        resolution: {
            skill: '  ',
            attribute: 'Dexterity',
            opponent: {name: 'Rival', skill: 'N/A', attribute: 'Strength'},
            label: 'failure',
            degree: 'failure',
            success: false
        }
    });

    assert.equal(runningSummary, "Resolving Player's Dexterity vs Rival");
    assert.equal(completedSummary, "❌ Player's Dexterity vs Rival: Failure");
    assert.equal(record.kind, 'opposed-skill');
});

test('real skill labels take precedence over attributes', () => {
    const {runningSummary, completedSummary, record} = recordCheck({
        name: 'resolveSkillCheck',
        parameters: {actor: 'Player', skill: 'Stealth', attribute: 'Dexterity'},
        resolution: {
            skill: 'Stealth',
            attribute: 'Dexterity',
            label: 'success',
            degree: 'success',
            success: true
        }
    });

    assert.equal(runningSummary, "Resolving Player's Stealth");
    assert.equal(completedSummary, "✔️ Player's Stealth: Success");
    assert.equal(record.skillCheck.skill, 'Stealth');
    assert.equal(record.skillCheck.attribute, 'Dexterity');
});

test('technique check summaries round displayed health changes without changing receipt precision', () => {
    for (const [delta, expected] of [[2.6, '+3 HP'], [-2.6, '-3 HP'], [0.4, '+0 HP']]) {
        const entries = [];
        const recorder = createCheckResultsRecorder({ promptLabel: 'Player action', locationId: 'location-1', entryCollector: entries });
        const receipt = { committed: true, kind: 'use', operationId: `fractional-${delta}`, actorId: 'actor', techniqueId: 'technique', success: true,
            display: { actorName: 'Caster', techniqueName: 'Spell' }, effects: [{ success: true, kind: delta < 0 ? 'damage' : 'healing', amount: Math.abs(delta), delta }] };
        const before = structuredClone(receipt);
        recorder.recordTechnique(receipt);
        const record = recorder.getEntry().checkResults[0];
        assert.ok(record.summary.includes(expected), record.summary);
        assert.equal(record.techniqueReceipt.effects[0].delta, delta);
        assert.deepEqual(receipt, before);
    }
});

test('technique summary rounds the exact aggregate health change once', () => {
    const entries = [];
    const recorder = createCheckResultsRecorder({ promptLabel: 'Player action', locationId: 'location-1', entryCollector: entries });
    const receipt = { committed: true, kind: 'use', operationId: 'two-fractional-effects', actorId: 'actor', techniqueId: 'technique', success: true,
        display: { actorName: 'Caster', techniqueName: 'Double Mend' }, effects: [
            { success: true, kind: 'healing', targetId: 'target', amount: 0.4, delta: 0.4 },
            { success: true, kind: 'healing', targetId: 'target', amount: 0.4, delta: 0.4 }
        ] };
    recorder.recordTechnique(receipt);
    const record = recorder.getEntry().checkResults[0];
    assert.match(record.summary, /\+1 HP/);
    assert.deepEqual(Array.from(record.techniqueReceipt.effects, effect => effect.amount), [0.4, 0.4]);
});
