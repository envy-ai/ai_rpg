/*
 * Declarative conversions of the cases that predate the JSON scenario harness.
 * Every case restores an immutable copied fixture; no case depends on mutations
 * made by another case. Definitions are validated by the normal scenario parser.
 */

const interactive = Object.freeze({ roll: null, questAccepted: false, confirmed: false });
const forcedLow = Object.freeze({ roll: 1, questAccepted: false, confirmed: false });
const forcedHigh = Object.freeze({ roll: 20, questAccepted: false, confirmed: false });
const load = Object.freeze({ type: 'loadFixture' });

function request(name, method, route, body, policy) {
    const step = { type: 'request', name, method, route };
    if (body !== undefined) step.body = body;
    if (policy !== undefined) step.interactive = policy;
    return step;
}

function chat(name, text, policy = interactive, extra = {}) {
    return { type: 'chat', name, text, interactive: policy, ...extra };
}

function snapshot(name) {
    return { type: 'snapshot', name };
}

function check(...assertions) {
    return { type: 'assert', assertions };
}

function namedStatus(name, status = 200) {
    return { type: 'equals', source: `responses.${name}`, path: 'status', equals: status };
}

function namedOk(name, value = true) {
    return { type: 'equals', source: `responses.${name}`, path: 'ok', equals: value };
}

function clean() {
    return [
        { type: 'noRealtimeErrors' },
        { type: 'noUnexpectedErrorLogs', allowRecoveredProviderRetries: true }
    ];
}

function define(caseName, {
    scenario,
    description,
    fixture,
    configProfile = 'isolated-base',
    steps,
    assertions = [],
    humanReview = []
}) {
    return {
        version: 1,
        scenario,
        case: caseName,
        description,
        fixture,
        configProfile,
        steps: fixture ? [load, ...steps] : steps,
        assertions,
        humanReview
    };
}

const vehicle = [
    define('VEH-1-board', {
        scenario: 'vehicle', fixture: 'vehicle-platform-ready', configProfile: 'vehicle-mechanics',
        description: 'Move to the platform and board the stationary fixed-route tram without starting a trip.',
        steps: [
            request('to_platform', 'POST', '/api/player/move', { destinationId: '$fixture.westPlatformId', expectedOriginLocationId: '$fixture.originId', accompanyingCharacters: [] }),
            request('board', 'POST', '/api/player/move', { destinationId: '$fixture.tramId', expectedOriginLocationId: '$fixture.westPlatformId', accompanyingCharacters: [] }),
            check(namedStatus('to_platform'), namedStatus('board'),
                { type: 'equals', source: 'after', path: 'player.payload.player.locationId', equals: '$fixture.tramId' },
                { type: 'equals', source: 'after', path: 'currentLocation.payload.location.vehicleInfo.pendingDestination', equals: null },
                ...clean())
        ]
    }),
    define('VEH-2-carry-item-and-alias-aboard', {
        scenario: 'vehicle', fixture: 'vehicle-platform-ready', configProfile: 'vehicle-mechanics',
        description: 'Travel prose picks up the case and accepts a local NPC alias as an accompanying character while boarding.',
        steps: [
            request('to_platform', 'POST', '/api/player/move', { destinationId: '$fixture.westPlatformId', expectedOriginLocationId: '$fixture.originId', accompanyingCharacters: [] }),
            chat('board_with_case', 'I pick up QA Brass Travel Case and board QA Clockwork Tram. Rika, come aboard with me.', interactive, {
                travel: true,
                travelMetadata: { mode: null, eventDriven: false, exit: { originLocationId: '$fixture.westPlatformId', destinationId: '$fixture.tramId', exitId: '$fixture.boardingExitId', direction: 'qa_clockwork_tram', destinationRegionId: 'region_1', destinationIsStub: false, destinationIsRegionEntryStub: false, isVehicle: true, vehicleType: 'rail tram', destinationName: 'QA Clockwork Tram', regionName: 'Ember Hollow Settlement' } }
            }),
            check(namedStatus('board_with_case'),
                { type: 'equals', source: 'after', path: 'player.payload.player.locationId', equals: '$fixture.tramId' },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.carrierId', path: 'locationId', equals: '$fixture.tramId' },
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.travelCaseId', path: 'metadata.ownerId', equals: '$fixture.playerId' },
                ...clean())
        ],
        humanReview: ['Confirm the boarding prose treats Rika as the alias-resolved companion and keeps the case with Baato.']
    }),
    define('VEH-3-depart', {
        scenario: 'vehicle', fixture: 'vehicle-platform-ready', configProfile: 'vehicle-mechanics',
        description: 'Board and command the tram to depart on its existing route with one pending destination and future ETA.',
        steps: [
            request('to_platform', 'POST', '/api/player/move', { destinationId: '$fixture.westPlatformId', expectedOriginLocationId: '$fixture.originId', accompanyingCharacters: [] }),
            request('board', 'POST', '/api/player/move', { destinationId: '$fixture.tramId', expectedOriginLocationId: '$fixture.westPlatformId', accompanyingCharacters: [] }),
            chat('depart', 'I request that QA Clockwork Tram depart for QA East Platform now. The scheduled trip takes 10 minutes.'),
            check(namedStatus('depart'),
                { type: 'equals', source: 'after', path: 'currentLocation.payload.location.vehicleInfo.pendingDestination.locationId', equals: '$fixture.eastPlatformId' },
                { type: 'equals', source: 'after', path: 'currentLocation.payload.location.vehicleInfo.isUnderway', equals: true },
                { type: 'greaterThan', source: 'after', path: 'currentLocation.payload.location.vehicleInfo.ETA', valueFrom: { source: 'after', path: 'currentLocation.payload.location.vehicleInfo.departureTime' } },
                ...clean())
        ],
        humanReview: ['Confirm the prose describes departure, not premature arrival at QA East Platform.']
    }),
    define('VEH-4-ordinary-ride', {
        scenario: 'vehicle', fixture: 'vehicle-underway-eastbound', configProfile: 'vehicle-mechanics',
        description: 'An ordinary in-transit conversation advances the turn without changing the active route.',
        steps: [snapshot('underway'), chat('ride', 'I remain seated in the tram and chat briefly with Rika for 2 minutes without changing the route.'),
            check(namedStatus('ride'),
                { type: 'equals', source: 'after', path: 'currentLocation.payload.location.vehicleInfo.pendingDestination.locationId', equals: '$fixture.eastPlatformId' },
                { type: 'equals', source: 'after', path: 'currentLocation.payload.location.vehicleInfo.ETA', equalsFrom: { source: 'snapshots.underway', path: 'currentLocation.payload.location.vehicleInfo.ETA' } },
                { type: 'greaterThan', source: 'after', path: 'calendar.payload.worldTime.timeMinutes', valueFrom: { source: 'snapshots.underway', path: 'calendar.payload.worldTime.timeMinutes' } },
                ...clean())]
    }),
    define('VEH-5-move-inside-vehicle', {
        scenario: 'vehicle', fixture: 'vehicle-underway-eastbound', configProfile: 'vehicle-mechanics',
        description: 'Interior movement remains aboard and leaves route metadata untouched.',
        steps: [snapshot('underway'), chat('interior', "I stand up and walk from my seat to the driver's booth inside QA Clockwork Tram without leaving the tram or changing its route."),
            check(namedStatus('interior'),
                { type: 'equals', source: 'after', path: 'player.payload.player.locationId', equals: '$fixture.tramId' },
                { type: 'equals', source: 'after', path: 'currentLocation.payload.location.vehicleInfo.pendingDestination', equalsFrom: { source: 'snapshots.underway', path: 'currentLocation.payload.location.vehicleInfo.pendingDestination' } },
                ...clean())]
    }),
    define('VEH-6-emergency-stop', {
        scenario: 'vehicle', fixture: 'vehicle-underway-eastbound', configProfile: 'vehicle-mechanics',
        description: 'An emergency stop clears underway timing without fabricating arrival at a platform.',
        steps: [chat('stop', 'I pull the emergency brake and command QA Clockwork Tram to make an unplanned stop here immediately, without arriving at either platform.'),
            check(namedStatus('stop'),
                { type: 'equals', source: 'after', path: 'player.payload.player.locationId', equals: '$fixture.tramId' },
                { type: 'equals', source: 'after', path: 'currentLocation.payload.location.vehicleInfo.pendingDestination', equals: null },
                { type: 'equals', source: 'after', path: 'currentLocation.payload.location.vehicleInfo.isUnderway', equals: false },
                ...clean())]
    })
];

