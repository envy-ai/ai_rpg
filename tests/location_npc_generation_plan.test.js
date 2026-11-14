'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Utils = require('../Utils.js');
const { loadXmlGenerationSchema, compileXmlGenerationSchema } = require('../XmlGenerationSchema.js');
const { parseLocationNpcXmlPlan, parseLocationNpcCheckpoint } = require('../LocationNpcGenerationPlan.js');

const planSchema = loadXmlGenerationSchema('location-npc-plan.schema.xml');
const playerFields = compileXmlGenerationSchema('<fields><customTrait optional="true">A custom trait</customTrait></fields>');
const rowSchema = loadXmlGenerationSchema('location-npc-checkpoint.schema.xml', { extensions: { playerFields: [playerFields] } });
const row = (kind, name, quantity, description) => `<npc><kind>${kind}</kind><name>${name}</name><quantity>${quantity}</quantity><description>${description}</description></npc>`;
const plan = entries => `<npcsPlan>${entries}</npcsPlan>`;
const approved = { kind: 'npc', name: 'Pell', quantity: 2, description: 'A dock worker.' };
function parseNpcXml(xml) {
    const root = Utils.parseXmlDocumentStrict(xml).documentElement;
    const npc = root.getElementsByTagName('npc')[0] || root.getElementsByTagName('hostile')[0];
    const text = name => npc.getElementsByTagName(name)[0]?.textContent.trim() || '';
    const record = root.getElementsByTagName('npcMemories')[0];
    require('../GeneratedNpcTechniques.js').parseGeneratedNpcTechniques(npc);
    return { npcs: [{ name: text('name'), quantity: Number(text('quantity')), isHostile: text('isHostile') === 'true', description: text('description'), customTrait: text('customTrait') }],
        memories: record ? new Map([[record.getElementsByTagName('npcName')[0].textContent.trim().toLowerCase(), [...record.getElementsByTagName('memory')].map(node => node.textContent)]]) : new Map() };
}

test('NPC plan requires strict nonempty roster with distinct valid profiles but does not enforce hinted totals', () => {
    const response = plan(row('npc', 'Pell', 2, 'Dock worker') + row('hostile', 'Moth', 1, 'Hungry creature'));
    assert.deepEqual(parseLocationNpcXmlPlan(response, { schema: planSchema, maxQuantity: 3 }), [
        { kind: 'npc', name: 'Pell', quantity: 2, description: 'Dock worker' },
        { kind: 'hostile', name: 'Moth', quantity: 1, description: 'Hungry creature' }
    ]);
    for (const bad of [plan(''), plan(row('npc', 'Pell', 0, 'Worker')), plan(row('other', 'Pell', 1, 'Worker')),
        plan(row('npc', 'Pell', 1, 'Worker') + row('hostile', 'pell', 1, 'Creature')),
        plan('<npc><kind>npc</kind><name>Pell</name><quantity>1</quantity></npc>'),
        plan(row('npc', 'Pell', 1, 'Worker').replace('</npc>', '<unexpected>bad</unexpected></npc>'))]) {
        assert.throws(() => parseLocationNpcXmlPlan(bad, { schema: planSchema, maxQuantity: 3 }));
    }
});

