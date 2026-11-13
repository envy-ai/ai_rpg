const test = require('node:test');
const assert = require('node:assert/strict');

const Faction = require('../Faction.js');
const FactionFavorService = require('../FactionFavorService.js');

const TIERS = [
    { threshold: 0, label: 'Neutral' },
    { threshold: 20, label: 'Friend' },
    { threshold: 60, label: 'Ally' }
];

function makePlayer({ standings = {}, usage = {}, party = [], currency = 0, location = 'loc_here' } = {}) {
    const favorUsage = new Map(Object.entries(usage));
    const standingMap = new Map(Object.entries(standings));
    return {
        id: 'player',
        name: 'Baato',
        currentLocation: location,
        currency,
        getFactionStanding: id => (standingMap.has(id) ? standingMap.get(id) : null),
        setFactionStanding: (id, value) => standingMap.set(id, value),
        getFavorUsage: id => (favorUsage.has(id) ? { ...favorUsage.get(id) } : null),
        recordFavorUse: (id, minute) => favorUsage.set(id, { lastUsedWorldMinute: minute }),
        getPartyMembers: () => party,
        adjustCurrency(amount) { this.currency += amount; },
        standingMap,
        favorUsage
    };
}

function setup({ favorOverrides = {}, standings = { faction_guild: 25 }, usage = {}, npcs = [], party = [], locationFaction = null, regionFaction = null } = {}) {
    Faction.clear();
    const guild = new Faction({
        id: 'faction_guild',
        name: 'Ashen Guild',
        reputationTiers: TIERS,
        favors: [{
            name: 'Quiet Inquiry',
            shortDescription: 'Informants dig up a name.',
            description: 'Guild informants ask around.',
            minThreshold: 20,
            cooldown: '2 days',
            presence: 'anywhere',
            effect: null,
            ...favorOverrides
        }]
    });
    const rival = new Faction({ id: 'faction_rival', name: 'Tidewatch', relations: { faction_guild: { status: 'rival', notes: 'Old feud.' } } });
    const enemy = new Faction({ id: 'faction_enemy', name: 'Red Hand', relations: { faction_guild: { status: 'hostile', notes: 'War.' } } });
    const actors = new Map(npcs.map(npc => [npc.id, npc]));
    const location = { id: 'loc_here', regionId: 'region_here', controllingFactionId: locationFaction, npcIds: npcs.filter(npc => !party.includes(npc.id)).map(npc => npc.id) };
    const region = { id: 'region_here', controllingFactionId: regionFaction };
    const player = makePlayer({ standings, usage, party });
    const deps = {
        findFavor: id => Faction.findFavor(id),
        getAllFactions: () => [guild, rival, enemy],
        findActorById: id => actors.get(id) || null,
        findRegionById: id => (id === region.id ? region : null),
        findLocationById: () => null,
        getAllLocations: () => [location]
    };
    return { guild, rival, enemy, favor: guild.favors[0], player, location, deps };
}

test.afterEach(() => Faction.clear());

test('status ordering is locked, then cooldown, then needs presence, then available', () => {
    let ctx = setup({ standings: { faction_guild: 5 }, favorOverrides: { presence: 'faction-presence' }, usage: { favor_quiet_inquiry: { lastUsedWorldMinute: 100 } } });
    const status = options => FactionFavorService.getFavorStatus({ ...options, worldMinute: 200 }).status;
    assert.equal(status({ player: ctx.player, faction: ctx.guild, favor: ctx.favor, location: ctx.location, deps: ctx.deps }), 'locked');

    ctx = setup({ favorOverrides: { presence: 'faction-presence' } });
    ctx.player.recordFavorUse(ctx.favor.id, 100);
    const cooldown = FactionFavorService.getFavorStatus({ player: ctx.player, faction: ctx.guild, favor: ctx.favor, location: ctx.location, deps: ctx.deps, worldMinute: 200 });
    assert.equal(cooldown.status, 'cooldown');
    assert.equal(cooldown.readyAtWorldMinute, 100 + 2 * 1440);
    assert.match(cooldown.readyIn, /day/);

    const atBoundary = FactionFavorService.getFavorStatus({ player: ctx.player, faction: ctx.guild, favor: ctx.favor, location: ctx.location, deps: ctx.deps, worldMinute: 100 + 2 * 1440 });
    assert.equal(atBoundary.status, 'needs-presence', 'cooldown ends exactly at the ready minute');

    ctx = setup({ favorOverrides: { presence: 'faction-presence' }, locationFaction: 'faction_guild' });
    assert.equal(status({ player: ctx.player, faction: ctx.guild, favor: ctx.favor, location: ctx.location, deps: ctx.deps }), 'available');
});

