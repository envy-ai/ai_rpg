# Things & Inventory API

Common payloads: see `docs/api/common.md`.

## POST /api/things
Create a new thing.

Request:
- Body supports: `name`, `description`, `shortDescription`, `thingType`, `imageId`, `rarity`, `itemTypeDetail`, `metadata`, `slot`, `attributeBonuses`, `causeStatusEffect`, `causeStatusEffectOnTarget`, `causeStatusEffectOnEquipper`, `count`, `level`, `relativeLevel`, `containerContents`, `statusEffects`, plus boolean flags (`isVehicle`, `isCraftingStation`, `isProcessingStation`, `isHarvestable`, `isSalvageable`, `isContainer`, `requiresCheckToOpen`) and registered Thing fields exposed to create/edit flows.

Response:
- 200: `{ success: true, thing: Thing, message, imageNeedsGeneration }`
- 400: `{ success: false, error }`

Notes:
- When `causeStatusEffectOnTarget`/`causeStatusEffectOnEquipper` are supplied, `causeStatusEffect` is treated as legacy input.
- Registered Thing fields with `clearThingSlotWhenPresent` clear `slot` when they are provided with a meaningful value.

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

## POST /api/mod-thing-context-actions/:actionId
Execute a registered mod-owned Thing context-menu action.

Request:
- Path `actionId` is the registry full id, such as `implants:install-implant`.
- Body: `{ thingId, context?, ownerId?, ownerType?, npcId?, locationId?, ...actionFields }`.

Response:
- 200: `{ success: true, actionId, result, thing, actor?, location? }`
- 400/404 with `{ success: false, error }`

Notes:
- The route looks up the action live from `ModExtensionRegistry` and calls its handler with the Thing, owner actor when resolvable, current player, runtime maps, and request context.
- Mod handlers are authoritative and should throw explicit errors for invalid owners, incompatible items, duplicate state, or unsupported contexts.
- The clicked `thingId` remains required for generic routing. Action-specific fields are passed through as `requestBody`; the bundled modules mod uses `baseItemId`, `moduleItemId`, `slotType`, `baseItemSource`, and `moduleItemSource` to install inventory or loose-location modules, splitting one module off a selected stack when needed, and removes modules from the visible base item by reading its `installedModuleIds` plus the selected `moduleItemId`.

## PUT /api/things/:id
Update a thing.

Request:
- Body supports: `name`, `description`, `shortDescription`, `thingType`, `imageId`, `rarity`, `itemTypeDetail`, `metadata`, `slot`, `attributeBonuses`, `causeStatusEffect`, `causeStatusEffectOnTarget`, `causeStatusEffectOnEquipper`, `count`, `level`, `relativeLevel`, `containerContents`, `statusEffects`, plus boolean flags (`isVehicle`, `isCraftingStation`, `isProcessingStation`, `isHarvestable`, `isSalvageable`, `isContainer`, `requiresCheckToOpen`) and registered Thing fields exposed to the edit modal.

Response:
- 200: `{ success: true, thing: Thing, message, imageNeedsUpdate }`
- 400/404 with `{ success: false, error }`

Notes:
- `causeStatusEffect` is treated as a legacy payload and mapped internally when provided.
- Registered Thing fields are written through `thing.setExtensionField(...)` when available.
- Registered Thing fields with `clearThingSlotWhenPresent` clear `slot` when they are provided with a meaningful value.

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
- Separated outputs opt out of automatic same-destination stack merging because the purpose of the route is to produce distinct separated things.

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
- Explicit split-stack placement opts out of automatic same-destination stack merging so the two stack fragments remain separate until one is moved or explicitly merged.

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
- If the container has pending `containerContents` seeds, this route runs the dedicated `thing-generator-contents` prompt once, creates all listed contents as real item Things inside the container, clears the pending seeds, then returns the refreshed contents. Empty sentinels such as `empty`, `none`, or `n/a` and zero-count seeds are discarded during parsing/loading, so loaded empty containers return normally without firing that prompt.
- This route remains the raw inventory fetch. Client UI calls the open-check route first for containers with `requiresCheckToOpen: true`.

## POST /api/things/:containerId/container/open-check
Resolve a checked opening attempt for a container before showing the container inventory UI.

Request:
- Body: `{ actionText: string, clientId?: string, requestId?: string }`

Response:
- 200: `{ success: true, opened, prose, container, locationRefreshRequested, eventChecks, requestId }`
- 200: `{ success: true, opened: true, skipped: true, container }` when the target is a container that does not require a check.
- 400/404/500 with `{ success: false, error }`

