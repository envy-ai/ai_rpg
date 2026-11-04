const test = require('node:test');
const assert = require('node:assert/strict');
const Quest = require('../Quest.js');
const Events = require('../Events.js');
const LLMClient = require('../LLMClient.js');
const Utils = require('../Utils.js');
const { buildBaseRenderContext, createPromptEnv } = require('./helpers/baseContextFixtures.js');

function checkQuestXml(xml) {
    const doc = Utils.parseXmlDocumentStrict(xml, 'text/xml');
    const quest = doc.getElementsByTagName('quest')[0];
    assert.ok(quest, 'rendered prompt contains the active quest');
    for (const [tag, expected] of Object.entries({ originLocationLevel: '7', relativeLevel: '-2', level: '5', rewardXp: '42' })) {
        assert.equal(quest.getElementsByTagName(tag)[0]?.textContent, expected, tag);
    }
}

function extractXml(rendered, root) {
    const start = rendered.indexOf(`<${root}>`);
    const end = rendered.indexOf(`</${root}>`, start);
    assert.ok(start >= 0 && end >= 0, `rendered prompt has ${root}`);
    return rendered.slice(start, end + root.length + 3);
}

test('base context and quest check render getter-derived quest level and XP', async () => {
    const quest = new Quest({ name: 'Signal', originLocationLevel: 7, relativeLevel: -2,
        rewardXp: 42, objectives: ['Repair beacon'] });
    const env = createPromptEnv();
    env.opts.throwOnUndefined = false;
    const base = buildBaseRenderContext();
    base.currentPlayer.currentQuests = [quest];
    const generation = env.render('_includes/quest-generate.njk', { quest, shortDescription: 'Repair beacon', questOriginLocationLevel: 7 });
    assert.ok(generation.includes('25 base XP per required objective as the baseline'));
    assert.ok(generation.includes('adjust that authored value when the quest warrants it'));
    assert.ok(generation.includes('Use 0 only for quests that should intentionally grant no XP'));
    checkQuestXml(extractXml(env.render('base-context.xml.njk', base), 'gameState'));

    const oldDeps = Events._deps;
    const oldCompletion = LLMClient.chatCompletion;
    const oldLog = LLMClient.logPrompt;
    let renderedCheck;
    try {
        Events._deps = {
            config: { quest_checks: { enabled: true, interval: 1 }, event_checks: { enabled: true } },
            currentPlayer: { currentQuests: [quest], getQuestByIndex: i => i === 0 ? quest : null },
            promptEnv: { render: (template, context) => (renderedCheck = env.render(template, context)) },
            prepareBasePromptContext: async () => base,
            parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'generation' })
        };
        LLMClient.chatCompletion = async () => '<quests></quests>';
        LLMClient.logPrompt = () => {};
        await Events.runQuestChecks({ bypassInterval: true });
        checkQuestXml(extractXml(renderedCheck, 'quests'));
    } finally {
        Events._deps = oldDeps;
        LLMClient.chatCompletion = oldCompletion;
        LLMClient.logPrompt = oldLog;
        Quest.clear();
    }
});
