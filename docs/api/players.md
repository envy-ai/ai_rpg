# Players & Party API

Common payloads: see `docs/api/common.md`.

Player endpoints generally return `NpcProfile` payloads from `serializeNpcForClient`. Those profiles include expanded inventory items, active need bars, abilities, formula-derived unspent point totals, faction standings, sparse `relationships` maps (`target character id -> label of at most six words`), active/completed quests, mod status sections, and `partyMembers` unless the route intentionally suppresses nested party serialization. Chat prompts can set individual non-player character relationship edges through `setRelationship({ characterA, characterB, relationship, reciprocalRelationship? })`; that tool rejects calls where either character is the current player.

## POST /api/player

Create a player, store it in the runtime players map, and make it the current player.

Request:
- Body (optional): `{ name?: string, attributes?: object, level?: number }`
  - `name` defaults to `New Player`.
  - `attributes` defaults to `{}`.
  - `level` defaults to `1`.

Response:
- 200: `{ success: true, player: NpcProfile, message }`
- 400: `{ success: false, error }`

Notes:
- The route attempts startup inventory generation after creation. Inventory-generation errors are logged and do not fail the player creation response.

## GET /api/player

Get the current player.

Response:
- 200: `{ success: true, player: NpcProfile }`
- 404: `{ success: false, error: 'No current player found' }`
- 500 or route-supplied error status: `{ success: false, error }`

Notes:
- Before serializing the player payload, containers in the current player's inventory with pending `Thing.containerContents` seeds generate those contents through `thing-generator-contents` and clear the pending seed list.

## PUT /api/player/thing-list-view-preferences

Persist one shared thing-list panel view mode on the current player.

Request:
- Body: `{ panelKey: string, viewMode: string }`
  - Supported server-side `panelKey` values: `npcInventory`, `npcBarterInventory`, `barterPlayerInventory`, `barterMerchantInventory`, `craftingInventory`, `locationScenery`, `locationItems`, `containerPlayerInventory`, `containerContents`
  - Supported `viewMode` values: `classic`, `table`, `grid`, `small-grid`

Response:
- 200: `{ success: true, thingListViewPreferences: object, player: NpcProfile }`
- 400: `{ success: false, error }` for invalid panel keys or view modes
- 404: `{ success: false, error }`

## GET /api/player/ability-selection

Resolve the player-only pending level-up ability draft state, optionally generating the next level's option cards.

Request:
- Query (optional): `generateOptions`
  - `generateOptions=0|false|no` returns pending state without generating missing option cards.
  - Omitted values and other values generate missing option cards for the next pending level.

Response:
- 200: `{ success: true, pending: boolean, abilitySelection, player: NpcProfile | null }`
- 400: `{ success: false, error }` for an NPC current-player record
- 404: `{ success: false, error }`
- 500: `{ success: false, error }`

Notes:
- When no game is loaded (`Globals.gameLoaded === false`), the endpoint returns `pending: false`, `abilitySelection: { pending: false, levelsMissing: [] }`, and the serialized player when one exists.
- `abilitySelection.pending` indicates whether gameplay is blocked by missing player ability picks.
- Pending state is computed from levels `1..currentLevel` and the config keys `player_abilities_per_level` and `player_ability_options_per_level`.
- When pending, `abilitySelection.selection` includes `level`, `requiredSelections`, `optionsPerLevel`, `optionsReady`, `optionsToGenerate`, `options`, and `preselectedAbilityNames`.
- Generated option prompts exclude the player's current ability names and persisted `declinedAbilities` names.
- `/api/chat` and `/api/player/move` reject gameplay with `409` while this state is pending.

## POST /api/player/ability-selection/submit

Submit selected abilities for the next pending player level.

Request:
- Body: `{ level: number, selectedAbilityNames: string[], declinedAbilityNames?: string[], clientId?: string, requestId?: string }`

Response:
- 200: `{ success: true, pending: boolean, abilitySelection, player: NpcProfile, gameIntroGenerated: boolean }`
- 400/404/500: `{ success: false, error }`

Notes:
- The submitted `level` must match the next pending level.
- `selectedAbilityNames` must contain exactly the configured number of unique names and each name must match one of the available option cards.
- `declinedAbilityNames`, when provided, must be unique option-card names. Unselected declined options are persisted on the player as `declinedAbilities`; selected names take precedence and are not stored as declined.
- If a deferred new-game intro is waiting and this submit clears the pending draft state, the route attempts the `game-intro` prompt. `gameIntroGenerated` is `true` only when that prompt succeeds.