const containers = [
    define('CONT-1-forced-failure', {
        scenario: 'checked-containers', fixture: 'checked-container-three-lock', configProfile: 'vehicle-mechanics',
        description: 'A forced-low checked opening fails once without changing the lock or exposing contents.',
        steps: [snapshot('closed'), request('open', 'POST', '/api/things/$fixture.chestId/container/open-check', { actionText: 'I try to wrench the QA Three-Lock Chest open with my bare hands. <f>' }, forcedLow),
            check(namedStatus('open'),
                { type: 'equals', source: 'responses.open', path: 'payload.opened', equals: false },
                { type: 'equals', source: 'responses.open', path: 'payload.permanentlyOpened', equals: false },
                { type: 'equals', source: 'responses.open', path: 'payload.container.containedThingIds', equals: [] },
                { type: 'equals', source: 'after', path: 'calendar.payload.worldTime.timeMinutes', equalsFrom: { source: 'responses.open', path: 'payload.worldTime.timeMinutes' } },
                { type: 'greaterThan', source: 'after', path: 'calendar.payload.worldTime.timeMinutes', valueFrom: { source: 'snapshots.closed', path: 'calendar.payload.worldTime.timeMinutes' } },
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.chestId', path: 'requiresCheckToOpen', equals: true },
                { type: 'realtimeEventCount', where: { type: 'player_input_request' }, equals: 1 },
                ...clean())]
    }),
    define('CONT-2-retry-after-failure', {
        scenario: 'checked-containers', fixture: 'checked-container-three-lock', configProfile: 'vehicle-mechanics',
        description: 'A failed attempt does not cache; a new method performs a second independent check.',
        steps: [
            request('first', 'POST', '/api/things/$fixture.chestId/container/open-check', { actionText: 'I wrench the chest open with my bare hands. <f>' }, forcedLow),
            request('retry', 'POST', '/api/things/$fixture.chestId/container/open-check', { actionText: 'I use improvised lockpicks for a different method. <f>' }, forcedHigh),
            check(namedStatus('first'), namedStatus('retry'),
                { type: 'equals', source: 'responses.first', path: 'payload.opened', equals: false },
                { type: 'equals', source: 'responses.retry', path: 'payload.opened', equals: true },
                { type: 'realtimeEventCount', where: { type: 'player_input_request' }, equals: 2 },
                ...clean())]
    }),
    define('CONT-3-temporary-success', {
        scenario: 'checked-containers', fixture: 'checked-container-three-lock', configProfile: 'vehicle-mechanics',
        description: 'A temporary bypass opens the interaction but preserves the checked-lock requirement.',
        steps: [request('open', 'POST', '/api/things/$fixture.chestId/container/open-check', { actionText: 'I temporarily bypass one lock without disabling or damaging it. <f>' }, forcedHigh),
            request('contents', 'GET', '/api/things/$fixture.chestId/container'),
            check(namedStatus('open'), namedStatus('contents'),
                { type: 'equals', source: 'responses.open', path: 'payload.opened', equals: true },
                { type: 'equals', source: 'responses.open', path: 'payload.permanentlyOpened', equals: false },
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.chestId', path: 'requiresCheckToOpen', equals: true },
                ...clean())]
    }),
    define('CONT-4-permanent-success-persistence', {
        scenario: 'checked-containers', fixture: 'checked-container-three-lock', configProfile: 'vehicle-mechanics',
        description: 'A permanent lock defeat clears requiresCheckToOpen and survives save/reload.',
        steps: [request('open', 'POST', '/api/things/$fixture.chestId/container/open-check', { actionText: 'I permanently disable all three locks. <f>' }, forcedHigh),
            { type: 'save', name: 'saved' }, { type: 'reload', name: 'reloaded' },
            check(namedStatus('open'),
                { type: 'equals', source: 'responses.open', path: 'payload.permanentlyOpened', equals: true },
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.chestId', path: 'requiresCheckToOpen', equals: false },
                ...clean())]
    }),
    define('CONT-5-already-open', {
        scenario: 'checked-containers', fixture: 'checked-container-three-lock',
        description: 'An already-open container skips all checks, prompts, and time advancement.',
        steps: [request('unlock_fixture_copy', 'PUT', '/api/things/$fixture.chestId', { requiresCheckToOpen: false }), snapshot('already_open'),
            request('open', 'POST', '/api/things/$fixture.chestId/container/open-check', { actionText: 'Open it.' }),
            check(namedStatus('open'),
                { type: 'equals', source: 'responses.open', path: 'payload.skipped', equals: true },
                { type: 'realtimeEventCount', where: { type: 'player_input_request' }, equals: 0 },
                { type: 'stateUnchanged', beforeSource: 'snapshots.already_open', afterSource: 'after', paths: ['calendar.payload.worldTime', 'history.payload.history'] },
                ...clean())]
    }),
    define('CONT-6-contents-generation-idempotency', {
        scenario: 'checked-containers', fixture: 'checked-container-three-lock', configProfile: 'vehicle-mechanics',
        description: 'Pending content seeds instantiate once and repeated fetches return the same canonical stacks.',
        steps: [request('first', 'GET', '/api/things/$fixture.chestId/container'), request('second', 'GET', '/api/things/$fixture.chestId/container'),
            check(namedStatus('first'), namedStatus('second'),
                { type: 'count', source: 'responses.first', path: 'payload.contents', equals: 2 },
                { type: 'equals', source: 'responses.second', path: 'payload.contents', equalsFrom: { source: 'responses.first', path: 'payload.contents' } },
                { type: 'arrayObjectCount', source: 'responses.second', path: 'payload.contents', where: { name: '$fixture.silverPinName', count: 2 }, equals: 1 },
                { type: 'arrayObjectCount', source: 'responses.second', path: 'payload.contents', where: { count: 1 }, equals: 1 },
                ...clean())]
    }),
    define('CONT-7-transfer-split-merge', {
        scenario: 'checked-containers', fixture: 'checked-container-three-lock', configProfile: 'vehicle-mechanics',
        description: 'A generated stack moves out, splits, and merges back into the same container with exact quantity.',
        steps: [request('contents', 'GET', '/api/things/$fixture.chestId/container'),
            request('out', 'POST', '/api/things/$fixture.chestId/container/move-out', { thingId: '$response.contents.payload.contents.0.id' }),
            request('split', 'POST', '/api/things/$response.contents.payload.contents.0.id/split-stack', { quantity: 1 }),
            request('partial_in', 'POST', '/api/things/$fixture.chestId/container/move-in', { thingId: '$response.split.payload.splitThingId' }),
            request('rest_in', 'POST', '/api/things/$fixture.chestId/container/move-in', { thingId: '$response.contents.payload.contents.0.id' }),
            check(namedStatus('out'), namedStatus('split'), namedStatus('partial_in'), namedStatus('rest_in'),
                { type: 'arrayObjectCount', source: 'responses.rest_in', path: 'payload.contents', where: { name: '$fixture.silverPinName', count: 2 }, equals: 1 },
                { type: 'arrayObjectCount', source: 'responses.rest_in', path: 'payload.contents', where: { name: '$fixture.silverPinName', count: 2, metadata: { containerId: '$fixture.chestId' } }, equals: 1 },
                { type: 'count', source: 'responses.rest_in', path: 'payload.container.containedThingIds', equals: 2 },
                { type: 'arrayObjectCount', source: 'responses.rest_in', path: 'payload.playerInventory', where: { name: '$fixture.silverPinName' }, equals: 0 },
                ...clean())]
    }),
    define('CONT-8-invalid-moves-atomic', {
        scenario: 'checked-containers', fixture: 'checked-container-three-lock',
        description: 'Self-containment, containment cycles, scenery, equipped items, and unknown contents fail without mutation.',
        steps: [
            request('unequip_back', 'POST', '/api/player/equip', { slotName: 'Back' }),
            request('nest_satchel', 'POST', '/api/things/thing_38/container/move-in', { thingId: 'thing_28' }),
            snapshot('before_cycle'),
            request('cycle', 'POST', '/api/things/thing_28/container/move-in', { thingId: 'thing_38' }),
            check(namedOk('cycle', false),
                { type: 'stateUnchanged', beforeSource: 'snapshots.before_cycle', afterSource: 'after', paths: ['player.payload.player.inventory', 'things.payload.things', 'calendar.payload.worldTime'] }),
            request('unnest_satchel', 'POST', '/api/things/thing_38/container/move-out', { thingId: 'thing_28' }),
            request('reequip_back', 'POST', '/api/player/equip', { slotName: 'Back', itemId: 'thing_38' }),
            snapshot('before_invalid'),
            request('self', 'POST', '/api/things/$fixture.chestId/container/move-in', { thingId: '$fixture.chestId' }),
            request('unknown', 'POST', '/api/things/$fixture.chestId/container/move-in', { thingId: 'thing_missing_cont8' }),
            request('scenery', 'POST', '/api/things/$fixture.chestId/container/move-in', { thingId: 'thing_184', source: 'location', locationId: '$fixture.locationId' }),
            request('equipped', 'POST', '/api/things/$fixture.chestId/container/move-in', { thingId: 'thing_38' }),
            check(namedOk('self', false), namedOk('unknown', false), namedOk('scenery', false), namedOk('equipped', false),
                { type: 'stateUnchanged', beforeSource: 'snapshots.before_invalid', afterSource: 'after', paths: ['player.payload.player.inventory', 'things.payload.things', 'calendar.payload.worldTime'] },
                ...clean())]
    })
];

