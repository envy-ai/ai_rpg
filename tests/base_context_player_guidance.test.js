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