## DELETE /api/player/quests/:questId

Remove a quest from the current player. Detailed quest editing behavior is documented in `docs/api/quests.md`.

Request:
- Path: `questId`

Response:
- 200: `{ success: true, message, player: NpcProfile }`
- 400/404: `{ success: false, error }`

## GET /api/players

List all runtime player/NPC actor records in the players map.

Response:
- 200: `{ success: true, players: NpcProfile[], count, currentPlayer }`
  - `currentPlayer` is the current player's id or `null`.

## POST /api/player/set-current

Set the current player by id.

Request:
- Body: `{ playerId: string }`

Response:
- 200: `{ success: true, currentPlayer: NpcProfile, message }`
- 400/404/500: `{ success: false, error }`

## GET /api/player/party

List party members for the current player.

Response:
- 200: `{ success: true, members: NpcProfile[], count }`
- 404/500: `{ success: false, error }`

Notes:
- `members` are serialized with nested `partyMembers` omitted.

## POST /api/player/party

Attach a party member id to an owner player id.

Request:
- Body: `{ ownerId: string, memberId: string }`

Response:
- 200: `{ success: true, message, members }`
  - `members` is an array of member ids.
- 400/404/500: `{ success: false, error }`

Notes:
- Re-adding an existing member returns 200 with `message: 'Player already in party'`.
- `Player.addPartyMember(...)` stores the member id on the party owner, marks the member as having party history, marks the actor to persist when dead, removes the actor from all location NPC lists, and clears the actor's explicit location. Member `isInPlayerParty` payloads are derived from the current player's `partyMembers` list.

## DELETE /api/player/party

Detach a party member id from an owner player id.

Request:
- Body: `{ ownerId: string, memberId: string }`

Response:
- 200: `{ success: true, message, members }`
  - `members` is an array of member ids.
- 400/404/500: `{ success: false, error }`

Notes:
- `Player.removePartyMember(...)` removes the member id from the party owner, marks the member to persist when dead, and places the actor at the owner player's current location.
- Generic and scheduled chat prompts can call `updatePartyMembers({ add?, remove? })` for validated multi-member party mutations. It accepts arrays of NPC ids, exact names, or aliases; validates the whole request before mutation; lets `add` targets resolve from any location; and places `remove` targets at the current player location.

## GET /api/player/fast-travel-preview

Preview directed graph-route travel timing for the current player without moving the player or advancing time.

Request:
- Query: `destinationId` (required location id)

Response:
- 200: `{ success: true, origin: { id, name, regionName }, destination: { id, name, regionName }, travelTimeMinutes }`
- 400: `{ success: false, error }` for missing destination or unavailable current-player location
- 404: `{ success: false, error }` for missing current player, origin location, or destination location
- 500: `{ success: false, error }`

Notes:
- The route calls `resolveFastTravelTimeForTraversal({ sourceLocation, destinationLocation })`, which uses `Location.findShortestTravelTimeMinutes(...)`.
- The location graph is directed. A missing route resolves to `travelTimeMinutes: 0`; malformed graph data raises an error.
- The route is read-only and does not write chat history, run arrival prompts, move actors, or advance world time.

## POST /api/player/move

Move the current player through an exit from the current location.

Request:
- Body: `{ destinationId?: string, direction?: string, expectedOriginLocationId: string, accompanyingCharacters?: string[], clientId?: string }`
  - At least one of `destinationId` or `direction` is required.
  - When `destinationId` is present, the route finds the exit whose destination matches that id.
  - `expectedOriginLocationId` is required and must match the current server-side player location.
  - `accompanyingCharacters` contains complete canonical names or aliases selected by the preceding travel-prose prompt. It defaults to an empty array.

Response:
- 200: `{ success: true, location: LocationResponse, player: NpcProfile, worldTime, timeProgress, message, direction }`
- 400: `{ success: false, error }`
- 404: `{ success: false, error }`
- 409: `{ success: false, error, pendingAbilitySelection?, player? }`
- 500: `{ success: false, error }`

