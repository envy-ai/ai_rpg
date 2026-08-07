# Things & Inventory API

Common payloads: see `docs/api/common.md`.

## POST /api/things
Create a Thing record directly in the runtime Thing registry.

Request:
- Body supports: `name`, `description`, `shortDescription`, `thingType`, `imageId`, `rarity`, `itemTypeDetail`, `metadata`, `slot`, `attributeBonuses`, `causeStatusEffect`, `causeStatusEffectOnTarget`, `causeStatusEffectOnEquipper`, `count`, `level`, `relativeLevel`, `containerContents`, `statusEffects`, plus boolean flags (`isVehicle`, `isCraftingStation`, `isProcessingStation`, `isHarvestable`, `isSalvageable`, `isContainer`, `requiresCheckToOpen`) and registered Thing fields exposed to create/edit flows.

Response:
- 200: `{ success: true, thing: Thing, message, imageNeedsGeneration }`
- 400: `{ success: false, error }`

Notes:
- This route does not automatically attach the Thing to a location, player inventory, NPC inventory, or container. Location-scoped generated item/scenery creation uses `POST /api/locations/:id/things`.
- The current image eligibility helper treats Things as image-eligible. Creation clears the stored `imageId` and returns `imageNeedsGeneration: true`.
- When `causeStatusEffectOnTarget`/`causeStatusEffectOnEquipper` are supplied, `causeStatusEffect` is treated as compatibility input.
- Registered Thing fields with `clearThingSlotWhenPresent` clear `slot` when they are provided with a meaningful value.

## GET /api/things
List all things (optionally by type).

Request:
- Query: `type` (`item` or `scenery`)

Response:
- 200: `{ success: true, things: Thing[], count }`
- 400/500 with `{ success: false, error }`

Notes:
- The list is built from the runtime `things` map and may include loose location Things, inventory Things, container contents, barter-stock Things, installed module Things, and other indexed records.

## GET /api/things/:id
Fetch a thing by id.

Response:
- 200: `{ success: true, thing: Thing }`
- 404: `{ success: false, error }`

## POST /api/things/ai-search
Run `prompts/ai-item-search.xml.njk` against a caller-supplied item list and search criteria.

Request:
- Body: `{ criteria: string, mode?: "strict" | "lenient", items: [{ id, name, description?, level?, quality?, quantity?, equipmentSlot? }] }`.

Response:
- 200: `{ success: true, criteria, mode, resultNames, matchedIds, unmatchedNames, response }`
- 400: `{ success: false, error }` for missing criteria, missing item arrays, or malformed item records.
- 500: `{ success: false, error }` when prompt rendering, transport, or result XML parsing fails.

Notes:
- The endpoint requires a parseable `<results>` block from the prompt and logs the prompt/response through `LLMClient.logPrompt()` with metadata label `ai_item_search`.
- `resultNames` are the exact `<item>` names returned by the model. `matchedIds` contains all supplied item ids whose supplied names match those returned names case-insensitively after trimming, so duplicate item names all remain visible.
- The route does not read from the global Thing registry; callers are responsible for sending the item list that should be searched.

## POST /api/things/ai-combine-candidates
Run `prompts/ai-item-combiner.xml.njk` against a caller-supplied visible item-stack list and ask the model for same-quality groups that can reasonably be combined.

Request:
- Body: `{ items: [{ id, name, description?, level?, quality?, quantity?, equipmentSlot?, statusEffects?, statModifiers? }] }`.

Response:
- 200: `{ success: true, groups: [{ reason, itemIds, items }], excludedItemIds, response }`
- 400/404/500 with `{ success: false, error }` for malformed items, stale ids, prompt failure, invalid XML, or AI groups that violate server validation.

Notes:
- The endpoint resolves every supplied id against the runtime Thing registry, excludes non-item, equipped, container, and installed-module stacks from the prompt, and logs through `LLMClient.logPrompt()` with metadata label `ai_item_combiner`.
- Prompt context includes compact markdown-list text for status effects, target/equipper cause effects, and direct attribute stat modifiers. The server derives these from the resolved Thing when possible and uses supplied `statusEffects`/`statModifiers` text only as fallback context.
- Returned groups are validated server-side before being shown to the player: every stack must be item-type, unequipped, non-container, same quality/rarity, and in the same real holder.
- The route suggests groups only. It does not mutate inventory.

