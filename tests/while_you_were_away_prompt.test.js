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

test('while-you-were-away include renders current-location reunion candidates', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('_includes/while-you-were-away.njk', {
        whileYouWereAwayNpcs: [
            {
                name: 'Bob',
                lastSeenTimeAgo: '2 hours ago',
                lastSeenLocationName: 'Town Square',
                last_seen_location: 'town-square'
            }
        ]
    });

    assert.match(rendered, /Bob \(last seen 2 hours ago at Town Square\)/);
    assert.match(rendered, /<name>Bob<\/name>/);
    assert.match(rendered, /Only use the optional arrival section for a character who is physically in the exact current location right now but was not listed above\./);
    assert.match(rendered, /<travelDestination>HERE<\/travelDestination>/);
    assert.match(rendered, /<proseForPlayer>/);
});

test('while-you-were-away include stays empty when no NPCs are supplied', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('_includes/while-you-were-away.njk', {
        whileYouWereAwayNpcs: []
    });

    assert.doesNotMatch(rendered, /last seen/i);
    assert.doesNotMatch(rendered, /<name>[^<]+<\/name>/);
});