Notes:
- Move requests use a per-player non-blocking server lock.
- The route rejects movement while player ability selection is pending, while another move is in progress for the same player, when origin verification fails, or when vehicle boarding/disembark rules block the exit.
- Before movement side effects, the route checks for non-stub locations listed in multiple live regions. When found, it returns `409` with `code: "location_region_membership_conflict"` and a `conflict` payload whose location and region labels are formatted as `name (id)`; the client fixer modal can resolve it and retry the move.
- Region-entry and ordinary location stubs are expanded before movement completes.
- Before resolving move duration, cross-region arrivals run the shared exit travel-time backfill for the destination region. That helper updates `0`-minute legacy exits, renders only pending zero-minute exits through the `set_travel_times` prompt, skips same-region moves, and treats prompt failures as warning-only so movement can continue.
- Positive exit travel time advances world time unless the source location context represents a vehicle. The response includes `worldTime` and `timeProgress`; `timeProgress` is `null` when no time is advanced.
- Gameplay arrival runs the while-you-were-away prompt only when the destination had a recorded pre-arrival visited state and passes the configured revisit threshold. First visits, missing pre-arrival snapshots, and too-soon revisits skip that prompt.
- Direct moves persist a travel event-summary row and parent it to visible arrival prose, prior travel prose, or the travel user/comment entry so the client can render it in the turn-state drawer.
- Companion selections are validated against living party members and living NPCs at the verified origin before mutation. Aliases are canonicalized. Selected non-party NPCs move into the destination location; selected party members retain membership and the normal off-location party representation.
- After movement, the server runs location/region/exit integrity checks, queues relevant assets, records NPC sightings, and returns a full `LocationResponse`.

## PUT /api/player/attributes

Update attributes on the current player.

Request:
- Body: `{ attributes: Record<string, number> }`

Response:
- 200: `{ success: true, player: NpcProfile, message }`
- 400/404: `{ success: false, error }`

Notes:
- Each entry is passed to `Player.setAttribute(...)`, which validates the attribute name and configured min/max rules. Attribute edits that affect max health also reconcile current health with the new max.
- Missing or empty `attributes` applies no attribute edits and still returns the serialized current player.

## PUT /api/player/health

Modify current player health by a signed amount.

Request:
- Body: `{ amount: number, reason?: string }`

Response:
- 200: `{ success: true, healthChange, player: NpcProfile, message }`
- 400/404: `{ success: false, error }`

Notes:
- `amount` must be a JSON number. The model stores finite health and caps the result to the actor's `0..maxHealth` range.

## POST /api/player/levelup

Increase the current player's level by one.

Response:
- 200: `{ success: true, player: NpcProfile, pendingAbilitySelection, message }`
- 400/404: `{ success: false, error }`

Notes:
- `Player.levelUp()` resets current health to recalculated max health and invokes the configured level-up handler.
- The level-up handler writes a `type: level-up` chat entry with `metadata.excludeFromBaseContextHistory: true`.
- `pendingAbilitySelection` is resolved without generating option cards.

## GET /api/player/needs

Get active need bars for the current player.

Response:
- 200: `{ success: true, needs: NeedBar[], audience: { player, party, nonParty }, player: { id, name, isNPC } }`
- 404/500: `{ success: false, error }`

## PUT /api/player/needs

Set active need-bar values on the current player.

Request:
- Body: `{ needs: Array<{ id: string, value: number }> }`

Response:
- 200: `{ success: true, message, needs: NeedBar[], audience: { player, party, nonParty }, player: { id, name, isNPC }, applied: NeedBar[] }`
- 400/404/500: `{ success: false, error }`

Notes:
- Entries with blank ids or non-object entries are ignored. Non-finite values return 400.
- Values are applied through `Player.setNeedBarValue(...)`.

## POST /api/player/generate-attributes

Generate and assign attributes for the current player.

Request:
- Body: `{ method?: string }`

Response:
- 200: `{ success: true, player: NpcProfile, generatedAttributes, method, message }`
- 400/404: `{ success: false, error }`

Notes:
- `method` must be one of `currentPlayer.getGenerationMethods()` when provided; otherwise `standard` is used.

## POST /api/player/update-stats

Apply player stats from the player-view/admin-style form.

Request:
- Body supports `name`, `description`, `level`, `health`, `attributes`, `skills`, and `statusEffects`.
- `unspentSkillPoints` and `unspentAttributePoints` are rejected because those pools are formula-derived.

Response:
- 200: `{ success: true, player: NpcProfile, message, imageNeedsUpdate }`
- 400/404/500: `{ success: false, error }`

