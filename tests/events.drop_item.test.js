const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');

test.afterEach(() => {
    Events.initialize({});
});

test('drop_item continues applying later entries after one actor item mismatch', async () => {
    const things = new Map([
        ['thing-shard', {
            id: 'thing-shard',
            name: 'Whisperglass Shard of the First Survey',
            count: 1,
            metadata: { ownerId: 'char-baato' }
        }],
        ['thing-memory-core', {
            id: 'thing-memory-core',
            name: 'Pre-Construction Memory Core',
            count: 1,
            metadata: { ownerId: 'char-velkathra' }
        }],
        ['thing-map', {
            id: 'thing-map',
            name: 'Map to the Deep Sector Express',
            count: 1,
            metadata: { ownerId: 'char-baato' }
        }],
        ['thing-codex', {
            id: 'thing-codex',
            name: "The Heart-Seeker's Codex",
            count: 1,
            metadata: { ownerId: 'char-mikki' }
        }]
    ]);
    const makeActor = (id, name) => ({
        id,
        name,
        hasInventoryItem() {
            return true;
        }
    });
    const actors = new Map([
        ['baato', makeActor('char-baato', 'Baato')],
        ['velkathra zauvirr', makeActor('char-velkathra', 'Velkathra Zauvirr')],
        ['mikki flashpaw', makeActor('char-mikki', 'Mikki Flashpaw')]
    ]);
    const addedThingIds = [];
    const location = {
        id: 'loc-main-junction',
        name: 'Main Junction Hub',
        addThingId(thingId) {
            addedThingIds.push(thingId);
            return true;
        }
    };
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
        warnings.push(args.map(String).join(' '));
    };

    Events.initialize({
        things,
        getConfig: () => ({ omit_npc_generation: true }),
        findActorByName: (name) => actors.get(String(name || '').trim().toLowerCase()) || null
    });
    Events._resetTrackingSets();

    try {
        await Events.applyEventOutcomes({
            parsed: {
                drop_item: [
                    {
                        name: 'Baato',
                        item: 'Whisperglass Shard of the First Survey',
                        quantity: 1
                    },
                    {
                        name: 'Baato',
                        item: 'Pre-Construction Memory Core',
                        quantity: 1
                    },
                    {
                        name: 'Baato',
                        item: 'Map to the Deep Sector Express',
                        quantity: 1
                    },
                    {
                        name: 'Mikki Flashpaw',
                        item: "The Heart-Seeker's Codex",
                        quantity: 1
                    }
                ]
            },
            rawEntries: {}
        }, { location });
    } finally {
        console.warn = originalWarn;
    }

    assert.deepEqual(addedThingIds, ['thing-shard', 'thing-map', 'thing-codex']);
    assert.equal(Events.droppedItems.has('Whisperglass Shard of the First Survey'), true);
    assert.equal(Events.droppedItems.has('Pre-Construction Memory Core'), false);
    assert.equal(Events.droppedItems.has('Map to the Deep Sector Express'), true);
    assert.equal(Events.droppedItems.has("The Heart-Seeker's Codex"), true);
    assert.match(warnings.join('\n'), /drop_item/i);
    assert.match(warnings.join('\n'), /Baato/);
    assert.match(warnings.join('\n'), /Pre-Construction Memory Core/);
});
