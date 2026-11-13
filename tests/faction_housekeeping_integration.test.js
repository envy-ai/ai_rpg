const test = require('node:test');
const assert = require('node:assert/strict');
const Events = require('../Events.js');
const Globals = require('../Globals.js');
const { normalizeFactionHousekeepingState } = require('../FactionHousekeepingState.js');

test('shared eligible-turn counter independently schedules normal and faction intervals without offset', () => {
    const saved = Events.getMaintenancePromptTurnCounters();
    try {
        for (const [normalInterval, factionInterval, turns, expectedNormal, expectedFaction] of [
            [4, 11, 22, [4, 8, 12, 16, 20], [11, 22]],
            [1, 1, 3, [1, 2, 3], [1, 2, 3]],
            [3, 11, 22, [3, 6, 9, 12, 15, 18, 21], [11, 22]]
        ]) {
            Events.resetMaintenancePromptTurnCounters();
            const normal = [], faction = [];
            const config = { housekeeping: { interval: normalInterval }, faction_housekeeping: { interval: factionInterval } };
            for (let turn = 1; turn <= turns; turn++) {
                if (Events.shouldRunAutomaticHousekeepingThisTurn(config)) normal.push(turn);
                if (Events.shouldRunAutomaticFactionHousekeepingThisTurn(config)) faction.push(turn);
                assert.equal(Events.getMaintenancePromptTurnCounters().housekeepingTurnCounter, turn);
            }
            assert.deepEqual(normal, expectedNormal);
            assert.deepEqual(faction, expectedFaction);
        }
        Events.hydrateMaintenancePromptTurnCounters({ housekeepingTurnCounter: 10 });
        const config = { housekeeping: { interval: 4 }, faction_housekeeping: { interval: 11 } };
        Events.shouldRunAutomaticHousekeepingThisTurn(config);
        assert.equal(Events.shouldRunAutomaticFactionHousekeepingThisTurn(config), true);
        Events.resetMaintenancePromptTurnCounters();
        assert.equal(Events.shouldRunAutomaticFactionHousekeepingThisTurn(config), false);
    } finally { Events.hydrateMaintenancePromptTurnCounters(saved); }
});

test('legacy or reset faction state is empty and state snapshots are isolated', () => {
    assert.deepEqual(normalizeFactionHousekeepingState(), {
        factionPlans: [], lastReviewedTurnId: null, lastReviewedTurnTimestamp: null
    });
    const saved = Globals.getFactionHousekeepingState();
    try {
        Globals.setFactionHousekeepingState({ factionPlans: [], lastReviewedTurnId: 'turn_1', lastReviewedTurnTimestamp: null });
        const copy = Globals.getFactionHousekeepingState();
        copy.factionPlans.push({ factionId: 'faction_1', plan: 'change' });
        assert.deepEqual(Globals.getFactionHousekeepingState().factionPlans, []);
        Globals.setFactionHousekeepingState(null);
        assert.deepEqual(Globals.getFactionHousekeepingState(), normalizeFactionHousekeepingState());
    } finally { Globals.setFactionHousekeepingState(saved); }
});

test('saved plans retain their content, reject draft IDs, and do not share nested arrays', () => {
    const plan = { factionRef: 'faction_2', role: 'Ally', plan: 'Protect the bridge & road', awarenessConstraints: 'Private', nextSteps: ['Send a scout'] };
    const normalized = normalizeFactionHousekeepingState({ factionPlans: [plan], lastReviewedTurnId: 'turn_5', lastReviewedTurnTimestamp: '2026-01-01T00:00:00.000Z' });
    assert.deepEqual(normalized.factionPlans, [plan]);
    plan.nextSteps.push('mutated');
    assert.deepEqual(normalized.factionPlans[0].nextSteps, ['Send a scout']);
    assert.throws(() => normalizeFactionHousekeepingState({ factionPlans: [{ ...plan, factionRef: 'draft:new' }] }), /actual faction ID/);
    assert.throws(() => normalizeFactionHousekeepingState({ factionPlans: [plan, plan] }), /unique/);
});

const Faction = require('../Faction.js');
const { stageFactionHousekeepingProposal, commitFactionHousekeepingProposal, buildFactionHousekeepingContext } = require('../FactionHousekeepingService.js');

