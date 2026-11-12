'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Thing = require('../Thing.js');
const Pool = require('../ItemChargePool.js');
const Service = require('../ItemChargeService.js');
const Catalogue = require('../ItemCatalogue.js');
const registerApi = require('../ItemChargeApi.js');

const pool = (overrides = {}) => ({ mode: 'discrete', amount: 1, capacity: 5, unit: 'rounds', ammoType: 'round', ...overrides });
const item = (overrides = {}) => new Thing({ name: 'Test item', description: 'A test item.', thingType: 'item', ...overrides });
function actorWith(...items) {
    const ids = new Set(items.map(value => value.id));
    return { id: 'player_test', hasInventoryItem: id => ids.has(id) && !!Thing.getById(id),
        getInventoryItems: () => [...ids].map(id => Thing.getById(id)).filter(Boolean),
        addInventoryItem: value => { ids.add(value.id); return true; } };
}
test.beforeEach(() => Thing.clear());
test.afterEach(() => Thing.clear());

test('decimal spending is exact and pool values reject invalid discrete or out-of-range inputs', () => {
    const battery = item({ chargePool: pool({ mode: 'continuous', ammoType: undefined, amount: 0.3, capacity: 0.3, unit: 'energy' }) });
    const actor = actorWith(battery);
    for (let i = 0; i < 3; i++) Service.spend({ actor, itemId: battery.id, amount: 0.1 });
    assert.equal(battery.chargePool.amount, 0);
    for (const invalid of [-1, Infinity, NaN, 1.5, 6]) assert.throws(() => Pool.normalizePool(pool({ amount: invalid })), /chargePool\.amount/);
    assert.throws(() => Pool.normalizePool(pool(), { count: 2 }), /count.*1/);
    assert.throws(() => Pool.validatePayment(pool(), 0.5), /integer/);
});

test('charged instances stay individual, copy zero, and catalogue ignores current amount', () => {
    const first = item({ chargePool: pool({ amount: 0, initialAmount: 3 }) });
    const copy = first.copy();
    assert.equal(copy.chargePool.amount, 0);
    assert.equal(Thing.canMergeStacks(first, copy), false);
    assert.throws(() => { first.count = 2; }, /count.*1/);
    const before = Catalogue.blueprintFrom(first);
    first.chargePool = pool({ amount: 2, initialAmount: 3 });
    assert.deepEqual(Catalogue.blueprintFrom(first), before);
    assert.equal(before.chargePool.amount, undefined);
    assert.equal(Pool.materialize(before.chargePool).amount, 3);
    assert.throws(() => Pool.materialize(Pool.templateFrom(pool())), /initialAmount/);
});

test('reload uses the selected source, rejects bad transfers, and replays after source deletion', () => {
    const weapon = item({ chargePool: pool() });
    const ammo = item({ name: 'Rounds', ammoType: ' ROUND ', count: 3 });
    const wrong = item({ name: 'Wrong', ammoType: 'other', count: 9 });
    const actor = actorWith(weapon, ammo, wrong);
    assert.deepEqual(Service.getReloadOptions({ actor, itemId: weapon.id }).sources.map(x => x.id), [ammo.id]);
    assert.throws(() => Service.reload({ actor, itemId: weapon.id, ammoItemId: wrong.id, operationId: 'wrong' }), /ammoItemId/);
    for (const amount of [0.5, 4, 5]) assert.throws(() => Service.reload({ actor, itemId: weapon.id, ammoItemId: ammo.id, amount, operationId: `bad-${amount}` }), /integer|count|capacity/);
    assert.equal(weapon.chargePool.amount, 1);
    assert.equal(ammo.count, 3);
    const options = { actor, itemId: weapon.id, ammoItemId: ammo.id, operationId: 'reload-1' };
    const result = Service.reload(options);
    assert.equal(result.amount, 3);
    assert.equal(weapon.chargePool.amount, 4);
    assert.equal(Thing.getById(ammo.id), null);
    assert.deepEqual(Service.reload(options), result);
    assert.throws(() => Service.reload({ ...options, amount: 1 }), /different request/);
});

