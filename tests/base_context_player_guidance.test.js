const test = require('node:test');
const assert = require('node:assert/strict');

const Utils = require('../Utils.js');
const {
    buildBaseRenderContext,
    createPromptEnv,
    loadBuildBasePromptContext
} = require('./helpers/baseContextFixtures.js');

function extractGameState(rendered) {
    const match = rendered.match(/<gameState>[\s\S]*?<\/gameState>/);
    assert.ok(match, 'Rendered prompt did not contain a gameState block.');
    return match[0];
}

test('base context always renders player guidance as an XML-safe game-state child', () => {
    const promptEnv = createPromptEnv();
    const context = buildBaseRenderContext();
    context.currentPlayer.playerGuidance = 'Use <ruins> & "omens"; avoid \'prophecies\'.';

    const rendered = promptEnv.render('base-context.xml.njk', context);
    const gameStateXml = extractGameState(rendered);
    const document = Utils.parseXmlDocumentStrict(gameStateXml, 'text/xml');
    const gameState = document.documentElement;
    const directGuidanceNodes = Array.from(gameState.childNodes).filter(node => (
        node.nodeType === 1 && node.nodeName === 'playerGuidance'
    ));

    assert.equal(directGuidanceNodes.length, 1);
    assert.equal(
        directGuidanceNodes[0].textContent,
        'Use <ruins> & "omens"; avoid \'prophecies\'.'
    );
    assert.match(
        gameStateXml,
        /<playerGuidance>Use &lt;ruins&gt; &amp; &quot;omens&quot;; avoid &#39;prophecies&#39;\.<\/playerGuidance>/
    );
    assert.equal((rendered.match(/<playerGuidance>/g) || []).length, 1);
});

test('base context renders an empty player guidance block for missing guidance', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildBaseRenderContext());
    const gameStateXml = extractGameState(rendered);

    assert.match(gameStateXml, /<playerGuidance><\/playerGuidance>/);
    assert.equal((rendered.match(/<playerGuidance>/g) || []).length, 1);
});

test('base context places escaped concise technique lists on their owning actors', () => {
    const promptEnv = createPromptEnv();
    const context = buildBaseRenderContext({ currentLocation: { name: 'Room', description: '', statusEffects: [], exits: [], items: [], npcs: [] } });
    context.currentPlayer.id = 'player_1';
    const actor = (id, name) => ({ id, name, description: 'Actor description.', class: 'Scout', race: 'Human', personality: { type: 'Calm', traits: [], goals: [], notes: '' }, dispositionsTowardsPlayer: [], relationships: [], reciprocalRelationships: [], selectedImportantMemories: [], inventory: [], skills: [], abilities: [], statusEffects: [], needs: [], modStatusSections: [] });
    context.npcs = [actor('npc_1', 'Local NPC')];
    context.party = [actor('party_1', 'Party member')];
    context.techniqueSummaries = {
        player_1: [{ name: 'Ward <&>', shortDescription: 'Protects & shields <allies>.' }],
        npc_1: [{ name: 'Local technique', shortDescription: 'A quiet local scouting technique.' }],
        party_1: [{ name: 'Party technique', shortDescription: '' }]
    };
    for (const saveVersion of [0, 1]) {
        context.Globals.saveFileSaveVersion = saveVersion;
        const xml = extractGameState(promptEnv.render('base-context.xml.njk', context));
        const document = Utils.parseXmlDocumentStrict(xml, 'text/xml');
        const ownerNodes = [document.getElementsByTagName('player')[0], document.getElementsByTagName('npc')[0], document.getElementsByTagName('member')[0]];
        const techniqueText = ownerNodes.map(node => node.getElementsByTagName('techniques')[0]?.textContent.trim());
        assert.match(techniqueText[0], /\* Ward <&> - Protects & shields <allies>\./);
        assert.match(techniqueText[1], /\* Local technique - A quiet local scouting technique\./);
        assert.match(techniqueText[2], /\* Party technique/);
        assert.doesNotMatch(techniqueText[2], / - /);
        assert.equal(document.getElementsByTagName('techniques').length, 3);
        assert.doesNotMatch(xml, /formulaVariableSchema|balancePolicies|techniqueContext/);
    }
});

test('base prompt context exposes the current player guidance to shared prompt consumers', () => {
    const currentPlayer = {
        id: 'player-guidance-context',
        name: 'Tester',
        playerGuidance: 'Let factions remember broken promises.',
        currentQuests: [],
        getAbilities: () => [],
        getPartyMembers: () => [],
        getStatus: () => ({
            name: 'Tester',
            description: '',
            playerGuidance: 'Let factions remember broken promises.',
            inventory: [],
            gear: {},
            skills: []
        })
    };
    const buildBasePromptContext = loadBuildBasePromptContext({ currentPlayer });

    const context = buildBasePromptContext();

    assert.equal(context.currentPlayer.playerGuidance, 'Let factions remember broken promises.');
});

test('base-context construction does not eagerly build full technique mechanics', () => {
    const TechniqueService = require('../TechniqueService.js');
    const original = TechniqueService.getCompactPromptContext;
    TechniqueService.getCompactPromptContext = () => { throw new Error('Full technique context was built eagerly'); };
    try {
        const build = loadBuildBasePromptContext();
        const context = build();
        assert.equal(Object.hasOwn(context, 'techniqueContext'), false);
    } finally { TechniqueService.getCompactPromptContext = original; }
});