function factionFixture() {
    const a = new Faction({ id: 'faction_test_a', name: 'Test A', relations: { faction_test_b: { status: 'neutral', notes: 'Existing tie' } } });
    const b = new Faction({ id: 'faction_test_b', name: 'Test B' });
    const factions = new Map([[a.id, a], [b.id, b]]);
    const cleanup = () => { for (const id of factions.keys()) Faction.delete(id); };
    const plan = ref => ({ factionRef: ref, role: 'Ally', plan: 'Guard the road', awarenessConstraints: 'Private', nextSteps: ['Send a scout'] });
    const proposal = { newFactions: [{ localRef: 'draft:new', name: 'Test C', concept: 'Road wardens' }], factionPlans: [plan(a.id), plan('draft:new')] };
    const generator = async ({ existingFactions }) => {
        existingFactions[0].relations.faction_draft = { status: 'allied', notes: 'Shared patrols' };
        existingFactions[0].relations.faction_test_b = { status: 'hostile', notes: 'Must not replace' };
        return [{ id: 'faction_draft', name: 'Test C', relations: { faction_test_b: { status: 'rival', notes: 'Competing patrols' } } }];
    };
    return { a, b, factions, cleanup, proposal, generator };
}

test('staged generation commits only sparse new-faction edges and resolves plan references', async () => {
    const f = factionFixture();
    try {
        const staged = await stageFactionHousekeepingProposal({ proposal: f.proposal, factions: f.factions, generateFactionsList: f.generator });
        assert.equal(f.factions.size, 2);
        assert.equal(f.a.getRelation('faction_draft'), null);
        let state;
        const result = commitFactionHousekeepingProposal({ staged, factions: f.factions, boundary: { lastReviewedTurnId: null, lastReviewedTurnTimestamp: null }, setState: value => { state = value; } });
        const created = result.createdFactions[0];
        assert.equal(state.factionPlans[1].factionRef, created.id);
        assert.equal(state.factionPlans[0].factionRef, f.a.id);
        assert.deepEqual(f.a.getRelation(f.b.id), { status: 'neutral', notes: 'Existing tie' });
        assert.deepEqual(f.a.getRelation(created.id), { status: 'allied', notes: 'Shared patrols' });
        assert.deepEqual(created.getRelation(f.b.id), { status: 'rival', notes: 'Competing patrols' });
        assert.equal(f.b.getRelation(created.id), null);
        assert.equal(created.getRelation(f.a.id), null);
    } finally { f.cleanup(); }
});

test('authoring failure, commit failure, or cancelled world cannot partially apply a proposal', async () => {
    const f = factionFixture();
    try {
        await assert.rejects(stageFactionHousekeepingProposal({ proposal: f.proposal, factions: f.factions, generateFactionsList: async ({ existingFactions }) => {
            existingFactions[0].relations.bad = { status: 'allied', notes: 'temporary' };
            throw new Error('authoring failed');
        } }), /authoring failed/);
        assert.equal(f.factions.size, 2);
        assert.equal(f.a.getRelation('bad'), null);
        const staged = await stageFactionHousekeepingProposal({ proposal: f.proposal, factions: f.factions, generateFactionsList: f.generator });
        assert.throws(() => commitFactionHousekeepingProposal({ staged, factions: f.factions, boundary: {}, assertCurrent: () => { throw new Error('world changed'); } }), /world changed/);
        assert.throws(() => commitFactionHousekeepingProposal({ staged, factions: f.factions, boundary: {}, setState: () => { throw new Error('save failed'); } }), /save failed/);
        assert.equal(f.factions.size, 2);
        assert.deepEqual(f.a.getRelation(f.b.id), { status: 'neutral', notes: 'Existing tie' });
        assert.equal(f.a.relations.size, 1);
        assert.equal(Faction.getByName('Test C'), null);
    } finally { f.cleanup(); }
});

test('prior saved plans enter context as tentative intentions rather than events', () => {
    const plan = { factionRef: 'faction_1', role: 'Ally', plan: 'Guard <bridge> & road', awarenessConstraints: 'Private', nextSteps: ['Send a scout'] };
    const { context } = buildFactionHousekeepingContext({ baseContext: {}, factions: new Map(), chatHistory: [], previousState: { factionPlans: [plan] } });
    assert.equal(context.pendingDevelopments[0].commitment, 'tentative');
    assert.match(context.pendingDevelopments[0].description, /not evidence that an action happened/);
    assert.match(context.pendingDevelopments[0].description, /Guard <bridge> & road/);
    assert.deepEqual(context.deadlines, []);
});

