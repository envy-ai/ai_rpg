'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Faction = require('../Faction.js');
const SettingInfo = require('../SettingInfo.js');

test('100-faction saved settings and active records retain exactly three directed edges', () => {
    SettingInfo.clear();
    Faction.clear();
    try {
        const roster = Array.from({ length: 100 }, (_, index) => ({ id: `faction_${index + 1}`, name: `Faction ${index + 1}`, relations: {} }));
        roster[0].relations.faction_2 = { status: 'neutral', notes: 'A cautious truce.' };
        roster[0].relations.faction_3 = { status: 'allied', notes: 'An established pact.' };
        roster[3].relations.faction_1 = { status: 'hostile', notes: 'A lasting dispute.' };
        const setting = new SettingInfo({ name: 'Sparse Faction World', defaultFactions: roster });
        const restored = SettingInfo.fromJSON(JSON.parse(JSON.stringify(setting.toJSON())));
        const drafts = restored.toJSON().defaultFactions;
        assert.equal(drafts.length, 100);
        assert.equal(drafts.reduce((total, faction) => total + Object.keys(faction.relations).length, 0), 3);
        assert.deepEqual(drafts[0].relations.faction_2, { status: 'neutral', notes: 'A cautious truce.' });
        assert.deepEqual(drafts[1].relations, {});
        const active = drafts.map(draft => Faction.fromJSON(draft));
        const roundTrip = active.map(faction => Faction.fromJSON(JSON.parse(JSON.stringify(faction.toJSON()))));
        assert.equal(roundTrip.reduce((total, faction) => total + Object.keys(faction.toJSON().relations).length, 0), 3);
        assert.equal(roundTrip[1].getRelation('faction_1'), null);
        assert.deepEqual(roundTrip[0].getRelation('faction_2'), { status: 'neutral', notes: 'A cautious truce.' });
    } finally { Faction.clear(); SettingInfo.clear(); }
});

function loadInitialRelationshipParser() {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function parseFactionRelationsXml(');
    const end = source.indexOf('\nfunction parseFactionReputationTiersXml(', start);
    assert.ok(start >= 0 && end > start, 'Production relationship parser must be present.');
    const context = { Utils: require('../Utils.js') };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.parse = parseFactionRelationsXml;`, context);
    return context.parse;
}
const sourceXml = (name, relations) => `<faction><name>${name}</name><relations>${relations}</relations></faction>`;
const edgeXml = (target, status = 'neutral', notes = 'A cautious truce.') => `<relation><factionName>${target}</factionName><status>${status}</status><notes>${notes}</notes></relation>`;
const relationshipXml = content => `<factionRelationships>${content}</factionRelationships>`;

test('initial relationship parser accepts empty and sparse directed graphs but rejects invalid explicit entries', () => {
    const parse = loadInitialRelationshipParser();
    const factions = [{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Gamma' }];
    const parseResponse = text => parse(text, { factions });
    assert.equal(parseResponse('<factionRelationships/>').size, 0);
    const sparse = parseResponse(relationshipXml(sourceXml('Alpha', edgeXml('Beta')) + sourceXml('Gamma', '')));
    assert.equal(sparse.size, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(sparse.get('alpha'))), [{ targetName: 'Beta', status: 'neutral', notes: 'A cautious truce.' }]);
    assert.equal(sparse.has('beta'), false);
    assert.equal(sparse.get('gamma').length, 0);
    for (const xml of [
        relationshipXml(sourceXml('Unknown', '')),
        relationshipXml(sourceXml('Alpha', edgeXml('Unknown'))),
        relationshipXml(sourceXml('Alpha', edgeXml('Alpha'))),
        relationshipXml(sourceXml('Alpha', edgeXml('Beta') + edgeXml('beta'))),
        relationshipXml(sourceXml('Alpha', '') + sourceXml('alpha', '')),
        relationshipXml(sourceXml('Alpha', edgeXml('Beta', 'invalid'))),
        relationshipXml(sourceXml('Alpha', edgeXml('Beta', 'neutral', ''))),
        relationshipXml('<faction><name>Alpha</name></faction>')
    ]) assert.throws(() => parseResponse(xml));
});

function loadGenerationFixture({ relationships, generated = [], failIfConstructed = false }) {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function generateFactionsList(');
    const end = source.indexOf('\nasync function generateSkillsByNames(', start);
    assert.ok(start >= 0 && end > start);
    const calls = [], rosters = [];
    let constructed = 0;
    class MockFaction {
        constructor(value) {
            if (failIfConstructed) throw new Error('Unexpected faction construction');
            constructed += 1;
            Object.assign(this, value, { id: `generated-${constructed}` });
        }
    }
    const context = {
        Map, Set, Faction: MockFaction, console: { warn() {} }, hasConfiguredAiBackend: () => true,
        PromptFailureReporter: { run: (_options, callback) => callback(), isCancellation: () => false, validationRetry() {} },
        PromptAuditLog: { recordFailure() {} },
        parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'generate' }),
        renderFactionsPrompt: () => 'core', renderFactionReputationPrompt: () => 'reputation',
        renderFactionRelationshipsPrompt: ({ factions }) => { rosters.push(factions.map(entry => entry.name)); return 'relations'; },
        parseFactionCoreXml: () => generated,
        parseFactionRelationsXml: loadInitialRelationshipParser(),
        parseFactionReputationTiersXml: () => new Map(generated.map(faction => [faction.name.toLowerCase(), []])),
        logFactionGeneration() {}, logFactionRelationshipGeneration() {}, logFactionReputationGeneration() {},
        LLMClient: { chatCompletion: async options => {
            calls.push({ label: options.metadataLabel, messages: structuredClone(options.messages), constructed });
            if (options.metadataLabel === 'faction_relationship_generation') return relationships.shift();
            return '<fixture/>';
        } }
    };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.generate = generateFactionsList;`, context);
    return { generate: context.generate, calls, rosters, constructed: () => constructed };
}

