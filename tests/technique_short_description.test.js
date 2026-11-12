'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Technique = require('../Technique.js');
const { definition, mechanics } = require('./helpers/techniqueIntegrationFixtures.js');

const make = shortDescription => definition('technique-short-description', mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name: 'Ward', description: 'Practice.', duration: 5, maxHealthPercent: 10 } }] }), shortDescription === undefined ? {} : { shortDescription });

test('technique short descriptions roundtrip and legacy empty values normalize consistently', () => {
    for (const missing of [undefined, null, '', ' \n ']) {
        const technique = Technique.fromJSON(make(missing));
        assert.equal(technique.shortDescription, '');
        assert.equal(Technique.fromJSON(technique.toJSON()).shortDescription, '');
    }
    const original = make('  Protects an ally with a ward.  ');
    const technique = Technique.fromJSON(original);
    assert.equal(technique.shortDescription, 'Protects an ally with a ward.');
    const copy = Technique.fromJSON(technique.toJSON());
    assert.equal(copy.shortDescription, 'Protects an ally with a ward.');
    assert.equal(copy.id, original.id);
    assert.deepEqual(copy.revisions, technique.revisions);
    for (const invalid of [false, 0, 42, {}, []]) {
        assert.throws(() => Technique.fromJSON(make(invalid)), /shortDescription/i);
    }
});

test('technique candidate XML treats empty optional short descriptions as omitted and validates scalar structure', () => {
    const { parseTechniqueIntent } = require('../TechniquePrompt.js');
    const { writeTechniqueXmlValue, disciplineGroupSchema } = require('../TechniqueXml.js');
    const { DOMImplementation, XMLSerializer } = require('@xmldom/xmldom');
    const candidate = make(undefined);
    for (const key of ['id', 'disciplineId', 'provenance']) delete candidate[key];
    const document = new DOMImplementation().createDocument(null, 'discipline', null);
    writeTechniqueXmlValue(document.documentElement, { name: 'Wardcraft', description: 'A warding art.', publicAccess: true, accessRequirements: [], techniques: [{ candidate }] }, disciplineGroupSchema);
    const discipline = new XMLSerializer().serializeToString(document.documentElement);
    const xml = `<techniqueIntent><kind>discover</kind><actor>Actor</actor><intent>Study wards.</intent><targets><targetId>Actor</targetId></targets>${discipline}</techniqueIntent>`;
    const description = '<description>A technique integration fixture.</description>';
    const base = parseTechniqueIntent(xml);
    for (const empty of ['<shortDescription/>', '<shortDescription></shortDescription>', '<shortDescription> \n </shortDescription>']) {
        const parsed = parseTechniqueIntent(xml.replace(description, description + empty));
        assert.equal(parsed.candidate.shortDescription || '', base.candidate.shortDescription || '');
    }
    const populated = parseTechniqueIntent(xml.replace(description, `${description}<shortDescription>A quiet protective ward surrounds allies.</shortDescription>`));
    assert.equal(populated.candidate.shortDescription, 'A quiet protective ward surrounds allies.');
    for (const invalid of ['<shortDescription><nested/></shortDescription>', '<shortDescription bad="x"/>', '<shortDescription>A</shortDescription><shortDescription>B</shortDescription>']) {
        assert.throws(() => parseTechniqueIntent(xml.replace(description, description + invalid)), /shortDescription/i);
    }
});

test('canonical description update preserves catalogue mechanics and presentation-free fingerprint', async () => {
    const TechniqueService = require('../TechniqueService.js');
    const { withTechniqueWorld, addDefinition } = require('./helpers/techniqueIntegrationFixtures.js');
    await withTechniqueWorld(async () => {
        const created = addDefinition('technique-short-canonical', mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name: 'Ward', description: 'Practice.', duration: 5, maxHealthPercent: 10 } }] }));
        const before = TechniqueService.toJSON({ includePresentation: false });
        const revision = structuredClone(created.revisions);
        const returned = TechniqueService.setDefinitionShortDescription(created.id, 'Protects allies with a steady ward.');
        returned.shortDescription = 'A modified detached copy.';
        assert.equal(TechniqueService.getDefinition(created.id).shortDescription, 'Protects allies with a steady ward.');
        assert.deepEqual(TechniqueService.getDefinition(created.id).revisions, revision);
        assert.deepEqual(TechniqueService.toJSON({ includePresentation: false }), before);
        assert.equal(TechniqueService.toJSON().definitions.find(item => item.id === created.id).shortDescription, 'Protects allies with a steady ward.');
    });
});

