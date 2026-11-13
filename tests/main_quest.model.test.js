const test = require('node:test');
const assert = require('node:assert/strict');

const MainQuest = require('../MainQuest.js');
const Quest = require('../Quest.js');

test.afterEach(() => MainQuest.clear());

function record(overrides = {}) {
    return {
        title: 'The Drowned Choir',
        premise: 'Bells ring beneath the harbor.',
        hiddenTruth: 'The harbor master is the choir leader.',
        antagonist: { description: 'A cult that drowns the city.' },
        roles: [{ key: 'informant', description: 'Knows the bells.' }],
        stages: [
            { title: 'Listen', outline: 'Hear the bells.', exitCondition: 'The player knows where the bells are.' },
            { title: 'Descend', outline: 'Go below.', exitCondition: 'The player reaches the drowned chapel.' }
        ],
        endings: [{ description: 'The choir is silenced.' }, { description: 'The city floods.' }],
        ...overrides
    };
}

test('construction validates, allocates ids, and round-trips', () => {
    const quest = new MainQuest(record());
    assert.match(quest.id, /^mquest_the_drowned_choir/);
    assert.equal(quest.stages[0].id, 'stage_1');
    assert.equal(quest.endings[1].id, 'ending_2');
    assert.equal(quest.currentStage.title, 'Listen');
    const payload = MainQuest.serializeAll();
    MainQuest.loadAll(JSON.parse(JSON.stringify(payload)));
    assert.deepEqual(MainQuest.getById(quest.id).toJSON(), quest.toJSON());
    assert.deepEqual(MainQuest.getOffer(), { state: 'pending', followUpOf: null });
});

test('validation names the field and valid values', () => {
    assert.throws(() => new MainQuest(record({ stages: [] })), /needs at least one stage/);
    assert.throws(() => new MainQuest(record({ endings: [] })), /at least one possible ending/);
    assert.throws(() => new MainQuest(record({ status: 'paused' })), /Use one of: active, completed, abandoned/);
    assert.throws(() => new MainQuest(record({ roles: [{ key: 'x', description: 'y', boundTo: { type: 'place', id: 'a' } }] })), /Use one of: npc, faction/);
    assert.throws(() => MainQuest.setOffer({ state: 'maybe' }), /Use one of: pending, declined, started/);
});

test('only one main quest can be active', () => {
    new MainQuest(record());
    assert.throws(() => new MainQuest(record({ title: 'Second' })), /already active/);
    assert.doesNotThrow(() => new MainQuest(record({ title: 'Old', status: 'completed', reachedEnding: { description: 'Done.' } })));
});

test('older saves without mainQuests.json get a pending offer; present payloads restore it', () => {
    MainQuest.setOffer({ state: 'declined' });
    MainQuest.loadAll(null);
    assert.deepEqual(MainQuest.getOffer(), { state: 'pending', followUpOf: null });
    const done = new MainQuest(record({ status: 'completed', reachedEnding: { description: 'Done.' } }));
    MainQuest.setOffer({ state: 'pending', followUpOf: done.id });
    const payload = JSON.parse(JSON.stringify(MainQuest.serializeAll()));
    MainQuest.loadAll(payload);
    assert.equal(MainQuest.getOffer().followUpOf, done.id);
    assert.throws(() => MainQuest.loadAll([]), /must be an object/);
});

test('replanning keeps history, renumbers future stages, and locked facts dedupe', () => {
    const quest = new MainQuest(record());
    quest.stages[0].status = 'completed';
    quest.currentStageIndex = 0;
    quest.replanFutureStages([{ title: 'New', outline: 'o', exitCondition: 'e' }, { title: 'Newer', outline: 'o', exitCondition: 'e' }]);
    assert.deepEqual(quest.stages.map(stage => stage.id), ['stage_1', 'stage_2', 'stage_3']);
    assert.equal(quest.stages[0].status, 'completed');
    quest.addLockedFacts(['The bells are real.', 'the bells are real.']);
    assert.equal(quest.lockedFacts.length, 1);
    quest.bindRole('informant', { type: 'npc', id: 'char_vey', name: 'Vey' }, 'Met at the docks.');
    assert.equal(quest.roles[0].boundTo.name, 'Vey');
    assert.equal(quest.roles[0].history.length, 1);
    assert.throws(() => quest.bindRole('traitor', { type: 'npc', id: 'x' }), /no role "traitor"/);
});

test('player view hides hidden truth, future stages, endings and stage count', () => {
    const quest = new MainQuest(record());
    quest.setStageDetail('stage_1', { objective: 'Find the bells.', hiddenDirection: 'They are under the pier.', hooks: [] });
    const view = quest.toPlayerView();
    const text = JSON.stringify(view);
    assert.equal(view.currentStage.objective, 'Find the bells.');
    for (const hidden of ['harbor master', 'under the pier', 'Descend', 'city floods']) {
        assert.ok(!text.includes(hidden), `player view leaks "${hidden}"`);
    }
    assert.equal(view.stageCount, undefined);
});

test('quests carry main quest link fields as a pair', () => {
    Quest.clear();
    const quest = new Quest({ name: 'Stage quest', originLocationLevel: 3, relativeLevel: 0, questLineId: 'mquest_x', stageId: 'stage_1' });
    const restored = (() => { const json = quest.toJSON(); Quest.clear(); return Quest.fromJSON(json); })();
    assert.equal(restored.questLineId, 'mquest_x');
    assert.equal(restored.stageId, 'stage_1');
    assert.throws(() => new Quest({ name: 'Half', originLocationLevel: 1, relativeLevel: 0, stageId: 'stage_1' }), /both questLineId and stageId/);
    Quest.clear();
});
