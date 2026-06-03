const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');

test.afterEach(() => {
    Events.initialize({});
});

test('item_appear continues generating later entries after one failed item', async () => {
    const generatedNames = [];
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
        warnings.push(args.map(String).join(' '));
    };

    Events.initialize({
        getConfig: () => ({ omit_npc_generation: true }),
        generateItemsByNames: async ({ itemNames }) => {
            const name = itemNames[0];
            if (name === 'Broken Survey Beacon') {
                return [];
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
        await Events.applyEventOutcomes({
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
            rawEntries: {},
        }, {
            location: {
                id: 'loc-survey',
                name: 'Survey Site',
                things: [],
            },
        });
    } finally {
        console.warn = originalWarn;
    }

    assert.deepEqual(generatedNames, ['First Survey Marker', 'Second Survey Marker']);
    assert.equal(Events.newItems.has('First Survey Marker'), true);
    assert.equal(Events.newItems.has('Broken Survey Beacon'), false);
    assert.equal(Events.newItems.has('Second Survey Marker'), true);
    assert.match(warnings.join('\n'), /item_appear/i);
    assert.match(warnings.join('\n'), /Broken Survey Beacon/);
});
