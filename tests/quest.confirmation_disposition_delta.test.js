const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const QuestConfirmationManager = require('../QuestConfirmationManager.js');
const { resolveQuestDispositionRewardDelta } = require('../quest_disposition_reward_delta.js');

const rootDir = path.join(__dirname, '..');

test('shared resolver scales intensity by the disposition typical step', () => {
    const defs = { range: { typicalStep: 4, typicalBigStep: 50 } };
    assert.equal(resolveQuestDispositionRewardDelta(2, defs), 8);   // 2 * 4
    assert.equal(resolveQuestDispositionRewardDelta(3, defs), 12);  // 3 * 4
    assert.equal(resolveQuestDispositionRewardDelta(6, defs), 12);  // (6 / 2) * 4
    assert.equal(resolveQuestDispositionRewardDelta(-10, defs), -50); // typicalBigStep
    assert.equal(resolveQuestDispositionRewardDelta(0, defs), null);
    assert.equal(resolveQuestDispositionRewardDelta(2, null), null); // no definitions
});

test('the award path and the confirmation preview use the same shared resolver', () => {
    const eventsSource = fs.readFileSync(path.join(rootDir, 'Events.js'), 'utf8');
    const qcmSource = fs.readFileSync(path.join(rootDir, 'QuestConfirmationManager.js'), 'utf8');
    assert.match(eventsSource, /require\("\.\/quest_disposition_reward_delta\.js"\)/);
    assert.match(eventsSource, /_resolveQuestDispositionDelta\(intensityValue, definitions\) \{[\s\S]*?resolveQuestDispositionRewardDelta\(intensityValue, definitions\)/);
    assert.match(qcmSource, /resolveQuestDispositionRewardDelta\(intensity, dispositionDefinitions\)/);
});

test('quest confirmation payload includes the resolved disposition delta, not just raw intensity', () => {
    const typicalStep = Number(Player.getDispositionDefinitions()?.range?.typicalStep);
    assert.ok(Number.isFinite(typicalStep) && typicalStep !== 0, 'disposition definitions should provide a typicalStep');

    const previousEmit = Globals.emitToClient;
    let captured = null;
    Globals.emitToClient = (clientId, event, payload) => {
        captured = payload;
        return true;
    };
    try {
        const manager = new QuestConfirmationManager({ timeoutMs: null });
        manager.requestConfirmation({
            clientId: 'client-1',
            quest: {
                id: 'q1',
                name: 'Befriend the Guard',
                rewardNpcDispositions: [
                    { npcName: 'Mira', dispositions: [{ type: 'platonic', intensity: 2, reason: 'Trust earned.' }] }
                ]
            }
        });
    } finally {
        Globals.emitToClient = previousEmit;
    }

    const disposition = captured?.quest?.rewardNpcDispositions?.[0]?.dispositions?.[0];
    assert.ok(disposition, 'confirmation payload should include the disposition reward');
    assert.equal(disposition.intensity, 2, 'raw intensity is preserved');
    assert.equal(disposition.delta, 2 * typicalStep, 'resolved delta matches the applied change');
});

test('accept dialog displays the resolved delta when present, falling back to intensity', () => {
    const chatSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'chat.js'), 'utf8');
    // The confirmation reward renderer prefers the server-resolved delta.
    assert.match(chatSource, /const deltaRaw = Number\(disposition\?\.delta\);/);
    assert.match(chatSource, /Number\.isFinite\(deltaRaw\) && deltaRaw !== 0 \? deltaRaw : intensity/);
    // The received-payload normalizer carries the delta through.
    assert.match(chatSource, /delta: Number\.isFinite\(delta\) \? delta : null/);
});