## POST /api/things/combine-stacks
Combine a user-approved same-quality stack group by keeping one selected stack and deleting the other selected stacks.

Request:
- Body: `{ keepThingId: string, mergeThingIds: string[] }`.

Response:
- 200: `{ success: true, keptThingId, sourceThingId, mergedThingIds, things, owner?, container?, contents?, location?, message }`
- 400/404/500 with `{ success: false, error }`

Notes:
- This is the authoritative mutation endpoint for the AI-backed item stack combiner. It revalidates all requested stacks before deleting anything.
- The kept stack preserves its name, image, description, metadata, effects, value, and mechanics. Only its `count` changes.
- Merge candidates must be item-type, unequipped, non-container stacks with the same quality/rarity and the same real holder: actor inventory, Thing container, or loose location.

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
- When `name`, `description`, `thingType`, `rarity`, `itemTypeDetail`, or `metadata` changes and the request does not supply `imageId`, the route clears the stored `imageId` and returns `imageNeedsUpdate: true`.
- `causeStatusEffect` is treated as a compatibility payload and mapped internally when provided.
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
Merge same-name, same-checksum stacks from the same owner inventory, location, or Thing container into the selected item stack.

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
- 200: `{ success: true, container: Thing, contents: Thing[], player: NpcProfile, playerInventory: Thing[], location: LocationResponse | null }`
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
- 200: `{ success: true, opened, permanentlyOpened, prose, container, locationRefreshRequested, eventChecks, timeProgress, worldTime, requestId }`
- 200: `{ success: true, opened: true, skipped: true, container }` when the target is a container that does not require a check.
- 400/404/500 with `{ success: false, error }`

Notes:
- Only container Things can use this route, and `actionText` is required for checked containers.
- The server renders the `player-action-open-container` prompt through base context, logs it with `LLMClient.logPrompt()` under `player_action_open_container`, sends regular prose information tools plus `resolveSkillCheck` / `resolveOpposedSkillCheck` in the LLM request payload even when prompt-level checks are enabled elsewhere, and fails loudly if no skill check was recorded. Including `<f>` or `<F>` in `actionText` strips that marker and opens a forced integer die-roll prompt for each skill-check tool call made while resolving the open attempt.
- The prompt returns `<containerOpenResult><success>...</success><permanentlyOpened>...</permanentlyOpened><prose>...</prose><timePassed><duration>...</duration></timePassed></containerOpenResult>`. In TinyBrain mode, the retryable final parser verifies the single check invocation, tool identity, authoritative success value, failure/permanent-open consistency, and duration before the staged program can finish. The required `timePassed` duration advances world time before event checks and is passed into `Events.runEventChecks(...)` as `initialTimeProgress` so event-check `timePassed` / `time_passed` is only a fallback. Prose runs through the normal slop-removal pipeline, is stored visibly as a `player-action-open-container` chat entry, and then runs ordinary event checks. The `success` flag gates whether the client proceeds to `GET /api/things/:containerId/container`.
- When `success` and `permanentlyOpened` are both true, the route persists `requiresCheckToOpen: false` on the container so future UI opens skip this check. Temporary successes should return `permanentlyOpened: false`.
- Completed checked-open attempts run the standard autosave before returning, so the chat entry, elapsed time, event outcomes, and any cleared `requiresCheckToOpen` flag are durable.

## POST /api/things/:containerId/container/move-in
Move a whole item stack from the current player's unequipped inventory or a loose current-location item into a container.

Request:
- Body: `{ thingId: string }` or `{ thingIds: string[] }`
- Optional `source`: `"player"` (default) or `"location"`.
- Optional `locationId`: required for `source: "location"` unless the current player location can be resolved.

Response:
- 200: `{ success: true, container: Thing, contents: Thing[], player: NpcProfile, playerInventory: Thing[], location?: LocationResponse, chatEntry?: ChatEntry }`
- 400/404/409/500 with `{ success: false, error }`

Notes:
- When `thingIds` is provided, the route validates the full list before moving anything and returns one refreshed container payload.
- Rejects non-container destinations, missing items, non-item contents, equipped items, duplicate containment, self-containment, descendant cycles, missing current player state, player-source items outside the current player's inventory, and location-source items that are not loose in the current location.
- These routes move whole Thing stacks. For partial movement, call `POST /api/things/:id/split-stack` first and move the returned split stack.
- Moving an item stack into a container automatically merges it into an existing same-name/same-checksum stack in that container. Containers and equipped items are excluded from automatic merging.
- Successful prompt-free UI moves append one visible `container-transfer` assistant chat entry, such as `Baato put Flare (x3), Medkit into Cargo Crate.`, which is not excluded from base-context history.