const inventory = [
    define('INV-1-drop-pickup', {
        scenario: 'inventory', fixture: 'inventory-item-lifecycle', configProfile: 'vehicle-mechanics',
        description: 'Drop and normally pick up the same four-count stack without duplication.',
        steps: [request('drop', 'POST', '/api/things/$fixture.tokenId/drop', { ownerId: '$fixture.playerId', ownerType: 'player', locationId: '$fixture.locationId' }),
            chat('pickup', 'Pick up all four QA Copper Tokens and keep the count-four stack loose in my main inventory. Do not put it into a container.'),
            check(namedStatus('drop'), namedStatus('pickup'),
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.tokenId', path: 'count', equals: 4 },
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.tokenId', path: 'metadata.ownerId', equals: '$fixture.playerId' },
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.inventory', where: { id: '$fixture.tokenId', count: 4 }, equals: 1 },
                ...clean())]
    }),
    define('INV-2-split-merge', {
        scenario: 'inventory', fixture: 'inventory-item-lifecycle',
        description: 'Split one unit and merge compatible stacks back into one count-four stack.',
        steps: [request('split', 'POST', '/api/things/$fixture.tokenId/split-stack', { quantity: 1 }),
            request('merge', 'POST', '/api/things/$fixture.tokenId/merge-stacks'),
            check(namedStatus('split'), namedStatus('merge'),
                { type: 'equals', source: 'responses.split', path: 'payload.things.0.count', equals: 3 },
                { type: 'equals', source: 'responses.split', path: 'payload.things.1.count', equals: 1 },
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.tokenId', path: 'count', equals: 4 },
                { type: 'count', source: 'responses.merge', path: 'payload.mergedThingIds', equals: 1 },
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.inventory', where: { name: 'QA Copper Token', count: 4 }, equals: 1 },
                ...clean())]
    }),
    define('INV-3-give-partial-persistence', {
        scenario: 'inventory', fixture: 'inventory-item-lifecycle',
        description: 'Give a split unit to an NPC and preserve exact ownership/counts across reload.',
        steps: [request('split', 'POST', '/api/things/$fixture.tokenId/split-stack', { quantity: 1 }),
            request('give', 'POST', '/api/things/$response.split.payload.splitThingId/give', { ownerId: '$fixture.quartermasterId', ownerType: 'npc' }),
            { type: 'save', name: 'saved' }, { type: 'reload', name: 'reloaded' },
            check(namedStatus('give'),
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.tokenId', path: 'count', equals: 3 },
                { type: 'entityField', source: 'after', collection: 'things', id: '$response.split.payload.splitThingId', path: 'metadata.ownerId', equals: '$fixture.quartermasterId' },
                { type: 'entityArrayObjectCount', source: 'after', collection: 'players', id: '$fixture.quartermasterId', path: 'inventory', where: { id: '$response.split.payload.splitThingId', count: 1 }, equals: 1 },
                { type: 'entityArrayObjectCount', source: 'after', collection: 'players', id: '$fixture.playerId', path: 'inventory', where: { id: '$fixture.tokenId', count: 3 }, equals: 1 },
                ...clean())]
    }),
    define('INV-4-container-roundtrip', {
        scenario: 'inventory', fixture: 'inventory-item-lifecycle',
        description: 'Move a split stack into and out of a satchel and merge it back automatically.',
        steps: [request('split', 'POST', '/api/things/$fixture.tokenId/split-stack', { quantity: 1 }),
            request('inside', 'POST', '/api/things/$fixture.satchelId/container/move-in', { thingId: '$response.split.payload.splitThingId' }),
            check(namedStatus('inside'),
                { type: 'includes', source: 'responses.inside', path: 'payload.container.containedThingIds', value: '$response.split.payload.splitThingId' },
                { type: 'arrayObjectCount', source: 'responses.inside', path: 'payload.contents', where: { id: '$response.split.payload.splitThingId', metadata: { containerId: '$fixture.satchelId' } }, equals: 1 }),
            request('outside', 'POST', '/api/things/$fixture.satchelId/container/move-out', { thingId: '$response.split.payload.splitThingId' }),
            check(namedStatus('inside'), namedStatus('outside'),
                { type: 'count', source: 'responses.outside', path: 'payload.contents', equals: 0 },
                { type: 'arrayObjectCount', source: 'responses.outside', path: 'payload.playerInventory', where: { id: '$fixture.tokenId', count: 4 }, equals: 1 },
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.tokenId', path: 'metadata.ownerId', equals: '$fixture.playerId' },
                ...clean())]
    }),
    define('INV-5-consume-status', {
        scenario: 'inventory', fixture: 'inventory-item-lifecycle', configProfile: 'vehicle-mechanics',
        description: 'Consume one draught and apply one timed QA Focused status to the player.',
        steps: [chat('consume', 'Drink and fully consume the one QA Focus Draught from my inventory while staying at the current location.'),
            check(namedStatus('consume'),
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.inventory', where: { id: '$fixture.draughtId' }, equals: 0 },
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.statusEffects', where: { name: '$fixture.effectName', duration: 5 }, equals: 1 },
                { type: 'arrayObjectCount', source: 'responses.consume', path: 'payload.debug.eventStructured.parsed.consume_item', where: { item: 'QA Focus Draught', quantity: 1 }, equals: 1 },
                ...clean())],
        humanReview: ['Confirm the prose consumes exactly one draught and does not invent a second action.']
    }),
    define('INV-6-effect-expiry', {
        scenario: 'inventory', fixture: 'inventory-item-lifecycle', configProfile: 'vehicle-mechanics',
        description: 'A consumed five-minute status remains before expiry and disappears exactly once after it.',
        steps: [chat('consume', 'Drink and fully consume the one QA Focus Draught, then stop.'),
            request('before_expiry', 'POST', '/api/slash-command', { command: 'time', argsText: '+4 minutes' }),
            check({ type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.statusEffects', where: { name: '$fixture.effectName' }, equals: 1 }),
            request('after_expiry', 'POST', '/api/slash-command', { command: 'time', argsText: '+2 minutes' }),
            check(namedStatus('after_expiry'),
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.statusEffects', where: { name: '$fixture.effectName' }, equals: 0 },
                ...clean()),
            request('post_expiry', 'POST', '/api/slash-command', { command: 'time', argsText: '+1 minute' }),
            check(namedStatus('post_expiry'),
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.statusEffects', where: { name: '$fixture.effectName' }, equals: 0 },
                ...clean())]
    }),
    define('INV-7-invalid-operations-atomic', {
        scenario: 'inventory', fixture: 'inventory-item-lifecycle',
        description: 'Invalid split, incompatible merge, scenery give, and unknown move are atomic.',
        steps: [snapshot('before_invalid'),
            request('split', 'POST', '/api/things/$fixture.tokenId/split-stack', { quantity: 4 }),
            request('merge', 'POST', '/api/things/combine-stacks', { keepThingId: '$fixture.tokenId', mergeThingIds: ['$fixture.draughtId'] }),
            request('scenery', 'POST', '/api/things/thing_20/give', { ownerId: '$fixture.quartermasterId', ownerType: 'npc', locationId: '$fixture.locationId' }),
            request('unknown', 'POST', '/api/things/$fixture.satchelId/container/move-in', { thingId: 'thing_missing_inv7' }),
            check(namedOk('split', false), namedOk('merge', false), namedOk('scenery', false), namedOk('unknown', false),
                { type: 'stateUnchanged', beforeSource: 'snapshots.before_invalid', afterSource: 'after', paths: ['player.payload.player.inventory', 'things.payload.things', 'calendar.payload.worldTime'] },
                ...clean())]
    })
];

const equipment = [
    define('EQUIP-1-equip', {
        scenario: 'equipment', fixture: 'equipment-modules-lifecycle',
        description: 'Equip the Bronze Circlet into Head exactly once.',
        steps: [snapshot('baseline'), request('equip', 'POST', '/api/player/equip', { slotName: 'Head', itemId: '$fixture.bronzeId' }),
            check(namedStatus('equip'),
                { type: 'equals', source: 'after', path: 'currentPlayerDetail.payload.npc.gear.Head.itemId', equals: '$fixture.bronzeId' },
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.inventory', where: { id: '$fixture.bronzeId' }, field: 'isEquipped', equals: true },
                { type: 'exactDelta', path: 'currentPlayerDetail.payload.npc.attributeInfo.intelligence.modifiedValue', delta: 2, beforeSource: 'snapshots.baseline', afterSource: 'after' },
                ...clean())]
    }),
    define('EQUIP-2-replace', {
        scenario: 'equipment', fixture: 'equipment-modules-lifecycle',
        description: 'Replacing a head item unequips Bronze and equips Silver without stacking both.',
        steps: [request('bronze', 'POST', '/api/player/equip', { slotName: 'Head', itemId: '$fixture.bronzeId' }),
            snapshot('bronze_equipped'),
            request('silver', 'POST', '/api/player/equip', { slotName: 'Head', itemId: '$fixture.silverId' }),
            check(namedStatus('bronze'), namedStatus('silver'),
                { type: 'equals', source: 'after', path: 'currentPlayerDetail.payload.npc.gear.Head.itemId', equals: '$fixture.silverId' },
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.inventory', where: { id: '$fixture.bronzeId' }, field: 'isEquipped', equals: false },
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.inventory', where: { id: '$fixture.silverId' }, field: 'isEquipped', equals: true },
                { type: 'exactDelta', path: 'currentPlayerDetail.payload.npc.attributeInfo.intelligence.modifiedValue', delta: -2, beforeSource: 'snapshots.bronze_equipped', afterSource: 'after' },
                { type: 'exactDelta', path: 'currentPlayerDetail.payload.npc.attributeInfo.dexterity.modifiedValue', delta: 3, beforeSource: 'snapshots.bronze_equipped', afterSource: 'after' },
                ...clean())]
    }),
    define('EQUIP-3-unequip', {
        scenario: 'equipment', fixture: 'equipment-modules-lifecycle',
        description: 'Clearing Head leaves the item owned and unequipped.',
        steps: [snapshot('baseline'), request('silver', 'POST', '/api/player/equip', { slotName: 'Head', itemId: '$fixture.silverId' }), request('clear', 'POST', '/api/player/equip', { slotName: 'Head' }),
            check(namedStatus('clear'),
                { type: 'nullish', source: 'after', path: 'currentPlayerDetail.payload.npc.gear.Head.itemId' },
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.silverId', path: 'metadata.ownerId', equals: '$fixture.playerId' },
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.inventory', where: { id: '$fixture.silverId' }, field: 'isEquipped', equals: false },
                { type: 'equals', source: 'after', path: 'currentPlayerDetail.payload.npc.attributes', equalsFrom: { source: 'snapshots.baseline', path: 'currentPlayerDetail.payload.npc.attributes' } },
                ...clean())]
    }),
    define('EQUIP-4-invalid-operations', {
        scenario: 'equipment', fixture: 'equipment-modules-lifecycle',
        description: 'Wrong slot, unknown/off-location items, and every equipped-item transfer path fail without corrupting gear.',
        steps: [snapshot('baseline'), request('wrong_slot', 'POST', '/api/player/equip', { slotName: 'Body', itemId: '$fixture.bronzeId' }),
            request('unknown', 'POST', '/api/player/equip', { slotName: 'Head', itemId: 'thing_missing_equip4' }),
            check(namedOk('wrong_slot', false), namedOk('unknown', false),
                { type: 'stateUnchanged', beforeSource: 'snapshots.baseline', afterSource: 'after', paths: ['currentPlayerDetail.payload.npc.gear', 'player.payload.player.inventory'] }),
            request('off_location_setup', 'POST', '/api/things/$fixture.coatId/teleport', { locationId: 'loc_4' }),
            snapshot('off_location'),
            request('off_location_equip', 'POST', '/api/player/equip', { slotName: 'Body', itemId: '$fixture.coatId' }),
            check(namedOk('off_location_equip', false),
                { type: 'stateUnchanged', beforeSource: 'snapshots.off_location', afterSource: 'after', paths: ['currentPlayerDetail.payload.npc.gear', 'player.payload.player.inventory'] }),
            request('equip', 'POST', '/api/player/equip', { slotName: 'Head', itemId: '$fixture.bronzeId' }),
            snapshot('equipped'),
            request('drop', 'POST', '/api/things/$fixture.bronzeId/drop', { ownerId: '$fixture.playerId', ownerType: 'player', locationId: '$fixture.locationId' }),
            request('give', 'POST', '/api/things/$fixture.bronzeId/give', { ownerId: 'char_9', ownerType: 'npc', locationId: '$fixture.locationId' }),
            request('teleport', 'POST', '/api/things/$fixture.bronzeId/teleport', { locationId: 'loc_4' }),
            request('container', 'POST', '/api/things/thing_28/container/move-in', { thingId: '$fixture.bronzeId' }),
            check(namedStatus('equip'), namedOk('drop', false), namedOk('give', false), namedOk('teleport', false), namedOk('container', false),
                { type: 'equals', source: 'after', path: 'currentPlayerDetail.payload.npc.gear.Head.itemId', equals: '$fixture.bronzeId' },
                { type: 'stateUnchanged', beforeSource: 'snapshots.equipped', afterSource: 'after', paths: ['currentPlayerDetail.payload.npc.gear', 'player.payload.player.inventory', 'things.payload.things'] },
                ...clean())]
    }),
    define('EQUIP-5-module-install-remove', {
        scenario: 'equipment', fixture: 'equipment-modules-lifecycle',
        description: 'Install a compatible module, persist it, then remove it back to inventory.',
        steps: [request('equip', 'POST', '/api/player/equip', { slotName: 'Head', itemId: '$fixture.bronzeId' }), snapshot('base_equipped'),
            request('install', 'POST', '/api/mod-thing-context-actions/modules:install-module', { thingId: '$fixture.lensId', ownerId: '$fixture.playerId', context: 'player-inventory', locationId: '$fixture.locationId', baseItemId: '$fixture.bronzeId', moduleItemId: '$fixture.lensId', slotType: 'crystal', baseItemSource: 'inventory', moduleItemSource: 'inventory' }),
            check(namedStatus('install'),
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.bronzeId', path: 'installedModuleIds', equals: ['$fixture.lensId'] },
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.lensId', path: 'moduleInstalledOnItemId', equals: '$fixture.bronzeId' },
                { type: 'exactDelta', path: 'currentPlayerDetail.payload.npc.attributeInfo.wisdom.modifiedValue', delta: 2, beforeSource: 'snapshots.base_equipped', afterSource: 'after' },
                { type: 'count', source: 'after', path: 'currentPlayerDetail.payload.npc.modStatusSections', equals: 1 }),
            snapshot('installed'),
            { type: 'save', name: 'installed_save' }, { type: 'reload', name: 'installed_reload' },
            check(
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.bronzeId', path: 'installedModuleIds', equals: ['$fixture.lensId'] },
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.lensId', path: 'moduleInstalledOnItemId', equals: '$fixture.bronzeId' },
                { type: 'equals', source: 'after', path: 'currentPlayerDetail.payload.npc.attributes', equalsFrom: { source: 'snapshots.installed', path: 'currentPlayerDetail.payload.npc.attributes' } },
                { type: 'equals', source: 'after', path: 'currentPlayerDetail.payload.npc.modStatusSections', equalsFrom: { source: 'snapshots.installed', path: 'currentPlayerDetail.payload.npc.modStatusSections' } }),
            snapshot('before_remove'),
            request('remove', 'POST', '/api/mod-thing-context-actions/modules:remove-module', { thingId: '$fixture.bronzeId', ownerId: '$fixture.playerId', context: 'player-inventory', locationId: '$fixture.locationId', baseItemId: '$fixture.bronzeId', moduleItemId: '$fixture.lensId', baseItemSource: 'inventory', moduleItemSource: 'inventory' }),
            check(namedStatus('remove'),
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.bronzeId', path: 'installedModuleIds', equals: [] },
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.lensId', path: 'metadata.ownerId', equals: '$fixture.playerId' },
                { type: 'exactDelta', path: 'currentPlayerDetail.payload.npc.attributeInfo.wisdom.modifiedValue', delta: -2, beforeSource: 'snapshots.before_remove', afterSource: 'after' },
                { type: 'equals', source: 'after', path: 'currentPlayerDetail.payload.npc.attributeInfo.intelligence.modifiedValue', equalsFrom: { source: 'snapshots.before_remove', path: 'currentPlayerDetail.payload.npc.attributeInfo.intelligence.modifiedValue' } },
                { type: 'count', source: 'after', path: 'currentPlayerDetail.payload.npc.modStatusSections', equals: 0 },
                ...clean())]
    })
];

const commerce = [
    define('TRADE-1-session', {
        scenario: 'commerce', fixture: 'commerce-merin-session', configProfile: 'vehicle-mechanics',
        description: 'Start an eligible trade session with canonical offers, positive expiry, and bounded generated stock.',
        steps: [request('session', 'POST', '/api/npcs/$fixture.merchantId/trade/session', undefined, interactive),
            check(namedStatus('session'),
                { type: 'equals', source: 'responses.session', path: 'payload.session.npcId', equals: '$fixture.merchantId' },
                { type: 'exists', source: 'responses.session', path: 'payload.session.id' },
                { type: 'exists', source: 'responses.session', path: 'payload.session.playerOffers' },
                { type: 'exists', source: 'responses.session', path: 'payload.session.merchantOffers' },
                { type: 'greaterThan', source: 'responses.session', path: 'payload.session.expiresAtWorldMinutes', valueFrom: { source: 'after', path: 'calendar.payload.worldTime.timeMinutes' } },
                { type: 'arrayObjectCount', source: 'responses.session', path: 'payload.session.playerOffers', where: { itemId: '$fixture.amberId' }, equals: 1 },
                { type: 'arrayObjectCount', source: 'responses.session', path: 'payload.session.merchantOffers', where: { itemId: '$fixture.flaskId' }, equals: 1 },
                { type: 'arrayNumericFieldBounds', source: 'responses.session', path: 'payload.session.playerOffers', field: 'unitPrice', minimumExclusive: 0 },
                { type: 'arrayNumericFieldBounds', source: 'responses.session', path: 'payload.session.playerOffers', field: 'count', minimumExclusive: 0 },
                { type: 'arrayNumericFieldBounds', source: 'responses.session', path: 'payload.session.merchantOffers', field: 'unitPrice', minimumExclusive: 0 },
                { type: 'arrayNumericFieldBounds', source: 'responses.session', path: 'payload.session.merchantOffers', field: 'count', minimumExclusive: 0 },
                { type: 'arrayObjectCountBetween', source: 'responses.session', path: 'payload.session.merchantOffers', where: { source: 'barterInventory' }, minimum: 0, maximum: 15 },
                { type: 'uniqueBy', source: 'responses.session', path: 'payload.session.playerOffers', key: 'itemId' },
                { type: 'uniqueBy', source: 'responses.session', path: 'payload.session.merchantOffers', key: 'itemId' },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.merchantId', path: 'barterStockUpdatedAt', equalsFrom: { source: 'after', path: 'calendar.payload.worldTime.timeMinutes' } },
                ...clean())]
    }),
    define('TRADE-2-buy', {
        scenario: 'commerce', fixture: 'commerce-merin-session', configProfile: 'vehicle-mechanics',
        description: 'Buy one canonical merchant item and atomically transfer item and net currency.',
        steps: [request('session', 'POST', '/api/npcs/$fixture.merchantId/trade/session', undefined, interactive), snapshot('quoted'),
            request('commit', 'POST', '/api/npcs/$fixture.merchantId/trade/commit', { sessionId: '$response.session.payload.session.id', merchantItems: [{ itemId: '$fixture.flaskId', count: 1 }] }, interactive),
            check(namedStatus('commit'),
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.flaskId', path: 'metadata.ownerId', equals: '$fixture.playerId' },
                { type: 'lessThan', source: 'after', path: 'player.payload.player.currency', valueFrom: { source: 'snapshots.quoted', path: 'player.payload.player.currency' } },
                { type: 'historyAddedTypeCount', beforeSource: 'snapshots.quoted', afterSource: 'after', entryType: 'event-summary', equals: 1 },
                ...clean())]
    }),
    define('TRADE-3-sell', {
        scenario: 'commerce', fixture: 'commerce-merin-session', configProfile: 'vehicle-mechanics',
        description: 'Sell one player item into barter stock and receive the quoted currency.',
        steps: [request('session', 'POST', '/api/npcs/$fixture.merchantId/trade/session', undefined, interactive), snapshot('quoted'),
            request('commit', 'POST', '/api/npcs/$fixture.merchantId/trade/commit', { sessionId: '$response.session.payload.session.id', playerItems: [{ itemId: '$fixture.amberId', count: 1 }] }, interactive),
            check(namedStatus('commit'),
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.amberId', path: 'metadata.barterOwnerId', equals: '$fixture.merchantId' },
                { type: 'greaterThan', source: 'after', path: 'player.payload.player.currency', valueFrom: { source: 'snapshots.quoted', path: 'player.payload.player.currency' } },
                ...clean())]
    }),
    define('TRADE-4-mixed-transaction', {
        scenario: 'commerce', fixture: 'commerce-merin-session', configProfile: 'vehicle-mechanics',
        description: 'Commit one buy and one sale in the same validated transaction.',
        steps: [request('session', 'POST', '/api/npcs/$fixture.merchantId/trade/session', undefined, interactive),
            request('commit', 'POST', '/api/npcs/$fixture.merchantId/trade/commit', { sessionId: '$response.session.payload.session.id', playerItems: [{ itemId: '$fixture.amberId', count: 1 }], merchantItems: [{ itemId: '$fixture.flaskId', count: 1 }] }, interactive),
            check(namedStatus('commit'),
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.amberId', path: 'metadata.barterOwnerId', equals: '$fixture.merchantId' },
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.flaskId', path: 'metadata.ownerId', equals: '$fixture.playerId' },
                { type: 'exists', source: 'responses.commit', path: 'payload.transaction' },
                ...clean())]
    }),
    define('TRADE-5-merchant-currency-shortfall', {
        scenario: 'commerce', fixture: 'commerce-merin-session', configProfile: 'vehicle-mechanics',
        description: 'A merchant shortfall rejects atomically, then an explicit capped-payment acceptance commits.',
        steps: [request('poor', 'PUT', '/api/npcs/$fixture.merchantId', { currency: 1 }),
            request('session', 'POST', '/api/npcs/$fixture.merchantId/trade/session', undefined, interactive), snapshot('before_commit'),
            request('reject', 'POST', '/api/npcs/$fixture.merchantId/trade/commit', { sessionId: '$response.session.payload.session.id', playerItems: [{ itemId: '$fixture.amberId', count: 1 }] }, interactive),
            check(namedStatus('reject', 409),
                { type: 'equals', source: 'responses.reject', path: 'payload.reason', equals: 'merchant-insufficient-currency' },
                { type: 'stateUnchanged', beforeSource: 'snapshots.before_commit', afterSource: 'after', paths: ['player.payload.player.currency', 'player.payload.player.inventory', 'things.payload.things'] }),
            request('accept', 'POST', '/api/npcs/$fixture.merchantId/trade/commit', { sessionId: '$response.session.payload.session.id', playerItems: [{ itemId: '$fixture.amberId', count: 1 }], acceptMerchantCurrencyShortfall: true }, interactive),
            check(namedStatus('accept'),
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.amberId', path: 'metadata.barterOwnerId', equals: '$fixture.merchantId' },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.merchantId', path: 'currency', equals: 0 },
                ...clean())]
    }),
    define('TRADE-6-haggle', {
        scenario: 'commerce', fixture: 'commerce-merin-session', configProfile: 'vehicle-mechanics',
        description: 'Polite and insulting haggles run from separate restores, each recording one opposed check and one exchange.',
        steps: [{ type: 'save', name: 'baseline_save' },
            request('favorable_skill', 'PUT', '/api/npcs/$fixture.playerId', { skills: { Negotiation: 50 } }),
            request('polite_session', 'POST', '/api/npcs/$fixture.merchantId/trade/session', undefined, interactive),
            request('polite_haggle', 'POST', '/api/npcs/$fixture.merchantId/trade/haggle', { sessionId: '$response.polite_session.payload.session.id', offer: 'I can become a repeat customer. Could you give me a fairer price today?' }, interactive),
            check(namedStatus('polite_haggle'),
                { type: 'exists', source: 'responses.polite_haggle', path: 'payload.check.playerTotal' },
                { type: 'exists', source: 'responses.polite_haggle', path: 'payload.check.merchantTotal' },
                { type: 'greaterThan', source: 'responses.polite_haggle', path: 'payload.check.playerTotal', valueFrom: { source: 'responses.polite_haggle', path: 'payload.check.merchantTotal' } },
                { type: 'count', source: 'responses.polite_haggle', path: 'payload.chatEntries', equals: 2 },
                { type: 'uniqueBy', source: 'responses.polite_haggle', path: 'payload.session.merchantOffers', key: 'itemId' },
                { type: 'exists', source: 'responses.polite_haggle', path: 'payload.response' }),
            { type: 'reload', name: 'baseline_reload' },
            request('insult_context', 'PUT', '/api/npcs/$fixture.merchantId', { skills: { Negotiation: 50 }, aiNotes: 'QA commerce-test merchant. Treat a direct contemptuous insult during a major-failure haggle as grounds to refuse further trade immediately.' }),
            request('insult_session', 'POST', '/api/npcs/$fixture.merchantId/trade/session', undefined, interactive),
            request('insult_haggle', 'POST', '/api/npcs/$fixture.merchantId/trade/haggle', { sessionId: '$response.insult_session.payload.session.id', offer: 'These prices are a pathetic scam, and only a fool would buy from an incompetent fraud like you. Cut them now or admit you cannot trade.' }, interactive),
            check(namedStatus('insult_haggle'),
                { type: 'exists', source: 'responses.insult_haggle', path: 'payload.check.playerTotal' },
                { type: 'exists', source: 'responses.insult_haggle', path: 'payload.check.merchantTotal' },
                { type: 'count', source: 'responses.insult_haggle', path: 'payload.chatEntries', equals: 2 },
                { type: 'absent', source: 'responses.insult_haggle', path: 'payload.session' },
                { type: 'greaterThan', source: 'responses.insult_haggle', path: 'payload.check.merchantTotal', valueFrom: { source: 'responses.insult_haggle', path: 'payload.check.playerTotal' } },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.merchantId', path: 'willingToTrade', equals: false },
                ...clean())],
        humanReview: ['Review both merchant replies for natural reactions to the materially different offers; wording is not mechanically graded.']
    }),
    define('TRADE-7-refusal-expiry', {
        scenario: 'commerce', fixture: 'commerce-merin-session', configProfile: 'vehicle-mechanics',
        description: 'A temporary willingness refusal blocks sessions until its world-time expiry, then refreshes.',
        steps: [request('refuse', 'PUT', '/api/npcs/$fixture.merchantId', { willingToTrade: false }),
            request('blocked', 'POST', '/api/npcs/$fixture.merchantId/trade/session'),
            request('almost_expired', 'POST', '/api/slash-command', { command: 'time', argsText: '+1439 minutes' }),
            request('still_blocked', 'POST', '/api/npcs/$fixture.merchantId/trade/session'),
            request('reach_expiry', 'POST', '/api/slash-command', { command: 'time', argsText: '+1 minute' }),
            request('restored', 'POST', '/api/npcs/$fixture.merchantId/trade/session', undefined, interactive),
            check(namedStatus('blocked', 409), namedStatus('still_blocked', 409), namedStatus('restored'),
                { type: 'exists', source: 'responses.restored', path: 'payload.session.id' },
                ...clean())]
    }),
    define('TRADE-8-conclude', {
        scenario: 'commerce', fixture: 'commerce-merin-session', configProfile: 'vehicle-mechanics',
        description: 'Concluding an untouched session is silent; concluding a haggled session reports its response-turn trigger.',
        steps: [request('plain_session', 'POST', '/api/npcs/$fixture.merchantId/trade/session', undefined, interactive),
            request('plain_conclude', 'POST', '/api/npcs/$fixture.merchantId/trade/conclude', { sessionId: '$response.plain_session.payload.session.id' }, interactive),
            request('merchant_context', 'PUT', '/api/npcs/$fixture.merchantId', { aiNotes: 'Continue trading after a polite haggle; remain willing to sell the QA Glass Flask.' }),
            request('haggled_session', 'POST', '/api/npcs/$fixture.merchantId/trade/session', undefined, interactive),
            request('haggle', 'POST', '/api/npcs/$fixture.merchantId/trade/haggle', { sessionId: '$response.haggled_session.payload.session.id', offer: 'Would you consider a small cordial discount?' }, interactive),
            request('haggled_conclude', 'POST', '/api/npcs/$fixture.merchantId/trade/conclude', { sessionId: '$response.haggle.payload.session.id' }, interactive),
            check(namedStatus('plain_conclude'), namedStatus('haggle'), namedStatus('haggled_conclude'),
                { type: 'equals', source: 'responses.plain_conclude', path: 'payload.npcTurnTriggered', equals: false },
                { type: 'equals', source: 'responses.haggled_conclude', path: 'payload.concluded', equals: true },
                { type: 'equals', source: 'responses.haggled_conclude', path: 'payload.npcTurnTriggered', equals: true },
                ...clean())]
    }),
    define('TRADE-9-eligibility-rejections', {
        scenario: 'commerce', fixture: 'commerce-merin-session',
        description: 'Unwilling, hostile, dead, and absent merchants are independently rejected.',
        steps: [request('unwilling_setup', 'PUT', '/api/npcs/$fixture.merchantId', { willingToTrade: false }), request('unwilling', 'POST', '/api/npcs/$fixture.merchantId/trade/session'),
            request('willing_reset', 'PUT', '/api/npcs/$fixture.merchantId', { willingToTrade: true }), request('hostile_setup', 'PUT', '/api/npcs/$fixture.merchantId/dispositions', { dispositions: [{ key: 'platonic', value: -31 }] }), request('hostile', 'POST', '/api/npcs/$fixture.merchantId/trade/session'),
            request('neutral_reset', 'PUT', '/api/npcs/$fixture.merchantId/dispositions', { dispositions: [{ key: 'platonic', value: 0 }] }), request('dead_setup', 'PUT', '/api/npcs/$fixture.merchantId', { isDead: true }), request('dead', 'POST', '/api/npcs/$fixture.merchantId/trade/session'),
            request('alive_reset', 'PUT', '/api/npcs/$fixture.merchantId', { isDead: false }), request('absent_setup', 'POST', '/api/npcs/$fixture.merchantId/teleport', { locationId: '$fixture.otherLocationId', accountTravelTime: false }), request('absent', 'POST', '/api/npcs/$fixture.merchantId/trade/session'),
            check(namedStatus('unwilling', 409), namedStatus('hostile', 409), namedStatus('dead', 409), namedStatus('absent', 409), ...clean())]
    })
];

const crafting = [
    define('CRAFT-1-process', {
        scenario: 'crafting', fixture: 'crafting-processing-lifecycle', configProfile: 'vehicle-mechanics',
        description: 'Process two selected grain inputs at the Hand Mill and consume only selected inputs.',
        steps: [request('process', 'POST', '/api/craft', { mode: 'process', slots: [{ thingId: '$fixture.grainOneId', slotIndex: 0 }, { thingId: '$fixture.grainTwoId', slotIndex: 1 }], stationThingId: '$fixture.millId', stationName: 'QA Hand Mill', intendedItemName: 'QA Milled Grain', notes: 'Mill both selected QA Grain Bundles into useful milled grain. <15>' }, interactive),
            check(namedStatus('process'),
                { type: 'equals', source: 'responses.process', path: 'payload.success', equals: true },
                { type: 'count', source: 'responses.process', path: 'payload.consumedThingIds', equals: 2 },
                { type: 'arrayObjectCountAtLeast', source: 'responses.process', path: 'payload.craftedItems', where: {}, minimum: 1 },
                { type: 'greaterThanOrEqual', source: 'responses.process', path: 'payload.timeTakenMinutes', value: 1 },
                ...clean())]
    }),
    define('CRAFT-2-harvest', {
        scenario: 'crafting', fixture: 'crafting-processing-lifecycle', configProfile: 'vehicle-mechanics',
        description: 'Harvest a renewable patch, recover items, and retain the source with harvest history.',
        steps: [request('harvest', 'POST', '/api/craft', { mode: 'harvest', slots: [{ thingId: '$fixture.patchId', slotIndex: 0 }], harvestItemId: '$fixture.patchId', harvestItemName: 'QA Glowreed Patch', harvestItemDescription: 'A renewable luminous reed patch.', harvestNotes: 'Harvest a modest usable bundle without destroying the renewable source. <15>' }, interactive),
            check(namedStatus('harvest'),
                { type: 'arrayObjectCountAtLeast', source: 'responses.harvest', path: 'payload.recoveredItems', where: {}, minimum: 1 },
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.patchId', path: 'isHarvestable', equals: true },
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.patchId', path: 'lastHarvested', equalsFrom: { source: 'after', path: 'calendar.payload.worldTime.timeMinutes' } },
                { type: 'entityArrayUnique', source: 'after', collection: 'things', id: '$fixture.patchId', path: 'previouslyHarvestedItems' },
                ...clean())]
    }),
    define('CRAFT-3-repeat-harvest', {
        scenario: 'crafting', fixture: 'crafting-processing-lifecycle', configProfile: 'vehicle-mechanics',
        description: 'Harvest history survives time advancement and a later harvest updates rather than duplicates source state.',
        steps: [request('first', 'POST', '/api/craft', { mode: 'harvest', slots: [{ thingId: '$fixture.patchId' }], harvestItemId: '$fixture.patchId', harvestItemName: 'QA Glowreed Patch', harvestNotes: 'Harvest a modest usable bundle. <15>' }, interactive), snapshot('first_harvest'),
            request('day', 'POST', '/api/slash-command', { command: 'time', argsText: '1 day' }),
            request('second', 'POST', '/api/craft', { mode: 'harvest', slots: [{ thingId: '$fixture.patchId' }], harvestItemId: '$fixture.patchId', harvestItemName: 'QA Glowreed Patch', harvestNotes: 'Harvest a second modest usable bundle after regrowth. <15>' }, interactive),
            check(namedStatus('first'), namedStatus('second'),
                { type: 'greaterThan', source: 'after', path: 'calendar.payload.worldTime.timeMinutes', valueFrom: { source: 'snapshots.first_harvest', path: 'calendar.payload.worldTime.timeMinutes' } },
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.patchId', path: 'isHarvestable', equals: true },
                { type: 'entityArrayUnique', source: 'after', collection: 'things', id: '$fixture.patchId', path: 'previouslyHarvestedItems' },
                ...clean())]
    }),
    define('CRAFT-4-salvage', {
        scenario: 'crafting', fixture: 'crafting-processing-lifecycle', configProfile: 'vehicle-mechanics',
        description: 'Salvage the selected lantern, consume that target, and recover canonical outputs.',
        steps: [request('salvage', 'POST', '/api/craft', { mode: 'salvage', slots: [{ thingId: '$fixture.lanternId', slotIndex: 0 }], stationThingId: '$fixture.workbenchId', stationName: 'QA Workbench', salvageItemId: '$fixture.lanternId', salvageItemName: 'QA Broken Lantern', salvageItemDescription: 'A damaged lantern with recoverable components.', salvageNotes: 'Dismantle the selected lantern and recover usable components. <15>' }, interactive),
            check(namedStatus('salvage'),
                { type: 'includes', source: 'responses.salvage', path: 'payload.consumedThingIds', value: '$fixture.lanternId' },
                { type: 'arrayObjectCountAtLeast', source: 'responses.salvage', path: 'payload.recoveredItems', where: {}, minimum: 1 },
                ...clean())]
    }),
    define('CRAFT-5-scenery-output', {
        scenario: 'crafting', fixture: 'crafting-processing-lifecycle', configProfile: 'vehicle-mechanics',
        description: 'Craft a scenery target and place the result in the current location rather than inventory.',
        steps: [request('craft', 'POST', '/api/craft', { mode: 'craft', craftTargetType: 'scenery', slots: [{ thingId: '$fixture.woodId', slotIndex: 0 }, { thingId: '$fixture.resinId', slotIndex: 1 }], stationThingId: '$fixture.workbenchId', stationName: 'QA Workbench', intendedItemName: 'QA Trail Marker', notes: 'Construct one permanent scenery trail marker from selected wood and resin. <15>' }, interactive),
            check(namedStatus('craft'),
                { type: 'arrayObjectCountAtLeast', source: 'responses.craft', path: 'payload.craftedItems', where: { thingType: 'scenery' }, minimum: 1 },
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.inventory', where: { id: '$response.craft.payload.craftedItem.id' }, equals: 0 },
                ...clean())]
    }),
    define('CRAFT-6-critical-success', {
        scenario: 'crafting', fixture: 'crafting-processing-lifecycle', configProfile: 'vehicle-mechanics',
        description: 'A forced natural 20 reaches the authoritative high-success craft outcome without duplicate consumption.',
        steps: [request('craft', 'POST', '/api/craft', { mode: 'craft', craftTargetType: 'item', slots: [{ thingId: '$fixture.woodId', slotIndex: 0 }, { thingId: '$fixture.resinId', slotIndex: 1 }], stationThingId: '$fixture.workbenchId', stationName: 'QA Workbench', intendedItemName: 'QA Stormproof Lantern', notes: 'Craft a portable stormproof lantern and follow the authoritative result. <20>' }, interactive),
            check(namedStatus('craft'),
                { type: 'includes', source: 'responses.craft', path: 'payload.resultLevel', value: 'success' },
                { type: 'uniqueBy', source: 'responses.craft', path: 'payload.craftedItems', key: 'id' },
                { type: 'count', source: 'responses.craft', path: 'payload.consumedThingIds', equals: 2 },
                ...clean())],
        humanReview: ['Review the crafted-result prose for a natural, coherent high-success outcome; do not mechanically police wording.']
    }),
    define('CRAFT-7-critical-failure', {
        scenario: 'crafting', fixture: 'crafting-processing-lifecycle', configProfile: 'vehicle-mechanics',
        description: 'A deliberately disadvantaged natural 1 follows the authoritative failure tier and applies only declared consumption/effects.',
        steps: [request('disadvantage', 'PUT', '/api/npcs/$fixture.playerId', { attributes: { strength: 0, dexterity: 0, constitution: 0, intelligence: 0, wisdom: 0, charisma: 0, luck: 0 }, skills: { Crafting: -2, Carpentry: -2 } }),
            request('craft', 'POST', '/api/craft', { mode: 'craft', craftTargetType: 'item', slots: [{ thingId: '$fixture.woodId', slotIndex: 0 }, { thingId: '$fixture.resinId', slotIndex: 1 }], stationThingId: '$fixture.workbenchId', stationName: 'QA Workbench', intendedItemName: 'QA Stormproof Lantern', notes: 'Attempt the craft and follow the authoritative failure result exactly. <1>' }, interactive),
            check(namedStatus('craft'),
                { type: 'includes', source: 'responses.craft', path: 'payload.resultLevel', value: 'failure' },
                { type: 'greaterThanOrEqual', source: 'responses.craft', path: 'payload.timeTakenMinutes', value: 1 },
                ...clean())],
        humanReview: ['Review failure prose for material consistency with the structured result, while allowing useful story detail.']
    }),
    define('CRAFT-8-invalid-inputs-atomic', {
        scenario: 'crafting', fixture: 'crafting-processing-lifecycle',
        description: 'Offscreen, equipped, nonempty-container, multiple-salvage, non-harvestable, and unknown inputs reject before mutation.',
        steps: [snapshot('before_invalid'),
            request('equipped', 'POST', '/api/craft', { mode: 'craft', noProse: true, slots: [{ thingId: 'thing_191' }], stationThingId: '$fixture.workbenchId', intendedItemName: 'QA Metal Fitting' }),
            request('nonempty_container', 'POST', '/api/craft', { mode: 'craft', noProse: true, slots: [{ thingId: 'thing_28' }], stationThingId: '$fixture.workbenchId', intendedItemName: 'QA Salvaged Satchel Fitting' }),
            request('multiple_salvage', 'POST', '/api/craft', { mode: 'salvage', noProse: true, slots: [{ thingId: '$fixture.lanternId' }, { thingId: '$fixture.grainOneId' }], stationThingId: '$fixture.workbenchId' }),
            request('nonharvestable', 'POST', '/api/craft', { mode: 'harvest', noProse: true, slots: [{ thingId: '$fixture.grainOneId' }], harvestItemId: '$fixture.grainOneId' }),
            request('unknown', 'POST', '/api/craft', { mode: 'craft', noProse: true, slots: [{ thingId: 'thing_missing_craft8' }], stationThingId: '$fixture.workbenchId' }),
            check(namedOk('equipped', false), namedOk('nonempty_container', false), namedOk('multiple_salvage', false), namedOk('nonharvestable', false), namedOk('unknown', false),
                { type: 'stateUnchanged', beforeSource: 'snapshots.before_invalid', afterSource: 'after', paths: ['player.payload.player.inventory', 'things.payload.things', 'calendar.payload.worldTime'] },
                ...clean()),
            request('offscreen_setup', 'POST', '/api/things/$fixture.grainTwoId/teleport', { locationId: 'loc_6' }),
            snapshot('before_offscreen'),
            request('offscreen', 'POST', '/api/craft', { mode: 'process', noProse: true, slots: [{ thingId: '$fixture.grainTwoId' }], stationThingId: '$fixture.millId', intendedItemName: 'QA Impossible Offscreen Grain' }),
            check(namedOk('offscreen', false),
                { type: 'stateUnchanged', beforeSource: 'snapshots.before_offscreen', afterSource: 'after', paths: ['player.payload.player.inventory', 'things.payload.things', 'calendar.payload.worldTime'] },
                ...clean())]
    })
];

const combat = [
    define('COMBAT-4-opposed-maneuver', {
        scenario: 'combat', fixture: 'combat-elemental-skirmish', configProfile: 'combat-player-only',
        description: 'Resolve one non-damaging opposed grapple without changing target health.',
        steps: [snapshot('ready'), chat('grapple', '<20> I make one non-damaging contested combat maneuver against QA Ash Beetle: I grab and pin it without injuring it. Resolve my Melee Combat plus strength opposed by its Melee Combat plus strength.'),
            check(namedStatus('grapple'),
                { type: 'arrayObjectCount', source: 'responses.grapple', path: 'payload.toolInvocations', where: { name: 'resolveOpposedSkillCheck' }, equals: 1 },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.ashBeetleId', path: 'health', equals: 35 },
                ...clean())]
    }),
    define('COMBAT-5-status-effect-expiry', {
        scenario: 'combat', fixture: 'combat-elemental-skirmish', configProfile: 'combat-player-only',
        description: 'A targeted Fire Bomb applies one timed status and later time advancement expires it without reapplication.',
        steps: [request('isolate_frost', 'POST', '/api/npcs/$fixture.frostBeetleId/teleport', { locationId: '$fixture.isolationLocationId', accountTravelTime: false }),
            request('isolate_friend', 'POST', '/api/npcs/$fixture.shieldhandId/teleport', { locationId: '$fixture.isolationLocationId', accountTravelTime: false }),
            chat('bomb', '<20> I throw my one QA Fire Bomb directly at QA Ash Beetle, with no one else in the blast, then stop.'),
            check({ type: 'entityArrayObjectCount', source: 'after', collection: 'players', id: '$fixture.ashBeetleId', path: 'statusEffects', where: { name: 'Burn' }, equals: 1 }),
            request('expire', 'POST', '/api/slash-command', { command: 'time', argsText: '+10 minutes' }),
            check(namedStatus('expire'),
                { type: 'entityArrayObjectCount', source: 'after', collection: 'players', id: '$fixture.ashBeetleId', path: 'statusEffects', where: { name: 'Burn' }, equals: 0 },
                ...clean())]
    }),
    define('COMBAT-6-nonlethal-incapacitation', {
        scenario: 'combat', fixture: 'combat-elemental-skirmish', configProfile: 'combat-player-only',
        description: 'A one-health target struck nonlethally becomes incapacitated rather than dead and persists after reload.',
        steps: [request('prepare', 'PUT', '/api/npcs/$fixture.ashBeetleId', { health: 1, isDead: false, statusEffects: [] }),
            snapshot('prepared'),
            chat('strike', '<20> I strike QA Ash Beetle exactly once with a deliberately nonlethal barehanded blow, intending to incapacitate rather than kill it.'),
            { type: 'save', name: 'saved' }, { type: 'reload', name: 'reloaded' },
            check(namedStatus('strike'),
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.ashBeetleId', path: 'isDead', equals: false },
                { type: 'entityArrayObjectCount', source: 'after', collection: 'players', id: '$fixture.ashBeetleId', path: 'statusEffects', where: { description: 'Incapacitated' }, equals: 1 },
                { type: 'equals', source: 'after', path: 'player.payload.player.experience', equalsFrom: { source: 'snapshots.prepared', path: 'player.payload.player.experience' } },
                ...clean())]
    }),
    define('COMBAT-7-lethal-death', {
        scenario: 'combat', fixture: 'combat-elemental-skirmish', configProfile: 'combat-player-only',
        description: 'A one-health target struck lethally reaches zero, dies once, and remains a corpse.',
        steps: [request('prepare', 'PUT', '/api/npcs/$fixture.frostBeetleId', { health: 1, isDead: false, statusEffects: [] }),
            snapshot('prepared'),
            chat('strike', '<20> I strike QA Frost Beetle exactly once with a deliberately lethal barehanded blow, intending to kill rather than incapacitate it.'),
            check(namedStatus('strike'),
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.frostBeetleId', path: 'health', equals: 0 },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.frostBeetleId', path: 'isDead', equals: true },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.frostBeetleId', path: 'corpseCountdown', equals: 4 },
                { type: 'entityArrayObjectCount', source: 'after', collection: 'players', id: '$fixture.frostBeetleId', path: 'statusEffects', where: { description: 'Deceased' }, equals: 1 },
                { type: 'greaterThan', source: 'after', path: 'player.payload.player.experience', valueFrom: { source: 'snapshots.prepared', path: 'player.payload.player.experience' } },
                { type: 'historyAddedNestedObjectCount', beforeSource: 'snapshots.prepared', afterSource: 'after', entryWhere: { type: 'event-summary' }, path: 'summaryItems', where: { sourceType: 'death_incapacitation' }, equals: 1 },
                { type: 'historyAddedNestedObjectCount', beforeSource: 'snapshots.prepared', afterSource: 'after', entryWhere: { type: 'event-summary' }, path: 'summaryItems', where: { sourceType: 'experience_award' }, equals: 1 },
                ...clean())]
    }),
    define('COMBAT-8-healing-and-no-resurrection', {
        scenario: 'combat', fixture: 'combat-elemental-skirmish', configProfile: 'combat-player-only',
        description: 'Separate restores exercise player healing, nonlethal stabilization, and rejection of ordinary resurrection.',
        steps: [{ type: 'save', name: 'baseline_save' },
            request('wound_player', 'PUT', '/api/npcs/$fixture.playerId', { health: 20, isDead: false, statusEffects: [] }),
            chat('heal_player', 'I use exactly one QA Bandage on my own wounds and consume it. The treatment succeeds and I recover a medium amount of health. This is ordinary healing, not resurrection. Do not have anyone attack, and stop after the treatment is resolved.'),
            check(namedStatus('heal_player'),
                { type: 'greaterThan', source: 'after', path: 'player.payload.player.health', value: 20 },
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.inventory', where: { id: '$fixture.bandageId' }, equals: 0 },
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.statusEffects', where: { name: 'Healed' }, equals: 1 }),
            { type: 'reload', name: 'stabilize_reload' },
            request('prepare_incapacitated', 'PUT', '/api/npcs/$fixture.ashBeetleId', { health: 1, isDead: false, statusEffects: [] }),
            chat('incapacitate', '<20> I strike QA Ash Beetle exactly once with a deliberately nonlethal barehanded blow, intending to incapacitate rather than kill it.'),
            check(namedStatus('incapacitate'),
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.ashBeetleId', path: 'isDead', equals: false },
                { type: 'entityArrayObjectCount', source: 'after', collection: 'players', id: '$fixture.ashBeetleId', path: 'statusEffects', where: { description: 'Incapacitated' }, equals: 1 }),
            chat('stabilize', 'I use exactly one QA Bandage to stabilize QA Ash Beetle. The treatment succeeds and restores a small amount of health, but it remains unconscious and Incapacitated; this is stabilization, not revival. Do not have anyone attack, and stop after the treatment is resolved.'),
            check(namedStatus('stabilize'),
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.ashBeetleId', path: 'isDead', equals: false },
                { type: 'entityArrayObjectCount', source: 'after', collection: 'players', id: '$fixture.ashBeetleId', path: 'statusEffects', where: { description: 'Incapacitated' }, equals: 1 },
                { type: 'entityArrayObjectCount', source: 'after', collection: 'players', id: '$fixture.ashBeetleId', path: 'statusEffects', where: { name: 'Healed' }, equals: 1 }),
            { type: 'reload', name: 'dead_reload' },
            request('kill', 'PUT', '/api/npcs/$fixture.frostBeetleId', { health: 0, isDead: true }), snapshot('dead'),
            chat('bandage_dead', 'I try to use exactly one QA Bandage on the dead QA Frost Beetle. An ordinary bandage cannot resurrect it, so stop after the failed treatment.'),
            check(namedStatus('bandage_dead'),
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.frostBeetleId', path: 'health', equals: 0 },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.frostBeetleId', path: 'isDead', equals: true },
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.inventory', where: { id: '$fixture.bandageId', count: 1 }, equals: 1 },
                ...clean())],
        humanReview: ['Review all three treatment branches for material agreement: ordinary healing, unconscious stabilization, and no resurrection.']
    }),
    define('COMBAT-9-flee-success-and-failure', {
        scenario: 'combat', fixture: 'combat-elemental-skirmish', configProfile: 'combat-player-only',
        description: 'Failed and successful escapes run from separate restores, preserving movement, time, party, and combat boundaries.',
        steps: [{ type: 'save', name: 'baseline_save' },
            request('failure_party', 'POST', '/api/player/party', { ownerId: '$fixture.playerId', memberId: '$fixture.shieldhandId' }),
            chat('failure_enter', 'I take a defensive stance and enter combat with QA Ash Beetle and QA Frost Beetle. I do not attack or move.'), snapshot('failure_combat'),
            chat('failed', 'I try to flee with Bulwark to Ember Hollow Riverbank. Resolve one escape check using <1>. If it fails, neither of us moves.'),
            check(namedStatus('failed'),
                { type: 'equals', source: 'after', path: 'player.payload.player.locationId', equalsFrom: { source: 'snapshots.failure_combat', path: 'player.payload.player.locationId' } },
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.partyMembers', where: { id: '$fixture.shieldhandId' }, equals: 1 },
                { type: 'equals', source: 'responses.failed', path: 'payload.debug.eventStructured.parsed.in_combat', equals: true }),
            { type: 'reload', name: 'success_reload' },
            request('success_party', 'POST', '/api/player/party', { ownerId: '$fixture.playerId', memberId: '$fixture.shieldhandId' }),
            chat('success_enter', 'I take a defensive stance and enter combat with QA Ash Beetle and QA Frost Beetle. I do not attack or move.'), snapshot('success_combat'),
            chat('success', 'I flee with Bulwark to Ember Hollow Riverbank. Resolve one escape check using <20>. On success move only us through the existing exit and end combat.'),
            check(namedStatus('success'),
                { type: 'equals', source: 'after', path: 'player.payload.player.locationId', equals: 'loc_10' },
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.partyMembers', where: { id: '$fixture.shieldhandId' }, equals: 1 },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.shieldhandId', path: 'isInPlayerParty', equals: true },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.shieldhandId', path: 'locationId', equals: null },
                { type: 'exactDelta', path: 'calendar.payload.worldTime.timeMinutes', delta: 10, beforeSource: 'snapshots.success_combat', afterSource: 'after' },
                { type: 'equals', source: 'responses.success', path: 'payload.debug.eventStructured.parsed.in_combat', equals: false },
                ...clean())]
    }),
    define('COMBAT-10-turn-order-persistence', {
        scenario: 'combat', fixture: 'combat-elemental-skirmish', configProfile: 'combat-mechanics',
        description: 'Active combat and a corpse survive reload; the next scheduler excludes the corpse and runs living actors only.',
        steps: [chat('enter', 'I take a guarded stance and enter combat with QA Ash Beetle and QA Frost Beetle without attacking. Their attacks belong only to the configured NPC-turn phase.'),
            request('add_frostbite', 'PUT', '/api/npcs/$fixture.playerId', { isDead: false, statusEffects: [{ id: 'status_benchmark_frostbite', name: 'Frostbite', description: 'Persistent benchmark cold damage.', attributes: [], skills: [], needBars: [{ name: 'Health', delta: -1 }], duration: 30, appliedAt: 659 }] }),
            request('damage_player', 'PUT', '/api/npcs/$fixture.playerId', { health: 32, isDead: false }),
            request('kill_frost', 'POST', '/api/slash-command', { command: 'kill', argsText: 'QA Frost Beetle' }),
            { type: 'save', name: 'active_save' }, { type: 'reload', name: 'active_reload' },
            check(namedStatus('add_frostbite'), namedStatus('damage_player'), namedStatus('kill_frost'),
                { type: 'equals', source: 'after', path: 'player.payload.player.health', equals: 32 },
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.statusEffects', where: { name: 'Frostbite', duration: 30 }, equals: 1 },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.frostBeetleId', path: 'isDead', equals: true },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.frostBeetleId', path: 'health', equals: 0 }),
            snapshot('reloaded_combat'),
            chat('next', 'I brace and hold position for one brief combat beat. I do not attack, move, flee, use an item, or end combat; let configured living NPC actors run afterward.'),
            check(namedStatus('next'),
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.frostBeetleId', path: 'isDead', equals: true },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.frostBeetleId', path: 'health', equals: 0 },
                { type: 'attackResultCount', source: 'responses.next', path: 'payload.toolInvocations', where: { attacker: 'QA Frost Beetle' }, equals: 0 },
                { type: 'attackResultCount', source: 'responses.next', path: 'payload.toolInvocations', where: { attacker: 'QA Ash Beetle' }, equals: 1 },
                { type: 'arrayObjectCount', source: 'responses.next', path: 'payload.toolInvocations', where: { metadata: { error: true } }, equals: 0 },
                { type: 'arrayObjectCount', source: 'responses.next', path: 'payload.npcTurns', where: { npcId: '$fixture.shieldhandId' }, equals: 1 },
                { type: 'exactDelta', path: 'calendar.payload.worldTime.timeMinutes', delta: 1, beforeSource: 'snapshots.reloaded_combat', afterSource: 'after' },
                ...clean())],
        humanReview: ['Confirm no post-reload combat narration gives the dead Frost Beetle an active turn.']
    })
];

