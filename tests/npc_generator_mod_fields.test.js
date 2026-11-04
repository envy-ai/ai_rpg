const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

const Globals = require('../Globals.js');
const ModExtensionRegistry = require('../ModExtensionRegistry.js');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function extractFunctionBlock(source, signature, nextSignature) {
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, `Unable to locate ${signature}`);
    const end = source.indexOf(nextSignature, start);
    assert.notEqual(end, -1, `Unable to locate ${nextSignature}`);
    return source.slice(start, end);
}

function withRegisteredField(run) {
    const registry = new ModExtensionRegistry();
    registry.registerEntityField({
        modName: 'nsfw-boost',
        entityType: 'player',
        fieldName: 'sexualTraits',
        type: 'string',
        exposeToGeneratorPrompt: true,
        exposeToXmlParser: true,
        xmlPrompt: { tagName: 'sexualTraits', placeholder: 'traits here' }
    });
    const previousRegistry = Globals.modExtensionRegistry;
    Globals.modExtensionRegistry = registry;
    try {
        run(registry);
    } finally {
        Globals.modExtensionRegistry = previousRegistry;
    }
}

function getGeneratorPromptFields(registry) {
    return registry.getEntityFields('player', { exposeToGeneratorPrompt: true })
        .filter(field => field && field.xmlPrompt && typeof field.xmlPrompt.tagName === 'string');
}

test('batch NPC prompt renderers pass playerGeneratorPromptFields to their templates', () => {
    const serverSource = read('server.js');

    const locationRenderer = extractFunctionBlock(
        serverSource,
        'function renderLocationNpcPrompt(',
        'function renderRegionNpcPrompt('
    );
    assert.match(locationRenderer, /playerGeneratorPromptFields:\s*getPlayerGeneratorPromptFields\(\)/);

    const regionRenderer = extractFunctionBlock(
        serverSource,
        'function renderRegionNpcPrompt(',
        'const SHORT_DESCRIPTION_MAX_ATTEMPTS'
    );
    assert.match(regionRenderer, /playerGeneratorPromptFields:\s*getPlayerGeneratorPromptFields\(\)/);
});

const npcTemplates = {
    location: 'location-generator-npcs.xml.njk',
    region: 'region-generator-important-npcs.njk',
    single: '_includes/npc-generator-single.njk'
};

function renderNpc(mode, context = {}) {
    const env = nunjucks.configure(path.join(rootDir, 'prompts'), { autoescape: false, dev: true });
    require('../nunjucks_filters.js').addXmlCommentFilter(env);
    return env.render(npcTemplates[mode], {
        region: {}, location: {}, npc: {}, setting: {}, config: { regions: {} },
        attributeDefinitions: {}, needBarDefinitions: [], ...context
    });
}

function npcScaffold(output) {
    const match = output.match(/<npcs>\s*<npc>([\s\S]*?)<\/npc>/);
    assert.ok(match, 'expected an NPC scaffold inside npcs');
    return match[1];
}

function countTag(output, tag) {
    return (output.match(new RegExp(`<${tag}(?:\\s|>)`, 'g')) || []).length;
}

test('NPC scaffolds retain mode-specific fields and optional disposition guidance', () => {
    for (const mode of Object.keys(npcTemplates)) {
        const output = renderNpc(mode);
        const scaffold = npcScaffold(output);
        for (const tag of ['quantity', 'name', 'description', 'shortDescription', 'class', 'faction',
            'race', 'resistances', 'vulnerabilities', 'gender', 'isHostile', 'disposition',
            'relativeLevel', 'currency', 'attributes', 'hiddenFromPlayer', 'startingHealthPercentage',
            'startingNeeds', 'personality', 'healthAttribute', 'aiNotes', 'startingTechniques']) {
            assert.equal(countTag(scaffold, tag), 1, `${mode}: ${tag}`);
        }
        assert.match(scaffold, /Optional if no behavioral disposition applies: omit, leave empty, or use N\/A if sentient/);
        assert.match(scaffold, /animal-level intelligence or below/);
        assert.match(scaffold, /"None" if none/);
        assert.match(scaffold, /Omit this entirely if not applicable|<startingNeeds>\s*<\/startingNeeds>/);
        assert.equal(countTag(scaffold, 'role'), 1);
        assert.equal(countTag(scaffold, 'location'), mode === 'region' ? 1 : 0);
        assert.match(scaffold, mode === 'region' ? /Integer from \+2 to \+5/ : /Integer from -3 to \+3/);
        assert.match(output, mode === 'single' ? /<npcInfo>[\s\S]*<npcs>[\s\S]*<memories>[\s\S]*<\/npcInfo>/ : /<response>[\s\S]*<npcs>[\s\S]*<memories>[\s\S]*<bannedNpcs>[\s\S]*<\/response>/);
    }
});

