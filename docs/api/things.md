# Things & Inventory API

Common payloads: see `docs/api/common.md`.

## POST /api/things
Create a new thing.

Request:
- Body supports: `name`, `description`, `shortDescription`, `thingType`, `imageId`, `rarity`, `itemTypeDetail`, `metadata`, `slot`, `attributeBonuses`, `causeStatusEffect`, `causeStatusEffectOnTarget`, `causeStatusEffectOnEquipper`, `level`, `relativeLevel`, `statusEffects`, plus boolean flags (`isVehicle`, `isCraftingStation`, `isProcessingStation`, `isHarvestable`, `isSalvageable`).

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
- Body supports: `name`, `description`, `thingType`, `imageId`, `rarity`, `itemTypeDetail`, `metadata`, `slot`, `attributeBonuses`, `causeStatusEffect`, `causeStatusEffectOnTarget`, `causeStatusEffectOnEquipper`, `level`, `relativeLevel`, `statusEffects`, plus boolean flags.

Response:
- 200: `{ success: true, thing: Thing, message, imageNeedsUpdate }`
- 400/404 with `{ success: false, error }`

Notes:
- `causeStatusEffect` is treated as a legacy payload and mapped internally when provided.

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