test('partial source deletion failure rolls back target, registration, ownership and receipt', () => {
    const weapon = item({ chargePool: pool() });
    const ammo = item({ name: 'Rounds', ammoType: 'round', count: 2 });
    const actor = actorWith(weapon, ammo);
    const originalDelete = ammo.delete.bind(ammo);
    ammo.delete = () => { originalDelete(); throw new Error('injected deletion failure'); };
    const options = { actor, itemId: weapon.id, ammoItemId: ammo.id, operationId: 'rollback' };
    assert.throws(() => Service.reload(options), /injected deletion failure/);
    assert.equal(weapon.chargePool.amount, 1);
    assert.equal(ammo.count, 2);
    assert.equal(Thing.getById(ammo.id), ammo);
    assert.equal(actor.hasInventoryItem(ammo.id), true);
    assert.equal(Service.getOperationRecord('rollback'), null);
    ammo.delete = originalDelete;
    assert.equal(Service.reload(options).amount, 2);
});

test('native save files preserve charge ledger and accept legacy missing ledger', async () => {
    require('../LLMClient.js');
    const Utils = require('../Utils.js');
    const weapon = item({ chargePool: pool() });
    const actor = actorWith(weapon);
    Service.spend({ actor, itemId: weapon.id, amount: 1, operationId: 'saved-spend' });
    const ledger = Service.toJSON();
    const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'item-charge-'));
    await Utils.writeSerializedGameState(dir, { itemCharges: ledger, things: { [weapon.id]: weapon.toJSON() } });
    const saved = Utils.loadSerializedGameState(dir);
    assert.deepEqual(saved.itemCharges, ledger);
    assert.equal(saved.things[weapon.id].chargePool.amount, 0);
    Service.clear(); Service.hydrate(saved.itemCharges);
    assert.equal(Service.getOperationRecord('saved-spend').result.after, 0);
    fs.unlinkSync(path.join(dir, 'itemCharges.json'));
    assert.equal(Utils.loadSerializedGameState(dir).itemCharges, undefined);
    assert.doesNotThrow(() => Service.hydrate(undefined));
});

test('reload API reports success and stack-bearing errors', () => {
    const weapon = item({ chargePool: pool() });
    const ammo = item({ name: 'Rounds', ammoType: 'round', count: 2 });
    const actor = actorWith(weapon, ammo);
    const routes = {};
    registerApi({ get: (p, h) => { routes.get = h; }, post: (p, h) => { routes.post = h; } }, { getCurrentPlayer: () => actor });
    const invoke = (handler, body = {}) => { let status = 200, data; handler({ params: { id: weapon.id }, body }, { status(code) { status = code; return this; }, json(value) { data = value; } }); return { status, data }; };
    assert.equal(invoke(routes.get).data.sources[0].id, ammo.id);
    const good = invoke(routes.post, { ammoItemId: ammo.id, operationId: 'api-reload' });
    assert.equal(good.data.success, true);
    assert.equal(good.data.receipt.amount, 2);
    assert.deepEqual(invoke(routes.post, { ammoItemId: ammo.id, operationId: 'api-reload' }).data.receipt, good.data.receipt);
    const bad = invoke(routes.post, { ammoItemId: ammo.id, operationId: 'new', actorId: 'other' });
    assert.equal(bad.status, 400);
    assert.match(bad.data.stack, /reload\.actorId/);
});

test('charge XML optional scalars consistently omit blanks and preserve explicit zero', () => {
    const { DOMParser } = require('@xmldom/xmldom');
    const parse = content => Pool.parseXml(new DOMParser().parseFromString(`<thing><chargePool><mode>continuous</mode><amount>0</amount><capacity>2</capacity><unit>energy</unit>${content}</chargePool></thing>`, 'application/xml').documentElement).chargePool;
    for (const content of ['', '<initialAmount/>', '<initialAmount></initialAmount>', '<initialAmount>  </initialAmount>']) assert.equal(parse(content).initialAmount, undefined);
    assert.equal(parse('<initialAmount>0</initialAmount><costPerUse>0</costPerUse>').initialAmount, 0);
    assert.equal(parse('<initialAmount>0</initialAmount><costPerUse>0</costPerUse>').costPerUse, 0);
    for (const bad of ['<initialAmount>0</initialAmount><initialAmount>1</initialAmount>', '<unexpected>1</unexpected>', '<initialAmount><value>1</value></initialAmount>']) assert.throws(() => parse(bad), /chargePool\./);
});

