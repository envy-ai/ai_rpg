'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nunjucks = require('nunjucks');
const { TinyBrainPromptExtension } = require('../TinyBrainPromptRunner.js');
const { configureTinyBrainPromptContext } = require('../TinyBrainPromptFamilies.js');
const { buildBaseRenderContext } = require('./helpers/baseContextFixtures.js');

test('standard and TinyBrain NPC narrative rendering receives ignored technique feedback', async () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        async function runActionNarrativeForActor({');
    const end = source.indexOf('        async function executeNpcTurnsAfterPlayer({', start);
    assert.ok(start >= 0 && end > start);
    const runner = source.slice(start, end);
    const base = buildBaseRenderContext({});
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts')), { autoescape: false });
    env.addGlobal('randomword', () => 'test');
    env.addFilter('xmlText', value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    env.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    const feedback = 'Technique attempt ignored: the NPC is disabled. No roll, cost, effect or learning occurred.';
    for (const tinybrain of [false, true]) {
        let rendered;
        const sentinel = new Error('Captured rendered narrative input');
        const context = {
            Globals: { config: { ai: { tinybrain } } },
            isTinyBrainPromptEnabled: () => tinybrain,
            configureTinyBrainPromptContext,
            prepareBasePromptContext: async () => base,
            promptEnv: { render(name, variables) { rendered = env.render(name, variables); throw sentinel; } },
            projectTechniqueReceiptReport: value => value,
            console: { log() {}, warn() {} }
        };
        vm.createContext(context);
        vm.runInContext(`${runner}\nthis.run = runActionNarrativeForActor;`, context);
        try {
            await context.run({ actor: { id: 'npc', name: 'Fixture NPC', isNPC: true }, actionText: 'Tries a technique.', techniqueExecutionFeedback: [feedback] });
        } catch (error) { assert.strictEqual(error, sentinel); }
        assert.match(rendered, /<techniqueExecutionFeedback>[\s\S]*<attempt>/);
        assert.ok(rendered.includes(feedback));
        assert.doesNotMatch(rendered, /<committedTechniqueResults>/);
    }
});
