'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Globals = require('../Globals.js');
const Thing = require('../Thing.js');
const ItemCatalogue = require('../ItemCatalogue.js');
const { registerItemCatalogueApiRoutes } = require('../ItemCatalogueApi.js');

async function withServer(fn) {
    const app = express();
    registerItemCatalogueApiRoutes(app);
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    try {
        await fn(`http://127.0.0.1:${server.address().port}/api/item-catalogue`);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}

test('catalogue endpoint reads detached saved data without materializing items and isolates games', async () => {
    const wasLoaded = Globals.gameLoaded;
    Thing.clear();
    try {
        Globals.gameLoaded = true;
        const item = new Thing({ name: 'Extinct Ingot', description: 'A vanished bar.', thingType: 'item', rarity: 'common', level: 4 });
        item.delete();
        ItemCatalogue.commitFamilies([{
            name: 'Iron Sword', minimumRarity: 'common', maximumRarity: 'common', rarities: ['common'],
            variants: [{ name: 'Iron Sword', itemOrScenery: 'item', rarity: 'common', description: 'A sword.', unscaledAttributeBonuses: [{ attribute: 'strength', bonus: 2 }] }]
        }]);
        const before = ItemCatalogue.toJSON();
        const liveBefore = Thing.getAll().length;
        await withServer(async url => {
            const response = await fetch(url);
            assert.equal(response.status, 200);
            assert.equal(response.headers.get('cache-control'), 'no-store');
            const payload = await response.json();
            assert.equal(payload.success, true);
            assert.equal(payload.generation, ItemCatalogue.generation);
            assert.deepEqual(payload.definitions, before.definitions);
            assert.deepEqual(payload.families, before.families);
            assert.ok(Array.isArray(payload.rarityDefinitions));
            payload.definitions[0].blueprint.name = 'Changed by client';
            payload.families[0].variants[0].unscaledAttributeBonuses[0].bonus = 100;
            assert.deepEqual(ItemCatalogue.toJSON(), before);
            assert.equal(Thing.getAll().length, liveBefore);
            Thing.clear();
            const next = await (await fetch(url)).json();
            assert.deepEqual(next.definitions, []);
            assert.deepEqual(next.families, []);
            assert.notEqual(next.generation, payload.generation);
            Globals.gameLoaded = false;
            const unloaded = await fetch(url);
            assert.equal(unloaded.status, 409);
            assert.equal((await unloaded.json()).code, 'GAME_NOT_LOADED');
        });
    } finally {
        Thing.clear();
        Globals.gameLoaded = wasLoaded;
    }
});

test('catalogue endpoint returns the original failure and stack', async () => {
    const wasLoaded = Globals.gameLoaded;
    const original = ItemCatalogue.getAll;
    try {
        Globals.gameLoaded = true;
        ItemCatalogue.getAll = () => { throw new Error('Catalogue fixture failure'); };
        await withServer(async url => {
            const response = await fetch(url);
            assert.equal(response.status, 500);
            const payload = await response.json();
            assert.equal(payload.error, 'Catalogue fixture failure');
            assert.match(payload.stack, /Catalogue fixture failure/);
        });
    } finally {
        ItemCatalogue.getAll = original;
        Globals.gameLoaded = wasLoaded;
    }
});
