# Things & Inventory API

Common payloads: see `docs/api/common.md`.

## POST /api/things
Create a new thing.

Request:
- Body supports: `name`, `description`, `shortDescription`, `thingType`, `imageId`, `rarity`, `itemTypeDetail`, `metadata`, `slot`, `attributeBonuses`, `causeStatusEffect`, `causeStatusEffectOnTarget`, `causeStatusEffectOnEquipper`, `count`, `level`, `relativeLevel`, `statusEffects`, plus boolean flags (`isVehicle`, `isCraftingStation`, `isProcessingStation`, `isHarvestable`, `isSalvageable`).

Response:
- 200: `{ success: true, thing: Thing, message, imageNeedsGeneration }`
- 400: `{ success: false, error }`

Notes:
- When `causeStatusEffectOnTarget`/`causeStatusEffectOnEquipper` are supplied, `causeStatusEffect` is treated as legacy input.

## GET /api/things
List all things (optionally by type).

Request:
- Query: `type` (`item` or `scenery`)

Response:
- 200: `{ success: true, things: Thing[], count }`
- 400/500 with `{ success: false, error }`

## GET /api/things/:id
Fetch a thing by id.

Response:
- 200: `{ success: true, thing: Thing }`
- 404: `{ success: false, error }`

## PUT /api/things/:id
Update a thing.

Request:
- Body supports: `name`, `description`, `shortDescription`, `thingType`, `imageId`, `rarity`, `itemTypeDetail`, `metadata`, `slot`, `attributeBonuses`, `causeStatusEffect`, `causeStatusEffectOnTarget`, `causeStatusEffectOnEquipper`, `count`, `level`, `relativeLevel`, `statusEffects`, plus boolean flags.

Response:
- 200: `{ success: true, thing: Thing, message, imageNeedsUpdate }`
- 400/404 with `{ success: false, error }`

Notes:
- `causeStatusEffect` is treated as a legacy payload and mapped internally when provided.

## POST /api/things/:id/separate
Run the `thing-separate` prompt against an item and replace it with the parsed output items.

Request:
- No body required.

Response:
- 200: `{ success: true, noChanges: false, sourceThingId, things: Thing[], location?: LocationResponse, owner?: NpcProfile, message }`
- 200: `{ success: true, noChanges: true, things: [], message }` when the prompt returns an empty `<items>` list.
- 400/404/500 with `{ success: false, error }`

Notes:
- Only item-type things can be separated.
- Inventory-bound source items reject prompt output that contains scenery entries.
- Prompt output must use a positive integer `count` for every returned item; invalid prompt output fails the request instead of silently no-oping.
- Prompt output may be either a normal `<items>` list or a top-level `<stack>` node. `<stack>` updates only `name`, `description`, `shortDescription`, and `count`; all other stats are preserved directly from the source item without attribute-bonus rescaling.
- When the source item already has `count > 1`, the route skips the prompt entirely and splits it into that many identical `count: 1` items, reusing the original `imageId`, copying the source item's current `statusEffects` onto every split item without re-enrichment, and leaving the source `value` unchanged on each copied stack item.

## POST /api/things/:id/split-stack
Split an item stack into a second stack with an exact requested quantity.

Request:
- Body: `{ quantity: integer }`

Response:
- 200: `{ success: true, noChanges: false, sourceThingId, splitThingId, things: Thing[], location?: LocationResponse, owner?: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

Notes:
- Only item-type things can be split.
- `quantity` must be a positive integer strictly less than the source stack count.
- Split stacks are created via `Thing.copy(...)`, so they keep the same image and hashable item data as the source stack. Only `count`/placement metadata changes.
- Stack splitting leaves existing `value` metadata unchanged.

## POST /api/things/:id/merge-stacks
Merge same-name, same-checksum stacks from the same inventory or location into the selected item stack.

Request:
- No body required.

Response:
- 200: `{ success: true, noChanges: false, sourceThingId, mergedThingIds: string[], things: Thing[], location?: LocationResponse, owner?: NpcProfile, message }`
- 200: `{ success: true, noChanges: true, sourceThingId, mergedThingIds: [], things: Thing[], location?: LocationResponse, owner?: NpcProfile, message }` when no mergeable stacks exist.
- 400/404/500 with `{ success: false, error }`

Notes:
- Only item-type things can be merged.
- Equipped items are rejected and are excluded from merge candidate discovery.
- Merge candidates must share the same `name`, `checksum`, and container (same owner inventory or same location).
- Merging only increases the surviving stack's `count`; existing `value` metadata is left unchanged.

## POST /api/things/:id/give
Move an item into an inventory.

Request:
- Body: `{ ownerId: string, ownerType?: string, locationId?: string }`

Response:
- 200: `{ success: true, thing: Thing, owner: NpcProfile, location?: LocationResponse, message }`
- 400/404/409/500 with `{ success: false, error }`

## POST /api/things/:id/drop
Drop an item into a location.

Request:
- Body: `{ ownerId?: string, ownerType?: string, locationId?: string }`

Response:
- 200: `{ success: true, thing: Thing, location: LocationResponse, message, owner?: NpcProfile }`
- 400/404/500 with `{ success: false, error }`

## POST /api/things/:id/teleport
Teleport a thing to a location (removing from inventories).

Request:
- Body: `{ locationId: string }`

Response:
- 200: `{ success: true, thing: Thing, destination: LocationResponse, previousLocation: LocationResponse, removedOwnerIds: string[], locationIds: string[], message }`
- 400/404/500 with `{ success: false, error }`

## DELETE /api/things/:id
Delete a thing.

Response:
- 200: `{ success: true, message, locationIds, playerIds, npcIds }`
- 400/404/500 with `{ success: false, error }`

## GET /api/things/scenery
List all scenery things.

Response:
- 200: `{ success: true, things: Thing[], count }`
- 500: `{ success: false, error }`

## GET /api/things/items
List all item things.

Response:
- 200: `{ success: true, things: Thing[], count }`
- 500: `{ success: false, error }`

## POST /api/things/:id/image
Trigger image generation for a thing.

Response:
- 200: `{ success: true, thing: Thing, imageGeneration, message }`
- 202: `{ success: false, thing: Thing, imageGeneration, message }` (existing job)
- 409: `{ success: false, error, reason?, thing }` (not eligible or skipped)
- 404/500 with `{ success: false, error }`