test('combined configured and generated roster gains sparse meaningful edges without replacing authored neutral', async () => {
    for (const asDraft of [false, true]) {
        const existing = [
            { id: 'configured-a', name: 'Alpha', relations: asDraft ? { 'configured-b': { status: 'neutral', notes: 'An authored truce.' } } : new Map([['configured-b', { status: 'neutral', notes: 'An authored truce.' }]]) },
            { id: 'configured-b', name: 'Beta', relations: asDraft ? {} : new Map() }
        ];
        const xml = relationshipXml(sourceXml('Alpha', edgeXml('Beta', 'hostile', 'Generated conflict.')) + sourceXml('Beta', edgeXml('Gamma', 'allied', 'A new alliance.')) + sourceXml('Gamma', edgeXml('Alpha', 'rival', 'A rivalry.')));
        const fixture = loadGenerationFixture({ relationships: [xml], generated: [{ name: 'Gamma', violenceLevel: 1 }] });
        const created = await fixture.generate({ count: 1, asDraft, existingFactions: existing });
        assert.deepEqual(Array.from(fixture.rosters[0]), ['Alpha', 'Beta', 'Gamma']);
        const entries = [...existing, ...created];
        const relationObject = faction => Object.fromEntries(faction.relations instanceof Map ? faction.relations : Object.entries(faction.relations));
        assert.equal(entries.reduce((sum, faction) => sum + Object.keys(relationObject(faction)).length, 0), 3);
        assert.deepEqual(JSON.parse(JSON.stringify(relationObject(existing[0])['configured-b'])), { status: 'neutral', notes: 'An authored truce.' });
        assert.equal(relationObject(existing[1])[created[0].id].status, 'allied');
        assert.equal(relationObject(created[0])['configured-a'].status, 'rival');
        assert.equal(fixture.calls.find(call => call.label === 'faction_relationship_generation').constructed, 0);
    }
});

