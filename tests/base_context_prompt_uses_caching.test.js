const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
    createPromptEnv,
    buildBaseRenderContext
} = require('./helpers/baseContextFixtures.js');

function buildRenderContext({ promptUsesCaching, omitGameHistory }) {
    return buildBaseRenderContext({
        question: 'What happened?',
        currencyName: 'Gold',
        regionName: '',
        promptUsesCaching,
        overrides: {
            gameHistory: 'Older story entry.',
            recentGameHistory: 'Recent story entry.',
            omitGameHistory
        }
    });
}

test('base-context omits olderStoryHistory when omitGameHistory is set and prompt_uses_caching is false', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        promptUsesCaching: false,
        omitGameHistory: true
    }));

    assert.doesNotMatch(rendered, /<olderStoryHistory>/);
    assert.match(rendered, /<recentStoryHistory>Recent story entry\.<\/recentStoryHistory>/);
});

test('base-context keeps olderStoryHistory when prompt_uses_caching is true', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        promptUsesCaching: true,
        omitGameHistory: true
    }));

    assert.match(rendered, /<olderStoryHistory>Older story entry\.<\/olderStoryHistory>/);
});

test('base-context history assembly does not append an empty recent-story separator to older history', () => {
    const serverSource = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');

    assert.doesNotMatch(serverSource, /Recent story \(verbatim, not summarized\)/);
});