const party = [
    define('PARTY-1-recruit-local-alias', {
        scenario: 'party', fixture: 'party-membership-lifecycle', configProfile: 'vehicle-mechanics',
        description: 'Recruit a willing local NPC through an alias and canonical party tool mutation.',
        steps: [chat('recruit', 'I ask Skylark to join my party. She has already agreed for this scenario, so have her accept using the canonical party-membership mechanic. We stay here.'),
            check(namedStatus('recruit'),
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.partyMembers', where: { id: '$fixture.larkId' }, equals: 1 },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.larkId', path: 'isInPlayerParty', equals: true },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.larkId', path: 'wasEverInPlayerParty', equals: true },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.larkId', path: 'locationId', equals: null },
                { type: 'notIncludes', source: 'after', path: 'currentLocation.payload.location.npcIds', value: '$fixture.larkId' },
                ...clean())]
    }),
    define('PARTY-2-move-with-party', {
        scenario: 'party', fixture: 'party-membership-lifecycle', configProfile: 'vehicle-mechanics',
        description: 'An existing party member remains attached through ordinary player movement.',
        steps: [request('add', 'POST', '/api/player/party', { ownerId: '$fixture.playerId', memberId: '$fixture.larkId' }),
            snapshot('before_move'),
            request('move', 'POST', '/api/player/move', { destinationId: 'loc_10', expectedOriginLocationId: '$fixture.locationId', accompanyingCharacters: ['$fixture.larkAlias'] }),
            check(namedStatus('add'), namedStatus('move'),
                { type: 'equals', source: 'after', path: 'player.payload.player.locationId', equals: 'loc_10' },
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.partyMembers', where: { id: '$fixture.larkId' }, equals: 1 },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.larkId', path: 'isInPlayerParty', equals: true },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.larkId', path: 'locationId', equals: null },
                { type: 'notIncludes', source: 'after', path: 'currentLocation.payload.location.npcIds', value: '$fixture.larkId' },
                { type: 'includes', source: 'after', path: 'currentLocation.payload.location.npcIds', value: '$fixture.distantMossId' },
                { type: 'exactDelta', path: 'calendar.payload.worldTime.timeMinutes', delta: 10, beforeSource: 'snapshots.before_move', afterSource: 'after' },
                ...clean())]
    }),
    define('PARTY-3-dismiss-local', {
        scenario: 'party', fixture: 'party-membership-lifecycle', configProfile: 'vehicle-mechanics',
        description: 'Dismiss an existing party member and place them as a local NPC at the player location.',
        steps: [request('add', 'POST', '/api/player/party', { ownerId: '$fixture.playerId', memberId: '$fixture.larkId' }),
            chat('dismiss', 'I tell Skylark she can leave my party now. She agrees to stay here. Remove her through the canonical party mechanic and do nothing else.'),
            check(namedStatus('dismiss'),
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.partyMembers', where: { id: '$fixture.larkId' }, equals: 0 },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.larkId', path: 'locationId', equals: '$fixture.locationId' },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.larkId', path: 'isInPlayerParty', equals: false },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.larkId', path: 'wasEverInPlayerParty', equals: true },
                { type: 'includes', source: 'after', path: 'currentLocation.payload.location.npcIds', value: '$fixture.larkId' },
                ...clean())]
    }),
    define('PARTY-4-remote-add-by-alias', {
        scenario: 'party', fixture: 'party-membership-lifecycle', configProfile: 'vehicle-mechanics',
        description: 'The party tool resolves a remote NPC alias and adds that exact actor without moving the player.',
        steps: [snapshot('before_add'), chat('remote_add', '@@ PARTY BEHAVIOR TEST. Call updatePartyMembers exactly once to add the existing NPC identified by alias Moss to Baato\'s party. Do not move the player, advance time, or mutate anything else.'),
            request('old_location', 'GET', '/api/locations/loc_10'),
            check(namedStatus('remote_add'),
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.partyMembers', where: { id: '$fixture.distantMossId' }, equals: 1 },
                { type: 'equals', source: 'after', path: 'player.payload.player.locationId', equalsFrom: { source: 'snapshots.before_add', path: 'player.payload.player.locationId' } },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.distantMossId', path: 'locationId', equals: null },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.distantMossId', path: 'wasEverInPlayerParty', equals: true },
                { type: 'notIncludes', source: 'after', path: 'currentLocation.payload.location.npcIds', value: '$fixture.distantMossId' },
                { type: 'notIncludes', source: 'responses.old_location', path: 'payload.location.npcIds', value: '$fixture.distantMossId' },
                ...clean())]
    }),
    define('PARTY-5-remote-remove-by-alias', {
        scenario: 'party', fixture: 'party-membership-lifecycle', configProfile: 'vehicle-mechanics',
        description: 'Removing a remotely recruited member by alias places them at the current player location.',
        steps: [request('add', 'POST', '/api/player/party', { ownerId: '$fixture.playerId', memberId: '$fixture.distantMossId' }),
            chat('remove', '@@ PARTY BEHAVIOR TEST. Call updatePartyMembers exactly once to remove the existing party member identified by alias Moss. Do not move the player or mutate anything else.'),
            check(namedStatus('remove'),
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.partyMembers', where: { id: '$fixture.distantMossId' }, equals: 0 },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.distantMossId', path: 'locationId', equals: '$fixture.locationId' },
                { type: 'includes', source: 'after', path: 'currentLocation.payload.location.npcIds', value: '$fixture.distantMossId' },
                ...clean())]
    }),
    define('PARTY-6-atomic-invalid-batch', {
        scenario: 'party', fixture: 'party-membership-lifecycle', configProfile: 'vehicle-mechanics',
        description: 'Unknown, duplicate, already-member, and opposing add/remove batches each reject atomically from an isolated restore.',
        steps: [{ type: 'save', name: 'baseline_save' },
            snapshot('before_unknown'),
            chat('unknown', '@@ PARTY-6 ATOMIC REJECTION TEST. Call updatePartyMembers exactly once with add set to ["QA Lark"] and remove set to ["QA Unknown Party NPC"]. This deliberately mixes one valid addition with one unknown removal target. Do not correct, retry, or make another mutation after the expected tool error. Report the structured error only.'),
            check(namedStatus('unknown'),
                { type: 'stateUnchanged', beforeSource: 'snapshots.before_unknown', afterSource: 'after', paths: ['calendar.payload.worldTime'] },
                { type: 'count', source: 'after', path: 'player.payload.player.partyMembers', equals: 0 },
                { type: 'arrayObjectCountAtLeast', source: 'responses.unknown', path: 'payload.toolInvocations', where: { metadata: { error: true } }, minimum: 1 }),
            { type: 'reload', name: 'duplicate_reload' }, snapshot('before_duplicate'),
            chat('duplicate', '@@ PARTY-6 ATOMIC REJECTION TEST. Call updatePartyMembers exactly once with add set to ["QA Lark", "Skylark"] and no removals. Both names deliberately resolve to the same canonical NPC. Do not correct, retry, or make another mutation after the expected tool error. Report the structured error only.'),
            check(namedStatus('duplicate'),
                { type: 'stateUnchanged', beforeSource: 'snapshots.before_duplicate', afterSource: 'after', paths: ['calendar.payload.worldTime'] },
                { type: 'count', source: 'after', path: 'player.payload.player.partyMembers', equals: 0 },
                { type: 'arrayObjectCountAtLeast', source: 'responses.duplicate', path: 'payload.toolInvocations', where: { metadata: { error: true } }, minimum: 1 }),
            { type: 'reload', name: 'already_reload' },
            request('existing_member', 'POST', '/api/player/party', { ownerId: '$fixture.playerId', memberId: '$fixture.distantMossId' }), snapshot('before_already'),
            chat('already', '@@ PARTY-6 ATOMIC REJECTION TEST. Call updatePartyMembers exactly once with add set to ["QA Lark", "Moss"] and no removals. QA Lark is a valid new addition, while Moss deliberately identifies an existing party member. Do not correct, retry, or make another mutation after the expected tool error. Report the structured error only.'),
            check(namedStatus('already'),
                { type: 'stateUnchanged', beforeSource: 'snapshots.before_already', afterSource: 'after', paths: ['calendar.payload.worldTime'] },
                { type: 'count', source: 'after', path: 'player.payload.player.partyMembers', equals: 1 },
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.partyMembers', where: { id: '$fixture.distantMossId' }, equals: 1 },
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.partyMembers', where: { id: '$fixture.larkId' }, equals: 0 },
                { type: 'arrayObjectCountAtLeast', source: 'responses.already', path: 'payload.toolInvocations', where: { metadata: { error: true } }, minimum: 1 }),
            { type: 'reload', name: 'same_target_reload' }, snapshot('before_same_target'),
            chat('same_target', '@@ PARTY-6 ATOMIC REJECTION TEST. Call updatePartyMembers exactly once with add set to ["QA Lark"] and remove set to ["Skylark"]. Both names deliberately resolve to the same canonical NPC in opposing operations. Do not correct, retry, or make another mutation after the expected tool error. Report the structured error only.'),
            check(namedStatus('same_target'),
                { type: 'stateUnchanged', beforeSource: 'snapshots.before_same_target', afterSource: 'after', paths: ['calendar.payload.worldTime'] },
                { type: 'count', source: 'after', path: 'player.payload.player.partyMembers', equals: 0 },
                { type: 'arrayObjectCountAtLeast', source: 'responses.same_target', path: 'payload.toolInvocations', where: { metadata: { error: true } }, minimum: 1 },
                { type: 'noRealtimeErrors' },
                {
                    type: 'noUnexpectedErrorLogs',
                    allowedPrefixes: ['ERROR_tool_call_failed_generic_prompt_updatePartyMembers_'],
                    allowRecoveredProviderRetries: true
                })]
    }),
    define('PARTY-7-dead-member-travel', {
        scenario: 'party', fixture: 'party-membership-lifecycle', configProfile: 'vehicle-mechanics',
        description: 'A dead retained party member is not revived or moved as a living companion during travel.',
        steps: [request('add', 'POST', '/api/player/party', { ownerId: '$fixture.playerId', memberId: '$fixture.larkId' }), request('kill', 'POST', '/api/slash-command', { command: 'kill', argsText: 'QA Lark' }),
            snapshot('before_move'),
            chat('move', 'I travel from Ember Hollow Outskirts to Ember Hollow Riverbank. Do not move or revive any dead character. Use the normal player-action travel machinery and do nothing else.'),
            check(namedStatus('move'),
                { type: 'equals', source: 'after', path: 'player.payload.player.locationId', equals: 'loc_10' },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.larkId', path: 'isDead', equals: true },
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.partyMembers', where: { id: '$fixture.larkId' }, equals: 1 },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.larkId', path: 'locationId', equals: null },
                { type: 'notIncludes', source: 'after', path: 'currentLocation.payload.location.npcIds', value: '$fixture.larkId' },
                { type: 'entityArrayObjectCount', source: 'after', collection: 'players', id: '$fixture.playerId', path: 'partyMembers', where: { id: '$fixture.larkId', isDead: true }, equals: 1 },
                { type: 'exactDelta', path: 'calendar.payload.worldTime.timeMinutes', delta: 10, beforeSource: 'snapshots.before_move', afterSource: 'after' },
                ...clean())]
    }),
    define('PARTY-8-save-reload', {
        scenario: 'party', fixture: 'party-membership-lifecycle',
        description: 'Local, remote-origin, and dead-member party identity survives normal save/reload serialization.',
        steps: [request('add_lark', 'POST', '/api/player/party', { ownerId: '$fixture.playerId', memberId: '$fixture.larkId' }), request('add_moss', 'POST', '/api/player/party', { ownerId: '$fixture.playerId', memberId: '$fixture.distantMossId' }), request('kill_lark', 'POST', '/api/slash-command', { command: 'kill', argsText: 'QA Lark' }),
            { type: 'save', name: 'party_save' }, { type: 'reload', name: 'party_reload' },
            check({ type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.partyMembers', where: { id: '$fixture.larkId' }, equals: 1 },
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.partyMembers', where: { id: '$fixture.distantMossId' }, equals: 1 },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.larkId', path: 'isDead', equals: true },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.larkId', path: 'isInPlayerParty', equals: true },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.larkId', path: 'wasEverInPlayerParty', equals: true },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.larkId', path: 'aliases', equals: ['$fixture.larkAlias'] },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.distantMossId', path: 'isInPlayerParty', equals: true },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.distantMossId', path: 'wasEverInPlayerParty', equals: true },
                { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.distantMossId', path: 'aliases', equals: ['$fixture.distantAlias'] },
                { type: 'notIncludes', source: 'after', path: 'currentLocation.payload.location.npcIds', value: '$fixture.larkId' },
                { type: 'notIncludes', source: 'after', path: 'currentLocation.payload.location.npcIds', value: '$fixture.distantMossId' },
                ...clean())]
    })
];

