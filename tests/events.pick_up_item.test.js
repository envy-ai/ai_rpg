const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');

test.afterEach(() => {
    Events.initialize({});
});

test('pick_up_item lets different actors pick up separate same-name loose items', async () => {
    const makeLooseThing = (id) => {
        const thing = {
            id,
            name: 'Heavy Beam Pistol',
            count: 1,
            metadata: { locationId: 'armory' },
            whoseInventory() {
                const owner = actorsById.get(this.metadata?.ownerId);
                return owner ? [owner] : [];
            }
        };
        return thing;
    };
    const receivedByActor = new Map();
    const makeActor = (id, name) => ({
        id,
        name,
        addInventoryItem(thing) {
            receivedByActor.set(id, [...(receivedByActor.get(id) || []), thing]);
            thing.metadata = { ownerId: id };
            return true;
        }
    });
    const codex = makeActor('char-codex', 'Seraphim Archivist "Codex"');
    const serafi = makeActor('char-serafi', 'Seraphim Unit-3 "Serafi"');
    const actorsById = new Map([
        [codex.id, codex],
        [serafi.id, serafi]
    ]);
    const actorsByName = new Map([
        [codex.name.toLowerCase(), codex],
        [serafi.name.toLowerCase(), serafi]
    ]);
    const firstPistol = makeLooseThing('thing-pistol-1');
    const secondPistol = makeLooseThing('thing-pistol-2');
    const things = new Map([
        [firstPistol.id, firstPistol],
        [secondPistol.id, secondPistol]
    ]);
    const location = {
        id: 'armory',
        name: 'Armory'
    };

    Events.initialize({
        things,
        getConfig: () => ({ omit_npc_generation: true }),
        findActorByName: (name) => actorsByName.get(String(name || '').trim().toLowerCase()) || null,
        generateItemsByNames: async () => {
            throw new Error('pick_up_item should not generate items when enough loose items exist.');
        }
    });
    Events._resetTrackingSets();

    await Events.applyEventOutcomes({
        parsed: {
            pick_up_item: [
                {
                    name: 'Seraphim Archivist "Codex"',
                    item: 'Heavy Beam Pistol',
                    quantity: 1
                },
                {
                    name: 'Seraphim Unit-3 "Serafi"',
                    item: 'Heavy Beam Pistol',
                    quantity: 1
                }
            ]
        },
        rawEntries: {}
    }, { location });

    assert.deepEqual(receivedByActor.get(codex.id), [firstPistol]);
    assert.deepEqual(receivedByActor.get(serafi.id), [secondPistol]);
    assert.equal(firstPistol.metadata.ownerId, codex.id);
    assert.equal(secondPistol.metadata.ownerId, serafi.id);
});

