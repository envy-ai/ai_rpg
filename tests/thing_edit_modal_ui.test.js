const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const chatDocs = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'chat_interface.md'), 'utf8');
const locationDocs = fs.readFileSync(path.join(rootDir, 'docs', 'api', 'locations.md'), 'utf8');

function extractFunction(source, signature) {
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, `${signature} should exist`);
    const bodyOpenMarker = source.indexOf(') {', start);
    assert.notEqual(bodyOpenMarker, -1, `${signature} should have a body`);
    const bodyStart = bodyOpenMarker + 2;

    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    assert.fail(`${signature} body should close`);
}

test('New Item/Scenery modal slot pulldown has an empty Not specified option', () => {
    const slotFunction = extractFunction(viewSource, 'function populateThingSlotOptions');
    const formFunction = extractFunction(viewSource, 'function populateThingEditForm');

    assert.match(viewSource, /<select id="thingEditSlot"><\/select>/);
    assert.match(slotFunction, /function populateThingSlotOptions\(selectedSlot = '', \{ mode = 'edit' \} = \{\}\)/);
    assert.match(slotFunction, /emptyOption\.value = ''/);
    assert.match(slotFunction, /emptyOption\.textContent = mode === 'create'\s*\?\s*'Not specified'\s*:\s*'Not equippable'/);
    assert.match(formFunction, /populateThingSlotOptions\(thing\?\.slot \|\| thing\?\.metadata\?\.slot \|\| '', \{ mode \}\)/);
});

test('New Item/Scenery modal type pulldown can leave item/scenery unspecified', () => {
    const formFunction = extractFunction(viewSource, 'function populateThingEditForm');

    assert.match(viewSource, /<select id="thingEditType">\s*<option value="">Not specified<\/option>\s*<option value="item">Item<\/option>\s*<option value="scenery">Scenery<\/option>\s*<\/select>/);
    assert.match(viewSource, /function normalizeThingTypeSelection\(value\)/);
    assert.match(viewSource, /function syncThingTypeSelectForMode\(mode = 'edit'\)/);
    assert.match(formFunction, /syncThingTypeSelectForMode\(mode\)/);
    assert.match(formFunction, /const explicitType = normalizeThingTypeSelection\(options\.itemOrScenery\);/);
    assert.match(formFunction, /thingEditTypeSelect\.value = typeValue;/);

    assert.match(viewSource, /async function openAddThingModal\(\{ itemOrScenery = '' \} = \{\}\)/);
    assert.match(viewSource, /const typeSelection = normalizeThingTypeSelection\(thingEditTypeSelect\?\.value \|\| ''\);/);
    assert.match(viewSource, /const seed = \{\};\s*if \(typeSelection\) \{\s*seed\.itemOrScenery = typeSelection;\s*\}/);
});

test('location thing creation leaves omitted itemOrScenery unspecified for generation', () => {
    const routeStart = apiSource.indexOf("        app.post('/api/locations/:id/things'");
    const routeEnd = apiSource.indexOf("\n        app.post('/api/locations/:id/modify'", routeStart);
    assert.notEqual(routeStart, -1, 'location thing creation route should exist');
    assert.notEqual(routeEnd, -1, 'location thing creation route should have a following route');
    const routeSource = apiSource.slice(routeStart, routeEnd);

    assert.match(routeSource, /const rawItemOrScenery = normalizeSeedString\(rawSeed\.itemOrScenery\);/);
    assert.match(routeSource, /if \(rawItemOrScenery\) \{[\s\S]*const normalizedItemOrScenery = rawItemOrScenery\.toLowerCase\(\);[\s\S]*if \(normalizedItemOrScenery !== 'item' && normalizedItemOrScenery !== 'scenery'\) \{[\s\S]*return res\.status\(400\)\.json\(\{[\s\S]*Invalid itemOrScenery[\s\S]*\}\);[\s\S]*\}[\s\S]*seed\.itemOrScenery = normalizedItemOrScenery;[\s\S]*\}/);
    assert.doesNotMatch(routeSource, /seed\.itemOrScenery = rawItemOrScenery && rawItemOrScenery\.toLowerCase\(\) === 'scenery'[\s\S]*: 'item';/);
});

test('create thing docs describe unspecified type generation', () => {
    assert.match(chatDocs, /Type pulldown includes a blank `Not specified` option/);
    assert.match(locationDocs, /When `seed\.itemOrScenery` is omitted/);
});
