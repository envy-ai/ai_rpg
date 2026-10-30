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

## GET /api/player/prompt-guidance

Return the current player's free-text generation guidance.

Response:
- 200: `{ success: true, guidance: string, player: NpcProfile }`
- 404: `{ success: false, error: 'No current player found' }`

Missing guidance in an older save is returned as an empty string.

## PUT /api/player/prompt-guidance

Replace the current player's free-text generation guidance.

Request:
- Body: `{ guidance: string, clientId?: string }`
- `guidance` may be blank to clear the setting. It is normalized through `Player.normalizePlayerGuidance(...)`; non-string values are rejected.

Response:
- 200: `{ success: true, guidance: string, player: NpcProfile, entry: ChatEntry }`
- 400: missing or non-string `guidance`
- 404: no current player
- 409: no loaded game or no active player location
- 500: the guidance/update-notice commit failed

The route verifies the loaded game, active location, and writable chat-history prerequisites before changing the player. It first persists a `role: "system"`, `type: "player-prompt-guidance"` chat entry containing the latest guidance (or `(blank)` when cleared), then changes the player field; a setter failure removes the just-added notice. The notice carries `metadata.excludeFromBaseContextHistory: true`, and its dedicated type is always excluded from normal, generic/all-entry, scene-summary, and `getHistory` prompt paths. A `chat_history_updated` broadcast refreshes connected clients.

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
- 500: `{ success: false, error, code?, stack?, promptFailure? }`

Notes:
- When no game is loaded (`Globals.gameLoaded === false`), the endpoint returns `pending: false`, `abilitySelection: { pending: false, levelsMissing: [] }`, and the serialized player when one exists.
- `abilitySelection.pending` indicates whether gameplay is blocked by missing player ability picks.
- Pending state is computed from levels `1..currentLevel` and the config keys `player_abilities_per_level` and `player_ability_options_per_level`.
- When pending, `abilitySelection.selection` includes `level`, `requiredSelections`, `optionsPerLevel`, `optionsReady`, `optionsToGenerate`, `options`, and `preselectedAbilityNames`. Generated option records include `attachmentDraft: { statusEffects }` once detached XML authoring and preview validation finish; owned preselected records expose their installed `statusEffects`. `optionsReady` remains false until every generated option has a saved draft, including an explicit empty draft. `generateOptions=0` never starts missing option or attachment prompts.
- Generated option prompts exclude the player's current ability names and persisted `declinedAbilities` names.
- Caught option-generation failures preserve their original stack/code and safe prompt-failure envelope (including through exception causes), so the shared client error surface can deduplicate the corresponding realtime notification.
- `/api/chat` and `/api/player/move` reject gameplay with `409` while this state is pending.

## POST /api/player/ability-selection/submit

Submit selected abilities for the next pending player level.

Request:
- Body: `{ level: number, selectedAbilityNames: string[], declinedAbilityNames?: string[], clientId?: string, requestId?: string }`

Response:
- 200: `{ success: true, pending: boolean, abilitySelection, player: NpcProfile, gameIntroGenerated: boolean, gameIntroError? }`
- 409: `{ success: false, error, code: "GAME_NOT_LOADED", stack }` when no game is loaded.
- 400/404/500: `{ success: false, error, code?, stack?, promptFailure? }`

Notes:
- The submitted `level` must match the next pending level.
- Selected generated options commit their saved attachment drafts without a second model generation; unselected options never install status effects, disciplines, or techniques.
- With no loaded game, submission is rejected before generating options or changing the default actor. The error directs the user to load their saved game; no game is loaded automatically.
- `selectedAbilityNames` must contain exactly the configured number of unique names and each name must match one of the available option cards.
- `declinedAbilityNames`, when provided, must be unique option-card names. Unselected declined options are persisted on the player as `declinedAbilities`; selected names take precedence and are not stored as declined.
- If a deferred new-game intro is waiting and this submit clears the pending draft state, the route attempts the `game-intro` prompt. `gameIntroGenerated` is `true` only when that prompt succeeds.
- For ordinary setup, if opening-scene preparation/generation fails after the choices commit, the response remains successful for those choices and includes `gameIntroError: { message, code?, stack?, promptFailure? }`. The client advances/closes the completed choice stage and shows the original error through shared feedback; it does not imply that the accepted choices rolled back. This also exposes preparation errors that have no prompt notification envelope. Reviewed setup retains its original exception contract: an intro or provider-completion failure propagates through the route error response with its original diagnostics, rather than reporting successful reviewed completion.
- A successfully stored intro clears its matching pending marker before its existing autosave, preventing a loaded completed-intro autosave from replaying the scene. The route retains its local reviewed token for provider completion. Earlier ability levels never run the intro.
- Response errors preserve original stack/code and safe prompt-failure identity. Ability-selection rollback and the rule that all pending levels must be completed before the intro remain unchanged.

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

Preview the player-known directed route and fast-travel eligibility without moving the player, expanding stubs, marking visits, or advancing time.

Request:
- Query: `destinationId` (required location id)

Response:
- 200: `{ success: true, origin, destination, reachable, canFastTravel, blockingReason, travelTimeMinutes, steps }`
  - `origin` and `destination` contain `{ id, name, regionId, regionName }`; `destination` also contains `visited` and `isStub`.
  - `reachable` is true only when a player-known directed route exists. `travelTimeMinutes` is an integer for a reachable route and `null` when no known route exists.
  - `canFastTravel` additionally requires a visited, hydrated destination. `blockingReason` is `null` when travel is eligible, otherwise `{ code, message }` with a hidden-safe player-facing explanation.
  - `steps` is the ordered route. Every player-facing entry contains `exitId`, source/destination location and region ids/names, description, `travelTimeMinutes`, `isVehicle`, `vehicleType`, and `destinationIsStub`. Internal exit direction/name keys are intentionally omitted.
