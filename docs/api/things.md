# Things & Inventory API

Common payloads: see `docs/api/common.md`.

## POST /api/things
Create a new thing.

Request:
- Body supports: `name`, `description`, `shortDescription`, `thingType`, `imageId`, `rarity`, `itemTypeDetail`, `metadata`, `slot`, `attributeBonuses`, `causeStatusEffect`, `causeStatusEffectOnTarget`, `causeStatusEffectOnEquipper`, `count`, `level`, `relativeLevel`, `statusEffects`, plus boolean flags (`isVehicle`, `isCraftingStation`, `isProcessingStation`, `isHarvestable`, `isSalvageable`, `isContainer`).

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
- Body supports: `name`, `description`, `shortDescription`, `thingType`, `imageId`, `rarity`, `itemTypeDetail`, `metadata`, `slot`, `attributeBonuses`, `causeStatusEffect`, `causeStatusEffectOnTarget`, `causeStatusEffectOnEquipper`, `count`, `level`, `relativeLevel`, `statusEffects`, plus boolean flags (`isVehicle`, `isCraftingStation`, `isProcessingStation`, `isHarvestable`, `isSalvageable`, `isContainer`).

Response:
- 200: `{ success: true, thing: Thing, message, imageNeedsUpdate }`
- 400/404 with `{ success: false, error }`

Notes:
- `causeStatusEffect` is treated as a legacy payload and mapped internally when provided.

## POST /api/things/:id/separate
Run the `thing-separate` prompt against an item or scenery thing and replace it with the parsed output things.

Request:
- No body required.

Response:
- 200: `{ success: true, noChanges: false, sourceThingId, things: Thing[], location?: LocationResponse, owner?: NpcProfile, container?: Thing, contents?: Thing[], message }`
- 200: `{ success: true, noChanges: true, things: [], message }` when the prompt returns an empty `<items>` list.
- 400/404/500 with `{ success: false, error }`

Notes:
- Only item or scenery things can be separated.
- Inventory-bound source things reject prompt output that contains scenery entries.
- When separated output contains one or more containers, the first returned container receives the rest of the returned item-type things. Returned scenery remains at the source destination because container inventories only hold items.
- Prompt output must use a positive integer `count` for every returned thing; invalid prompt output fails the request instead of silently no-oping.
- Prompt output may be either a normal `<items>` list or a top-level `<stack>` node. `<stack>` updates only `name`, `description`, `shortDescription`, and `count`; all other stats are preserved directly from the source thing without attribute-bonus rescaling.
- When the source thing already has `count > 1`, the route skips the prompt entirely and splits it into that many identical `count: 1` things, reusing the original `imageId`, copying the source thing's current `statusEffects` onto every split thing without re-enrichment, and leaving the source `value` unchanged on each copied stack entry.
- Source things inside containers preserve their source container. Non-empty container things cannot be separated.

## POST /api/things/:id/split-stack
Split an item stack into a second stack with an exact requested quantity.

Request:
- Body: `{ quantity: integer }`

Response:
- 200: `{ success: true, noChanges: false, sourceThingId, splitThingId, things: Thing[], location?: LocationResponse, owner?: NpcProfile, container?: Thing, contents?: Thing[], message }`
- 400/404/500 with `{ success: false, error }`

Notes:
- Only item-type things can be split.
- `quantity` must be a positive integer strictly less than the source stack count.
- Split stacks are created via `Thing.copy(...)`, so they keep the same image and hashable item data as the source stack. Only `count`/placement metadata changes.
- Stack splitting leaves existing `value` metadata unchanged.
- Source stacks inside containers preserve their source container. Non-empty container stacks cannot be split.

## POST /api/things/:id/merge-stacks
Merge same-name, same-checksum stacks from the same inventory or location into the selected item stack.

Request:
- No body required.

Response:
- 200: `{ success: true, noChanges: false, sourceThingId, mergedThingIds: string[], things: Thing[], location?: LocationResponse, owner?: NpcProfile, container?: Thing, contents?: Thing[], message }`
- 200: `{ success: true, noChanges: true, sourceThingId, mergedThingIds: [], things: Thing[], location?: LocationResponse, owner?: NpcProfile, container?: Thing, contents?: Thing[], message }` when no mergeable stacks exist.
- 400/404/500 with `{ success: false, error }`

Notes:
- Only item-type things can be merged.
- Equipped items are rejected and are excluded from merge candidate discovery.
- Merge candidates must share the same `name`, `checksum`, and container (same owner inventory, same location, or same thing container).
- Merging only increases the surviving stack's `count`; existing `value` metadata is left unchanged.
- Container items are excluded from merge operations.

## GET /api/things/:containerId/container
Fetch a container thing and the two-column inventory payload for the current player.

Response:
- 200: `{ success: true, container: Thing, contents: Thing[], player: NpcProfile, playerInventory: Thing[] }`
- 400: `{ success: false, error }` when the target thing is not a container.
- 404/500 with `{ success: false, error }`

Notes:
- Only things with `isContainer: true` can be opened.
- `contents` contains item-type things held by the container; scenery containers can hold items, but scenery itself cannot be contained.

## POST /api/things/:containerId/container/move-in
Move a whole item stack from the current player's unequipped inventory into a container.

Request:
- Body: `{ thingId: string }` or `{ thingIds: string[] }`

Response:
- 200: `{ success: true, container: Thing, contents: Thing[], player: NpcProfile, playerInventory: Thing[] }`
- 400/404/409/500 with `{ success: false, error }`

Notes:
- When `thingIds` is provided, the route validates the full list before moving anything and returns one refreshed container payload.
- Rejects non-container destinations, missing items, non-item contents, equipped items, duplicate containment, self-containment, descendant cycles, and missing current player state.
- Partial movement is handled by splitting the stack first, then moving the split stack.

## POST /api/things/:containerId/container/move-out
Move a whole contained item stack into the current player's inventory.

Request:
- Body: `{ thingId: string }` or `{ thingIds: string[] }`

Response:
- 200: `{ success: true, container: Thing, contents: Thing[], player: NpcProfile, playerInventory: Thing[] }`
- 400/404/409/500 with `{ success: false, error }`

Notes:
- When `thingIds` is provided, the route validates the full list before moving anything and returns one refreshed container payload.
- The moved item is removed from the container, has `metadata.containerId` cleared, and gains player inventory ownership metadata.

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
- 200: `{ success: true, message, locationIds, playerIds, npcIds, containerIds }`
- 400/404/409/500 with `{ success: false, error }`

Notes:
- Deletes remove the thing from known locations, inventories, and containers before dropping the static Thing index entry.
- Non-empty containers are rejected with `409`; contained non-container items can be deleted and are removed from their parent container.

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