## POST /api/things/:containerId/container/move-out
Move a whole contained item stack into the current player's inventory.

Request:
- Body: `{ thingId: string }` or `{ thingIds: string[] }`

Response:
- 200: `{ success: true, container: Thing, contents: Thing[], player: NpcProfile, playerInventory: Thing[], chatEntry?: ChatEntry }`
- 400/404/409/500 with `{ success: false, error }`

Notes:
- When `thingIds` is provided, the route validates the full list before moving anything and returns one refreshed container payload.
- The moved item is removed from the container, has `metadata.containerId` cleared, and gains player inventory ownership metadata.
- Moving a contained item stack into player inventory automatically merges it into an existing same-name/same-checksum stack in that inventory. Containers and equipped items are excluded from automatic merging.
- These routes move whole Thing stacks. For partial movement, call `POST /api/things/:id/split-stack` first and move the returned split stack.
- Successful prompt-free UI moves append one visible `container-transfer` assistant chat entry, such as `Baato retrieved Flare (x3), Medkit from Cargo Crate.`, which is not excluded from base-context history.

## POST /api/things/:id/give
Move an item into an inventory.

Request:
- Body: `{ ownerId: string, ownerType?: string, locationId?: string }`

Response:
- 200: `{ success: true, thing: Thing, owner: NpcProfile, location?: LocationResponse, message }`
- 400/404/409/500 with `{ success: false, error }`

Notes:
- The route rejects non-item Things when `thingType` is present and not `item`.
- Moving an item into an inventory automatically merges it into an existing same-name/same-checksum stack owned by the destination actor. Containers and equipped items are excluded from automatic merging.

## POST /api/things/:id/drop
Drop a thing into a location.

Request:
- Body: `{ ownerId?: string, ownerType?: string, locationId?: string }`

Response:
- 200: `{ success: true, thing: Thing, location: LocationResponse, message, owner?: NpcProfile }`
- 400/404/500 with `{ success: false, error }`

Notes:
- Dropping a contained Thing removes it from any containing Thing containers before adding it to the target location and clearing container ownership metadata.
- Dropping an item-type Thing into a location automatically merges it into an existing loose same-name/same-checksum item stack in that location. Containers and equipped items are excluded from automatic merging.

## POST /api/things/:id/teleport
Teleport a thing to a location (removing from inventories).

Request:
- Body: `{ locationId: string }`

Response:
- 200: `{ success: true, thing: Thing, destination: LocationResponse, previousLocation: LocationResponse, removedOwnerIds: string[], locationIds: string[], message }`
- 400/404/500 with `{ success: false, error }`

Notes:
- Teleporting an item-type Thing to a location uses the same automatic loose-location stack merge as dropping.
- The route removes the Thing from actor inventories and its previous metadata location. It does not use the drop route's containing-container detachment helper.

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
Registered route for listing scenery Things, shadowed by `GET /api/things/:id` in the current route order.

Effective behavior:
- A request to `/api/things/scenery` is handled as `GET /api/things/:id` with `id = "scenery"`.
- It returns the Thing with id `scenery` if one exists, otherwise `{ success: false, error }` with `404`.
- Use `GET /api/things?type=scenery` for scenery listings.

## GET /api/things/items
Registered route for listing item Things, shadowed by `GET /api/things/:id` in the current route order.

Effective behavior:
- A request to `/api/things/items` is handled as `GET /api/things/:id` with `id = "items"`.
- It returns the Thing with id `items` if one exists, otherwise `{ success: false, error }` with `404`.
- Use `GET /api/things?type=item` for item listings.

## POST /api/things/:id/image
Trigger image generation for a thing.

Response:
- 200: `{ success: true, thing: Thing, imageGeneration, message }`
- 202: `{ success: false, thing: Thing, imageGeneration, message }` (existing job)
- 409: `{ success: false, error, reason?, thing }` (generation skipped or unavailable)
- 404/500 with `{ success: false, error }`

Notes:
- Item image generation is not restricted to the player inventory; NPC-owned, barter-stock, container, and other known things can be requested when they are visible in the UI.