- 400: `{ success: false, error }` for missing destination or unavailable current-player location
- 404: `{ success: false, error }` for missing current player, origin location, or destination location
- 500: `{ success: false, error }`

Notes:
- Preview and traversal use one policy: directed exits, hidden exits excluded, the ordinary vehicle-exit availability gate, and terminal-only stub routing. A stub may be inspected as the final destination but never used as an intermediate route node.
- Missing routes are explicit (`reachable: false`, `travelTimeMinutes: null`, empty `steps`) and never represented as zero time. Player wording says only that no known route is available and does not imply a hidden connection.
- Fast travel re-computes the same policy server-side immediately before applying travel. Stale or now-blocked routes fail rather than using the earlier preview.
- Malformed graph data and mismatched route totals raise errors.
- The route is read-only and does not write chat history, run arrival prompts, move actors, or advance world time.

## POST /api/player/move

Move the current player through an exit from the current location.

Request:
- Body: `{ destinationId?: string, direction?: string, expectedOriginLocationId: string, arrivalProseAlreadyProvided?: boolean, accompanyingCharacters?: string[], clientId?: string }`
  - At least one of `destinationId` or `direction` is required.
  - When `destinationId` is present, the route finds the exit whose destination matches that id.
  - `expectedOriginLocationId` is required and must match the current server-side player location.
  - `accompanyingCharacters` contains complete canonical names or aliases selected by the preceding travel-prose prompt. It defaults to an empty array.
  - `arrivalProseAlreadyProvided` must be a boolean and defaults to `false`. The client sends `true` only when the preceding direct-travel action produced real arrival prose; a prompt-skipping `# moved` comment sends `false`.

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
- Every ordinary location stub expansion uses the same exit-discovery behavior, including expansion during this route: the location-generation prompt sees the implied return route and existing outgoing exits, then may return any contextually justified number of new location or region exit stubs, including zero. Malformed entries trigger bounded parser-guided regeneration, while duplicate and already-known destinations are ignored. The decision is persisted through `hasGeneratedStubs` so it is not repeated.
- Before resolving move duration, cross-region arrivals run the shared exit travel-time backfill for the destination region. That helper updates `0`-minute legacy exits, renders only pending zero-minute exits through the `set_travel_times` prompt, skips same-region moves, and treats prompt failures as warning-only so movement can continue.
- Positive exit travel time advances world time unless the source location context represents a vehicle. The response includes `worldTime` and `timeProgress`; `timeProgress` is `null` when no time is advanced.
- Gameplay arrival runs the while-you-were-away prompt only when the destination had a recorded pre-arrival visited state and passes the configured revisit threshold. First visits, missing pre-arrival snapshots, and too-soon revisits skip that prompt.
- When that WYWA pass runs, a direct move with `arrivalProseAlreadyProvided: false` requires nonempty player-facing return prose and rejects/retries an empty one-shot or TinyBrain prose stage. Already-narrated player-action arrivals keep WYWA prose optional, and the existing TinyBrain replacement-prose path may suppress its duplicate visible entry.
- Direct moves persist a travel event-summary row and parent it to visible arrival prose, prior travel prose, or the travel user/comment entry so the client can render it in the turn-state drawer.
- Companion selections are validated against living party members and living NPCs at the verified origin before mutation. Aliases are canonicalized. Selected non-party NPCs move into the destination location; selected party members retain membership and the normal off-location party representation.
- After movement, the server runs location/region/exit integrity checks, queues relevant assets, records NPC sightings, and returns a full `LocationResponse`.
- If focused hostile replenishment exhausts its retry budget after the move commits, the route still returns the destination and player payload with `arrivalProcessingError: { message, stack }`. The client refreshes the destination and chat first, then opens the normal error popup with the server backtrace.

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
# Ability attachments

Owned abilities can carry permanent status-effect templates. A template may give fixed or signed percentage attribute/skill modifiers, `maxHealthPercent`, and status-bound technique grants. Status effects and grants are saved with the owning ability; removing that ability removes its derived effects and technique access. `needBars` changes are not supported on ability templates.

| Endpoint | Request | Response |
| --- | --- | --- |
| `GET /api/players/:actorId/abilities/:abilityId/attachments` | None | `{success, ability, draft, expected}` for manual editing. |
| `POST /api/players/:actorId/abilities/:abilityId/attachments/generate` | `{clientId?}` | `{success, draft, expected}`; generated mechanics remain staged. |
| `PUT /api/players/:actorId/abilities/:abilityId/attachments` | `{draft, expected}` | `{success, ability, player, draft, expected}` after atomic reviewed apply. |

`draft` is `{statusEffects:[...]}`. Each status has `name`, `description`, `duration:-1`, optional `attributes:[{attribute,modifier?,percentModifier?}]`, `skills:[{skill,modifier?,percentModifier?}]`, `maxHealthPercent`, and `techniqueEntries`. A technique entry is an existing `{techniqueId,definitionRevision?}` or `{candidate,candidateDiscipline?}` using the ordinary technique authoring definition and discipline schemas. The server assigns status/grant/novel catalogue IDs; applied statuses contain pinned `techniqueGrants`. The client must return the original `expected` baseline; stale ability or world state is rejected before mutation. Generate performs no world mutation, so rejected proposals and declined ability options cannot leak catalogue definitions. Validation errors include `error` and `stack` for the shared error modal.

