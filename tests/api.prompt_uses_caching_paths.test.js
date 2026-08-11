const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadBuildSlopRemoverPromptData() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('            const buildSlopRemoverPromptData = async ({');
    const end = source.indexOf('\n            const parseSlopRemoverEditedTextResponse = (responseText) => {', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate buildSlopRemoverPromptData in api.js');
    }

    const functionSource = source.slice(start, end);
    const renderCalls = [];
    let prepareCount = 0;
    const context = {
        config: {
            prompt_uses_caching: false
        },
        promptEnv: {
            render(templateName, payload) {
                renderCalls.push({ templateName, payload });
                if (templateName === '_includes/slop-remover.njk') {
                    return 'Rendered slop instructions';
                }
                return `<template>${templateName}</template>`;
            }
        },
        parseXMLTemplate(rendered) {
            return {
                systemPrompt: `parsed system: ${rendered}`,
                generationPrompt: `parsed generation: ${rendered}`
            };
        },
        LLMClient: {
            getBaseContextEndMarker() {
                return '[[[BASE_END]]]';
            }
        },
        prepareBasePromptContext: async () => {
            prepareCount += 1;
            return {
                currentPlayer: { name: 'Tester' },
                config: { inherited: true }
            };
        }
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.buildSlopRemoverPromptData = buildSlopRemoverPromptData;`,
        context
    );

    return {
        buildSlopRemoverPromptData: context.buildSlopRemoverPromptData,
        setPromptUsesCaching(value) {
            context.config.prompt_uses_caching = value;
        },
        getRenderCalls() {
            return renderCalls;
        },
        getPrepareCount() {
            return prepareCount;
        }
    };
}

function loadRunAttackPrecheck() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        async function runAttackPrecheck({ actionText, allowWhenLegacyChecksDisabled = false }) {');
    const end = source.indexOf('\n        const BAREHANDED_KEYWORDS = new Set([', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate runAttackPrecheck in api.js');
    }

    const functionSource = source.slice(start, end);
    let renderCalled = false;
    const context = {
        Globals: {
            config: {
                use_legacy_prompt_checks: false,
                plausibility_checks: {
                    enabled: true
                }
            }
        },
        config: {
            prompt_uses_caching: false,
            ai: {}
        },
        console: {
            info() {},
            warn() {}
        },
        promptEnv: {
            render() {
                renderCalled = true;
                throw new Error('render should not be called');
            }
        },
        parseXMLTemplate() {
            throw new Error('parseXMLTemplate should not be called');
        },
        LLMClient: {
            chatCompletion: async () => '<response>yes</response>',
            logPrompt() {}
        }
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.runAttackPrecheck = runAttackPrecheck;`,
        context
    );

    return {
        runAttackPrecheck: context.runAttackPrecheck,
        setPromptUsesCaching(value) {
            context.config.prompt_uses_caching = value;
        },
        setLegacyPromptChecks(value) {
            context.Globals.config.use_legacy_prompt_checks = value;
        },
        wasRenderCalled() {
            return renderCalled;
        }
    };
}

test('slop remover uses standalone template when prompt_uses_caching is false', async () => {
    const runtime = loadBuildSlopRemoverPromptData();

    const promptData = await runtime.buildSlopRemoverPromptData({
        systemPromptPrefix: 'Prefix',
        settingContext: { genre: 'Fantasy', tone: 'Neutral' },
        storyText: 'Older context',
        textToEdit: 'Current prose',
        slopWords: ['glimmering'],
        slopRegexes: ['Elara'],
        slopNgrams: ['stood there'],
        forbiddenTropes: ['mouth opens. closes. opens again.']
    });

    assert.equal(promptData.systemPrompt, 'parsed system: <template>slop-remover.xml.njk</template>');
    assert.equal(promptData.generationPrompt, 'parsed generation: <template>slop-remover.xml.njk</template>');
    assert.equal(runtime.getPrepareCount(), 0);
    const call = runtime.getRenderCalls()[0];
    assert.equal(call.templateName, 'slop-remover.xml.njk');
    assert.equal(call.payload.storyText, 'Older context');
    assert.deepEqual(call.payload.setting, { genre: 'Fantasy', tone: 'Neutral' });
    assert.deepEqual(call.payload.slopRegexes, ['Elara']);
    assert.deepEqual(call.payload.forbiddenTropes, ['mouth opens. closes. opens again.']);
});