test('charge events parse strict XML, apply and deduplicate recorded passes', () => {
    const { DOMParser } = require('@xmldom/xmldom');
    const Events = require('../ItemChargeEvents.js');
    const Player = require('../Player.js');
    const parse = xml => Events.parse(new DOMParser().parseFromString(xml, 'application/xml').documentElement);
    const weapon = item({ chargePool: pool() });
    const ammo = item({ name: 'Rounds', ammoType: 'round', count: 3 });
    const actor = actorWith(weapon, ammo);
    const oldGet = Player.getById;
    Player.getById = id => id === actor.id ? actor : null;
    try {
        const command = parse(`<reloadItem><actorId>${actor.id}</actorId><itemId>${weapon.id}</itemId><ammoItemId>${ammo.id}</ammoItemId><amount>2</amount></reloadItem>`);
        const first = Events.apply(command, { sourceEntryId: 'event-1' });
        assert.equal(weapon.chargePool.amount, 3);
        assert.deepEqual(Events.apply(command, { sourceEntryId: 'event-1' }), first);
        assert.equal(ammo.count, 1);
        assert.throws(() => parse(`<reloadItem><actorId>${actor.id}</actorId><itemId>${weapon.id}</itemId><ammoItemId>${ammo.id}</ammoItemId><amount>0.5</amount></reloadItem>`), /amount/);
        assert.throws(() => parse(`<chargeAdjust><actorId>${actor.id}</actorId><itemId>${weapon.id}</itemId><amount>1</amount><reason><nested/></reason></chargeAdjust>`), /reason/);
    } finally { Player.getById = oldGet; }
});

test('event source and section identity agree between direct execution and replay passes', () => {
    const Events = require('../ItemChargeEvents.js');
    const Reprocessor = require('../EventReprocessor.js');
    const Player = require('../Player.js');
    const weapon = item({ chargePool: pool() });
    const ammo = item({ name: 'Rounds', ammoType: 'round', count: 3 });
    const actor = actorWith(weapon, ammo);
    const oldGet = Player.getById;
    Player.getById = id => id === actor.id ? actor : null;
    try {
        const command = { kind: 'reloadItem', actorId: actor.id, itemId: weapon.id, ammoItemId: ammo.id, amount: 1 };
        const first = Events.apply(command, { sourceEntryId: 'entry-1', eventSectionKind: 'origin' });
        const replay = Reprocessor.runPass({ sourceEntryId: 'entry-1', eventSectionKind: 'origin' }, () => Events.apply(command, {}));
        assert.deepEqual(replay, first);
        assert.equal(weapon.chargePool.amount, 2);
        const distinct = Reprocessor.runPass({ sourceEntryId: 'entry-1', eventSectionKind: 'destination' }, () => Events.apply(command, {}));
        assert.notEqual(distinct.operationId, first.operationId);
        assert.equal(weapon.chargePool.amount, 3);
        assert.equal(ammo.count, 1);
    } finally { Player.getById = oldGet; }
});

test('replaying a committed reload after chat UUID migration preserves its original event scope', () => {
    const Events = require('../ItemChargeEvents.js');
    const Reprocessor = require('../EventReprocessor.js');
    const { migrateOperationalIds } = require('../OperationalIdMigration.js');
    const Player = require('../Player.js');
    const sourceId = 'e581178b-cd44-4f6c-95e2-a9b90266d5dd';
    const weapon = item({ chargePool: pool() });
    const ammo = item({ name: 'Rounds', ammoType: 'round', count: 3 });
    const actor = actorWith(weapon, ammo);
    const oldGet = Player.getById;
    Player.getById = id => id === actor.id ? actor : null;
    try {
        const command = { kind: 'reloadItem', actorId: actor.id, itemId: weapon.id, ammoItemId: ammo.id, amount: 1 };
        const original = Events.apply(command, { sourceEntryId: sourceId, eventSectionKind: 'origin' });
        const snapshot = { chatHistory: [{ id: sourceId, metadata: { requestId: sourceId, eventReplay: { passes: [{ sourceEntryId: sourceId, eventSectionKind: 'origin', options: {} }] } } }], itemCharges: Service.toJSON() };
        const migrated = migrateOperationalIds(snapshot).serialized;
        const entry = migrated.chatHistory[0], pass = entry.metadata.eventReplay.passes[0];
        assert.match(entry.id, /^chat_\d+$/);
        assert.equal(entry.metadata.requestId, entry.id);
        assert.equal(pass.sourceEntryId, entry.id);
        assert.deepEqual(pass.options.chargeEventScope, { sourceEntryId: sourceId, eventSectionKind: 'origin' });
        Service.hydrate(migrated.itemCharges);
        const replay = Reprocessor.runPass(pass, () => Events.apply(command, pass.options));
        assert.equal(replay.operationId, original.operationId);
        assert.equal(weapon.chargePool.amount, 2);
        assert.equal(ammo.count, 2);
    } finally { Player.getById = oldGet; }
});