test('faction presence comes from the location, its region, a local member, or a party member', () => {
    const check = ctx => FactionFavorService.hasFactionPresence({ faction: ctx.guild, player: ctx.player, location: ctx.location, deps: ctx.deps });
    assert.equal(check(setup()), false);
    assert.equal(check(setup({ locationFaction: 'faction_guild' })), true);
    assert.equal(check(setup({ regionFaction: 'faction_guild' })), true);
    assert.equal(check(setup({ npcs: [{ id: 'npc_a', name: 'Vey', factionId: 'faction_guild' }] })), true);
    assert.equal(check(setup({ npcs: [{ id: 'npc_a', name: 'Vey', factionId: 'faction_guild' }], party: ['npc_a'] })), true);
    assert.equal(check(setup({ npcs: [{ id: 'npc_a', name: 'Vey', factionId: 'faction_guild', isDead: true }] })), false);
});

test('activation applies the effect, rival penalties and cooldown, and builds turn context', async () => {
    const ctx = setup({
        favorOverrides: { effect: { type: 'grant-currency', params: { amount: 50 } } },
        npcs: [
            { id: 'npc_rival', name: 'Rival Agent', factionId: 'faction_rival' },
            { id: 'npc_enemy', name: 'Enemy Agent', factionId: 'faction_enemy' }
        ],
        standings: { faction_guild: 25, faction_rival: 10 }
    });
    const result = await FactionFavorService.activate({
        request: { favorId: ctx.favor.id, target: 'Who forged the seal?', fastTravelLocationId: null },
        player: ctx.player,
        location: ctx.location,
        worldMinute: 500,
        config: { faction_favors: { enabled: true, rival_witness_penalty: 2 } },
        deps: ctx.deps
    });
    assert.equal(ctx.player.currency, 50);
    assert.equal(ctx.player.getFavorUsage(ctx.favor.id).lastUsedWorldMinute, 500);
    assert.equal(ctx.player.standingMap.get('faction_rival'), 8);
    assert.equal(ctx.player.standingMap.get('faction_enemy'), -4, 'hostile witnesses double the penalty');
    assert.equal(result.actionText, 'I call in a favor from Ashen Guild: Quiet Inquiry. Who forged the seal?');
    assert.deepEqual(result.grantGuard, { favorId: ctx.favor.id, favorName: 'Quiet Inquiry', factionName: 'Ashen Guild', currencyAmount: 50 });
    assert.match(result.promptContext.rivalPenaltySummary, /Tidewatch \(rival\)/);
    assert.equal(result.metadata.effectType, 'grant-currency');
});

test('no witnesses or zero penalty means no rival change', async () => {
    const ctx = setup({ standings: { faction_guild: 25, faction_rival: 10 } });
    const result = await FactionFavorService.activate({
        request: { favorId: ctx.favor.id, target: '', fastTravelLocationId: null },
        player: ctx.player, location: ctx.location, worldMinute: 0, config: {}, deps: ctx.deps
    });
    assert.deepEqual(result.rivalPenalties, []);
    assert.equal(ctx.player.standingMap.get('faction_rival'), 10);
});

test('validation failures leave the player unchanged', async () => {
    const ctx = setup({ favorOverrides: { requiresTarget: true, targetPrompt: 'Who should they find?' } });
    const activate = (request, config = {}) => FactionFavorService.activate({
        request: { target: '', fastTravelLocationId: null, ...request },
        player: ctx.player, location: ctx.location, worldMinute: 0, config, deps: ctx.deps
    });
    await assert.rejects(activate({ favorId: 'favor_missing' }), /does not exist/);
    await assert.rejects(activate({ favorId: ctx.favor.id }), /needs a target: Who should they find\?/);
    await assert.rejects(activate({ favorId: ctx.favor.id, target: 'x' }, { faction_favors: { enabled: false } }), /disabled/);
    ctx.player.recordFavorUse(ctx.favor.id, 0);
    await assert.rejects(activate({ favorId: ctx.favor.id, target: 'x' }), error => error.code === 'FAVOR_UNAVAILABLE');
    assert.equal(ctx.player.favorUsage.size, 1);
});