test('unseeded NPC guidance is shared across generation modes', () => {
    const scaffolds = Object.fromEntries(Object.keys(npcTemplates).map(mode => [mode, npcScaffold(renderNpc(mode))]));
    function field(scaffold, tag) {
        const match = scaffold.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
        assert.ok(match, `missing ${tag}`);
        return match[1].replace(/\s+/g, ' ').trim();
    }
    for (const tag of ['name', 'description', 'role', 'traits', 'notes', 'aiNotes']) {
        const expected = field(scaffolds.single, tag);
        assert.equal(field(scaffolds.region, tag), expected, `region ${tag}`);
        assert.equal(field(scaffolds.location, tag), expected, `location ${tag}`);
    }
    const description = field(scaffolds.single, 'description');
    assert.match(description, /three sentences|3 sentences/i);
    for (const concept of [/appearance/i, /personality/i, /role/i, /behavio(?:u)?r/i, /currently/i]) {
        assert.match(description, concept);
    }
    assert.match(description, /do not describe where they are or what they are currently doing/i);
    assert.match(description, /%NAME%/);
    assert.match(field(scaffolds.single, 'name'), /existing or deceased NPC/i);
    assert.match(field(scaffolds.single, 'name'), /singular/i);
    assert.match(field(scaffolds.single, 'traits'), /mania/i);
    assert.match(field(scaffolds.single, 'traits'), /phobias/i);
    assert.match(field(scaffolds.single, 'notes'), /(?:up to|0 to) 2 paragraphs/i);
    assert.match(field(scaffolds.single, 'notes'), /secrets/i);
    assert.match(field(scaffolds.single, 'aiNotes'), /(?:heal|injur)/i);
    assert.match(field(scaffolds.single, 'aiNotes'), /(?:flee|fleeing)/i);
});

test('seeded role, description and AI notes are used only for a single NPC', () => {
    const npc = { role: 'Seed role', description: 'Seed description', aiNotes: 'Seed notes' };
    const seeded = npcScaffold(renderNpc('single', { npc }));
    for (const [tag, value] of Object.entries(npc)) {
        assert.ok(seeded.includes(`<${tag}>${value}</${tag}>`), tag);
    }
    for (const mode of ['region', 'location']) {
        const batch = npcScaffold(renderNpc(mode, { npc }));
        const unseeded = npcScaffold(renderNpc(mode));
        for (const tag of Object.keys(npc)) {
            const content = scaffold => scaffold.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))[1];
            assert.equal(content(batch), content(unseeded), `${mode}: ${tag} must ignore seed`);
        }
    }
});

test('configured attributes and needs are rendered exactly once per NPC', () => {
    for (const mode of Object.keys(npcTemplates)) {
        for (const populated of [false, true]) {
            const scaffold = npcScaffold(renderNpc(mode, {
                attributeDefinitions: populated ? { Might: { description: 'Strength' }, Insight: { description: 'Awareness' } } : {},
                needBarDefinitions: populated ? [{ id: 'hunger' }, { id: 'rest' }] : []
            }));
            assert.equal(countTag(scaffold, 'attribute'), populated ? 2 : 0);
            assert.equal(countTag(scaffold, 'needBar'), populated ? 2 : 0);
            if (populated) {
                assert.match(scaffold, /<attribute name="Might">/);
                assert.match(scaffold, /<attribute name="Insight">/);
                for (const name of ['Might', 'Insight']) {
                    assert.match(scaffold, new RegExp(`<attribute name="${name}"><!--Rating using: poor, below average, average, above average, excellent, or legendary\\.-->`));
                }
                assert.match(scaffold, /<id>hunger<\/id>/);
                assert.match(scaffold, /<id>rest<\/id>/);
                assert.match(scaffold, /Omit this entirely if not applicable/);
            }
        }
    }
});