test('suppressed and recursive checks do not advance cadence, and maintenance errors retain event results', async () => {
    const saved = { counters: Events.getMaintenancePromptTurnCounters(), config: Events.config, normal: Events._housekeepingPromptRunner, faction: Events._factionHousekeepingPromptRunner, error: console.error };
    try {
        Events.resetMaintenancePromptTurnCounters();
        Events.config = { housekeeping: { interval: 1 }, faction_housekeeping: { interval: 1 } };
        const calls = [];
        Events.setHousekeepingPromptRunner(async () => { calls.push('normal'); throw new Error('normal failed'); });
        Events.setFactionHousekeepingPromptRunner(async () => { calls.push('faction'); throw new Error('faction failed'); });
        assert.equal(Events._scheduleHousekeepingForEventChecks({ depth: 1 }), false);
        assert.equal(Events._scheduleHousekeepingForEventChecks({ suppressHousekeeping: true }), false);
        assert.equal(Events.getMaintenancePromptTurnCounters().housekeepingTurnCounter, 0);
        Events._scheduleHousekeepingForEventChecks();
        Events._scheduleHousekeepingForEventChecks();
        assert.equal(Events.shouldRunAutomaticFactionHousekeepingThisTurn({ faction_housekeeping: { interval: 1 } }), true);
        const eventResult = { currencyChanges: [{ amount: 7 }] };
        console.error = () => {};
        await Events._runHousekeepingAfterEventChecks({ housekeepingScheduled: true, factionHousekeepingScheduled: true, eventResult });
        assert.deepEqual(calls, ['normal', 'faction']);
        assert.deepEqual(eventResult.currencyChanges, [{ amount: 7 }]);
        assert.deepEqual(eventResult.postProcessingErrors.map(error => error.code), ['HOUSEKEEPING_AFTER_EVENT_CHECKS_FAILED', 'FACTION_HOUSEKEEPING_AFTER_EVENT_CHECKS_FAILED']);
        assert.match(eventResult.postProcessingErrors[1].stack, /faction failed/);
    } finally {
        Events.hydrateMaintenancePromptTurnCounters(saved.counters);
        Events.config = saved.config;
        Events.setHousekeepingPromptRunner(saved.normal);
        Events.setFactionHousekeepingPromptRunner(saved.faction);
        console.error = saved.error;
    }
});

test('standard and TinyBrain runtime routes use mocked tool-free completions and replace reviewed plans', async () => {
    const nunjucks = require('nunjucks');
    const path = require('node:path');
    const Utils = require('../Utils.js');
    const { TinyBrainPromptExtension } = require('../TinyBrainPromptRunner.js');
    const { FACTION_HOUSEKEEPING_SECTIONS } = require('../FactionHousekeepingPrompt.js');
    const { runFactionHousekeeping } = require('../FactionHousekeepingService.js');
    const LLMClient = require('../LLMClient.js');
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }), { autoescape: false, throwOnUndefined: true });
    env.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    const parse = xml => {
        const doc = Utils.parseXmlDocumentStrict(xml, 'text/xml');
        return { systemPrompt: doc.getElementsByTagName('systemPrompt')[0].textContent.trim(), generationPrompt: doc.getElementsByTagName('generationPrompt')[0].textContent };
    };
    const original = Globals.getFactionHousekeepingState();
    const originalScope = LLMClient.withXmlOutputScope;
    const scopes = [];
    LLMClient.withXmlOutputScope = (options, callback) => { scopes.push(options); return originalScope.call(LLMClient, options, callback); };
    const old = { factionRef: 'faction_1', role: 'ally', plan: 'Protect <bridge> & road', awarenessConstraints: 'private', nextSteps: ['wait'] };
    const final = '<factionHousekeepingProposal><newFactions/><factionPlans/></factionHousekeepingProposal>';
    try {
        for (const tinybrain of [false, true]) {
            Globals.setFactionHousekeepingState({ factionPlans: [old] });
            let count = 0;
            const result = await runFactionHousekeeping({
                promptEnv: env, parseXMLTemplate: parse, config: { ai: { tinybrain } }, factions: new Map(), chatHistory: [], baseContext: {}, currentPlayer: null, interval: 4,
                generateFactionsList: async () => { throw new Error('No faction generation expected'); },
                complete: async options => {
                    assert.equal(options.allowToolCalls, false);
                    assert.deepEqual(options.additionalPayload.tools, []);
                    if (tinybrain) {
                        assert.ok(options.queueReservation, 'staged completion must reuse the prompt queue reservation');
                        assert.deepEqual(scopes.at(-1).expectedXmlRootTags, [FACTION_HOUSEKEEPING_SECTIONS[count] || 'factionHousekeepingProposal']);
                    } else assert.equal(options.expectedXmlRootTag, 'factionHousekeepingProposal');
                    if (count === 0) assert.match(options.messages[1].content, /Protect &lt;bridge&gt; &amp; road/);
                    const name = FACTION_HOUSEKEEPING_SECTIONS[count++];
                    return tinybrain && name ? `<${name}><assessment>No development.</assessment><entries/></${name}>` : final;
                },
                logPrompt: () => path.join(__dirname, '..', 'tmp', 'faction-housekeeping-mocked.log')
            });
            assert.equal(count, tinybrain ? 10 : 1);
            assert.equal(result.response, final);
            assert.deepEqual(Globals.getFactionHousekeepingState().factionPlans, []);
        }
    } finally { Globals.setFactionHousekeepingState(original); LLMClient.withXmlOutputScope = originalScope; }
});

