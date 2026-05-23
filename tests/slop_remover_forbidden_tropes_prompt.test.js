const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const nunjucks = require('nunjucks');

function createPromptEnv() {
    return nunjucks.configure(path.join(process.cwd(), 'prompts'), {
        autoescape: false,
        throwOnUndefined: true
    });
}

function buildContext() {
    return {
        systemPromptPrefix: '',
        setting: {
            genre: 'Fantasy',
            tone: 'Bleak',
            unifiedTonalScalePrompt: ''
        },
        config: {
            extra_system_instructions: ''
        },
        storyText: 'Older story context.',
        textToEdit: 'Current prose to edit.',
        slopWords: ['glimmering'],
        slopRegexes: [],
        slopNgrams: [],
        forbiddenTropes: [
            'mouth opens. closes. opens again.',
            'you did x. in y. in my z.'
        ]
    };
}

test('standalone slop-remover prompt renders forbidden tropes context', () => {
    const env = createPromptEnv();
    const rendered = env.render('slop-remover.xml.njk', buildContext());

    assert.match(rendered, /<forbiddenTropes>/);
    assert.match(rendered, /<trope>mouth opens\. closes\. opens again\.<\/trope>/);
    assert.match(rendered, /<trope>you did x\. in y\. in my z\.<\/trope>/);
});

test('base-context slop-remover include renders forbidden tropes context', () => {
    const env = createPromptEnv();
    const rendered = env.render('_includes/slop-remover.njk', buildContext());

    assert.match(rendered, /<forbiddenTropes>/);
    assert.match(rendered, /<trope>mouth opens\. closes\. opens again\.<\/trope>/);
    assert.match(rendered, /<trope>you did x\. in y\. in my z\.<\/trope>/);
});