test('one NPC checkpoint binds approved identity and validates schema before candidate preparation', () => {
    const prepared = [];
    const options = { schema: rowSchema, parseNpcXml, validateCandidates: entries => prepared.push(entries) };
    const response = '<response><npcs><npc><customTrait>Steady</customTrait></npc></npcs><memories><npcMemories><memory>A storm passed.</memory></npcMemories></memories></response>';
    const result = parseLocationNpcCheckpoint(response, approved, options);
    assert.deepEqual(result.npc, { name: 'Pell', quantity: 2, isHostile: false, description: 'A dock worker.', customTrait: 'Steady' });
    assert.deepEqual(result.memories.get('pell'), ['A storm passed.']);
    assert.equal(prepared.length, 1);
    for (const blank of ['<name/><quantity/><isHostile/><description/>', '<name></name><quantity> </quantity><isHostile>  </isHostile><description>  </description>', '<name>Pell</name><quantity>2</quantity><isHostile>false</isHostile><description>A dock worker.</description>']) {
        const blankResponse = `<response><npcs><npc>${blank}</npc></npcs><memories><npcMemories><npcName>  </npcName><memory>Note.</memory></npcMemories></memories></response>`;
        const normalized = parseLocationNpcCheckpoint(blankResponse, approved, options);
        assert.equal(normalized.npc.name, 'Pell');
        assert.equal(normalized.npc.quantity, 2);
        assert.equal(normalized.npc.isHostile, false);
        assert.equal(normalized.npc.description, 'A dock worker.');
        assert.deepEqual(normalized.memories.get('pell'), ['Note.']);
    }
    const preparedBeforeInvalid = prepared.length;
    const malformed = [
        '<response><npcs><npc><description>A worker.</description><unexpected>bad</unexpected></npc></npcs></response>',
        '<response><npcs><npc><description>One.</description><description>Two.</description></npc></npcs></response>',
        '<response><npcs><npc><startingNeeds><needBar><startingLevel>50</startingLevel></needBar></startingNeeds></npc></npcs></response>',
        '<response><npcs><npc><name>Another</name></npc></npcs></response>',
        '<response><npcs><npc><description>A changed concept.</description></npc></npcs></response>',
        '<response><npcs><npc><quantity>0</quantity></npc></npcs></response>',
        '<response><npcs><npc><isHostile>true</isHostile></npc></npcs></response>',
        '<response><hostiles><hostile/></hostiles></response>',
        '<response><npcs><npc/></npcs><memories><npcMemories><npcName>Another</npcName></npcMemories></memories></response>'
    ];
    for (const bad of malformed) assert.throws(() => parseLocationNpcCheckpoint(bad, approved, options), /Pell|schema/i);
    assert.equal(prepared.length, preparedBeforeInvalid, 'invalid rows never reach detached candidate preparation');
    assert.throws(() => parseLocationNpcCheckpoint('<response><hostiles><hostile><isHostile>false</isHostile></hostile></hostiles></response>',
        { ...approved, kind: 'hostile' }, options), /isHostile/);
});

test('NPC checkpoint preserves cancellation identity from validation', () => {
    const cancelled = Object.assign(new Error('cancelled'), { code: 'PROMPT_CANCELLED' });
    assert.throws(() => parseLocationNpcCheckpoint('<response><npcs><npc/></npcs></response>', approved,
        { schema: rowSchema, parseNpcXml, validateCandidates: () => { throw cancelled; } }), error => error === cancelled);
});