test('serialized metadata restores plans and legacy saves clear previous world state', () => {
    const Utils = require('../Utils.js');
    const saved = { config: Globals.config, sceneSummaries: Globals.sceneSummaries, worldTime: Globals.worldTime, calendarDefinition: Globals.calendarDefinition, state: Globals.getFactionHousekeepingState() };
    const plan = { factionRef: 'faction_1', role: 'ally', plan: 'Guard road', awarenessConstraints: 'private', nextSteps: ['scout'] };
    try {
        Globals.config = { time: {} };
        Globals.sceneSummaries = { serialize: () => ({}), load: () => {} };
        Globals.worldTime = { dayIndex: 0, timeMinutes: 480 };
        Globals.calendarDefinition = Globals.generateCalendarDefinition({ settingName: 'Test Setting' });
        Globals.setFactionHousekeepingState({ factionPlans: [plan], lastReviewedTurnId: 'turn_5' });
        const serialized = Utils.serializeGameState({ currentPlayer: { id: 'player_1', name: 'Tester', level: 3 }, gameLocations: new Map(), gameLocationExits: new Map(), regions: new Map(), chatHistory: [], generatedImages: new Map(), things: new Map(), players: new Map(), skills: new Map(), factions: new Map(), currentSetting: null, pendingRegionStubs: new Map() });
        assert.deepEqual(serialized.metadata.factionHousekeepingState.factionPlans, [plan]);
        const hydrationContext = () => ({ gameLocations: new Map(), gameLocationExits: new Map(), regions: new Map(), chatHistoryRef: [], generatedImages: new Map(), things: new Map(), players: new Map(), skills: new Map(), factions: new Map(), jobQueue: [], imageJobs: new Map(), pendingLocationImages: new Map(), npcGenerationPromises: new Map(), pendingRegionStubs: new Map() });
        Globals.setFactionHousekeepingState(null);
        Utils.hydrateGameState(serialized, hydrationContext());
        assert.deepEqual(Globals.getFactionHousekeepingState().factionPlans, [plan]);
        delete serialized.metadata.factionHousekeepingState;
        Utils.hydrateGameState(serialized, hydrationContext());
        assert.deepEqual(Globals.getFactionHousekeepingState(), normalizeFactionHousekeepingState());
    } finally {
        Globals.config = saved.config; Globals.sceneSummaries = saved.sceneSummaries;
        Globals.worldTime = saved.worldTime; Globals.calendarDefinition = saved.calendarDefinition;
        Globals.setFactionHousekeepingState(saved.state);
    }
});

