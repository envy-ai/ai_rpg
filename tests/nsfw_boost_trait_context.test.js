const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const nunjucks = require('nunjucks');

const ModExtensionRegistry = require('../ModExtensionRegistry.js');
const nsfwBoost = require('../mods/nsfw-boost/mod.js');

const rootDir = path.join(__dirname, '..');
const promptEnv = nunjucks.configure(path.join(rootDir, 'prompts'), {
    autoescape: false
});

function createRegistry() {
    const registry = new ModExtensionRegistry();
    nsfwBoost.register({
        modDir: path.join(rootDir, 'mods', 'nsfw-boost'),
        registerEntityField: field => registry.registerEntityField({ ...field, modName: 'nsfw-boost' }),
        registerBaseContextContributor: (contributor, options = {}) => registry.registerBaseContextContributor({
            modName: 'nsfw-boost',
            contributor,
            ...options
        }),
        registerSceneSummarizeContributor() {},
        registerPlayerActionPromptStep() {}
    });
    return registry;
}

function getTraitContext(registry, context) {
    const [contribution] = registry.collectBaseContextContributions({ context });
    return contribution.value;
}

function countTag(xml, tagName) {
    return (xml.match(new RegExp(`<${tagName}(?:\\s|>)`, 'g')) || []).length;
}

test('sexual-trait context uses only scene actors, canonical order, case-insensitive aliases, and whole-trait matching', () => {
    const registry = createRegistry();
    const player = { name: 'Player', sexualTraits: 'brat tamer, NURTURING DOM, switchish' };
    const npc = { name: 'Scene NPC', sexualTraits: 'sWITCH, BrAt' };
    const partyMember = { name: 'Party Member', sexualTraits: 'romantic' };
    const offScene = { name: 'Off scene', sexualTraits: 'dominant' };
    const actors = [player, npc, partyMember, offScene];
    const before = actors.map(actor => JSON.stringify(actor));

    const result = getTraitContext(registry, {
        currentPlayer: player,
        npcs: [npc],
        party: [partyMember],
        allNpcs: [offScene],
        offsceneNpcs: [offScene],
        lastSeenNpcs: [offScene]
    });

    assert.match(result, /^<sexualTraits>[\s\S]*<\/sexualTraits>$/);
    assert.match(result, /- Brat:/);
    assert.match(result, /- Brat Tamer:/);
    assert.match(result, /- Switch:/);
    assert.match(result, /- Romantic:/);
    assert.match(result, /- Caregiver \/ Nurturing Dom:/);
    assert.doesNotMatch(result, /Dominant:/);
    assert.doesNotMatch(result, /switchish/i);

    // Selection order is catalog order, regardless of the order on the actors.
    assert.ok(result.indexOf('- Brat:') < result.indexOf('- Brat Tamer:'));
    assert.ok(result.indexOf('- Switch:') < result.indexOf('- Romantic:'));
    assert.ok(result.indexOf('power_dynamics_and_control:') < result.indexOf('emotional_and_psychological_style:'));
    assert.deepEqual(actors.map(actor => JSON.stringify(actor)), before, 'filtering must not mutate saved actors');

    const longerTraitOnly = getTraitContext(registry, {
        currentPlayer: { sexualTraits: 'Brat Tamer' },
        npcs: [],
        party: []
    });
    assert.match(longerTraitOnly, /- Brat Tamer:/);
    assert.doesNotMatch(longerTraitOnly, /- Brat:/, 'matching a longer assigned trait must not imply its shorter prefix');
});

test('sexual-trait context omits its category wrapper when no current scene actor has a known trait', () => {
    const registry = createRegistry();
    const unknownOnly = getTraitContext(registry, {
        currentPlayer: { sexualTraits: 'unknown synonym, dominantish' },
        npcs: [{ sexualTraits: 'almostromantic' }],
        party: []
    });
    assert.equal(unknownOnly, '');

    const noActors = getTraitContext(registry, {});
    assert.equal(noActors, '');
});

test('sexual-trait context is recomputed for changed scene actors', () => {
    const registry = createRegistry();
    const firstScene = getTraitContext(registry, {
        currentPlayer: { sexualTraits: 'switch' },
        npcs: [],
        party: []
    });
    const secondScene = getTraitContext(registry, {
        currentPlayer: { sexualTraits: 'romantic' },
        npcs: [],
        party: []
    });

    assert.match(firstScene, /- Switch:/);
    assert.doesNotMatch(firstScene, /- Romantic:/);
    assert.match(secondScene, /- Romantic:/);
    assert.doesNotMatch(secondScene, /- Switch:/);
});

test('sexual-trait context registers as scene placement and preserves its selected definitions', () => {
    const registry = createRegistry();
    const [contribution] = registry.collectBaseContextContributions({
        context: {
            currentPlayer: { sexualTraits: 'Dominant, Submissive, Switch' },
            npcs: [{ sexualTraits: 'Primal' }],
            party: [{ sexualTraits: 'Telemetry Exhibitionist' }]
        }
    });

    assert.equal(contribution.placement, 'scene');
    assert.equal((contribution.value.match(/^- /gm) || []).length, 5);
    assert.equal(contribution.value.length, 716);
    assert.match(contribution.value, /- Dominant:/);
    assert.match(contribution.value, /- Submissive:/);
    assert.match(contribution.value, /- Switch:/);
    assert.match(contribution.value, /- Primal:/);
    assert.match(contribution.value, /- Telemetry Exhibitionist:/);
});

test('sexual-trait catalog is available to each NPC create/alter XML prompt exactly once, but not ordinary base context', () => {
    const registry = createRegistry();
    const fields = registry.getEntityFields('player', { exposeToGeneratorPrompt: true });
    const sexualTraitsField = fields.find(field => field.fieldName === 'sexualTraits');
    assert.ok(sexualTraitsField, 'expected the real mod field registration');
    assert.equal(typeof sexualTraitsField.xmlPrompt.reference, 'string');
    assert.match(sexualTraitsField.xmlPrompt.reference, /^<sexualTraitsReference>[\s\S]*<\/sexualTraitsReference>$/);

    const playerGeneratorPromptFields = fields.filter(field => field?.xmlPrompt);
    const templateContexts = {
        'location-generator-npcs.xml.njk': {},
        'region-generator-important-npcs.njk': { region: {} },
        '_includes/npc-generator-single.njk': {},
        '_includes/character-alter.njk': {
            alteredCharacter: { personality: {} },
            characterSeed: {},
            attributeDefinitions: {}
        }
    };

    for (const [template, extraContext] of Object.entries(templateContexts)) {
        const rendered = promptEnv.render(template, {
            ...extraContext,
            playerGeneratorPromptFields
        });
        assert.equal(countTag(rendered, 'sexualTraitsReference'), 1, `${template} should include the full reference once`);
        assert.match(rendered, /power_dynamics_and_control:/, `${template} should expose the actual catalog`);
    }

    const ordinaryBaseContext = getTraitContext(registry, {
        currentPlayer: { sexualTraits: 'switch' },
        npcs: [],
        party: []
    });
    assert.equal(countTag(ordinaryBaseContext, 'sexualTraitsReference'), 0);
    assert.equal(countTag(ordinaryBaseContext, 'sexualTraits'), 1);
    assert.doesNotMatch(ordinaryBaseContext, /Dominant:/, 'ordinary context should contain selected traits only');
});
