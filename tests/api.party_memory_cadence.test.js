const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('async function processPartyMemoriesForCurrentTurn(');
    const end = source.indexOf('\n        function schedulePartyMemoriesForCurrentTurn', start);
    assert.ok(start >= 0 && end > start, 'party memory processing helper must exist');
    const calls = { prompt: [], dispositions: [], summaries: [] };
    const member = {
        id: 'npc_1', name: 'Dewdrop', turnsSincePartyMemoryGeneration: 0, segments: [],
        incrementTurnsSincePartyMemoryGeneration() { return ++this.turnsSincePartyMemoryGeneration; },
        resetTurnsSincePartyMemoryGeneration() { this.turnsSincePartyMemoryGeneration = 0; },
        addPartyMemoryHistorySegment(entries) { if (entries.length) this.segments.push(entries); },
        getPartyMemoryHistorySegments() { return this.segments; }
    };
    const player = { currentLocation: 'loc_1', getPartyMembers: () => [member.id], getPartyMembersRemovedThisTurn: () => [], clearPartyMembershipChangeTracking() {} };
    const context = {
        config: { party_generate_memory_interval: 2 }, players: new Map([[member.id, member]]),
        gameLocations: new Map([['loc_1', { id: 'loc_1', npcIds: [] }]]),
        chatHistory: [{ content: 'Dewdrop speaks', metadata: { npcNames: ['Dewdrop'] } }],
        isNpcMemoryPromptEligible: () => true, filterPromptHistoryEntries: entries => entries,
        runNpcMemoriesPrompt: async options => { calls.prompt.push(options); return { dispositions: [{ value: 1 }] }; },
        applyDispositionChanges: changes => { calls.dispositions.push(changes); return changes; },
        appendAppliedDispositionChanges: (target, changes) => target.push(...changes),
        recordDispositionPromptSummary: payload => { calls.summaries.push(payload); return true; },
        console: { log() {}, warn() {} }
    };
    const process = vm.runInNewContext(`(${source.slice(start, end).trim()})`, context);
    const locationStart = source.indexOf('async function generateNpcMemoriesForLocationChange(');
    assert.ok(locationStart >= 0 && locationStart < start);
    const processLocation = vm.runInNewContext(`(${source.slice(locationStart, start).trim()})`, context);
    const historyEntries = [{ content: 'Dewdrop speaks to the player', metadata: { npcNames: ['Dewdrop'] } }];
    return { member, player, process, processLocation, historyEntries, calls };
}

test('ordinary gameplay advances party memory and disposition on the configured interval', async () => {
    const h = harness();
    await h.process({ player: h.player, historyEntries: h.historyEntries });
    assert.equal(h.member.turnsSincePartyMemoryGeneration, 1);
    assert.equal(h.calls.prompt.length, 0);
    await h.process({ player: h.player, historyEntries: h.historyEntries });
    assert.equal(h.calls.prompt.length, 1);
    assert.equal(h.calls.dispositions.length, 1);
    assert.equal(h.calls.summaries.length, 1);
    assert.equal(h.member.turnsSincePartyMemoryGeneration, 0);
});

test('location-change bookkeeping for event travel does not count a second party turn', async () => {
    const h = harness();
    await h.process({ player: h.player, historyEntries: h.historyEntries });
    await h.processLocation({ player: h.player, previousLocationId: 'loc_1', newLocationId: 'loc_2', isNonEventTravel: false });
    assert.equal(h.member.turnsSincePartyMemoryGeneration, 1);
    assert.equal(h.calls.prompt.length, 0);
});

test('background scheduling runs the same interval and publishes its disposition summary', async () => {
    const h = harness();
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('function schedulePartyMemoriesForCurrentTurn(');
    const end = source.indexOf('\n        function createPromptToolCallDebugRecorder', start);
    assert.ok(start >= 0 && end > start);
    const notifications = [];
    const schedule = vm.runInNewContext(`(${source.slice(start, end).trim()})`, {
        getContextRuntimeGeneration: () => 1,
        processPartyMemoriesForCurrentTurn: h.process,
        trackTurnContextWork: task => task,
        recordTurnContextError: error => { throw error; },
        Globals: { emitToClient: (...args) => notifications.push(args) },
        console, setImmediate
    });
    const options = { player: h.player, historyEntries: h.historyEntries, clientId: 'client_1' };
    const first = schedule(options);
    assert.equal(h.member.turnsSincePartyMemoryGeneration, 0, 'scheduling does not block the response');
    await first;
    assert.equal(h.member.turnsSincePartyMemoryGeneration, 1);
    await schedule(options);
    assert.equal(h.calls.prompt.length, 1);
    assert.equal(h.calls.dispositions.length, 1);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0][0], 'client_1');
    assert.equal(notifications[0][1], 'chat_history_updated');
});

test('direct movement location-change processing counts and triggers at the same interval', async () => {
    const h = harness();
    await h.processLocation({ player: h.player, previousLocationId: 'loc_1', newLocationId: 'loc_2' });
    assert.equal(h.member.turnsSincePartyMemoryGeneration, 1);
    await h.processLocation({ player: h.player, previousLocationId: 'loc_1', newLocationId: 'loc_2' });
    assert.equal(h.calls.prompt.length, 1);
    assert.equal(h.calls.dispositions.length, 1);
    assert.equal(h.member.turnsSincePartyMemoryGeneration, 0);
});

test('chat schedules only completed gameplay and leaves direct travel to movement', () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const chatStart = source.indexOf("app.post('/api/chat', withTurnPromptAudit('/api/chat'");
    const chatEnd = source.indexOf("app.post('/api/npcs/:id/teleport'", chatStart);
    assert.ok(chatStart >= 0 && chatEnd > chatStart);
    const chat = source.slice(chatStart, chatEnd);
    assert.match(chat, /let partyMemoryTurnCompleted = false;/);
    assert.equal((chat.match(/partyMemoryTurnCompleted\s*=/g) || []).length, 2,
        'only the successful gameplay completion sets the marker after its false initialization');
    assert.match(chat, /partyMemoryTurnCompleted = !currentActionIsTravel \|\| travelMetadataIsEventDriven;\s*await respond\(responseData\);/);
    assert.match(chat, /if \(statusCode === 200 && partyMemoryTurnCompleted\)\s*\{\s*schedulePartyMemoriesForCurrentTurn\(/);
    assert.match(chat, /generateNpcMemoriesForLocationChange\(\{[\s\S]*?isNonEventTravel:\s*false,/);

    const moveStart = source.indexOf("app.post('/api/player/move'");
    const moveEnd = source.indexOf("app.post('/api/craft'", moveStart);
    assert.ok(moveStart >= 0 && moveEnd > moveStart);
    assert.match(source.slice(moveStart, moveEnd), /generateNpcMemoriesForLocationChange\(\{\s*previousLocationId:[\s\S]*?newLocationId:[\s\S]*?player: currentPlayer\s*\}\)/);
});