test('an effect failure does not start the cooldown', async () => {
    const ctx = setup({ favorOverrides: { effect: { type: 'grant-item', params: { name: 'Writ', description: 'A pass.' } } } });
    ctx.deps.generateItemsByNames = async () => { throw new Error('generator offline'); };
    await assert.rejects(FactionFavorService.activate({
        request: { favorId: ctx.favor.id, target: '', fastTravelLocationId: null },
        player: ctx.player, location: ctx.location, worldMinute: 0, config: {}, deps: ctx.deps
    }), error => error.favorStage === 'apply' && /generator offline/.test(error.message) && /cooldown did not start/.test(error.message));
    assert.equal(ctx.player.getFavorUsage(ctx.favor.id), null);
});

test('prompt rows omit locked favors and describe status compactly', () => {
    const ctx = setup({ favorOverrides: { presence: 'faction-presence' } });
    ctx.guild.favors = [...ctx.guild.favors.map(entry => ({ ...entry })), {
        name: 'War Chest', shortDescription: 'A loan.', description: 'Coin.', minThreshold: 60, cooldown: '7 days'
    }];
    const rows = FactionFavorService.buildPromptRows({ player: ctx.player, factions: [ctx.guild], location: ctx.location, worldMinute: 0, deps: ctx.deps });
    assert.deepEqual(rows, [{ factionName: 'Ashen Guild', name: 'Quiet Inquiry', shortDescription: 'Informants dig up a name.', status: 'needs presence' }]);
});

test('activation request validation names the bad field', () => {
    assert.equal(FactionFavorService.normalizeActivationRequest(undefined), null);
    assert.throws(() => FactionFavorService.normalizeActivationRequest({ favorId: '' }), /favorId must be a non-empty favor id/);
    assert.throws(() => FactionFavorService.normalizeActivationRequest({ favorId: 'a', extra: 1 }), /unknown field "extra"/);
    assert.throws(() => FactionFavorService.normalizeActivationRequest({ favorId: 'a', target: 'x'.repeat(301) }), /300 characters/);
    assert.throws(() => FactionFavorService.resolveConfig({ faction_favors: { rival_witness_penalty: -1 } }), /rival_witness_penalty must be a whole number of 0 or more/);
});

test('fast-travel favors require a valid visited faction destination', async () => {
    const ctx = setup({ favorOverrides: { effect: { type: 'fast-travel', params: {} } } });
    const destination = { id: 'loc_hall', name: 'Guild Hall', regionId: 'region_other', controllingFactionId: 'faction_guild', visited: true };
    ctx.deps.getAllLocations = () => [ctx.location, destination, { id: 'loc_unvisited', name: 'Vault', controllingFactionId: 'faction_guild', visited: false }];
    const run = fastTravelLocationId => FactionFavorService.activate({
        request: { favorId: ctx.favor.id, target: '', fastTravelLocationId },
        player: ctx.player, location: ctx.location, worldMinute: 0, config: {}, deps: ctx.deps
    });
    await assert.rejects(run('loc_unvisited'), /Valid destinations: Guild Hall/);
    const result = await run('loc_hall');
    assert.deepEqual(result.fastTravel, { destinationLocationId: 'loc_hall', destinationName: 'Guild Hall' });
});

