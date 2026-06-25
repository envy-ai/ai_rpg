const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nunjucks = require('nunjucks');
const Utils = require('../Utils.js');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function loadCombinerHelpers() {
    const source = read('api.js');
    const start = source.indexOf('        function createAiItemCombinerValidationError(message) {');
    const end = source.indexOf("\n        app.post('/api/things/ai-combine-candidates'", start);
    assert.notEqual(start, -1, 'Unable to locate item combiner helpers in api.js');
    assert.notEqual(end, -1, 'Unable to locate item combiner route after helpers in api.js');

    const context = {
        Error,
        Array,
        Set,
        Map,
        Number,
        String,
        Boolean,
        Utils,
        console
    };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}
this.parseAiItemCombinerResponse = parseAiItemCombinerResponse;
this.validateItemCombinerMergeSet = validateItemCombinerMergeSet;
this.normalizeAiItemCombinerItem = normalizeAiItemCombinerItem;`, context);
    return context;
}

test('ai item combiner prompt asks for same-quality stack groups by id', () => {
    const env = nunjucks.configure(path.join(rootDir, 'prompts'), {
        autoescape: false,
        throwOnUndefined: false
    });

    const output = env.render('ai-item-combiner.xml.njk', {
        items: [
            {
                id: 'thing-torch-1',
                name: 'Pine Torch',
                description: 'A simple resin torch.',
                level: '1',
                quality: 'common',
                quantity: '2',
                equipmentSlot: ''
            },
            {
                id: 'thing-torch-2',
                name: 'Pitch Torch',
                description: 'A simple pitch-soaked torch.',
                level: '1',
                quality: 'common',
                quantity: '3',
                equipmentSlot: '',
                statusEffects: '- self: Crackling aura (duration: ongoing)',
                statModifiers: '- Strength +2'
            }
        ]
    });

    assert.match(output, /same quality/i);
    assert.match(output, /thing-torch-1/);
    assert.match(output, /<statusEffects>- self: Crackling aura \(duration: ongoing\)<\/statusEffects>/);
    assert.match(output, /<statModifiers>- Strength \+2<\/statModifiers>/);
    assert.match(output, /<combinationGroups>/);
    assert.match(output, /<itemId>thing-torch-1<\/itemId>/);
});

test('ai item combiner item normalizer keeps compact mechanics context', () => {
    const { normalizeAiItemCombinerItem } = loadCombinerHelpers();
    const item = normalizeAiItemCombinerItem({
        id: 'thing-amulet-1',
        name: 'Crackling Amulet',
        statusEffects: '- equipper: Charged (duration: while equipped)',
        statModifiers: '- Dexterity +1\n- Focus +2'
    }, 0);

    assert.equal(item.statusEffects, '- equipper: Charged (duration: while equipped)');
    assert.equal(item.statModifiers, '- Dexterity +1\n- Focus +2');
});

test('ai item combiner response parser returns disjoint groups with reasons', () => {
    const { parseAiItemCombinerResponse } = loadCombinerHelpers();
    const groups = parseAiItemCombinerResponse(`
        <combinationGroups>
          <group>
            <reason>Both are common resin torches.</reason>
            <itemId>thing-torch-1</itemId>
            <itemId>thing-torch-2</itemId>
          </group>
          <group>
            <reason>Both are common ration packs.</reason>
            <itemId>thing-ration-1</itemId>
            <itemId>thing-ration-2</itemId>
          </group>
        </combinationGroups>
    `);

    assert.deepEqual(JSON.parse(JSON.stringify(groups)), [
        {
            reason: 'Both are common resin torches.',
            itemIds: ['thing-torch-1', 'thing-torch-2']
        },
        {
            reason: 'Both are common ration packs.',
            itemIds: ['thing-ration-1', 'thing-ration-2']
        }
    ]);
});

test('ai item combiner response parser rejects duplicate ids across groups', () => {
    const { parseAiItemCombinerResponse } = loadCombinerHelpers();
    assert.throws(() => parseAiItemCombinerResponse(`
        <combinationGroups>
          <group>
            <itemId>thing-a</itemId>
            <itemId>thing-b</itemId>
          </group>
          <group>
            <itemId>thing-b</itemId>
            <itemId>thing-c</itemId>
          </group>
        </combinationGroups>
    `), /appeared in more than one/);
});

test('item combiner merge validation requires item stacks from same holder and quality', () => {
    const { validateItemCombinerMergeSet } = loadCombinerHelpers();
    const contexts = new Map([
        ['thing-a', { owner: { id: 'player-1' }, container: null, location: { id: 'loc-1' } }],
        ['thing-b', { owner: { id: 'player-1' }, container: null, location: { id: 'loc-1' } }],
        ['thing-c', { owner: { id: 'player-2' }, container: null, location: { id: 'loc-2' } }],
        ['thing-d', { owner: { id: 'player-1' }, container: null, location: { id: 'loc-1' } }],
        ['thing-e', { owner: { id: 'player-1' }, container: { id: 'chest-1' }, location: { id: 'loc-1' } }],
        ['thing-f', { owner: { id: 'player-1' }, container: { id: 'chest-1' }, location: { id: 'loc-1' } }],
        ['thing-g', { owner: { id: 'player-1' }, container: { id: 'chest-2' }, location: { id: 'loc-1' } }]
    ]);
    const resolver = thing => contexts.get(thing.id);
    const keep = { id: 'thing-a', name: 'Torch', thingType: 'item', rarity: 'common', isContainer: false, isEquipped: false };
    const mergeable = { id: 'thing-b', name: 'Lamp', thingType: 'item', rarity: 'common', isContainer: false, isEquipped: false };

    const result = validateItemCombinerMergeSet(keep, [mergeable], resolver);
    assert.equal(result.holderKey, 'owner:player-1');
    assert.equal(result.qualityKey, 'common');

    const containedResult = validateItemCombinerMergeSet(
        { ...keep, id: 'thing-e' },
        [{ ...mergeable, id: 'thing-f' }],
        resolver
    );
    assert.equal(containedResult.holderKey, 'container:chest-1');

    assert.throws(() => validateItemCombinerMergeSet(keep, [
        { ...mergeable, id: 'thing-d', rarity: 'rare' }
    ], resolver), /same quality/);

    assert.throws(() => validateItemCombinerMergeSet(keep, [
        { ...mergeable, id: 'thing-c' }
    ], resolver), /same holder/);

    assert.throws(() => validateItemCombinerMergeSet(
        { ...keep, id: 'thing-e' },
        [{ ...mergeable, id: 'thing-g' }],
        resolver
    ), /same holder/);

    assert.throws(() => validateItemCombinerMergeSet(keep, [
        { ...mergeable, isEquipped: true }
    ], resolver), /Equipped items/);
});

test('things API and shared item-list UI expose the item combiner flow', () => {
    const apiSource = read('api.js');
    const viewSource = read('views/index.njk');
    const thingsDocs = read('docs/api/things.md');
    const chatDocs = read('docs/ui/chat_interface.md');
    const configSource = read('config.default.yaml');
    const iconSource = read('assets/material-icons/misc/merge.svg');

    assert.match(apiSource, /app\.post\('\/api\/things\/ai-combine-candidates', async \(req, res\) => \{/);
    assert.match(apiSource, /promptEnv\.render\('ai-item-combiner\.xml\.njk'/);
    assert.match(apiSource, /const metadataLabel = 'ai_item_combiner'/);
    assert.match(apiSource, /LLMClient\.logPrompt\(\{[\s\S]*?metadataLabel,[\s\S]*?generationPrompt: parsedTemplate\.generationPrompt,[\s\S]*?response: responseText/);
    assert.match(apiSource, /app\.post\('\/api\/things\/combine-stacks'/);

    assert.match(viewSource, /thingListCombineButtons/);
    assert.match(viewSource, /startThingStackCombiner/);
    assert.match(viewSource, /openThingStackCombinerModal/);
    assert.match(viewSource, /fetch\('\/api\/things\/ai-combine-candidates'/);
    assert.match(viewSource, /fetch\('\/api\/things\/combine-stacks'/);
    assert.match(viewSource, /containerPlayerInventoryCombineBtn/);
    assert.match(viewSource, /<div class="modal__actions thing-stack-combiner-modal__actions">/);
    assert.match(viewSource, /class="button button-secondary" id="thingStackCombinerBackBtn"/);
    assert.match(viewSource, /class="button button-secondary" id="thingStackCombinerClearBtn"/);
    assert.match(viewSource, /class="button button-secondary" id="thingStackCombinerCancelBtn"/);
    assert.match(viewSource, /class="button button-primary" id="thingStackCombinerNextBtn"/);
    assert.match(viewSource, /options\.context === 'container-player-inventory'[\s\S]*currentThingContainerPlayerInventory = ownerData\.inventory[\s\S]*renderThingContainerModal\(\)/);
    assert.doesNotMatch(viewSource, /barterPlayerCombineBtn/);

    assert.match(thingsDocs, /POST \/api\/things\/ai-combine-candidates/);
    assert.match(thingsDocs, /POST \/api\/things\/combine-stacks/);
    assert.match(chatDocs, /AI-backed item stack combiner/);
    assert.match(configSource, /ai_item_combiner:\s*5000/);
    assert.match(iconSource, /fill="#fff"/);
});