const questOfferPrompt = [
    '@@ QUEST OFFER MECHANICS TEST.',
    'Call createQuest exactly once with Tsubaki Morino as giver.',
    'The concise summary must offer Baato a quest called QA Benchmark Errand with exactly one objective:',
    'show Tsubaki Morino the Brass Key already in his possession.',
    'The reward preview is 3 Paws and 4 XP.',
    'Do not create entities, complete the objective, grant rewards, move anyone, or advance time.'
].join(' ');
const questAccepted = Object.freeze({ roll: null, questAccepted: true, confirmed: false });

function pickupRecord(name = 'pickup') {
    return chat(name, 'I pick up QA Sealed Record and do nothing else.');
}

function giveRecord(name = 'give') {
    return chat(name, 'I hand QA Sealed Record to QA Archivist and do nothing else.');
}

function reportRecord(name = 'report') {
    return chat(name, 'I report to QA Archivist that I completed the QA Sealed Record delivery and ask them to close out the job. I do nothing else.');
}

function completedQuestAssertions() {
    return [
        { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, equals: 0 },
        { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.completedQuests', where: { id: '$fixture.questId', completed: true, rewardClaimed: true }, equals: 1 },
        { type: 'entityArrayObjectCount', source: 'after', collection: 'players', id: '$fixture.playerId', path: 'inventory', where: { metadata: { questRewardQuestId: '$fixture.questId' } }, equals: 1 },
        { type: 'equals', source: 'after', path: 'player.payload.player.factionStandings.faction_8', equals: 5 },
        { type: 'entityField', source: 'after', collection: 'players', id: '$fixture.archivistId', path: 'dispositionsTowardPlayer.platonic', equals: 12 }
    ];
}

const quests = [
    define('QUEST-1-decline', {
        scenario: 'quests', fixture: 'quest-preoffer-baseline', configProfile: 'quest-mechanics',
        description: 'Declining a generated quest offer leaves the existing quest list and reward-bearing state unchanged.',
        steps: [snapshot('before_offer'), chat('offer', questOfferPrompt),
            check(namedStatus('offer'),
                { type: 'count', source: 'after', path: 'player.payload.player.quests', equals: 1 },
                { type: 'stateUnchanged', beforeSource: 'snapshots.before_offer', afterSource: 'after', paths: ['player.payload.player.quests', 'player.payload.player.currency', 'player.payload.player.experience'] },
                { type: 'arrayObjectCount', source: 'responses.offer', path: 'payload.toolInvocations', where: { name: 'createQuest', metadata: { status: 'declined' } }, equals: 1 },
                ...clean())]
    }),
    define('QUEST-2-accept', {
        scenario: 'quests', fixture: 'quest-preoffer-baseline', configProfile: 'quest-mechanics',
        description: 'Accepting the same offer adds one uncompleted quest with a canonical giver and reward preview but grants nothing yet.',
        steps: [snapshot('before_offer'), chat('offer', questOfferPrompt, questAccepted),
            check(namedStatus('offer'),
                { type: 'count', source: 'after', path: 'player.payload.player.quests', equals: 2 },
                { type: 'arrayObjectFieldCount', source: 'after', path: 'player.payload.player.quests', where: { giverName: 'Tsubaki Morino' }, field: 'objectives', equals: 1 },
                { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.quests', where: { completed: false, rewardClaimed: false, giverName: 'Tsubaki Morino' }, equals: 1 },
                { type: 'stateUnchanged', beforeSource: 'snapshots.before_offer', afterSource: 'after', paths: ['player.payload.player.currency', 'player.payload.player.experience'] },
                { type: 'arrayObjectCount', source: 'responses.offer', path: 'payload.toolInvocations', where: { name: 'createQuest', metadata: { status: 'success' } }, equals: 1 },
                ...clean())]
    }),
    define('QUEST-3-partial-objective', {
        scenario: 'quests', fixture: 'quest-archive-lifecycle', configProfile: 'quest-mechanics',
        description: 'Picking up the sealed record completes only the matching objective and leaves the quest active.',
        steps: [pickupRecord(),
            check(namedStatus('pickup'),
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, field: 'objectives.0.completed', equals: true },
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, field: 'objectives.1.completed', equals: false },
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, field: 'objectives.2.completed', equals: false },
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, field: 'completed', equals: false },
                { type: 'entityField', source: 'after', collection: 'things', id: '$fixture.recordId', path: 'metadata.ownerId', equals: '$fixture.playerId' },
                ...clean())]
    }),
    define('QUEST-4-pause', {
        scenario: 'quests', fixture: 'quest-archive-lifecycle', configProfile: 'quest-mechanics',
        description: 'Paused quests ignore an otherwise matching delivery; unpausing lets the established state satisfy it later.',
        steps: [pickupRecord(), request('pause', 'POST', '/api/quest/edit', { questId: '$fixture.questId', paused: true }), giveRecord('paused_delivery'),
            check(namedStatus('pause'), namedStatus('paused_delivery'),
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, field: 'paused', equals: true },
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, field: 'objectives.1.completed', equals: false }),
            request('unpause', 'POST', '/api/quest/edit', { questId: '$fixture.questId', paused: false }),
            chat('recognize_delivery', 'I remind QA Archivist that I already handed over QA Sealed Record. We stay here and do nothing else.'),
            check(namedStatus('unpause'), namedStatus('recognize_delivery'),
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, field: 'paused', equals: false },
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, field: 'objectives.1.completed', equals: true },
                ...clean())]
    }),
    define('QUEST-5-complete', {
        scenario: 'quests', fixture: 'quest-archive-lifecycle', configProfile: 'quest-mechanics',
        description: 'Completing all ordered objectives archives the quest and applies every configured reward exactly once.',
        steps: [snapshot('unrewarded'), pickupRecord(), giveRecord(), reportRecord(),
            check(namedStatus('pickup'), namedStatus('give'), namedStatus('report'),
                ...completedQuestAssertions(),
                { type: 'exactDelta', path: 'player.payload.player.currency', delta: 10, beforeSource: 'snapshots.unrewarded', afterSource: 'after' },
                { type: 'exactDelta', path: 'player.payload.player.experience', delta: 17, beforeSource: 'snapshots.unrewarded', afterSource: 'after' },
                ...clean())],
        humanReview: ['Confirm the completion/reward prose agrees materially with the structured quest and reward state without judging exact wording.']
    }),
    define('QUEST-6-duplicate-prevention', {
        scenario: 'quests', fixture: 'quest-archive-lifecycle', configProfile: 'quest-mechanics',
        description: 'A later quest-check turn cannot grant the completed quest rewards a second time.',
        steps: [pickupRecord(), giveRecord(), reportRecord(), snapshot('rewarded'),
            chat('later_turn', 'Baato waits in place for exactly one minute, adjusting the courier satchel strap. He does not travel, deliver anything, complete any other task, spend money, use an item, or interact with QA Archivist.'),
            check(namedStatus('later_turn'),
                ...completedQuestAssertions(),
                { type: 'stateUnchanged', beforeSource: 'snapshots.rewarded', afterSource: 'after', paths: ['player.payload.player.currency', 'player.payload.player.experience', 'player.payload.player.completedQuests', 'player.payload.player.inventory'] },
                ...clean())]
    }),
    define('QUEST-7-failure-edit-path', {
        scenario: 'quests', fixture: 'quest-archive-lifecycle', configProfile: 'quest-mechanics',
        description: 'An edited impossible objective stays incomplete and restoring its definition does not duplicate the quest.',
        steps: [request('impossible', 'POST', '/api/quest/edit', {
            questId: '$fixture.questId',
            objectives: [
                { id: '$fixture.pickupObjectiveId', description: 'Pick up QA Sealed Record. [item: QA Sealed Record]', completed: true, optional: false },
                { id: '$fixture.giveObjectiveId', description: 'Give QA Sealed Record to QA Archivist. [item: QA Sealed Record] [person: QA Archivist]', completed: true, optional: false },
                { id: '$fixture.reportObjectiveId', description: 'Receive a signed clearance from the nonexistent QA Null Registrar at the nonexistent QA Null Annex.', completed: false, optional: false }
            ]
        }),
        chat('wait', 'Baato waits in place for exactly one minute. He does not receive any signed clearance, does not visit any annex, and does not claim to have met the remaining quest condition.'),
        check(namedStatus('impossible'), namedStatus('wait'),
            { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, field: 'objectives.2.completed', equals: false },
            { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, field: 'completed', equals: false }),
        request('restore', 'POST', '/api/quest/edit', {
            questId: '$fixture.questId',
            objectives: [
                { id: '$fixture.pickupObjectiveId', description: 'Pick up QA Sealed Record. [item: QA Sealed Record]', completed: true, optional: false },
                { id: '$fixture.giveObjectiveId', description: 'Give QA Sealed Record to QA Archivist. [item: QA Sealed Record] [person: QA Archivist]', completed: true, optional: false },
                { id: '$fixture.reportObjectiveId', description: 'Return to Ember Hollow Outskirts and report completion to QA Archivist. [location: Ember Hollow Outskirts] [person: QA Archivist]', completed: false, optional: false }
            ]
        }),
        check(namedStatus('restore'),
            { type: 'arrayObjectCount', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, equals: 1 },
            ...clean())]
    }),
    define('QUEST-8-event-acceleration', {
        scenario: 'quests', fixture: 'quest-archive-lifecycle', configProfile: 'quest-mechanics',
        description: 'An objective-completion event accelerates quest checking even when the ordinary interval is set far away.',
        steps: [request('interval', 'PUT', '/api/game-config-override', { yaml: 'quest_checks:\n  enabled: true\n  interval: 99\n' }), pickupRecord(),
            check(namedStatus('interval'), namedStatus('pickup'),
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, field: 'objectives.0.completed', equals: true },
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, field: 'objectives.1.completed', equals: false },
                { type: 'promptRunCount', labelIncludes: 'quest_check', equals: 1 },
                ...clean())]
    }),
    define('QUEST-9-save-reload', {
        scenario: 'quests', fixture: 'quest-archive-lifecycle', configProfile: 'quest-mechanics',
        description: 'Partial and completed quest states, objective IDs, giver metadata, and one-time rewards survive save/reload.',
        steps: [pickupRecord(), request('pause_partial', 'POST', '/api/quest/edit', { questId: '$fixture.questId', paused: true }), { type: 'save', name: 'partial_save' }, { type: 'reload', name: 'partial_reload' },
            check({ type: 'arrayObjectField', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, field: 'objectives.0.id', equals: '$fixture.pickupObjectiveId' },
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, field: 'objectives.0.completed', equals: true },
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, field: 'giverId', equals: '$fixture.archivistId' },
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, field: 'paused', equals: true },
                { type: 'arrayObjectField', source: 'after', path: 'player.payload.player.quests', where: { id: '$fixture.questId' }, field: 'rewardClaimed', equals: false }),
            request('unpause_partial', 'POST', '/api/quest/edit', { questId: '$fixture.questId', paused: false }),
            giveRecord(), reportRecord(), { type: 'save', name: 'completed_save' }, { type: 'reload', name: 'completed_reload' },
            check(...completedQuestAssertions(), ...clean())]
    })
];