test('real event checks schedule independent faction cadence, excluding recursive and suppressed passes', async () => {
    const LLMClient = require('../LLMClient.js');
    const saved = { config: Globals.config, player: Globals.currentPlayer, completion: LLMClient.chatCompletion, log: LLMClient.logPrompt, deps: Events._deps, timeout: Events._baseTimeout, parsers: Events._parsers, aggregators: Events._aggregators, handlers: Events._handlers, normal: Events._housekeepingPromptRunner, faction: Events._factionHousekeepingPromptRunner, counters: Events.getMaintenancePromptTurnCounters() };
    const player = { isNPC: false, name: 'Wanderer', currency: 0, getCurrency() { return this.currency; }, adjustCurrency(amount) { this.currency += amount; } };
    try {
        Globals.config = { ai: {}, event_checks: { enabled: true }, housekeeping: { interval: 4 }, faction_housekeeping: { interval: 11 }, quests: { enabled: false }, omit_npc_generation: true };
        Globals.currentPlayer = player;
        LLMClient.logPrompt = () => {};
        LLMClient.chatCompletion = async options => (options.messages?.at(-1)?.content || '').includes('Identify only techniques whose completed learning')
            ? '<techniqueSelections/>'
            : '<events><currency><amount>7</amount></currency><inCombat><value>false</value></inCombat><anyQuestObjectivesCompleted><value>false</value></anyQuestObjectivesCompleted></events>';
        Events.initialize({ promptEnv: { render: () => 'prompt' }, parseXMLTemplate: rendered => ({ systemPrompt: 'system', generationPrompt: rendered }), prepareBasePromptContext: async () => ({ needBarDefinitions: [], npcs: [], party: [] }), Location: { get: () => null }, findRegionByLocationId: () => null, getCurrentPlayer: () => player, getConfig: () => Globals.config });
        Events.resetMaintenancePromptTurnCounters();
        const calls = [];
        let turn = 0;
        Events.setHousekeepingPromptRunner(async () => calls.push(['normal', turn]));
        Events.setFactionHousekeepingPromptRunner(async () => calls.push(['faction', turn]));
        for (turn = 1; turn <= 11; turn++) {
            await Events.runEventChecks({ textToCheck: 'Coins appear.', suppressNeedBarEventChecks: true });
            if (turn === 3) {
                await Events.runEventChecks({ textToCheck: 'Followup.', suppressNeedBarEventChecks: true, _depth: 1 });
                await Events.runEventChecks({ textToCheck: 'Replay or split pass.', suppressNeedBarEventChecks: true, suppressHousekeeping: true });
            }
        }
        assert.deepEqual(calls, [['normal', 4], ['normal', 8], ['faction', 11]]);
        assert.equal(Events.getMaintenancePromptTurnCounters().housekeepingTurnCounter, 11);
    } finally {
        Globals.config = saved.config; Globals.currentPlayer = saved.player;
        LLMClient.chatCompletion = saved.completion; LLMClient.logPrompt = saved.log;
        Events._deps = saved.deps; Events._baseTimeout = saved.timeout; Events._parsers = saved.parsers; Events._aggregators = saved.aggregators; Events._handlers = saved.handlers;
        Events.setHousekeepingPromptRunner(saved.normal); Events.setFactionHousekeepingPromptRunner(saved.faction); Events.hydrateMaintenancePromptTurnCounters(saved.counters);
    }
});