test('pick_up_item lets different actors split a same-name loose stack', async () => {
    const receivedByActor = new Map();
    const makeActor = (id, name) => ({
        id,
        name,
        addInventoryItem(thing) {
            receivedByActor.set(id, [...(receivedByActor.get(id) || []), thing]);
            thing.metadata = { ownerId: id };
            return true;
        }
    });
    const codex = makeActor('char-codex', 'Seraphim Archivist "Codex"');
    const serafi = makeActor('char-serafi', 'Seraphim Unit-3 "Serafi"');
    const actorsById = new Map([
        [codex.id, codex],
        [serafi.id, serafi]
    ]);
    const actorsByName = new Map([
        [codex.name.toLowerCase(), codex],
        [serafi.name.toLowerCase(), serafi]
    ]);
    const pistolStack = {
        id: 'thing-pistol-stack',
        name: 'Heavy Beam Pistol',
        count: 2,
        metadata: { locationId: 'armory' },
        whoseInventory() {
            const owner = actorsById.get(this.metadata?.ownerId);
            return owner ? [owner] : [];
        },
        copy({ count, metadataOverrides = {} } = {}) {
            const copy = {
                ...this,
                id: 'thing-pistol-split',
                count,
                metadata: {
                    ...(this.metadata || {}),
                    ...metadataOverrides
                }
            };
            copy.whoseInventory = this.whoseInventory;
            copy.copy = this.copy;
            return copy;
        }
    };
    const things = new Map([[pistolStack.id, pistolStack]]);
    const location = {
        id: 'armory',
        name: 'Armory',
        addThingId(thingId) {
            const thing = things.get(thingId);
            if (thing) {
                thing.metadata = { ...(thing.metadata || {}), locationId: this.id };
            }
            return true;
        }
    };

    Events.initialize({
        things,
        getConfig: () => ({ omit_npc_generation: true }),
        findActorByName: (name) => actorsByName.get(String(name || '').trim().toLowerCase()) || null,
        generateItemsByNames: async () => {
            throw new Error('pick_up_item should not generate items when a large enough loose stack exists.');
        }
    });
    Events._resetTrackingSets();

    await Events.applyEventOutcomes({
        parsed: {
            pick_up_item: [
                {
                    name: 'Seraphim Archivist "Codex"',
                    item: 'Heavy Beam Pistol',
                    quantity: 1
                },
                {
                    name: 'Seraphim Unit-3 "Serafi"',
                    item: 'Heavy Beam Pistol',
                    quantity: 1
                }
            ]
        },
        rawEntries: {}
    }, { location });

    const codexItems = receivedByActor.get(codex.id) || [];
    const serafiItems = receivedByActor.get(serafi.id) || [];
    assert.equal(codexItems.length, 1);
    assert.equal(serafiItems.length, 1);
    assert.equal(codexItems[0].count, 1);
    assert.equal(serafiItems[0].count, 1);
    assert.equal(codexItems[0].metadata.ownerId, codex.id);
    assert.equal(serafiItems[0].metadata.ownerId, serafi.id);
});

test('pick_up_item skips exact duplicate actor item quantity rows', async () => {
    const receivedItems = [];
    const actor = {
        id: 'char-codex',
        name: 'Seraphim Archivist "Codex"',
        addInventoryItem(thing) {
            receivedItems.push(thing);
            thing.metadata = { ownerId: this.id };
            return true;
        }
    };
    const pistolStack = {
        id: 'thing-pistol-stack',
        name: 'Heavy Beam Pistol',
        count: 2,
        metadata: { locationId: 'armory' },
        whoseInventory() {
            return this.metadata?.ownerId === actor.id ? [actor] : [];
        },
        copy({ count, metadataOverrides = {} } = {}) {
            const copy = {
                ...this,
                id: 'thing-pistol-split',
                count,
                metadata: {
                    ...(this.metadata || {}),
                    ...metadataOverrides
                }
            };
            copy.whoseInventory = this.whoseInventory;
            copy.copy = this.copy;
            return copy;
        }
    };
    const things = new Map([[pistolStack.id, pistolStack]]);
    const location = {
        id: 'armory',
        name: 'Armory',
        addThingId(thingId) {
            const thing = things.get(thingId);
            if (thing) {
                thing.metadata = { ...(thing.metadata || {}), locationId: this.id };
            }
            return true;
        }
    };

    Events.initialize({
        things,
        getConfig: () => ({ omit_npc_generation: true }),
        findActorByName: (name) => (
            String(name || '').trim().toLowerCase() === actor.name.toLowerCase()
                ? actor
                : null
        ),
        generateItemsByNames: async () => {
            throw new Error('pick_up_item should not generate items for an exact duplicate row.');
        }
    });
    Events._resetTrackingSets();

    await Events.applyEventOutcomes({
        parsed: {
            pick_up_item: [
                {
                    name: 'Seraphim Archivist "Codex"',
                    item: 'Heavy Beam Pistol',
                    quantity: 1
                },
                {
                    name: 'Seraphim Archivist "Codex"',
                    item: 'Heavy Beam Pistol',
                    quantity: 1
                }
            ]
        },
        rawEntries: {}
    }, { location });

    assert.equal(receivedItems.length, 1);
    assert.equal(receivedItems[0].count, 1);
    assert.equal(receivedItems[0].metadata.ownerId, actor.id);
});
