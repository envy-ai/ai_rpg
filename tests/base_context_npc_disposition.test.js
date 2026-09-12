const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildBaseRenderContext,
    createPromptEnv
} = require('./helpers/baseContextFixtures.js');

function createNpc(name, disposition) {
    return {
        id: `npc_${name.toLowerCase().replace(/\W+/g, '_')}`,
        name,
        description: `${name} is here.`,
        disposition,
        class: 'creature',
        race: 'beast',
        resistances: '',
        vulnerabilities: '',
        personality: {
            type: '',
            traits: '',
            goals: [],
            notes: '',
            aiNotes: ''
        },
        aiNotes: '',
        dispositionsTowardsPlayer: [],
        relationshipsTowardsListedCharacters: [],
        relationshipsFromListedCharacters: [],
        selectedImportantMemories: [],
        inventory: [],
        skills: [],
        abilities: [],
        statusEffects: [],
        needs: [],
        modStatusSections: []
    };
}

test('base context includes real NPC dispositions and omits N/A values', () => {
    const context = buildBaseRenderContext({
        currentLocation: {
            name: 'Mosswood Trail',
            description: 'A shaded forest trail.',
            statusEffects: [],
            exits: [],
            items: [],
            npcs: []
        },
        overrides: {
            npcs: [
                createNpc('Moss Deer', 'flees if approached; attacks only if cornered'),
                createNpc('Archivist Nera', 'N/A')
            ],
            party: [
                createNpc('Tame Drake', 'extremely territorial; warns before attacking')
            ]
        }
    });
    const rendered = createPromptEnv().render('base-context.xml.njk', context);

    assert.match(rendered, /<name>Moss Deer<\/name>[\s\S]*?<disposition>flees if approached; attacks only if cornered<\/disposition>/);
    assert.match(rendered, /<name>Tame Drake<\/name>[\s\S]*?<disposition>extremely territorial; warns before attacking<\/disposition>/);
    const archivistBlock = rendered.match(/<npc>\s*<id>npc_archivist_nera<\/id>[\s\S]*?<\/npc>/)?.[0] || '';
    assert.doesNotMatch(archivistBlock, /<disposition>/);
    assert.doesNotMatch(rendered, />N\/A<\/disposition>/);
    assert.match(rendered, /Follow that disposition unless the current circumstances provide a good reason not to/);
});

test('NPC memory context includes an offscreen NPC behavioral disposition', () => {
    const currentNpc = createNpc('Marsh Stalker', 'ornery; becomes aggressive if approached too closely');
    const context = buildBaseRenderContext({
        overrides: {
            promptType: 'npc-memories',
            dispositionTypes: [],
            currentNpc,
            historyEntries: [
                {
                    role: 'assistant',
                    content: 'The Marsh Stalker watched from the reeds.',
                    metadata: { npcNames: ['Marsh Stalker'] }
                }
            ]
        }
    });
    const rendered = createPromptEnv().render('base-context.xml.njk', context);

    const currentNpcBlock = rendered.match(/<currentNpc>[\s\S]*?<\/currentNpc>/)?.[0] || '';
    assert.match(currentNpcBlock, /<disposition>ornery; becomes aggressive if approached too closely<\/disposition>/);
});