test('context uses intended setting tone and base prompt maps saved plans to faction IDs', () => {
    const { createPromptEnv, buildBaseRenderContext } = require('./helpers/baseContextFixtures.js');
    const built = buildFactionHousekeepingContext({ baseContext: { setting: { tone: 'Cautious hope', description: 'A cold world' } }, factions: new Map(), chatHistory: [] });
    assert.equal(built.context.intendedTone, 'Cautious hope');
    const plan = { factionRef: 'faction_1', role: 'ally', plan: 'Guard <bridge> & road', awarenessConstraints: 'private', nextSteps: ['scout'] };
    const context = buildBaseRenderContext({ question: 'What now?', currencyName: 'Gold', regionName: '', promptUsesCaching: true, overrides: { factions: [{ id: 'faction_1', name: 'Bridge Wardens', tags: [], goals: [] }], factionHousekeepingPlans: [plan], recentGameHistory: 'The latest turn.' } });
    const rendered = createPromptEnv().render('base-context.xml.njk', context);
    assert.match(rendered, /<faction>\s*<id>faction_1<\/id>\s*<name>Bridge Wardens<\/name>/);
    assert.match(rendered, /### Bridge Wardens \(faction_1\)/);
    assert.match(rendered, /\*\*Role:\*\* ally/);
    assert.match(rendered, /\*\*Next steps:\*\*\s+- scout/);
    assert.match(rendered, /\*\*Awareness and timing:\*\* private/);
    assert.match(rendered, /Guard &lt;bridge&gt; &amp; road/);
    assert.doesNotMatch(rendered, /<factionPlans>|<factionPlan>|<factionRef>/);
    const summaryStart = rendered.indexOf('## Current faction plans');
    const recentBoundary = rendered.indexOf('[[[AI_RPG_INTERNAL_MESSAGE_BOUNDARY_RECENT_STORY_HISTORY_V1]]]');
    assert.ok(summaryStart > rendered.indexOf('[[[AI_RPG_INTERNAL_MESSAGE_BOUNDARY_STABLE_CONTEXT_V1]]]'));
    assert.ok(summaryStart < recentBoundary);
    assert.match(rendered.slice(summaryStart, recentBoundary), /\*\*Awareness and timing:\*\* private/);
    assert.match(rendered.slice(recentBoundary), /<recentStoryHistory>The latest turn\.<\/recentStoryHistory>/);
    const empty = createPromptEnv().render('base-context.xml.njk', { ...context, factionHousekeepingPlans: [] });
    assert.doesNotMatch(empty, /## Current faction plans/);
});

test('commit tolerates unrelated artwork changes while rejecting a changed faction roster', async () => {
    const f = factionFixture();
    try {
        const staged = await stageFactionHousekeepingProposal({ proposal: f.proposal, factions: f.factions, generateFactionsList: f.generator });
        f.a.imagePrompt = 'Updated art';
        const result = commitFactionHousekeepingProposal({ staged, factions: f.factions, boundary: {}, setState: () => {} });
        assert.equal(f.a.imagePrompt, 'Updated art');
        assert.equal(result.createdFactions.length, 1);
    } finally { f.cleanup(); }
    const other = factionFixture();
    try {
        const staged = await stageFactionHousekeepingProposal({ proposal: other.proposal, factions: other.factions, generateFactionsList: other.generator });
        other.a.description = 'Changed identity';
        assert.throws(() => commitFactionHousekeepingProposal({ staged, factions: other.factions, boundary: {}, setState: () => {} }), /roster changed/);
        assert.equal(other.factions.size, 2);
    } finally { other.cleanup(); }
});

test('context retains current settled events and distinguishes scheduled commitments from tentative plans', () => {
    const plan = { factionRef: 'faction_1', role: 'ally', plan: 'Send help', awarenessConstraints: 'private', nextSteps: ['prepare'] };
    const { context } = buildFactionHousekeepingContext({ baseContext: {}, factions: new Map(), chatHistory: [], previousState: { factionPlans: [plan] }, actionText: 'Search the bridge', textToCheck: 'The bridge shakes.', currentEventText: 'The bridge collapsed.', scheduledEvents: [{ id: 'event_1', status: 'pending', event: 'Repair crew arrives', targetWorldMinute: 100 }, { id: 'event_2', status: 'completed', event: 'Old event' }] });
    assert.match(context.currentSituation, /Search the bridge/);
    assert.match(context.currentSituation, /bridge collapsed/);
    assert.deepEqual(context.pendingDevelopments.map(item => [item.reference, item.commitment]), [['faction_1', 'tentative'], ['event_1', 'committed']]);
    assert.match(context.pendingDevelopments[1].description, /does not establish player awareness/);
    assert.deepEqual(context.deadlines, []);
});

test('public evidence includes delivered actor-name NPC prose and excludes hidden and diagnostic rows', () => {
    const chatHistory = [
        { id: 'npc_public', role: 'Mira', type: 'npc-action', content: 'The bridge closes at dusk.' },
        { id: 'assistant_public', role: 'assistant', type: 'player-action', content: 'You see the bridge.' },
        { id: 'npc_hidden', role: 'Mira', type: 'npc-action', content: 'Private secret.', metadata: { hiddenFromClient: true } },
        { id: 'diagnostic', role: 'assistant', type: 'npc-action', content: 'Diagnostic.', toolCalls: [{ name: 'x' }] },
        { id: 'system', role: 'system', type: 'npc-action', content: 'System note.' },
        { id: 'user', role: 'user', type: 'npc-action', content: 'User action.' }
    ];
    const { context } = buildFactionHousekeepingContext({ baseContext: {}, factions: new Map(), chatHistory });
    assert.deepEqual(context.publicPassages.map(item => item.reference), ['npc_public', 'assistant_public']);
});

function factionHistory(count) {
    return Array.from({ length: count }, (_, index) => {
        const n = index + 1;
        return [
            { id: `turn_${n}`, role: 'user', type: 'player-action', content: `Action ${n}`, timestamp: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString() },
            { id: `passage_${n}`, role: 'assistant', type: 'player-action', content: `Public passage ${n}.` },
            { id: `secret_${n}`, role: 'assistant', type: 'supplemental-story-info', content: `Private fact ${n}.`, metadata: { hiddenFromClient: true } },
            { id: `event_${n}`, role: 'assistant', type: 'event-summary', content: `Event ${n}.` }
        ];
    }).flat();
}

function factionContext(history, options = {}) {
    return buildFactionHousekeepingContext({ baseContext: {}, factions: new Map(), chatHistory: history, interval: 5, ...options });
}

test('faction reviews process an old backlog in bounded consecutive batches without skipping turns', () => {
    const history = factionHistory(300);
    let previousState = { factionPlans: [], lastReviewedTurnId: 'turn_1', lastReviewedTurnTimestamp: null };
    const boundaries = [];
    for (let run = 0; run < 30; run++) {
        const result = factionContext(history, { previousState });
        const from = 2 + run * 10;
        const to = Math.min(from + 9, 300);
        assert.deepEqual(result.context.publicPassages.map(p => p.reference), Array.from({ length: to - from + 1 }, (_, i) => `passage_${from + i}`));
        assert.ok(JSON.stringify(result.context).length < 12000, 'history payload remains bounded as history grows');
        assert.equal(result.boundary.lastReviewedTurnId, `turn_${to}`);
        boundaries.push(result.boundary.lastReviewedTurnId);
        previousState = { factionPlans: [], ...result.boundary };
    }
    assert.equal(boundaries.at(-1), 'turn_300');
});

test('first faction review chooses the latest interval and deleted boundaries resume by timestamp', () => {
    const history = factionHistory(12);
    const initial = factionContext(history);
    assert.deepEqual(initial.context.publicPassages.map(p => p.reference), ['passage_8', 'passage_9', 'passage_10', 'passage_11', 'passage_12']);
    assert.equal(initial.boundary.lastReviewedTurnId, 'turn_12');
    const resumed = factionContext(history, { previousState: { factionPlans: [], lastReviewedTurnId: 'deleted', lastReviewedTurnTimestamp: '2026-01-01T00:03:30.000Z' } });
    assert.deepEqual(resumed.context.publicPassages.map(p => p.reference), ['passage_4', 'passage_5', 'passage_6', 'passage_7', 'passage_8', 'passage_9', 'passage_10', 'passage_11', 'passage_12']);
    assert.equal(resumed.boundary.lastReviewedTurnId, 'turn_12');
});

test('deferred current turn supplements remain visible without moving the backlog boundary', () => {
    const history = factionHistory(20);
    const result = factionContext(history, {
        previousState: { factionPlans: [], lastReviewedTurnId: 'turn_1', lastReviewedTurnTimestamp: null },
        currentTurnId: 'turn_20', actionText: 'Updated current action', textToCheck: 'Updated current public prose.', currentEventText: 'Settled current event.'
    });
    assert.equal(result.boundary.lastReviewedTurnId, 'turn_11');
    const combined = JSON.stringify(result.context);
    assert.match(combined, /Updated current action/);
    assert.match(combined, /Updated current public prose/);
    assert.match(combined, /Settled current event/);
    assert.doesNotMatch(combined, /Public passage 12\./);
    assert.match(combined, /Private fact 20\./);
});

test('saved citations preserve only explicitly referenced older public passages and history prose is not duplicated', () => {
    const history = factionHistory(20);
    const plan = { factionRef: 'faction_1', role: 'ally', plan: 'Watch the road', nextSteps: ['Prepare'], awarenessConstraints: 'The player heard the deadline in passage_2.' };
    const result = factionContext(history, { previousState: { factionPlans: [plan], lastReviewedTurnId: 'turn_15', lastReviewedTurnTimestamp: null } });
    assert.deepEqual(result.context.publicPassages.map(p => p.reference), ['passage_2', 'passage_16', 'passage_17', 'passage_18', 'passage_19', 'passage_20']);
    const serialized = JSON.stringify(result.context);
    assert.equal((serialized.match(/Public passage 16\./g) || []).length, 1);
    assert.doesNotMatch(serialized, /Public passage 3\./);
    assert.doesNotMatch(serialized, /Private fact 3\./);
    assert.match(serialized, /Event 16\./);
    assert.match(serialized, /Action 16/);
});

test('an indivisibly oversized faction history record fails clearly', () => {
    const history = factionHistory(1);
    history[1].content = 'x'.repeat(150000);
    assert.throws(() => factionContext(history), /(?:too (?:large|long)|exceed|budget|limit)/i);
});

function projectHiddenNotes(text, onReplacement) {
    const replace = (source, pattern, replacement) => {
        let delta = 0;
        return source.replace(pattern, (match, offset) => {
            const start = offset + delta;
            onReplacement?.(start, start + match.length, replacement.length);
            delta += replacement.length - match.length;
            return replacement;
        });
    };
    let result = replace(text, /<hidden\b[^>]*>[\s\S]*?<\/hidden>/gi, '');
    result = replace(result, /<hidden\b[^>]*>[\s\S]*$/gi, '');
    result = replace(result, /[ \t]+\n/g, '\n');
    result = replace(result, /\n{3,}/g, '\n\n');
    const trimmed = result.trim();
    const leading = result.length - result.trimStart().length;
    if (leading) onReplacement?.(0, leading, 0);
    if (result.length - leading > trimmed.length) onReplacement?.(trimmed.length, result.length - leading, 0);
    return trimmed;
}

test('selected turn projects public text, actor prose and private supplemental facts separately', () => {
    const history = [
        { id: 'orphan', role: 'assistant', type: 'npc-action', content: 'An earlier orphan public passage.' },
        { id: 'turn_1', role: 'user', type: 'player-action', content: 'Ask Mira.' },
        { id: 'mixed', role: 'assistant', type: 'player-action', content: 'The gate opens.<hidden>Secret note.</hidden>' },
        { id: 'actor', role: 'Mira', type: 'npc-action', content: 'Mira waves.' },
        { id: 'secret', role: 'assistant', type: 'supplemental-story-info', content: 'Private instruction.', metadata: { hiddenFromClient: true } }
    ];
    const result = factionContext(history, { publicText: projectHiddenNotes });
    assert.deepEqual(result.context.publicPassages.map(p => p.reference), ['orphan', 'mixed', 'actor']);
    const publicText = JSON.stringify(result.context.publicPassages);
    assert.match(publicText, /Mira waves/);
    assert.doesNotMatch(publicText, /Secret note|Private instruction/);
    assert.ok(result.context.knownFacts.some(fact => fact.reference === 'secret' && fact.description === 'Private instruction.'));
});

test('character budget stops at a whole-turn boundary and the next review resumes there', () => {
    const history = factionHistory(4);
    for (const entry of history.filter(entry => entry.id.startsWith('passage_'))) entry.content = `${entry.id}: ${'x'.repeat(40000)}`;
    const first = factionContext(history, { previousState: { factionPlans: [], lastReviewedTurnId: 'turn_1', lastReviewedTurnTimestamp: null } });
    assert.deepEqual(first.context.publicPassages.map(p => p.reference), ['passage_2', 'passage_3']);
    assert.equal(first.boundary.lastReviewedTurnId, 'turn_3');
    const second = factionContext(history, { previousState: { factionPlans: [], ...first.boundary } });
    assert.deepEqual(second.context.publicPassages.map(p => p.reference), ['passage_4']);
    assert.equal(second.boundary.lastReviewedTurnId, 'turn_4');
});

test('inline hidden blocks survive as private continuity while projected public prose stays clean', () => {
    const history = [
        { id: 'turn_1', role: 'user', content: 'Inspect.' },
        { id: 'mixed', role: 'assistant', type: 'player-action', content: '  Public. <hidden>First secret.</hidden> \n\n\nMore public.<hidden>Second secret.</hidden>\n <hidden>Dangling secret.' }
    ];
    const { context } = factionContext(history, { publicText: projectHiddenNotes });
    const passage = context.publicPassages.find(item => item.reference === 'mixed');
    assert.match(passage.text, /Public\./);
    assert.match(passage.text, /More public\./);
    assert.doesNotMatch(passage.text, /secret|hidden/i);
    const note = context.knownFacts.find(item => item.reference === 'mixed' && item.visibility === 'private');
    for (const secret of ['First secret.', 'Second secret.', 'Dangling secret.']) assert.ok(note.description.includes(secret));
    assert.doesNotMatch(context.currentSituation, /secret/i);
    assert.throws(() => factionContext(history, { publicText: text => text.replace(/<hidden\b[\s\S]*/i, '') }), /replacement callbacks/i);
});

test('review boundary timestamp becomes null when the newly reviewed turn lacks one', () => {
    const history = factionHistory(2);
    delete history.find(entry => entry.id === 'turn_2').timestamp;
    const { boundary } = factionContext(history, { previousState: { factionPlans: [], lastReviewedTurnId: 'turn_1', lastReviewedTurnTimestamp: '2026-01-01T00:01:00.000Z' } });
    assert.equal(boundary.lastReviewedTurnId, 'turn_2');
    assert.equal(boundary.lastReviewedTurnTimestamp, null);
});

test('history budget counts XML expansion before accepting an indivisible turn', () => {
    const history = factionHistory(1);
    history[1].content = '&'.repeat(20000);
    assert.throws(() => factionContext(history), /(?:exceed|budget|cannot fit)/i);
});
