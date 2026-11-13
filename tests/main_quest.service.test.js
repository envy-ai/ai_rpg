const test = require('node:test');
const assert = require('node:assert/strict');

const MainQuest = require('../MainQuest.js');
const Service = require('../MainQuestService.js');
const Tracker = require('../Tracker.js');
const ScheduledEvent = require('../ScheduledEvent.js');
const Quest = require('../Quest.js');

const stageXml = n => Array.from({ length: n }, (_, index) =>
    `<stage><title>S${index + 1}</title><outline>O${index + 1}</outline><exitCondition>E${index + 1}</exitCondition></stage>`).join('');
const detail = tag => `<${tag}><objective>Do stage work.</objective><hiddenDirection>Secret.</hiddenDirection><hooks><hook>A hook.</hook></hooks></${tag}>`;

function harness({ config = {}, responses = {} } = {}) {
    const quests = new Map();
    const player = { id: 'player', name: 'Baato' };
    const queues = Object.fromEntries(Object.entries(responses).map(([key, list]) => [key, [...list]]));
    const calls = [];
    let worldMinute = 100;
    const scheduled = [];
    let saves = 0;
    const persistedOffers = [];
    const updates = [];
    const wrapUps = [];
    const stageProse = [];
    const runtime = Service.createMainQuestRuntime({
        getConfig: () => ({ main_quest: { stage_count: 3, full_check_interval: 2, ...config } }),
        getPlayer: () => player,
        getWorldMinute: () => worldMinute,
        getWorldTime: () => ({ dayIndex: 0, timeMinutes: worldMinute }),
        runPrompt: async ({ promptType, variables, parse }) => {
            calls.push({ promptType, variables });
            const queue = queues[promptType];
            assert.ok(queue && queue.length, `no scripted response for ${promptType}`);
            return parse(queue.shift());
        },
        resolvers: {
            findNpcByName: name => (name === 'Vey' ? { id: 'char_vey', name: 'Vey' } : name === 'Mara' ? { id: 'char_mara', name: 'Mara' } : null),
            findFactionByName: name => (name === 'Ashen Guild' ? { id: 'faction_ashen', name: 'Ashen Guild' } : null)
        },
        createStageQuest: async ({ mainQuest, stage, summary }) => {
            const quest = new Quest({ name: `${stage.title} quest`, description: summary, originLocationLevel: 1, relativeLevel: 0, questLineId: mainQuest.id, stageId: stage.id, objectives: ['Do it'] });
            quests.set(quest.id, quest);
            return quest;
        },
        getQuestById: id => quests.get(id) || null,
        removePlayerQuest: id => quests.delete(id),
        scheduleEvent: async args => {
            const event = new ScheduledEvent({
                event: args.event, regionId: 'region_harbor', regionName: args.region, locationId: 'loc_docks', locationName: args.location,
                targetWorldMinute: worldMinute + 4320, targetWorldTime: { dayIndex: 3, timeMinutes: 0 },
                createdAtWorldMinute: worldMinute, createdAtWorldTime: { dayIndex: 0, timeMinutes: worldMinute }
            });
            scheduled.push(event);
            return { id: event.id };
        },
        ScheduledEvent,
        Tracker,
        storeWrapUp: async ({ prose }) => wrapUps.push(prose),
        storeStageProse: async ({ stage, quest, prose }) => stageProse.push({ stageId: stage.id, questId: quest.id, prose }),
        emitUpdate: reason => updates.push(reason)
    });
    return { runtime, quests, calls, scheduled, wrapUps, stageProse, updates, persistedOffers, saves: () => saves, setMinute: value => { worldMinute = value; } };
}

const generate = (pressure = '<pressure><playerFacingText>The choir grows bolder.</playerFacingText><deadline><in>3 days</in><event>The choir floods the docks.</event><region>Harbor</region><location>Docks</location></deadline></pressure>') =>
    `<mainQuest><modeChosen>new</modeChosen><title>The Drowned Choir</title><premise>Bells ring.</premise><hiddenTruth>H</hiddenTruth>
<antagonist><description>A cult.</description><factionName>Ashen Guild</factionName></antagonist>
<roles><role><key>informant</key><description>Knows the bells.</description></role></roles>
<stages>${stageXml(3)}</stages><endings><ending><description>Silenced.</description></ending><ending><description>Flooded.</description></ending></endings>${pressure}</mainQuest>`;
const stage = (hasNext = true, extra = '') => `<mainQuestStage>${detail('currentStage')}${hasNext ? detail('nextStage') : ''}${extra}<prose>A bell tolls beneath the pier.</prose><quest><summary>Find the bells.</summary></quest></mainQuestStage>`;