test('short-description diagnostic lists missing catalogue techniques', async () => {
    const TechniqueService = require('../TechniqueService.js');
    const Command = require('../slashcommands/short_description_check.js');
    const { withTechniqueWorld, addDefinition } = require('./helpers/techniqueIntegrationFixtures.js');
    await withTechniqueWorld(async () => {
        const effect = mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name: 'Ward', description: 'Practice.', duration: 5, maxHealthPercent: 10 } }] });
        const missing = addDefinition('technique-short-missing', effect, { name: 'Missing Ward' });
        const present = addDefinition('technique-short-present', effect, { name: 'Described Ward', shortDescription: 'Protects friends with a stable ward.' });
        let response;
        await Command.execute({ reply: value => { response = value; } });
        assert.match(response.content, /Techniques missing shortDescription \(1\):[\s\S]*Missing Ward/);
        assert.doesNotMatch(response.content, /Described Ward/);
        assert.equal(TechniqueService.getDefinition(missing.id).shortDescription, '');
        assert.equal(TechniqueService.getDefinition(present.id).shortDescription, 'Protects friends with a stable ward.');
    });
});

test('backfill applies to canonical techniques, skips filled entries, and isolates duplicate names', async () => {
    const fs = require('node:fs');
    const TechniqueService = require('../TechniqueService.js');
    const { withTechniqueWorld, addDefinition } = require('./helpers/techniqueIntegrationFixtures.js');
    await withTechniqueWorld(async () => {
        const effect = mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name: 'Ward', description: 'Practice.', duration: 5, maxHealthPercent: 10 } }] });
        const a = addDefinition('technique-short-a', effect, { name: 'Shared Ward', description: 'First ward.' });
        const b = addDefinition('technique-short-b', effect, { name: 'Shared Ward', description: 'Second ward.' });
        const filled = addDefinition('technique-short-filled', effect, { name: 'Filled Ward', shortDescription: 'Already has a suitable short description.' });
        const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
        const start = source.indexOf('async function ensureTechniqueShortDescriptions(');
        const end = source.indexOf('\nfunction normalizeNpcPromptSeed', start);
        assert.ok(start >= 0 && end > start);
        const groups = [];
        const populate = async options => {
            groups.push(options.items.map(item => item.id));
            for (const item of options.items) options.setShortDescription(item, item.id === a.id ? 'First ward protects a single ally.' : 'Second ward protects a whole party.');
            return { updated: options.items.length, remaining: 0, attempts: 1 };
        };
        const ensure = new Function('Technique', 'TechniqueService', 'populateShortDescriptions', `${source.slice(start, end)}; return ensureTechniqueShortDescriptions;`)(Technique, TechniqueService, populate);
        const before = TechniqueService.toJSON({ includePresentation: false });
        const result = await ensure(TechniqueService.getDefinitions());
        assert.deepEqual(groups, [[a.id], [b.id]]);
        assert.equal(result.updated, 2);
        assert.equal(TechniqueService.getDefinition(a.id).shortDescription, 'First ward protects a single ally.');
        assert.equal(TechniqueService.getDefinition(b.id).shortDescription, 'Second ward protects a whole party.');
        assert.equal(TechniqueService.getDefinition(filled.id).shortDescription, 'Already has a suitable short description.');
        assert.deepEqual(TechniqueService.toJSON({ includePresentation: false }), before);
    });
});