test('single NPC seed preserves exact values, false booleans and zero health', () => {
    const scaffold = npcScaffold(renderNpc('single', { npc: {
        name: 'Seed Name', description: 'First line\nSecond line', shortDescription: 'Seed short',
        role: 'Seed role', class: 'Seed class', race: 'Seed race', gender: 'other',
        disposition: 'Seed behavior', isHostile: false, hiddenFromPlayer: false,
        startingHealthPercentage: 0, relativeLevel: 2, currency: 7, aiNotes: 'Seed notes'
    } }));
    for (const [tag, value] of Object.entries({ name: 'Seed Name', description: 'First line Second line',
        shortDescription: 'Seed short', role: 'Seed role', class: 'Seed class', race: 'Seed race',
        gender: 'other', disposition: 'Seed behavior', isHostile: 'false', hiddenFromPlayer: 'false',
        startingHealthPercentage: '0', relativeLevel: '2', currency: '7', aiNotes: 'Seed notes' })) {
        assert.ok(scaffold.includes(`<${tag}>${value}</${tag}>`), tag);
    }
    assert.equal((scaffold.match(/<\/name>/g) || []).length, 1, 'seeded name has one closing tag');
    const zeroScaffold = npcScaffold(renderNpc('single', { npc: { relativeLevel: 0, currency: 0 } }));
    assert.match(zeroScaffold, /<relativeLevel><!--Integer from -3 to \+3/);
    assert.match(zeroScaffold, /<currency><!--Integer amount/);
});

test('extension values and references stay scoped to each render and mode', () => {
    const fields = [{ fieldName: 'customTrait', type: 'string', xmlPrompt: {
        tagName: 'customTrait', placeholder: 'custom placeholder', reference: '<customReference>catalog</customReference>'
    } }];
    for (const mode of ['single', 'region', 'location', 'single']) {
        const output = renderNpc(mode, { playerGeneratorPromptFields: fields, npc: { customTrait: 'seed value' }, techniqueCatalogueForGeneration: [{ id: 'technique_1' }] });
        const scaffold = npcScaffold(output);
        assert.equal(countTag(scaffold, 'customTrait'), 1);
        assert.equal(countTag(output, 'customReference'), 1);
        assert.equal(countTag(scaffold, 'startingTechniques'), 1);
        assert.match(output, /technique_1/);
        assert.match(scaffold, mode === 'single' ? /<customTrait>seed value<\/customTrait>/ : /<customTrait><!--custom placeholder--><\/customTrait>/);
        assert.match(npcScaffold(renderNpc(mode, { npc: { startingHealthPercentage: 0 } })), /<startingHealthPercentage>0<\/startingHealthPercentage>/);
        const empty = renderNpc(mode);
        assert.equal(countTag(empty, 'customTrait'), 0);
        assert.equal(countTag(empty, 'customReference'), 0);
        assert.doesNotMatch(empty, /Known world techniques for optional initial learning/);
    }
});

test('registered Player fields render into batch NPC generation scaffolds', () => {
    withRegisteredField((registry) => {
        const promptEnv = nunjucks.configure(path.join(rootDir, 'prompts'), {
            autoescape: false,
            dev: true
        });
        const fields = getGeneratorPromptFields(registry);
        assert.equal(fields.length, 1);

        const locationOutput = promptEnv.render('location-generator-npcs.xml.njk', {
            playerGeneratorPromptFields: fields
        });
        assert.match(locationOutput, /<sexualTraits><!--traits here--><\/sexualTraits>/);

        const regionOutput = promptEnv.render('region-generator-important-npcs.njk', {
            playerGeneratorPromptFields: fields,
            region: {}
        });
        assert.match(regionOutput, /<sexualTraits><!--traits here--><\/sexualTraits>/);

        // Without the variable the scaffold renders nothing (the original bug).
        const withoutFields = promptEnv.render('location-generator-npcs.xml.njk', {});
        assert.doesNotMatch(withoutFields, /<sexualTraits>/);
    });
});

test('world naming guidance appears safely inside the unseeded name comment in each mode', () => {
    const guidance = 'Names honor the moon -- never use <titles> & aliases --> Use stars';
    for (const mode of Object.keys(npcTemplates)) {
        const getName = (setting, npc = {}) => {
            const scaffold = npcScaffold(renderNpc(mode, { setting, npc }));
            const match = scaffold.match(/<name>([\s\S]*?)<\/name>/);
            assert.ok(match, mode);
            return match[1];
        };
        const absent = getName({});
        assert.equal(getName({ npcNamingGuidance: '' }), absent);
        assert.equal(getName({ npcNamingGuidance: '   ' }), absent);
        const guided = getName({ npcNamingGuidance: guidance });
        assert.match(guided, /^<!--[\s\S]*-->$/);
        const comment = guided.slice(4, -3);
        assert.doesNotMatch(comment, /--/);
        assert.match(comment, /Names honor the moon/);
        assert.match(comment, /never use/);
        assert.match(comment, /titles/);
        assert.match(comment, /aliases/);
        assert.match(comment, /Use stars/);
        if (mode === 'single') {
            assert.equal(getName({ npcNamingGuidance: guidance }, { name: 'Fixed Name' }), 'Fixed Name');
        }
    }
});
