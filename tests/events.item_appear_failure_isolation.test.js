const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');

test.afterEach(() => {
    Events.initialize({});
});

test('item_appear continues generating later entries after one failed item', async () => {
    const generatedNames = [];
    const warnings = [];
    const context = {
        location: {
            id: 'loc-survey',
            name: 'Survey Site',
            things: [],
        },
    };
    const generationError = new Error('Item schema generation rejected the beacon.');
    const structured = {
        parsed: {
            item_appear: [
                {
                    name: 'First Survey Marker',
                    quantity: 1,
                    description: 'A fresh marker.',
                },
                {
                    name: 'Broken Survey Beacon',
                    quantity: 1,
                    description: 'This generation intentionally fails.',
                },
                {
                    name: 'Second Survey Marker',
                    quantity: 2,
                    description: 'Another fresh marker.',
                },
            ],
        },
        rawEntries: {
            item_appear: 'planned entries, including the failed beacon',
        },
    };
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args) => {
        warnings.push(args.map(String).join(' '));
    };
    console.error = () => {};

    Events.initialize({
        getConfig: () => ({ omit_npc_generation: true }),
        generateItemsByNames: async ({ itemNames }) => {
            const name = itemNames[0];
            if (name === 'Broken Survey Beacon') {
                throw generationError;
            }
            generatedNames.push(name);
            return [{
                id: `thing-${generatedNames.length}`,
                name,
                count: 1,
                metadata: {},
            }];
        },
    });
    Events._resetTrackingSets();

    try {
        await Events.applyEventOutcomes(structured, context);
    } finally {
        console.warn = originalWarn;
        console.error = originalError;
    }

    assert.deepEqual(generatedNames, ['First Survey Marker', 'Second Survey Marker']);
    assert.equal(Events.newItems.has('First Survey Marker'), true);
    assert.equal(Events.newItems.has('Broken Survey Beacon'), false);
    assert.equal(Events.newItems.has('Second Survey Marker'), true);
    assert.deepEqual(
        structured.parsed.item_appear.map(entry => entry.name),
        ['First Survey Marker', 'Second Survey Marker'],
        'committed event summaries must retain only appearances that were created or stacked successfully'
    );
    assert.equal(
        structured.rawEntries.item_appear,
        'First Survey Marker → 1 → A fresh marker. | Second Survey Marker → 2 → Another fresh marker.'
    );
    assert.equal(context.postProcessingErrors.length, 1);
    assert.equal(context.postProcessingErrors[0].code, 'EVENT_ITEM_APPEAR_FAILED');
    assert.equal(context.postProcessingErrors[0].stage, 'item appearance');
    assert.equal(context.postProcessingErrors[0].item.name, 'Broken Survey Beacon');
    assert.equal(context.postProcessingErrors[0].cause, generationError.message);
    assert.equal(context.postProcessingErrors[0].stack, generationError.stack,
        'the original generation backtrace must survive to the response');
    assert.match(warnings.join('\n'), /item_appear/i);
    assert.match(warnings.join('\n'), /Broken Survey Beacon/);
});