test('load planner creates a reviewed technique-only pending plan without generating descriptions', async () => {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('const ensureShortDescriptionsOnLoad = async () => {');
    const end = source.indexOf('\n            await ensureShortDescriptionsOnLoad();', start);
    assert.ok(start >= 0 && end > start);
    const pending = new Map();
    let generatorCalls = 0, saveUpdates = 0;
    const failIfRun = () => { generatorCalls++; throw new Error('Load must not generate descriptions'); };
    const context = {
        Globals: { config: { short_description: { max_items_per_prompt: 2 } }, ensureThingShortDescriptions: failIfRun, ensureLocationShortDescriptions: failIfRun, ensureRegionShortDescriptions: failIfRun, ensureAbilityShortDescriptions: failIfRun, ensureTechniqueShortDescriptions: failIfRun },
        TechniqueService: { getDefinitions: () => [{ id: 'a', name: 'Ward', shortDescription: '' }, { id: 'b', name: 'Ward', shortDescription: '' }, { id: 'c', name: 'Flare', shortDescription: '' }, { id: 'd', name: 'Done', shortDescription: 'Already has a short description.' }] },
        things: new Map(), gameLocations: new Map(), regions: new Map(), players: new Map(), clientId: 'client-test', shortDescriptionBackfillByClient: pending,
        updateSaveFileVersionAtLeast: () => { saveUpdates++; }, console
    };
    const run = vm.runInNewContext(`(async () => { ${source.slice(start, end)}; await ensureShortDescriptionsOnLoad(); })`, context);
    await run();
    const plan = pending.get('client-test');
    assert.ok(plan);
    assert.equal(plan.counts.techniques, 3);
    assert.equal(plan.prompts.techniques, 3, 'duplicate names need separate prompts');
    assert.equal(plan.totalPending, 3);
    assert.equal(generatorCalls, 0);
    assert.equal(saveUpdates, 0);
});

test('reviewed backfill processes catalogue techniques through the native processor', async () => {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('async function processShortDescriptionBackfill()');
    const end = source.indexOf("\n        app.post('/api/new-game/settings/save'", start);
    assert.ok(start >= 0 && end > start);
    const definitions = [{ id: 'technique_1', name: 'Ward', shortDescription: '' }];
    const calls = [];
    const context = {
        shortDescriptionBackfillInProgress: false,
        Globals: { gameLoaded: true, ensureThingShortDescriptions: async () => {}, ensureLocationShortDescriptions: async () => {}, ensureRegionShortDescriptions: async () => {}, ensureAbilityShortDescriptions: async () => {}, ensureTechniqueShortDescriptions: async items => calls.push(items) },
        TechniqueService: { getDefinitions: () => definitions }, things: new Map(), gameLocations: new Map(), regions: new Map(), players: new Map(), updateSaveFileVersionAtLeast: version => calls.push(version)
    };
    const run = vm.runInNewContext(`(${source.slice(start, end).trim()})`, context);
    await run();
    assert.equal(calls[0], definitions);
    assert.equal(calls[1], 1);
    assert.equal(context.shortDescriptionBackfillInProgress, false);
});

test('backfill refuses stale catalogue updates after concurrent edits or runtime replacement', async () => {
    const fs = require('node:fs');
    const TechniqueService = require('../TechniqueService.js');
    const { withTechniqueWorld, addDefinition } = require('./helpers/techniqueIntegrationFixtures.js');
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function ensureTechniqueShortDescriptions(');
    const end = source.indexOf('\nfunction normalizeNpcPromptSeed', start);
    assert.ok(start >= 0 && end > start);
    for (const mutation of ['summary', 'runtime']) {
        await withTechniqueWorld(async () => {
            const created = addDefinition(`technique-stale-${mutation}`, mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name: 'Ward', description: 'Practice.', duration: 5, maxHealthPercent: 10 } }] }));
            const populate = async options => {
                if (mutation === 'summary') TechniqueService.setDefinitionShortDescription(created.id, 'A concurrently supplied short description.');
                else TechniqueService.reset();
                options.setShortDescription(options.items[0], 'A stale generated short description.');
                return { updated: 1, remaining: 0, attempts: 1 };
            };
            const ensure = new Function('Technique', 'TechniqueService', 'populateShortDescriptions', `${source.slice(start, end)}; return ensureTechniqueShortDescriptions;`)(Technique, TechniqueService, populate);
            await assert.rejects(ensure(TechniqueService.getDefinitions()), /changed while its short description was generated/i);
            if (mutation === 'summary') assert.equal(TechniqueService.getDefinition(created.id).shortDescription, 'A concurrently supplied short description.');
        });
    }
});

