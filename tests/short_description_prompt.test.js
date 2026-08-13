const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const nunjucks = require('nunjucks');

const promptEnv = nunjucks.configure(path.join(__dirname, '..', 'prompts'), {
    autoescape: false,
    noCache: true
});

function renderShortDescriptionPrompt(itemType, payload) {
    return promptEnv.render('short-description.xml.njk', {
        itemType,
        itemTypeLabel: itemType === 'npc' ? 'NPC' : itemType,
        itemTypePlural: itemType === 'npc' ? 'npcs' : `${itemType}s`,
        itemTypePluralLabel: itemType === 'npc' ? 'NPCs' : `${itemType}s`,
        setting: null,
        items: [],
        locations: [],
        regions: [],
        abilities: [],
        npcs: [],
        factions: [],
        ...payload
    });
}

test('short-description prompt renders NPC context and NPC response schema', () => {
    const rendered = renderShortDescriptionPrompt('npc', {
        npcs: [{
            name: 'Neka',
            description: 'A medic in a patched hazard coat.',
            race: 'human',
            class: 'scout',
            gender: 'female',
            personalityType: 'Cautious analyst',
            personalityTraits: 'patient, observant',
            personalityNotes: 'Trust comes slowly.',
            aiNotes: 'Checks every seal twice.',
            aliases: ['Patch']
        }]
    });

    assert.match(rendered, /<npcs>/);
    assert.match(rendered, /<name>Neka<\/name>/);
    assert.match(rendered, /<aliases>Patch<\/aliases>/);
    assert.match(rendered, /<npc>[\s\S]*<shortDescription>/);
});

test('short-description prompt renders faction context and faction response schema', () => {
    const rendered = renderShortDescriptionPrompt('faction', {
        factions: [{
            name: 'The Brass Concord',
            description: 'Artificers regulating forbidden clockwork.',
            tags: ['artificers', 'lawful'],
            goals: ['Control unstable automata'],
            homeRegionName: 'Manor District',
            assets: [{ name: 'Regulatory Charter' }]
        }]
    });

    assert.match(rendered, /<factions>/);
    assert.match(rendered, /<name>The Brass Concord<\/name>/);
    assert.match(rendered, /<asset>Regulatory Charter<\/asset>/);
    assert.match(rendered, /<faction>[\s\S]*<shortDescription>/);
});
