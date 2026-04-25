const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
const promptSource = fs.readFileSync(path.join(rootDir, 'prompts', '_includes', 'thing-separate.njk'), 'utf8');
const thingsDocSource = fs.readFileSync(path.join(rootDir, 'docs', 'api', 'things.md'), 'utf8');
const chatDocSource = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'chat_interface.md'), 'utf8');

function assertIncludes(source, expected) {
    assert.ok(source.includes(expected), `Expected source to include: ${expected}`);
}

function assertMatches(source, pattern) {
    assert.ok(pattern.test(source), `Expected source to match: ${pattern}`);
}

test('thing context menu shows Separate for item and scenery sources', () => {
    assertIncludes(viewSource, "const normalizedThingType = (thing.thingType || '').trim().toLowerCase();");
    assertIncludes(viewSource, "const isItemThing = normalizedThingType === 'item';");
    assertIncludes(viewSource, "const isSceneryThing = normalizedThingType === 'scenery';");
    assertIncludes(viewSource, 'const canSeparate = isItemThing || isSceneryThing;');
    assertIncludes(viewSource, 'const canSplitStack = isItemThing && thingCount > 1');
    assertIncludes(viewSource, "const canMergeStacks = isItemThing && options.context !== 'npc-equipment';");
});

test('thing separate API accepts item or scenery sources', () => {
    assertMatches(apiSource, /const sourceThingType = typeof sourceThing\.thingType === 'string'[\s\S]*?sourceThing\.thingType\.trim\(\)\.toLowerCase\(\)[\s\S]*?: '';/);
    assertIncludes(apiSource, "const canSeparateSource = sourceThingType === 'item' || sourceThingType === 'scenery';");
    assertMatches(apiSource, /if \(!canSeparateSource\) \{[\s\S]*Only item or scenery things can be separated\./);
    assertIncludes(apiSource, "effectiveThingType !== 'item'");
    assertIncludes(apiSource, 'Thing separation returned scenery');
});

test('thing separation prompt and docs describe item-or-scenery sources', () => {
    assertIncludes(promptSource, 'Separate the item or scenery above');
    assert.doesNotMatch(promptSource, /Separate the item above/);
    assertIncludes(thingsDocSource, 'against an item or scenery thing');
    assertIncludes(thingsDocSource, 'Only item or scenery things can be separated.');
    assertIncludes(thingsDocSource, 'When separated output contains one or more containers, the first returned container receives the rest of the returned item-type things.');
    assertIncludes(promptSource, 'If a returned thing is a container that should hold the separated item outputs, mark it with `isContainer` true.');
    assertIncludes(chatDocSource, 'Item and scenery thing-card context menus include `Separate`');
});

test('stack separation preserves normalized scenery source type', () => {
    assertMatches(serverSource, /const stackThingType = sourceThingType === 'scenery' \? 'scenery' : 'item';/);
    assertIncludes(serverSource, 'itemOrScenery: stackThingType');
    assertIncludes(serverSource, 'thingType: stackThingType');
});

test('separated container output receives the rest of the item outputs', () => {
    assertIncludes(apiSource, 'const separatedOutputContainer = stagedThings.find(entry => Boolean(entry?.isContainer)) || null;');
    assertIncludes(apiSource, "const canNestSeparatedThing = (thing) => thing && thing !== separatedOutputContainer && thing.thingType === 'item';");
    assertIncludes(apiSource, 'const nestedSeparatedThings = separatedOutputContainer');
    assertIncludes(apiSource, 'const destinationSeparatedThings = separatedOutputContainer');
    assertIncludes(apiSource, 'separatedOutputContainer.addInventoryItem(nestedThing);');
    assertIncludes(apiSource, 'for (const stagedThing of destinationSeparatedThings)');
});