test.beforeEach(() => { MainQuest.clear(); Tracker.clear(); ScheduledEvent.clear(); Quest.clear(); });

test('start generates the spine, starts stage 1 with a linked quest, and applies pressure', async () => {
    const h = harness({ responses: { 'main-quest-generate': [generate()], 'main-quest-stage': [stage(true, '<roleBindings><binding><role>informant</role><type>npc</type><name>Vey</name></binding></roleBindings>')] } });
    const mainQuest = await h.runtime.start({ goal: 'Silence the bells.' });
    assert.equal(mainQuest.status, 'active');
    assert.equal(mainQuest.playerGoal, 'Silence the bells.');
    assert.equal(mainQuest.antagonist.factionId, 'faction_ashen');
    assert.equal(mainQuest.stages[0].status, 'active');
    assert.ok(mainQuest.stages[1].detail, 'next stage is detailed for foreshadowing');
    assert.equal(mainQuest.stages[2].detail, null, 'later stages stay outlines');
    const quest = h.quests.get(mainQuest.stages[0].questId);
    assert.equal(quest.questLineId, mainQuest.id);
    assert.equal(mainQuest.roles[0].boundTo.name, 'Vey');
    assert.equal(mainQuest.pressure.playerFacingText, 'The choir grows bolder.');
    const tracker = Tracker.getById(mainQuest.pressure.trackerIds[0]);
    assert.equal(tracker.hiddenFromPlayer, true);
    assert.equal(tracker.sourceMainQuestId, mainQuest.id);
    assert.equal(h.scheduled[0].sourceMainQuestId, mainQuest.id);
    assert.deepEqual(MainQuest.getOffer(), { state: 'started', followUpOf: null });
    assert.equal(h.calls[0].variables.mainQuestGeneration.stageCount, 3);
    assert.deepEqual(h.updates, ['started']);
    await assert.rejects(h.runtime.start({}), /already active/);
});

test('a failed stage start rolls back the new main quest and its pressure', async () => {
    const h = harness({ responses: { 'main-quest-generate': [generate()], 'main-quest-stage': ['<mainQuestStage><currentStage><objective>x</objective></currentStage></mainQuestStage>'] } });
    await assert.rejects(h.runtime.start({}), /hiddenDirection/);
    assert.equal(MainQuest.getActive(), null);
    assert.equal(MainQuest.getAll().length, 0);
    assert.equal(h.scheduled[0].status, 'skipped');
    assert.equal(Tracker.getAll().length, 0);
    assert.equal(MainQuest.getOffer().state, 'pending', 'the offer stays pending after a failed start');
});

test('pressure clock disabled creates no trackers or scheduled events', async () => {
    const h = harness({ config: { pressure_clock_enabled: false }, responses: { 'main-quest-generate': [generate()], 'main-quest-stage': [stage()] } });
    const mainQuest = await h.runtime.start({});
    assert.equal(h.scheduled.length, 0);
    assert.equal(Tracker.getAll().length, 0);
    assert.equal(mainQuest.pressure.playerFacingText, 'The choir grows bolder.');
});