test('replaying a committed reload event after domain ID migration does not transfer twice', () => {
    const Events = require('../ItemChargeEvents.js');
    const Migration = require('../DomainIdMigration.js');
    const Player = require('../Player.js');
    const weapon = item({ id: 'legacy_thing_1', name: 'Pistol', chargePool: pool() });
    const ammo = item({ id: 'legacy_thing_2', name: 'Rounds', ammoType: 'round', count: 3 });
    let actor = actorWith(weapon, ammo); actor.id = 'legacy_char_1';
    const oldGet = Player.getById;
    Player.getById = id => id === actor.id ? actor : null;
    try {
        const command = { kind: 'reloadItem', actorId: actor.id, itemId: weapon.id, ammoItemId: ammo.id, amount: 1 };
        const context = () => ({ sourceEntryId: 'entry-1', eventSectionKind: 'origin' });
        const original = Events.apply(command, context());
        const snapshot = { metadata: { playerId: actor.id }, gameWorld: { regions: {}, locations: {}, locationExits: {} },
            players: { [actor.id]: { id: actor.id, name: 'Mira', inventory: [weapon.id, ammo.id] } },
            things: { [weapon.id]: weapon.toJSON(), [ammo.id]: ammo.toJSON() }, factions: {}, pendingRegionStubs: {}, chatHistory: [{ metadata: { eventReplay: { passes: [{ acceptedXml: `<events><reloadItem><actorId>${actor.id}</actorId><itemId>${weapon.id}</itemId><ammoItemId>${ammo.id}</ammoItemId><amount>1</amount></reloadItem></events>` }] } } }], itemCharges: Service.toJSON() };
        const migrated = Migration.prepare(snapshot).serialized;
        Thing.clear();
        const migratedWeapon = new Thing(migrated.things.thing_pistol);
        const migratedAmmo = new Thing(migrated.things.thing_rounds);
        actor = actorWith(migratedWeapon, migratedAmmo); actor.id = 'char_mira';
        Service.hydrate(migrated.itemCharges);
        const { DOMParser } = require('@xmldom/xmldom');
        const accepted = migrated.chatHistory[0].metadata.eventReplay.passes[0].acceptedXml;
        const migratedCommand = Events.parse(new DOMParser().parseFromString(accepted, 'application/xml').documentElement.firstChild);
        assert.equal(migratedCommand.actorId, actor.id);
        assert.equal(migratedCommand.itemId, migratedWeapon.id);
        assert.equal(migratedCommand.ammoItemId, migratedAmmo.id);
        const replay = Events.apply(migratedCommand, context());
        assert.equal(replay.operationId, original.operationId);
        assert.equal(migratedWeapon.chargePool.amount, 2);
        assert.equal(migratedAmmo.count, 2);
        assert.throws(() => Events.apply({ ...migratedCommand, amount: 2 }, context()), /different request/);
        const nextContext = context();
        Events.apply(migratedCommand, nextContext);
        const second = Events.apply(migratedCommand, nextContext);
        assert.notEqual(second.operationId, original.operationId);
        assert.equal(migratedWeapon.chargePool.amount, 3);
        assert.equal(migratedAmmo.count, 1);
    } finally { Player.getById = oldGet; }
});