const deterministic = [
    define('NEED-7-invalid-tinybrain-response', {
        scenario: 'need-bars',
        description: 'The retained forced-output suite retries six semantically invalid TinyBrain character responses and accepts only the final valid one.',
        steps: [
            { type: 'nodeTest', name: 'need_parser_tests', files: ['tests/events_need_bar_tinybrain.test.js', 'tests/tiny_brain_prompt_parsers.test.js'] },
            check(namedStatus('need_parser_tests'), { type: 'equals', source: 'responses.need_parser_tests', path: 'payload.success', equals: true })
        ]
    }),
    define('REL-7-housekeeping-lifecycle', {
        scenario: 'relationships-factions',
        description: 'The retained lifecycle suite sends add, update, and delete through the real housekeeping parser, executor, log formatter, and history filter.',
        steps: [
            { type: 'nodeTest', name: 'relationship_lifecycle_test', files: ['tests/rel7.housekeeping_relationship_lifecycle.test.js'] },
            check(namedStatus('relationship_lifecycle_test'), { type: 'equals', source: 'responses.relationship_lifecycle_test', path: 'payload.success', equals: true })
        ]
    })
];

export const scenarios = [
    ...vehicle,
    ...containers,
    ...inventory,
    ...equipment,
    ...commerce,
    ...crafting,
    ...combat,
    ...party,
    ...quests,
    ...deterministic
];
