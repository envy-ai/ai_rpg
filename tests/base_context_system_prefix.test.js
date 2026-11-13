const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const yaml = require('js-yaml');
const { buildBaseRenderContext, createPromptEnv } = require('./helpers/baseContextFixtures.js');
const { TinyBrainPromptExtension } = require('../TinyBrainPromptRunner.js');
const { configureTinyBrainPromptContext } = require('../TinyBrainPromptFamilies.js');

function loadResolver(entries = []) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function resolveSystemPromptPrefix(');
    const end = source.indexOf('\nfunction getNpcNameBlockedWords()', start);
    assert.ok(start >= 0 && end > start);
    const context = { getSystemPromptPrefixByPromptList: () => entries };
    vm.runInNewContext(`${source.slice(start, end)}\nthis.resolve = resolveSystemPromptPrefix;`, context);
    return context.resolve;
}

test('Strata profile author prefix is exact folded text', () => {
    const config = yaml.load(fs.readFileSync(require.resolve('../config.yaml.strata-davidau'), 'utf8'));
    assert.equal(typeof config.systemPromptPrefix, 'string');
    assert.ok(config.systemPromptPrefix.trim());
    assert.doesNotMatch(config.systemPromptPrefix.trim(), /\n/);
    assert.equal(yaml.load('systemPromptPrefix: >-\n  First line\n  second line\n').systemPromptPrefix, 'First line second line');
});

test('base-context prefixes preserve local precedence and validate optional values', () => {
    const resolve = loadResolver([{ pattern: 'question', prefix: 'Local definition' }]);
    assert.equal(resolve('question'), 'Local definition');
    assert.equal(resolve('question', { globalPrefix: 'Global', explicitPrefix: 'Explicit' }), 'Global\n\nExplicit');
    assert.equal(resolve('question', { globalPrefix: 'Global', explicitPrefix: '  ' }), 'Global\n\nLocal definition');
    assert.equal(resolve('question', { globalPrefix: 'Same', explicitPrefix: 'Same' }), 'Same');
    for (const value of [null, '', '   ']) assert.equal(resolve('other', { globalPrefix: value, explicitPrefix: value }), '');
    assert.throws(() => resolve('question', { globalPrefix: 42 }), /config\.systemPromptPrefix/);
    assert.throws(() => resolve('question', { explicitPrefix: {} }), /render\.systemPromptPrefix/);
});

test('standard and TinyBrain base contexts render global and local prefixes once', () => {
    const resolve = loadResolver([{ pattern: 'game-intro', prefix: 'Local definition' }]);
    const env = createPromptEnv();
    env.addGlobal('getSystemPromptPrefix', resolve);
    env.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    for (const tiny of [false, true]) {
        const context = buildBaseRenderContext();
        context.promptType = 'game-intro';
        context.config.systemPromptPrefix = 'Global author guidance';
        context.systemPromptPrefix = 'Explicit local guidance';
        if (tiny) configureTinyBrainPromptContext(context, 'game_intro');
        const rendered = env.render('base-context.xml.njk', context);
        assert.match(rendered, /Global author guidance\n\nExplicit local guidance/);
        assert.equal(rendered.split('Global author guidance').length - 1, 1);
        assert.equal(rendered.split('Explicit local guidance').length - 1, 1);
        assert.doesNotMatch(rendered, /Local definition/);
    }
});

test('cached slop remover keeps global prefix out of generation while retaining its local prefix', () => {
    const resolve = loadResolver([{ pattern: 'slop-remover', prefix: 'Local editing guidance' }]);
    const env = createPromptEnv();
    env.addGlobal('getSystemPromptPrefix', resolve);
    const context = buildBaseRenderContext();
    Object.assign(context, { promptType: 'slop-remover', storyText: 'Earlier text', textToEdit: 'Text', slopWords: [], slopRegexes: [], slopNgrams: [], forbiddenTropes: [] });
    context.config.systemPromptPrefix = 'Global author guidance';
    const rendered = env.render('base-context.xml.njk', context);
    const system = rendered.match(/<systemPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/systemPrompt>/)?.[1];
    const generation = rendered.match(/<generationPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/generationPrompt>/)?.[1];
    assert.ok(system && generation);
    assert.match(system, /Global author guidance\n\nLocal editing guidance/);
    assert.doesNotMatch(generation, /Global author guidance/);
    assert.match(generation, /Local editing guidance/);
});
