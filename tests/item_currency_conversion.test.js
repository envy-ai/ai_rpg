const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    resolveThingCurrencyConversion,
    resolveThingStandardValueDetails
} = require('../api.js');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('currency conversion multiplies integer unit value by the complete stack count', () => {
    const conversion = resolveThingCurrencyConversion({
        id: 'thing-copper-coins',
        name: 'Copper Coins',
        thingType: 'item',
        count: 37,
        metadata: { value: '2' },
        isContainer: false,
        containedThingIds: [],
        containerContents: []
    });

    assert.deepEqual(conversion, {
        thingId: 'thing-copper-coins',
        thingName: 'Copper Coins',
        count: 37,
        unitValue: 2,
        totalValue: 74
    });
});

test('currency conversion uses one item when stack count is omitted and preserves explicit zero value', () => {
    assert.deepEqual(resolveThingStandardValueDetails({ metadata: { value: 0 } }), {
        found: true,
        value: 0
    });

    const conversion = resolveThingCurrencyConversion({
        id: 'thing-token',
        name: 'Brass Token',
        thingType: 'item',
        metadata: { value: 0 },
        isContainer: false
    });
    assert.equal(conversion.count, 1);
    assert.equal(conversion.totalValue, 0);
});

test('currency conversion rejects values and item states the player must fix first', () => {
    assert.throws(
        () => resolveThingCurrencyConversion({
            id: 'thing-scenery',
            name: 'Coin Fountain',
            thingType: 'scenery',
            metadata: { value: 10 }
        }),
        /Only items can be converted/
    );

    assert.throws(
        () => resolveThingCurrencyConversion({
            id: 'thing-valueless',
            name: 'Mystery Coin',
            thingType: 'item',
            metadata: {},
            isContainer: false
        }),
        /has no numeric value.*Edit the item and set its value first/
    );

    assert.throws(
        () => resolveThingCurrencyConversion({
            id: 'thing-negative',
            name: 'Debt Note',
            thingType: 'item',
            metadata: { value: -5 },
            isContainer: false
        }),
        /value must be zero or greater/
    );

    assert.throws(
        () => resolveThingCurrencyConversion({
            id: 'thing-filled-pouch',
            name: 'Filled Pouch',
            thingType: 'item',
            metadata: { value: 5 },
            isContainer: true,
            containedThingIds: ['thing-inside'],
            containerContents: []
        }),
        /Open it and empty it first/
    );

    assert.throws(
        () => resolveThingCurrencyConversion({
            id: 'thing-pending-pouch',
            name: 'Unopened Pouch',
            thingType: 'item',
            metadata: { value: 5 },
            isContainer: true,
            containedThingIds: [],
            containerContents: [{ name: 'Coin', count: 3 }]
        }),
        /Open it and empty it first/
    );
});

test('things API and item context menus expose confirmed authoritative currency conversion', () => {
    const apiSource = read('api.js');
    const viewSource = read('views/index.njk');

    assert.match(apiSource, /app\.get\('\/api\/things\/:id\/currency-conversion'/);
    assert.match(apiSource, /app\.post\('\/api\/things\/:id\/convert-to-currency'/);
    assert.match(apiSource, /assertThingCurrencyConversionConfirmation\(req\.body\?\.expected, conversion\)/);
    assert.match(apiSource, /const deletionResult = deleteThingById\(req\.params\.id\);[\s\S]*conversionPlayer\.setCurrency\(currencyAfter\)/);

    assert.match(viewSource, /if \(isItemThing\) \{[\s\S]*convertToCurrencyButton\.textContent = 'Convert to Currency'/);
    assert.match(viewSource, /Item being deleted: \$\{itemLabel\}/);
    assert.match(viewSource, /You will receive \$\{conversion\.totalValue\} \$\{conversion\.currencyLabel\}/);
    assert.match(viewSource, /window\.alert\(`Failed to convert item to currency:/);
});
