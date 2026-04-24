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

test('last-seen-npcs include renders newly present NPC memory bullets', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('_includes/last-seen-npcs.njk', {
        currentLocationLastSeenNpcs: [
            {
                name: 'Bob',
                lastSeenTimeAgo: '2 days, 5 hours, and 20 minutes ago',
                lastSeenLocationName: 'Town Square',
                last_seen_location: 'town-square'
            }
        ]
    });

    assert.equal(
        rendered.trim(),
        '- Bob (last seen 2 days, 5 hours, and 20 minutes ago at Town Square)'
    );
});

test('last-seen-npcs include stays empty when no NPCs qualify', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('_includes/last-seen-npcs.njk', {
        currentLocationLastSeenNpcs: []
    });

    assert.equal(rendered.trim(), '');
});