test('native TinyBrain NPC program retries only invalid checkpoints and assembles accepted rows without a final completion', async () => {
    const path = require('node:path');
    const nunjucks = require('nunjucks');
    const LLMClient = require('../LLMClient.js');
    const { addXmlTextFilter } = require('../nunjucks_filters.js');
    const { TinyBrainPromptExtension } = require('../TinyBrainPromptRunner.js');
    const { configureTinyBrainPromptContext, runTinyBrainPromptProgram } = require('../TinyBrainPromptFamilies.js');
    const { runLocationNpcGenerationProgram } = require('../LocationNpcGenerationProgram.js');
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts')), { autoescape: false });
    addXmlTextFilter(env);
    env.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    env.addGlobal('randomword', () => 'fixture');
    const context = { acceptedLocationGenerationResponse: '<location>Accepted Harbor</location>', otherKnownLocationsText: '', location: { name: 'Harbor', description: 'A dock.' }, setting: {}, config: {}, numNpcs: 1, numHostiles: 1,
        bannedWords: [], attributeDefinitions: {}, attributes: [], needBars: [], playerGeneratorPromptFields: [],
        techniqueCatalogueForGeneration: [], existingNpcsInOtherRegions: [], existingNpcsInOtherLocations: [], existingNpcsInThisLocation: [] };
    const tinyBrain = configureTinyBrainPromptContext(context, 'location_npc_generation');
    const rendered = 'Fixed context.\n' + tinyBrain.renderState.programStartMarker + env.render(tinyBrain.programTemplateName, context);
    const roster = plan(row('npc', 'Pell', 1, 'A dock worker.') + row('hostile', 'Moth', 1, 'A hungry creature.'));
    const responses = ['<npcsPlan><npc>', roster,
        '<response><npcs><npc><shortDescription>Worker.</shortDescription></npc></npcs></response>',
        '<response><hostiles><hostile><unexpected>bad</unexpected></hostile></hostiles></response>',
        '<response><hostiles><hostile><startingNeeds><needBar><startingLevel>50</startingLevel></needBar></startingNeeds></hostile></hostiles></response>',
        '<response><hostiles><hostile><startingTechniques><techniqueId>discipline_fake</techniqueId></startingTechniques></hostile></hostiles></response>',
        '<response><hostiles><hostile><shortDescription>Moth.</shortDescription></hostile></hostiles></response>'];
    const calls = [], prepared = [];
    const Player = require('../Player.js');
    const IdGenerator = require('../IdGenerator.js');
    const initialCount = Player.getAll().length, initialCharCounter = IdGenerator.snapshotCounters().char || 0;
    const oldLog = LLMClient.logPrompt;
    LLMClient.logPrompt = () => path.join(__dirname, '..', 'tmp', 'location-npc-runner-test.log');
    try {
        const result = await runLocationNpcGenerationProgram({ promptEnv: env,
            parseXMLTemplate: renderedText => ({ systemPrompt: 'fixture', generationPrompt: renderedText }),
            initialRenderedTemplate: rendered, templateContext: context, tinyBrain,
            maxAttempts: 4, maxQuantity: 3, schemaExtensions: { playerFields: [] }, parseNpcXml,
            validateCandidates: entries => prepared.push(entries), runProgram: runTinyBrainPromptProgram,
            completeStage: async (stage, schema) => {
                calls.push({ schema, checkpoint: stage.checkpoint?.parserName, messages: stage.messages });
                assert.equal(Player.getAll().length, initialCount);
                assert.equal(IdGenerator.snapshotCounters().char || 0, initialCharCounter);
                const aiResponse = responses.shift();
                assert.notEqual(aiResponse, undefined, 'no extra completion is required for local assembly');
                return { aiResponse, conversationMessages: [...stage.messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
            }
        });
        assert.equal(responses.length, 0);
        for (const call of calls) {
            const transcript = call.messages.map(message => message.content || '').join('\n');
            assert.equal((transcript.match(/Fixed context\./g) || []).length, 1, 'the existing base context is not duplicated');
        }
        assert.deepEqual(calls.map(call => call.schema), [
            'location-npc-plan.schema.xml', 'location-npc-plan.schema.xml',
            'location-npc-checkpoint.schema.xml', 'location-npc-checkpoint.schema.xml',
            'location-npc-checkpoint.schema.xml', 'location-npc-checkpoint.schema.xml',
            'location-npc-checkpoint.schema.xml'
        ]);
        assert.equal(calls.filter(call => call.checkpoint === 'location_npc_entry').length, 5);
        assert.equal(prepared.length, 2, 'only accepted profiles reach detached preflight');
        assert.deepEqual(result.value.npcs.map(item => [item.name, item.quantity, item.isHostile, item.description]), [
            ['Pell', 1, false, 'A dock worker.'], ['Moth', 1, true, 'A hungry creature.']
        ]);
        assert.match(calls[3].messages.map(message => message.content || '').join('\n'), /A hungry creature\./);
        for (const tag of ['name', 'quantity', 'isHostile', 'description', 'npcName']) {
            assert.doesNotMatch(calls[3].messages.at(-1).content, new RegExp(`<${tag}>`, 'i'), `known ${tag} is not requested again`);
        }
        assert.match(calls[4].messages.at(-1).content, /unexpected|schema/i);
        assert.match(calls[5].messages.at(-1).content, /needBar|schema|id/i);
        assert.match(calls[6].messages.at(-1).content, /discipline_fake/);
        assert.match(calls[6].messages.at(-1).content, /techniqueId/i);
        assert.equal(Player.getAll().length, initialCount);
        assert.equal(IdGenerator.snapshotCounters().char || 0, initialCharCounter);
    } finally { LLMClient.logPrompt = oldLog; }
});

test('zero total location NPC hints skip the generation pipeline', async () => {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function generateLocationNPCs(');
    const end = source.indexOf('\nasync function generateRegionNPCs(', start);
    assert.ok(start >= 0 && end > start);
    const context = { config: {}, Region: { get: () => null }, players: new Map(), currentPlayer: null,
        Utils, getAllPlayers: () => [], buildReservedActorNameSet: () => new Set(),
        renderLocationNpcPrompt: () => { throw new Error('zero hints must not render or call a model'); } };
    const generate = vm.runInNewContext(`${source.slice(start, end)}\ngenerateLocationNPCs`, context);
    const result = await generate({ location: { id: 'loc', npcIds: [], generationHints: { numNpcs: 0, numHostiles: 0 } } });
    assert.equal(result.length, 0);
});
