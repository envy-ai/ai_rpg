const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');
const craftingDocs = fs.readFileSync(path.join(rootDir, 'docs', 'api', 'crafting.md'), 'utf8');
const chatDocs = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'chat_interface.md'), 'utf8');

function assertIncludes(source, expected) {
    assert.ok(source.includes(expected), `Expected source to include: ${expected}`);
}

test('crafting UI greys out non-empty containers and blocks assignment', () => {
    assertIncludes(viewSource, 'function isCraftingNonEmptyContainer(thing)');
    assertIncludes(viewSource, "card.classList.add('is-non-empty-container');");
    assertIncludes(viewSource, 'Empty this container before using it for crafting.');
    assertIncludes(viewSource, 'if (isCraftingNonEmptyContainer(sourceThing))');
    assertIncludes(viewSource, 'if (isCraftingNonEmptyContainer(thing))');
    assertIncludes(scssSource, '.crafting-inventory-card.is-non-empty-container');
});

test('crafting API rejects non-empty containers submitted as inputs', () => {
    assertIncludes(apiSource, 'function isNonEmptyCraftingContainer(thing)');
    assertIncludes(apiSource, 'Selected container');
    assertIncludes(apiSource, 'must be emptied before it can be used for crafting.');
});

test('crafting docs describe non-empty container handling', () => {
    assertIncludes(craftingDocs, 'Non-empty containers cannot be selected as crafting inputs');
    assertIncludes(chatDocs, 'non-empty containers are greyed out');
});