test('all-configured empty relations can gain justified initial ties; invalid graphs never mutate the roster', async () => {
    const existing = [{ id: 'a', name: 'Alpha', relations: new Map() }, { id: 'b', name: 'Beta', relations: new Map() }];
    const fixture = loadGenerationFixture({ relationships: [relationshipXml(sourceXml('Alpha', edgeXml('Beta', 'allied', 'Shared defence.')))] });
    const created = await fixture.generate({ count: 0, existingFactions: existing });
    assert.equal(created.length, 0);
    assert.deepEqual(fixture.calls.map(call => call.label), ['faction_relationship_generation']);
    assert.equal(existing[0].relations.get('b').status, 'allied');
    assert.equal(existing[1].relations.size, 0);
    const untouched = [{ id: 'a', name: 'Alpha', relations: new Map() }, { id: 'b', name: 'Beta', relations: new Map() }];
    const bad = relationshipXml(sourceXml('Alpha', edgeXml('Unknown')));
    const invalid = loadGenerationFixture({ relationships: [bad, bad, bad], generated: [{ name: 'Gamma', violenceLevel: 1 }], failIfConstructed: true });
    await assert.rejects(invalid.generate({ count: 1, existingFactions: untouched }), /unknown faction/i);
    assert.equal(invalid.constructed(), 0);
    assert.equal(untouched[0].relations.size, 0);
    assert.equal(untouched[1].relations.size, 0);
    assert.equal(invalid.calls.filter(call => call.label === 'faction_relationship_generation').length, 3);
    assert.match(invalid.calls.filter(call => call.label === 'faction_relationship_generation')[1].messages.at(-1).content, /unknown faction/i);
});

function loadApiRelationshipHelpers() {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const extract = (startText, endText) => {
        const start = source.indexOf(startText);
        const end = source.indexOf(endText, start);
        assert.ok(start >= 0 && end > start, `Missing API helper: ${startText}`);
        return source.slice(start, end);
    };
    const context = { Utils: require('../Utils.js'), Map, Set };
    vm.createContext(context);
    vm.runInContext([
        extract('const factionXmlChildren =', 'const factionAutofillFieldIsEmpty ='),
        extract('const parseFactionAutofillResponse =', 'const mergeFactionAutofillValues ='),
        extract('const mapGeneratedRelationsToIds =', 'const generateInboundRelationsForNewFaction ='),
        'this.helpers = { parseFactionAutofillResponse, mapGeneratedRelationsToIds, parseFactionInboundRelationsResponse };'
    ].join('\n'), context);
    return context.helpers;
}

test('inbound new-faction relations accept sparse graphs and validate every explicit source and edge', () => {
    const { parseFactionInboundRelationsResponse: parse } = loadApiRelationshipHelpers();
    const options = { existingFactionsByName: new Map([['alpha', 'a'], ['beta', 'b']]), newFactionName: 'Gamma' };
    const read = xml => JSON.parse(JSON.stringify(parse(xml, options)));
    assert.deepEqual(read('<factionRelationships/>'), {});
    assert.deepEqual(read(relationshipXml(sourceXml('Alpha', edgeXml('Gamma')) + sourceXml('Beta', ''))), {
        a: { status: 'neutral', notes: 'A cautious truce.' }
    });
    for (const xml of [
        relationshipXml(sourceXml('Unknown', '')),
        relationshipXml(sourceXml('Alpha', edgeXml('Beta'))),
        relationshipXml(sourceXml('Alpha', '') + sourceXml('alpha', '')),
        relationshipXml(sourceXml('Alpha', edgeXml('Gamma') + edgeXml('Gamma'))),
        relationshipXml(sourceXml('Alpha', edgeXml('Gamma', 'invalid'))),
        relationshipXml(sourceXml('Alpha', edgeXml('Gamma', 'neutral', ''))),
        relationshipXml('<faction><name>Alpha</name></faction>')
    ]) assert.throws(() => read(xml));
});

test('autofill validates explicit generated edges even when authored relations would be retained', () => {
    const { parseFactionAutofillResponse: parse, mapGeneratedRelationsToIds: map } = loadApiRelationshipHelpers();
    const read = relations => parse(`<faction><name>Gamma</name><violenceLevel>1</violenceLevel>${relations}</faction>`).relationEntries;
    const existing = new Map([['alpha', 'a']]);
    assert.deepEqual(JSON.parse(JSON.stringify(map(read(''), existing))), {});
    assert.deepEqual(JSON.parse(JSON.stringify(map(read(`<relations>${edgeXml('Alpha')}</relations>`), existing))), {
        a: { status: 'neutral', notes: 'A cautious truce.' }
    });
    for (const relation of [
        edgeXml('Unknown'),
        edgeXml('Alpha') + edgeXml('alpha'),
        edgeXml('Alpha', 'invalid'),
        edgeXml('Alpha', 'neutral', '')
    ]) assert.throws(() => map(read(`<relations>${relation}</relations>`), existing));
});