test('slop remover uses base-context include when prompt_uses_caching is true', async () => {
    const runtime = loadBuildSlopRemoverPromptData();
    runtime.setPromptUsesCaching(true);

    const promptData = await runtime.buildSlopRemoverPromptData({
        systemPromptPrefix: 'Prefix',
        settingContext: { genre: 'Fantasy', tone: 'Neutral' },
        storyText: 'Older context',
        textToEdit: 'Current prose',
        slopWords: ['glimmering'],
        slopRegexes: ['Elara'],
        slopNgrams: ['stood there'],
        forbiddenTropes: ['mouth opens. closes. opens again.']
    });

    assert.equal(promptData.systemPrompt, 'parsed system: <template>base-context.xml.njk</template>');
    assert.equal(promptData.generationPrompt, 'parsed generation: <template>base-context.xml.njk</template>');
    assert.equal(runtime.getPrepareCount(), 1);
    const call = runtime.getRenderCalls()[0];
    assert.equal(call.templateName, 'base-context.xml.njk');
    assert.equal(call.payload.promptType, 'slop-remover');
    assert.equal(call.payload.storyText, 'Older context');
    assert.equal(call.payload.currentPlayer.name, 'Tester');
    assert.deepEqual(call.payload.slopRegexes, ['Elara']);
    assert.deepEqual(call.payload.forbiddenTropes, ['mouth opens. closes. opens again.']);
});

test('cached slop remover reuses an explicitly supplied rendered player-action prefix', async () => {
    const runtime = loadBuildSlopRemoverPromptData();
    runtime.setPromptUsesCaching(true);
    const baseContextOverride = {
        systemPrompt: 'Exact player system prompt',
        generationPromptPrefix: 'Exact player base context\n'
    };

    const promptData = await runtime.buildSlopRemoverPromptData({
        systemPromptPrefix: '',
        settingContext: { genre: 'Fantasy', tone: 'Neutral' },
        storyText: 'Older context',
        textToEdit: 'Current prose',
        baseContextOverride
    });

    assert.equal(promptData.systemPrompt, 'Exact player system prompt');
    assert.equal(
        promptData.generationPrompt,
        'Exact player base context\n[[[BASE_END]]]Rendered slop instructions'
    );
    assert.equal(runtime.getPrepareCount(), 0);
    const call = runtime.getRenderCalls()[0];
    assert.equal(call.templateName, '_includes/slop-remover.njk');
    assert.equal(call.payload.storyText, 'Older context');
    assert.equal(call.payload.textToEdit, 'Current prose');
});

test('cached slop remover rejects an invalid rendered-prefix override', async () => {
    const runtime = loadBuildSlopRemoverPromptData();
    runtime.setPromptUsesCaching(true);

    await assert.rejects(
        runtime.buildSlopRemoverPromptData({
            systemPromptPrefix: '',
            settingContext: { genre: 'Fantasy', tone: 'Neutral' },
            storyText: 'Older context',
            textToEdit: 'Current prose',
            baseContextOverride: 'invalid'
        }),
        /must contain rendered systemPrompt and generationPromptPrefix strings/
    );
    assert.equal(runtime.getPrepareCount(), 0);
});

test('attack precheck is skipped when prompt_uses_caching is true', async () => {
    const runtime = loadRunAttackPrecheck();
    runtime.setLegacyPromptChecks(true);
    runtime.setPromptUsesCaching(true);

    const result = await runtime.runAttackPrecheck({
        actionText: 'The player swings at the goblin.'
    });

    assert.equal(result, true);
    assert.equal(runtime.wasRenderCalled(), false);
});

test('attack precheck is skipped when legacy prompt checks are disabled', async () => {
    const runtime = loadRunAttackPrecheck();

    const result = await runtime.runAttackPrecheck({
        actionText: 'The player swings at the goblin.'
    });

    assert.equal(result, false);
    assert.equal(runtime.wasRenderCalled(), false);
});

test('attack precheck can be explicitly enabled for TinyBrain NPC attack resolution', async () => {
    const runtime = loadRunAttackPrecheck();
    runtime.setPromptUsesCaching(true);

    const result = await runtime.runAttackPrecheck({
        actionText: 'Kira attacks the Frost Slug with Ember Breath.',
        allowWhenLegacyChecksDisabled: true
    });

    assert.equal(result, true);
    assert.equal(runtime.wasRenderCalled(), false);
});