test('checks advance stages, replan, recast, lock facts, and reach an unplanned ending with a follow-up offer', async () => {
    const h = harness({ responses: {
        'main-quest-generate': [generate()],
        'main-quest-stage': [stage(true), stage(true)],
        'main-quest-check': [
            '<mainQuestCheck><progress>none</progress><newLockedFacts><fact>The bells are real.</fact></newLockedFacts><recast><binding><role>informant</role><type>npc</type><name>Mara</name><reason>Vey fled.</reason></binding></recast></mainQuestCheck>',
            `<mainQuestCheck><progress>stage-complete</progress><stageOutcome>Bribed the bellringer.</stageOutcome><replan><stages>${stageXml(2).replace(/S(\d)/g, 'R$1')}</stages></replan></mainQuestCheck>`,
            '<mainQuestCheck><progress>ending-reached</progress><stageOutcome>Made a pact.</stageOutcome><ending><endingId></endingId><description>A pact with the choir.</description></ending></mainQuestCheck>'
        ],
        'main-quest-wrapup': ['<mainQuestWrapUp><prose>The bells fall quiet.</prose></mainQuestWrapUp>']
    } });
    const mainQuest = await h.runtime.start({});
    const firstQuestId = mainQuest.stages[0].questId;
    await h.runtime.runCheck({ reason: 'interval' });
    assert.deepEqual(mainQuest.lockedFacts, ['The bells are real.']);
    assert.equal(mainQuest.roles[0].boundTo.name, 'Mara');
    await h.runtime.runCheck({ reason: 'interval' });
    assert.equal(mainQuest.currentStageIndex, 1);
    assert.equal(mainQuest.stages[0].outcome, 'Bribed the bellringer.');
    assert.deepEqual(mainQuest.stages.map(entry => entry.title), ['S1', 'R1', 'R2'], 'replan replaced the stages after the completed one');
    assert.equal(h.quests.has(firstQuestId), false, 'an unfinished quest for a stage resolved another way is removed');
    assert.deepEqual(mainQuest.lockedFacts, ['The bells are real.'], 'replanning preserves locked facts');
    await h.runtime.runCheck({ reason: 'stage-quest-completed' });
    assert.equal(mainQuest.status, 'completed');
    assert.deepEqual(mainQuest.reachedEnding, { endingId: null, description: 'A pact with the choir.' });
    assert.deepEqual(h.wrapUps, ['The bells fall quiet.']);
    assert.deepEqual(MainQuest.getOffer(), { state: 'pending', followUpOf: mainQuest.id });
    assert.equal(Tracker.getAll().length, 0, 'completion stops the pressure clock');
    assert.equal(await h.runtime.runCheck({}), null, 'no check without an active main quest');
});

test('a sequel receives the previous main quest; sequel without history is rejected', async () => {
    const h = harness({ responses: {
        'main-quest-generate': [generate(''), generate('').replace('<modeChosen>new</modeChosen>', '<modeChosen>sequel</modeChosen>')],
        'main-quest-stage': [stage(), stage()]
    } });
    await assert.rejects(h.runtime.start({ mode: 'sequel' }), /needs an earlier main quest/);
    const first = await h.runtime.start({});
    await h.runtime.abandon();
    const second = await h.runtime.start({ mode: 'sequel' });
    assert.equal(second.previousMainQuestId, first.id);
    assert.equal(h.calls.filter(call => call.promptType === 'main-quest-generate')[1].variables.mainQuestGeneration.previous.id, first.id);
});

test('abandon removes the stage quest and only main-quest pressure, and declines the offer', async () => {
    const h = harness({ responses: { 'main-quest-generate': [generate()], 'main-quest-stage': [stage()] } });
    const unrelatedTracker = new Tracker({ name: 'Storm', type: 'short_string', value: 'brewing', description: 'Weather.', lastUpdatedWorldMinute: 0 });
    const mainQuest = await h.runtime.start({});
    const questId = mainQuest.stages[0].questId;
    await h.runtime.abandon();
    assert.equal(mainQuest.status, 'abandoned');
    assert.equal(h.quests.has(questId), false);
    assert.equal(h.scheduled[0].status, 'skipped');
    assert.deepEqual(Tracker.getAll().map(tracker => tracker.id), [unrelatedTracker.id]);
    assert.deepEqual(MainQuest.getOffer(), { state: 'declined', followUpOf: null });
    await assert.rejects(h.runtime.abandon(), /no active main quest/);
});

test('turn bookkeeping runs the full check on the full interval, after stage quest completion, or on an event-checker signal', async () => {
    const h = harness({ responses: { 'main-quest-generate': [generate('')], 'main-quest-stage': [stage()] } });
    assert.equal(h.runtime.noteCompletedTurn(), null, 'nothing without an active main quest');
    assert.equal(h.runtime.noteProgressSignal({ kind: 'stage-complete', evidence: 'x' }), false, 'signals are ignored without an active main quest');
    const mainQuest = await h.runtime.start({});
    assert.equal(h.runtime.noteCompletedTurn(), null);
    assert.deepEqual(h.runtime.noteCompletedTurn(), { reason: 'interval', signal: null });
    assert.equal(mainQuest.turnsSinceProgress, 2);

    h.runtime.noteProgressSignal({ kind: 'stage-complete', evidence: 'The bellringer handed over the key.' });
    h.runtime.noteProgressSignal({ kind: 'ending', evidence: 'The choir disbanded.' });
    const signalled = h.runtime.noteCompletedTurn();
    assert.equal(signalled.reason, 'event-signal');
    assert.equal(signalled.signal.kind, 'ending', 'an ending signal outranks a stage signal in the same turn');
    assert.deepEqual(signalled.signal.evidence, ['The bellringer handed over the key.', 'The choir disbanded.']);
    assert.notEqual(h.runtime.noteCompletedTurn()?.reason, 'event-signal', 'a signal is consumed by one turn');

    h.quests.get(mainQuest.stages[0].questId).objectives.forEach(objective => { objective.completed = true; });
    assert.equal(h.runtime.noteCompletedTurn().reason, 'stage-quest-completed');
});