Notes:
- Only container Things can use this route, and `actionText` is required for checked containers.
- The server renders the `player-action-open-container` prompt through base context, logs it with `LLMClient.logPrompt()` under `player_action_open_container`, exposes regular prose information tools plus `resolveSkillCheck` / `resolveOpposedSkillCheck` even when legacy prompt checks are enabled elsewhere, and fails loudly if no skill check was recorded.
- The prompt returns `<containerOpenResult><success>...</success><permanentlyOpened>...</permanentlyOpened><prose>...</prose></containerOpenResult>`. Prose runs through the normal slop-removal pipeline, is stored visibly as a `player-action-open-container` chat entry, and then runs ordinary event checks. The `success` flag gates whether the client proceeds to `GET /api/things/:containerId/container`.
- When `success` and `permanentlyOpened` are both true, the route persists `requiresCheckToOpen: false` on the container so future UI opens skip this check. Temporary successes should return `permanentlyOpened: false`.

## POST /api/things/:containerId/container/move-in
Move a whole item stack from the current player's unequipped inventory or a loose current-location item into a container.

Request:
- Body: `{ thingId: string }` or `{ thingIds: string[] }`
- Optional `source`: `"player"` (default) or `"location"`.
- Optional `locationId`: required for `source: "location"` unless the current player location can be resolved.

Response:
- 200: `{ success: true, container: Thing, contents: Thing[], player: NpcProfile, playerInventory: Thing[], location?: LocationResponse }`
- 400/404/409/500 with `{ success: false, error }`

Notes:
- When `thingIds` is provided, the route validates the full list before moving anything and returns one refreshed container payload.
- Rejects non-container destinations, missing items, non-item contents, equipped items, duplicate containment, self-containment, descendant cycles, missing current player state, player-source items outside the current player's inventory, and location-source items that are not loose in the current location.
- Partial movement is handled by splitting the stack first, then moving the split stack.
- Moving an item stack into a container automatically merges it into an existing same-name/same-checksum stack in that container. Containers and equipped items are excluded from automatic merging.

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
- Moving a contained item stack into player inventory automatically merges it into an existing same-name/same-checksum stack in that inventory. Containers and equipped items are excluded from automatic merging.

## POST /api/things/:id/give
Move an item into an inventory.

Request:
- Body: `{ ownerId: string, ownerType?: string, locationId?: string }`

Response:
- 200: `{ success: true, thing: Thing, owner: NpcProfile, location?: LocationResponse, message }`
- 400/404/409/500 with `{ success: false, error }`

Notes:
- Moving an item into an inventory automatically merges it into an existing same-name/same-checksum stack owned by the destination actor. Containers and equipped items are excluded from automatic merging.

## POST /api/things/:id/drop
Drop an item into a location.

Request:
- Body: `{ ownerId?: string, ownerType?: string, locationId?: string }`

Response:
- 200: `{ success: true, thing: Thing, location: LocationResponse, message, owner?: NpcProfile }`
- 400/404/500 with `{ success: false, error }`

Notes:
- Dropping a contained item removes it from any containing Thing containers before adding it to the target location and clearing container ownership metadata.
- Dropping an item into a location automatically merges it into an existing loose same-name/same-checksum item stack in that location. Containers and equipped items are excluded from automatic merging.

## POST /api/things/:id/teleport
Teleport a thing to a location (removing from inventories).

Request:
- Body: `{ locationId: string }`

Response:
- 200: `{ success: true, thing: Thing, destination: LocationResponse, previousLocation: LocationResponse, removedOwnerIds: string[], locationIds: string[], message }`
- 400/404/500 with `{ success: false, error }`

Notes:
- Teleporting an item to a location uses the same automatic loose-location stack merge as dropping.

## DELETE /api/things/:id
Delete a thing.

Response:
- 200: `{ success: true, message, locationIds, playerIds, npcIds, containerIds }`
- 400/404/409/500 with `{ success: false, error }`

Notes:
- Deletes remove the thing from known locations, inventories, and containers before dropping the static Thing index entry.
- Non-empty containers are rejected with `409`; contained non-container items can be deleted and are removed from their parent container.
- The generic/scheduled chat tool `deleteThing({ thing })` delegates to this same deletion path after resolving an item/scenery target and receiving explicit client confirmation through `player_input_request` confirmation mode, so these protections and affected-id response fields remain authoritative.

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
- 409: `{ success: false, error, reason?, thing }` (generation skipped or unavailable)
- 404/500 with `{ success: false, error }`

Notes:
- Item image generation is not restricted to the player inventory; NPC-owned, barter-stock, container, and other known things can be requested when they are visible in the UI.
