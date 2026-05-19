const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const nunjucks = require('nunjucks');

const { addEvalFilter } = require('../nunjucks_filters.js');

function createPromptEnv() {
    const env = nunjucks.configure(path.join(process.cwd(), 'prompts'), {
        autoescape: false,
        throwOnUndefined: true
    });
    addEvalFilter(env);
    return env;
}

test('mystery-thread-check include renders active mystery thread names', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('_includes/mystery-thread-check.njk', {
        activeMysteryThreads: [
            { name: 'Ellison Conspiracy' },
            { name: 'Burned Archive' }
        ]
    });

    assert.doesNotMatch(rendered, /\[codex: replace this with a list of mystery threads by name\]/);
    assert.match(rendered, /- Ellison Conspiracy/);
    assert.match(rendered, /- Burned Archive/);
});
