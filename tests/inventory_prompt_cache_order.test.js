const test = require('node:test');
const assert = require('node:assert/strict');
const nunjucks = require('nunjucks');

const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('prompts'), { autoescape: false });
const context = name => ({
    itemBatchPlanningOnly: true,
    attributeDefinitions: { strength: { description: 'Power.' } },
    gearSlots: ['head'],
    character: { name, role: 'Merchant', description: `${name} sells things.` },
    rarityDefinitions: [{ key: 'common', description: 'Common.' }],
    itemReuseFamilies: [{ id: 'itemfamily_clamp', name: 'Loose Conduit Clamp', rarities: ['common'] }]
});

test('inventory roster renders the shared family catalogue once, before the character, so NPCs share a cached prefix', () => {
    const a = env.render('_includes/inventory-generator.njk', context('Ada'));
    const b = env.render('_includes/inventory-generator.njk', context('Bo'));
    assert.equal(a.split('<reusableFamilies>').length - 1, 1);
    assert.equal(a.split('Configured rarities:').length - 1, 1);
    assert.ok(a.indexOf('</reusableFamilies>') < a.indexOf('<character>'));
    let shared = 0;
    while (a[shared] === b[shared]) shared += 1;
    assert.ok(shared > a.indexOf('</reusableFamilies>'), 'the prompts diverge only after the catalogue');
});

test('container contents planning still renders the catalogue', () => {
    const output = env.render('_includes/thing-generator-contents.njk', context('Box'));
    assert.equal(output.split('<reusableFamilies>').length - 1, 1);
});