test('target delivery hydrates before starting cooldown and guards requested and generated names', async () => {
    const ctx = setup({ favorOverrides: {
        requiresTarget: true, targetPrompt: 'What should be delivered?',
        effect: { type: 'grant-item', params: { name: 'Parcel', description: 'A sealed parcel.', contentsSource: 'target' } }
    } });
    const parcel = { id: 'parcel', name: 'Guild Parcel', isContainer: true, containerContents: [{ name: 'Copper Key', count: 1 }], getInventoryItems() { return this.items || []; } };
    ctx.deps.generateItemsByNames = async request => {
        assert.equal(request.owner, ctx.player);
        assert.deepEqual(request.seeds[0].containerContents, [{ name: 'Copper Key', count: 1 }]);
        assert.equal(request.seeds[0].isContainer, true);
        request.options.onCreated(parcel);
        return [parcel];
    };
    ctx.deps.generateContainerContentsForThing = async ({ container, location, onCreated }) => {
        assert.equal(container, parcel);
        assert.equal(location, ctx.location);
        assert.equal(ctx.player.getFavorUsage(ctx.favor.id), null);
        const content = { id: 'key', name: 'Copper Key of Passage' };
        onCreated([content]);
        parcel.items = [content];
        parcel.containerContents = [];
        return [content];
    };
    const result = await FactionFavorService.activate({
        request: { favorId: ctx.favor.id, target: 'Copper Key' }, player: ctx.player,
        location: ctx.location, worldMinute: 25, config: {}, deps: ctx.deps
    });
    assert.equal(ctx.player.getFavorUsage(ctx.favor.id).lastUsedWorldMinute, 25);
    for (const name of ['Parcel', 'Guild Parcel', 'Copper Key', 'Copper Key of Passage']) {
        assert.ok(result.grantGuard.itemNames.includes(name), `guard includes ${name}`);
    }
});

test('failed delivery rolls back its committed things without deleting unrelated concurrent things or starting cooldown', async () => {
    const Thing = require('../Thing.js');
    const ctx = setup({ favorOverrides: {
        requiresTarget: true, targetPrompt: 'What should be delivered?',
        effect: { type: 'grant-item', params: { name: 'Parcel', description: 'A sealed parcel.', contentsSource: 'target' } }
    } });
    const makeThing = (name, extra = {}) => new Thing({ name, description: `${name} description.`, thingType: 'item', enrichStatusEffects: false, ...extra });
    let parcel, content, unrelated;
    ctx.deps.generateItemsByNames = async request => {
        parcel = makeThing('Parcel', { isContainer: true, containerContents: request.seeds[0].containerContents });
        request.options.onCreated(parcel);
        return [parcel];
    };
    ctx.deps.generateContainerContentsForThing = async ({ container, onCreated }) => {
        content = makeThing('Copper Key');
        onCreated([content]);
        container.addInventoryItem(content, { mergeStacks: false });
        unrelated = makeThing('Unrelated Concurrent Item');
        throw new Error('post-attachment bookkeeping failed');
    };
    try {
        await assert.rejects(FactionFavorService.activate({
            request: { favorId: ctx.favor.id, target: 'Copper Key' }, player: ctx.player,
            location: ctx.location, worldMinute: 25, config: {}, deps: ctx.deps
        }), /post-attachment bookkeeping failed/);
        assert.equal(Thing.getById(parcel.id), null);
        assert.equal(Thing.getById(content.id), null);
        assert.equal(Thing.getById(unrelated.id), unrelated);
        assert.equal(ctx.player.getFavorUsage(ctx.favor.id), null);
    } finally {
        Thing.clear();
    }
});

test('delivery removes a crate when generation fails after its commit', async () => {
    const Thing = require('../Thing.js');
    const ctx = setup({ favorOverrides: {
        requiresTarget: true, targetPrompt: 'What should be delivered?',
        effect: { type: 'grant-item', params: { name: 'Parcel', description: 'A sealed parcel.', contentsSource: 'target' } }
    } });
    let parcel;
    ctx.deps.generateItemsByNames = async request => {
        parcel = new Thing({ name: 'Parcel', description: 'A sealed parcel.', thingType: 'item', isContainer: true, enrichStatusEffects: false });
        request.options.onCreated(parcel);
        throw new Error('post-commit placement failed');
    };
    ctx.deps.generateContainerContentsForThing = async () => { throw new Error('must not hydrate'); };
    try {
        await assert.rejects(FactionFavorService.activate({
            request: { favorId: ctx.favor.id, target: 'Copper Key' }, player: ctx.player,
            location: ctx.location, worldMinute: 25, config: {}, deps: ctx.deps
        }), /post-commit placement failed/);
        assert.equal(Thing.getById(parcel.id), null);
        assert.equal(ctx.player.getFavorUsage(ctx.favor.id), null);
    } finally {
        Thing.clear();
    }
});