test('catalogue save and hydration preserve technique short descriptions', async () => {
    const TechniqueService = require('../TechniqueService.js');
    const { withTechniqueWorld, addDefinition } = require('./helpers/techniqueIntegrationFixtures.js');
    await withTechniqueWorld(async () => {
        const created = addDefinition('technique-short-save', mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name: 'Ward', description: 'Practice.', duration: 5, maxHealthPercent: 10 } }] }), { shortDescription: 'A protective ward for nearby allies.' });
        const save = TechniqueService.toJSON();
        TechniqueService.hydrate(save);
        assert.equal(TechniqueService.getDefinition(created.id).shortDescription, 'A protective ward for nearby allies.');
        assert.deepEqual(TechniqueService.getDefinition(created.id).revisions, created.revisions);
    });
});

test('native shared backfill retries an incomplete technique response within its bounded attempts', async () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function populateShortDescriptions(');
    const end = source.indexOf('\nfunction buildThingShortDescriptionItem', start);
    assert.ok(start >= 0 && end > start);
    let calls = 0;
    const populate = new Function('resolveShortDescriptionTypeConfig', 'resolveShortDescriptionBatchSize', 'buildSettingContextForNamePrompt', 'splitEvenlyIntoChunks', 'runShortDescriptionPrompt', 'SHORT_DESCRIPTION_MAX_ATTEMPTS', `${source.slice(start, end)}; return populateShortDescriptions;`)(
        () => ({ itemType: 'technique', itemTypeLabel: 'technique', itemTypePlural: 'techniques', itemTypePluralLabel: 'techniques' }),
        () => 100, () => ({}), items => [items],
        async () => ++calls === 1 ? new Map() : new Map([['ward', 'Protects an ally with a ward.']]), 3
    );
    const entries = [{ name: 'Ward', shortDescription: '' }];
    const result = await populate({ itemType: 'technique', items: entries, buildPromptItem: item => item, getName: item => item.name, getShortDescription: item => item.shortDescription, setShortDescription: (item, value) => { item.shortDescription = value; } });
    assert.equal(calls, 2);
    assert.equal(result.attempts, 2);
    assert.equal(result.remaining, 0);
    assert.equal(entries[0].shortDescription, 'Protects an ally with a ward.');
});

test('technique generator response schema and shared parser accept named XML results', () => {
    const fs = require('node:fs');
    const { loadXmlGenerationSchema } = require('../XmlGenerationSchema.js');
    const { XmlClosingTagGuard } = require('../XmlClosingTagGuard.js');
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function sanitizeShortDescriptionXml(');
    const end = source.indexOf('\nfunction parseLocationShortDescriptionResponse', start);
    assert.ok(start >= 0 && end > start);
    const parse = new Function('Utils', `${source.slice(start, end)}; return parseShortDescriptionResponse;`)(require('../Utils.js'));
    const xml = '<techniques><technique><name>Ward</name><shortDescription>Protects an ally with a ward.</shortDescription></technique></techniques>';
    assert.equal(new XmlClosingTagGuard({ schema: loadXmlGenerationSchema('short-description-technique.schema.xml') }).inspect(xml), null);
    const Globals = require('../Globals.js');
    const previousConfig = Globals.config;
    try {
        Globals.config = {};
        assert.equal(parse({ responseText: xml, itemType: 'technique', itemTypePlural: 'techniques' }).get('ward'), 'Protects an ally with a ward.');
    } finally { Globals.config = previousConfig; }
});
