const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const nunjucks = require('nunjucks');

test('thing-generator-contents renders pending containedItem seeds through item template', () => {
    const env = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts')),
        { autoescape: false }
    );

    const rendered = env.render('_includes/thing-generator-contents.njk', {
        container: {
            name: 'Supply Crate',
            containerContents: [
                { name: 'Signal Flares', count: 3 }
            ]
        },
        attributeDefinitions: {},
        equipmentSlots: [],
        rarityDefinitions: [
            { key: 'common', label: 'Common' }
        ],
        attributes: []
    });

    assert.match(rendered, /Generate only the items listed inside the container "Supply Crate"/);
    assert.match(rendered, /Do not generate the container itself/);
    assert.match(rendered, /Do not add, remove, combine, split, rename, or recount them/);
    assert.match(rendered, /Choose sensible numeric values yourself; do not use randomness/);
    assert.match(rendered, /Do not make tool calls/);
    assert.match(rendered, /<name>Signal Flares<\/name>/);
    assert.match(rendered, /<count>3<\/count>/);
    assert.doesNotMatch(rendered, /<!-- Item Name -->/);
});