test('the check prompt receives the event-checker evidence', async () => {
    const h = harness({ responses: {
        'main-quest-generate': [generate('')],
        'main-quest-stage': [stage()],
        'main-quest-check': ['<mainQuestCheck><progress>none</progress></mainQuestCheck>']
    } });
    await h.runtime.start({});
    await h.runtime.runCheck({ reason: 'event-signal', signal: { kind: 'stage-complete', evidence: ['A key changed hands.'], mainQuestId: 'x' } });
    const call = h.calls.find(entry => entry.promptType === 'main-quest-check');
    assert.equal(call.variables.mainQuestCheckReason, 'event-signal');
    assert.deepEqual(call.variables.mainQuestCheckSignal, { kind: 'stage-complete', evidence: ['A key changed hands.'] });
});

test('a new deadline replaces the previous pending one', async () => {
    const h = harness({ responses: {
        'main-quest-generate': [generate()],
        'main-quest-stage': [stage()],
        'main-quest-check': ['<mainQuestCheck><progress>none</progress><pressure><playerFacingText>They are close.</playerFacingText><deadline><in>1 day</in><event>The choir strikes.</event><region>Harbor</region><location>Docks</location></deadline></pressure></mainQuestCheck>']
    } });
    const mainQuest = await h.runtime.start({});
    await h.runtime.runCheck({});
    assert.equal(h.scheduled[0].status, 'skipped');
    assert.equal(h.scheduled[1].status, 'pending');
    assert.equal(mainQuest.pressure.trackerIds.length, 1);
    assert.equal(Tracker.getById(mainQuest.pressure.trackerIds[0]).value, '1 day');
    assert.equal(mainQuest.pressure.playerFacingText, 'They are close.');
});

test('declining changes only in-memory state, saved with the game as normal', async () => {
    const h = harness();
    const offer = await h.runtime.declineOffer();
    assert.deepEqual(offer, { state: 'declined', followUpOf: null });
    assert.deepEqual(MainQuest.serializeAll().offer, { state: 'declined', followUpOf: null });
    assert.deepEqual(h.updates, ['declined']);
    await h.runtime.declineOffer();
    assert.deepEqual(h.updates, ['declined'], 'a second decline is a no-op');
});

test('each new stage stores introductory prose; advancing passes the previous stage outcome', async () => {
    const h = harness({ responses: {
        'main-quest-generate': [generate('')],
        'main-quest-stage': [stage(), stage()],
        'main-quest-check': ['<mainQuestCheck><progress>stage-complete</progress><stageOutcome>Found the bells.</stageOutcome></mainQuestCheck>']
    } });
    const mainQuest = await h.runtime.start({});
    const firstQuest = h.quests.get(mainQuest.stages[0].questId);
    assert.deepEqual(h.stageProse, [{ stageId: 'stage_1', questId: firstQuest.id, prose: 'A bell tolls beneath the pier.' }]);
    assert.equal(h.calls.find(call => call.promptType === 'main-quest-stage').variables.mainQuestPreviousStage, null);
    firstQuest.objectives.forEach(objective => { objective.completed = true; });
    await h.runtime.runCheck({ reason: 'stage-quest-completed' });
    const secondStageCall = h.calls.filter(call => call.promptType === 'main-quest-stage')[1];
    assert.deepEqual(secondStageCall.variables.mainQuestPreviousStage, { title: 'S1', outcome: 'Found the bells.', questCompleted: true });
    assert.equal(h.stageProse.length, 2);
    assert.equal(h.stageProse[1].stageId, 'stage_2');
});
