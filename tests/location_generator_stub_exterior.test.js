const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const nunjucks = require('nunjucks');

const promptsDir = path.join(__dirname, '..', 'prompts');
const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(promptsDir),
    { autoescape: false }
);

test('exterior stub prompt renders the base building name without crashing', () => {
    const rendered = env.render('_includes/location-generator-stub.njk', {
        stubId: 'loc_community_kitchen_exterior',
        stubName: 'Community Kitchen Exterior'
    });

    assert.match(rendered, /THIS IS THE EXTERIOR OF A BUILDING, NOT THE INTERIOR!/);
    assert.match(rendered, /people who might be found outside of Community Kitchen\./);
    assert.match(rendered, /enemies who might be found outside of Community Kitchen\./);
    assert.doesNotMatch(rendered, /outside of community kitchen exterior/i);
});

test('stub prompt tolerates a missing stub name', () => {
    assert.doesNotThrow(() => env.render('_includes/location-generator-stub.njk', {
        stubId: 'loc_unnamed'
    }));
});