Notes:
- `name` and `description` edits clear `player.imageId` and return `imageNeedsUpdate: true`.
- `level` is applied only when it is numeric and within `1..20`.
- `health` is applied only when it is numeric and non-negative; `Player.setHealth(...)` caps it to max health.
- Finite attribute values are passed through `Player.setAttribute(...)`. Unknown attributes or configured min/max failures return 400.
- `skills` accepts a map of skill names to numeric values. Unknown skill names trigger skill metadata generation, then the route registers the resulting skills before assigning integer ranks. Non-finite skill values are skipped.
- `statusEffects` must be an array or `null` when present.

## PUT /api/player/status

Replace current player status effects directly.

Request:
- Body: `{ statusEffects: array | null }`

Response:
- 200: `{ success: true, message, player: NpcProfile }`
- 400/404: `{ success: false, error }`

Notes:
- The `statusEffects` key is required. `null` clears all replaceable status effects.

## POST /api/player/create-from-stats

Create a player from the player stats form and make it the current player.

Request:
- Body requires `name`.
- Body supports `description`, `level`, `health`, `attributes`, `skills`, and `statusEffects`.
- `unspentSkillPoints` and `unspentAttributePoints` are rejected because those pools are formula-derived.

Response:
- 200: `{ success: true, player: NpcProfile, message }`
- 400/500: `{ success: false, error }`

Notes:
- `level` defaults to `1` and is normalized to at least `1`.
- Finite non-negative `health` is assigned before serialization.
- Form-style attributes are parsed as integers and normalized to the `3..18` range before construction.
- Form-style skills are parsed as integers and normalized to zero or greater before construction.
- `statusEffects` must be an array, `null`, or omitted.
- The route attempts startup inventory generation after creation. Inventory-generation errors are logged and do not fail the creation response.

## POST /api/player/skills/:skillName/increase

Spend unspent skill points to increase one skill rank.

Request:
- Path: `skillName`
- Body: `{ amount?: number }` (defaults to `1`)

Response:
- 200: `{ success: true, player: NpcProfile, skill: { name, rank }, amount }`
- 400/404: `{ success: false, error }`

Notes:
- `amount` must resolve to a positive integer.
- The skill name must be available in `Player.availableSkills` when that registry is populated.
- The current player must have enough formula-derived unspent skill points.

## POST /api/player/equip

Equip an inventory item into a specific gear slot, or clear the slot.

Request:
- Body: `{ slotName: string, itemId?: string }`
  - Omit `itemId` or send a falsey value to clear the slot.

Response:
- 200: `{ success: true, player: NpcProfile, message }`
- 400/404/500: `{ success: false, error }`

Notes:
- `slotName` must match a key in the current player's gear snapshot.
- When `itemId` is present, the item must be in the current player's inventory and `Player.equipItemInSlot(...)` must accept it for the requested slot.
- `Player.equipItemInSlot(...)` may return an explanatory error string for semantic failures such as an incompatible slot type. The route treats only literal `true` as success and returns that message with HTTP 400 otherwise; a truthy error string can never produce a success response.
- Clearing an empty slot returns success.

## PUT /api/player/factions/:id/standing

Set or clear the current player's standing with a faction. Detailed faction behavior is documented in `docs/api/factions.md`.

Request:
- Path: `id` (faction id)
- Body: `{ value: number | null }`

Response:
- 200: `{ success: true, factionId, standings: Record<string, number> }`
- 400/404/500: `{ success: false, error }`

Notes:
- `value: null` removes the standing entry for that faction.
- Numeric values must be finite.

## POST /api/players/:id/portrait

Trigger portrait generation for a player/NPC actor by id.

Request:
- Path: `id`

Response:
- 200: `{ success: true, player: { id, name, imageId }, imageGeneration, message }`
- 202: `{ success: false, player: { id, name, imageId }, imageGeneration, message: 'Portrait job already in progress' }`
- 409: `{ success: false, error, reason, player: { id, name, imageId } }`
- 503: `{ success: false, error }`
- 404/500: `{ success: false, error }`

Notes:
- Image generation must be enabled and the ComfyUI client must be available.
- In-progress portrait work for the same actor returns the existing job payload instead of starting another render.
- A skipped render returns 409 when portrait generation is not valid for the target actor in the current scene context.

## GET /api/gear-slots

List configured gear slot types.

Response:
- 200: `{ success: true, slotTypes: string[] }`
- 500: `{ success: false, error, details }`

Notes:
- Slot types come from `Player.gearSlotDefinitions.byType` and are sorted case-insensitively.
