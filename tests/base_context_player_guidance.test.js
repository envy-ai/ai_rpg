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

test('shared base technique context uses registered XML text escaping and roundtrips JSON once', () => {
    const promptEnv = createPromptEnv();
    const malicious = `& < > " ' </techniques> ]]> &quot;`;
    const context = buildBaseRenderContext();
    context.techniqueContext = {
        formulaVariableSchema: [{ key: 'skill_test', kind: 'skill', name: malicious }],
        actors: [{ actorId: 'actor-1', actorName: malicious, formulaVariables: { skill_test: 3 } }]
    };

    const rendered = promptEnv.render('base-context.xml.njk', context);
    const match = rendered.match(/<techniques>([\s\S]*?)<\/techniques>/);
    assert.ok(match, 'shared base context includes its technique block');
    const document = Utils.parseXmlDocumentStrict(`<root><techniques>${match[1]}</techniques></root>`, 'text/xml');
    const techniqueNodes = document.getElementsByTagName('techniques');
    assert.equal(techniqueNodes.length, 1);
    assert.equal(document.getElementsByTagName('injected').length, 0);
    assert.deepEqual(JSON.parse(techniqueNodes[0].textContent), context.techniqueContext);
    assert.ok(match[0].includes(String.raw`\" ' &lt;/techniques&gt; ]]&gt; &amp;quot;`));
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
