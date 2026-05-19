const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');

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
