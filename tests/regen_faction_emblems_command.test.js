'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Faction = require('../Faction.js');
const { initializeSlashCommands, getSlashCommandModule } = require('../SlashCommandRegistry.js');

function getCommand() {
    initializeSlashCommands();
    const command = getSlashCommandModule('regen_faction_emblems');
    assert.ok(command, 'regen_faction_emblems must be registered');
    return command;
}

async function withFactions(callback) {
    // Each node:test file runs in an isolated process; keep its registry clean.
    Faction.clear();
    try { return await callback(); } finally { Faction.clear(); }
}

function makeInteraction(generateFactionImage, clientId = 'client-factions') {
    const replies = [];
    return { clientId, generateFactionImage, replies, async reply(payload) { replies.push(payload); } };
}

test('regen_faction_emblems is registered and appears in help', async () => {
    const command = getCommand();
    assert.equal(command.name, 'regen_faction_emblems');
    assert.deepEqual(command.args, []);
    assert.equal(command.usage.trim(), '/regen_faction_emblems');
    const interaction = makeInteraction(null);
    await getSlashCommandModule('help').execute(interaction);
    assert.match(interaction.replies[0].content, /\/regen_faction_emblems/);
});

test('all registered factions use forced generation with the invoking client and distinct result groups', async () => withFactions(async () => {
    const first = new Faction({ id: 'faction-regen-a', name: 'Azure Watch' });
    const second = new Faction({ id: 'faction-regen-b', name: 'Bronze Guild' });
    const third = new Faction({ id: 'faction-regen-c', name: 'Cinder Circle' });
    const calls = [];
    const interaction = makeInteraction(async (faction, options) => {
        calls.push({ faction, options });
        if (faction === first) return { success: true, jobId: 'job-a' };
        if (faction === second) return { success: true, existingJob: true, jobId: 'job-b' };
        return { success: false, skipped: true, existingJob: true, reason: 'disabled' };
    }, 'client-faction-regeneration');
    await getCommand().execute(interaction, {});
    assert.deepEqual(calls.map(call => call.faction), [first, second, third]);
    assert.deepEqual(calls.map(call => call.options), Array.from({ length: 3 }, () => ({ force: true, clientId: 'client-faction-regeneration' })));
    assert.equal(interaction.replies.length, 1);
    assert.equal(interaction.replies[0].ephemeral, false);
    const content = interaction.replies[0].content;
    assert.match(content, /Queued[^\n]*Azure Watch/i);
    assert.match(content, /(?:Joined|existing)[^\n]*Bronze Guild/i);
    assert.match(content, /Skipped[^\n]*Cinder Circle[^\n]*disabled/i);
}));

test('empty faction registry gives an informative result without generating', async () => withFactions(async () => {
    let calls = 0;
    const interaction = makeInteraction(async () => { calls++; });
    await getCommand().execute(interaction, {});
    assert.equal(calls, 0);
    assert.equal(interaction.replies.length, 1);
    assert.match(interaction.replies[0].content, /no factions/i);
    assert.equal(interaction.replies[0].ephemeral, false);
}));

test('faction requests start concurrently to retain image prompt batching', async () => withFactions(async () => {
    const first = new Faction({ id: 'faction-concurrent-a', name: 'First' });
    const second = new Faction({ id: 'faction-concurrent-b', name: 'Second' });
    const calls = [], gates = [];
    const interaction = makeInteraction(faction => {
        calls.push(faction);
        return new Promise(resolve => { gates.push(() => resolve({ success: true, jobId: faction.id })); });
    });
    const running = getCommand().execute(interaction, {});
    await Promise.resolve();
    try {
        assert.deepEqual(calls, [first, second]);
        gates.forEach(resolve => resolve());
        await running;
        assert.match(interaction.replies[0].content, /Queued[^\n]*First[^\n]*Second/i);
    } finally { gates.forEach(resolve => resolve()); }
}));

test('missing faction image helper fails explicitly', async () => withFactions(async () => {
    new Faction({ id: 'faction-no-helper', name: 'No Helper' });
    const interaction = makeInteraction(null);
    await assert.rejects(getCommand().execute(interaction, {}), /faction.*(?:image|emblem).*helper.*unavailable/i);
    assert.deepEqual(interaction.replies, []);
}));

test('generator exceptions preserve their original error and stack', async () => withFactions(async () => {
    new Faction({ id: 'faction-error', name: 'Broken Faction' });
    const original = new Error('Fixture generation failure');
    const originalStack = original.stack;
    const interaction = makeInteraction(async () => { throw original; });
    await assert.rejects(getCommand().execute(interaction, {}), error => {
        assert.strictEqual(error, original);
        assert.equal(error.stack, originalStack);
        return true;
    });
    assert.deepEqual(interaction.replies, []);
}));

test('malformed generator results fail rather than reporting a queued emblem', async () => withFactions(async () => {
    new Faction({ id: 'faction-invalid-result', name: 'Invalid Result' });
    const interaction = makeInteraction(async () => ({}));
    await assert.rejects(getCommand().execute(interaction, {}), /invalid|failed|queue|result/i);
    assert.deepEqual(interaction.replies, []);
}));

test('slash-command interaction exposes the actual faction generator and normalized client ID', () => {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        function buildSlashCommandInteractionContext({');
    const end = source.indexOf("\n        app.post('/api/slash-command', async (req, res) => {", start);
    assert.ok(start >= 0 && end > start, 'slash interaction builder must exist');
    const generateFactionImage = async () => ({ success: true });
    const context = {
        chatHistory: [], performGameSave() {}, migrateCurrentDomainIds() {}, currentPlayer: null,
        adjustSlashCommandWorldTimeByMinutes() {}, runSlashCommandQuestCheckPrompt() {},
        skills: new Map(), things: new Map(), generateFactionImage
    };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.build = buildSlashCommandInteractionContext;`, context);
    const interaction = context.build({ clientId: '  tab-123  ' });
    assert.strictEqual(interaction.generateFactionImage, generateFactionImage);
    assert.equal(interaction.clientId, 'tab-123');
});
