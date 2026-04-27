# Chat API

Entries are sorted by path. Common payloads (ChatEntry, ActionResolution, etc.) are defined in `docs/api/common.md`.

## POST /api/chat
Primary turn-resolution endpoint.

Request:
- Body:
  - `messages` (required): array of chat messages; at minimum the last entry should be `{ role, content }`.
  - `clientId` (optional string): enables realtime streaming events.
  - `requestId` (optional string): echoed back in `streamMeta` and chat metadata.
  - `travel` (optional boolean): marks the user message as a travel action.
  - `travelMetadata` (optional object): required for event-driven travel; normalized to:
    - `mode` (string | null)
    - `eventDriven` (boolean)
    - `exit` object:
      - `originLocationId` (string, required)
      - `destinationId` (string, required)
      - `exitId` (string | null)
      - `direction` (string | null)
      - `destinationRegionId` (string | null)
      - `destinationIsStub` (boolean)
      - `destinationIsRegionEntryStub` (boolean)
      - `isVehicle` (boolean)
      - `vehicleType` (string | null)
      - `destinationName` (string | null)
      - `regionName` (string | null)

Response (200):
- Base fields:
  - `response`: string (final prose)
  - `messages`: ChatEntry[] (new entries appended this request)
- Optional fields (present when relevant):
  - `summary`: string
  - `toolInvocations`: array (executed model tool calls for this turn; includes tool metadata such as lookup queries/match counts and world-mutation results)
  - `slopRemoval`: `{ slopWords: string[], slopRegexes: string[], slopNgrams: string[] }`
  - `debug`: object (debug payload, when enabled)
  - `actionResolution`: ActionResolution
  - `actionResolutions`: ActionResolution[] (one skill-check outcome per plausibility tool call in this turn)
  - `attackCheck`: object (attack roll details)
  - `attackSummary`: object
  - `attackSummaries`: object[] (one attack summary per `resolveAttack` tool call in this turn)
  - `attackDamage`: object
  - `plausibility`: `{ type, reason }`
  - `plausibilities`: array (one plausibility payload per plausibility tool call in this turn)
  - `eventChecks`: string (HTML summary)
  - `eventChecksOrigin`, `eventChecksDestination`: string (HTML summaries when travel prose is split)
  - `events`: object | array
  - `eventsOrigin`, `eventsDestination`: object | array (structured events when travel prose is split)
  - `experienceAwards`, `currencyChanges`, `environmentalDamageEvents`, `needBarChanges`, `dispositionChanges`, `factionReputationChanges`: arrays
  - `questsAwarded`, `questRewards`, `questObjectivesCompleted`, `followupEventChecks`: arrays
    - `questObjectivesCompleted[]` entries include quest/objective identifiers plus `objectiveDescription`, `reason`, `questCompleted`, and `questJustCompleted` when relevant
  - `npcTurns`: array (NPC turn payloads; each finalized turn includes the updated chat-entry `timestamp` and `entryId` when available)
  - `npcUpdates`: `{ added: string[], departed: string[], movedLocations: string[] }`
  - `locationRefreshRequested`: boolean
  - `corpseRemovals`, `corpseCountdownUpdates`: arrays
  - `worldTime`: object
    - `dayIndex`: number
    - `timeMinutes`: number (canonical minute-of-day value)
    - `timeLabel`: string (`h:MM AM/PM`)
    - `dateLabel`: string
    - `segment`: string
    - `season`: string
    - `seasonDescription`: string | null
    - `holiday`: object | null
      - `name`: string
      - `description`: string | null
      - `month`: string
      - `day`: number
    - `holidayName`: string | null
    - `holidayDescription`: string | null
    - `lighting`: string
    - `transitions`: array (optional; `segment`/`season` changes for the resolved turn)
  - `timeProgress`: object (optional; raw advancement result from `time_passed` handling)
  - `requestId`: string (when supplied)
  - `streamMeta`: object (streaming metadata when realtime is enabled)
  - `commentLogged`: boolean (comment-only actions)

Variants:
- Empty player action: an empty final user message is accepted as a normal player-action continuation. The server skips plausibility and renders the player-action prompt with empty `actionText` so `prompts/_includes/player-action.njk` uses its "continue the previous scene" branch. The legacy attack precheck/check prompts and the automatic player-action plausibility prompt call are disabled for all player actions.
- Comment-only action: if the user message begins with `#`, the response is `{ response: '', commentLogged: true, messages: [...] }` (no turn resolution).
- Forced-event action: user message begins with `!!`; creative action begins with `!`. These alter processing but do not change the base response shape.
- Question action: if the user message begins with `?`, the server routes through the `question` prompt template (`prompts/_includes/question.njk`) using the stripped question text (leading `?` and spaces removed for prompt rendering). It records chat entries as `type: user-question` (user) and `type: storyteller-answer` (assistant), skips event/random/NPC turn resolution for that request, bypasses slop-remover processing for that response, and returns a normal chat payload with the answer in `response`.
- Generic prompt actions route through `prompts/_includes/generic-prompt.njk` with stripped marker text:
  - `@...`: saved normally in chat history as `user-generic-prompt` + `generic-prompt-response`.
  - `@@...`: saved in chat history, but marked so those entries are excluded from base-context history assembly.
  - `@@@...`: not persisted in server chat history at all (ephemeral display only), and skipped in future base-context history.
- No-context prompt actions route through `prompts/generic-prompt-nocontext.xml.njk` with stripped marker text:
  - `\...`: saved in chat history as `user-generic-prompt` + `generic-prompt-response`, marked so those entries are excluded from base-context history assembly, and runs with no chat tools.
- All generic/no-context prompt variants (`@`, `@@`, `@@@`, `\`) bypass slop-remover processing for that response.
- Inline die-roll override: player action text supports one or more `"<integer>"` tokens (pattern `/<-?\\d+>/`). These tokens are stripped from action text before prompt processing and before the user entry is persisted in chat history. The old automatic player-action plausibility prompt path that consumed this override is currently disabled in favor of tool-based checks.
- Creative `!` actions now respect `repetition_buster`: when enabled, the response is required/parsing-validated as action XML (`<finalProse>`/`<travelProse>`); when disabled, creative actions remain free-form prose.
- Tool calling is enabled in the chat generation loop. The model can emit `tool_calls`; the server executes each call, appends `role: tool` messages, and continues generation until normal assistant prose is returned.
- Tool availability is prompt-mode gated:
  - Regular prompts (not prefixed by `@`, `@@`, `@@@`, or `\`) get information-gathering tools plus the health-mutating `resolveAttack` exception and the skill-check resolution tools. This includes both `player_action` and `npc_action` prose prompts.
  - Generic prompt actions (`@...`, `@@...`, `@@@...`) get the full tool set, including world-mutation tools.
  - No-context prompt actions (`\...`) do not get any chat tools.
- Information-gathering tools (always available):
  - `moreInfo({ name, type? })`: returns `<moreInfoResults>...</moreInfoResults>` XML with curated, template-rendered markdown summaries (base-context style) for matching NPCs (including alias matches), things, locations, and regions whose names contain the query substring. Optional `type` may be `character`, `thing`, `location`, or `region`; omitting it searches all categories. Each entity node includes a `<markdown>` field.
  - `getHistory({ query, startIndex?, count? })`: returns `<historyResults>...</historyResults>` XML for assistant prose-like history entries whose content matches all case-insensitive query terms (`query` supports string or string-array inputs with AND semantics). Optional `startIndex` is 1-based and optional `count` limits how many matches are returned; omitting both preserves current behavior (all matches).
  - `listLocationEntities({ location, region?, entityType? })`: returns concise character/thing lists for a location; includes current player + party members when the player is present.
  - `resolveAttack({ attacker, defender, attackerInfo, defenderInfo, ability, weapon, circumstanceModifiers, damageEffectiveness })`: resolves an attack roll using the same attack fields produced by the attack-check prompt, applies the resulting damage to the defender, and returns only `Damage: N%` plus `Remaining health: N%` as tool content, or `miss` when the attack misses. This is the only health-mutating tool available to regular prompts. Each call also emits an attack summary; persisted assistant turns store those summaries as `attack-check` attachment entries so every attack tool call renders as a hover insight button on the response.
  - `resolveSkillCheck({ actor?, reason, skill, attribute, difficultyLevel, circumstanceModifiers })`: resolves an unopposed skill check for a meaningful uncertain non-attack action by the supplied actor, the acting NPC during `npc_action` when `actor` is omitted, or the current player otherwise. It returns the outcome label as tool content and emits both an `ActionResolution` and plausibility payload for skill-check/plausibility insight attachments.
  - `resolveOpposedSkillCheck({ actor?, reason, skill, attribute, opponent, opponentSkill, opponentAttribute, circumstanceModifiers })`: resolves a contested skill check against a resolved opponent actor, using the same omitted-actor default as `resolveSkillCheck`, returns the outcome label as tool content, and emits the same skill-check/plausibility attachment metadata.
  - Attack and skill-check tool results are cached for the current prose prompt round. Repeated calls with the same round plus attacker/actor, target/opponent when applicable, weapon/ability/attribute when applicable, and skill return the first result without re-rolling or re-applying damage; modifiers/difficulty changes in later drafts do not produce a new result for that same cache key. The cache is recreated for each new prose prompt and shared with same-prompt repetition reruns.
  - When root config `debug_tool_calls` is `true`, each prose prompt with tool calls also creates one visible `tool-call-debug` chat entry. The entry stores structured `toolCalls` records for client rendering, marks cache hits with `cacheHit`/`cacheKey`, is updated as calls start and complete, refreshed via the existing `chat_history_updated` event, and marked `metadata.excludeFromBaseContextHistory: true` so it is never included in future prompt context.
  - Post-player NPC turn processing creates a prompt-excluded pending `npc-action` planned-action chat entry while `next_npc_list` and the selected NPC action-plan prompt are running. It starts as `Another character is taking their turn`, changes to `NAME is taking their turn...` after the NPC is resolved, and is finalized in place with the deslopped planned-action text. The later `npc_turn` stream payload still represents the separate final NPC prose entry.
  - `locateNpcs({ query })`: locates NPCs by full name or alias; returns all matches with full name, location, and region.
  - `locateThings({ query })`: locates things by name; returns all matches with location/region, and includes owner name when in inventory.
- World-mutation tools (available only for `@`/`@@`/`@@@` generic prompt actions):
  - `teleportCharacterToLocation({ character, location, region? })`: teleports a player/NPC to the destination location.
  - `teleportThingToLocation({ thing, location, region? })`: teleports a thing to the destination location, removing prior ownership/location ties first.
  - `moveThingFromLocationToCharacterInventory({ thing, fromLocation, character, region? })`: moves an item from a specific location into a character inventory.
  - `createRegionStub({ regionName, originLocation?, originRegion?, description?, parentRegion?, vehicleType?, relativeLevel? })`: creates a new region-entry stub from an origin location.
  - `createLocationStub({ locationName, originLocation?, originRegion?, description?, targetRegion?, vehicleType?, relativeLevel? })`: creates or resolves a destination location stub, ensures an exit from origin to destination, and returns origin/destination metadata.
  - `createExit({ fromLocation, fromRegion?, toLocation?, toRegion?, description?, vehicleType?, relativeLevel? })`: creates exits to existing destinations and is the canonical creation path for new location/region stubs (missing destinations are stubbed automatically). Successful calls always ensure a two-way connection between origin and destination. If the requested origin→destination exit already exists, the tool returns `status=unchanged` and does not modify the existing exit.
  - `createThing({ shortDescription, itemOrScenery, location?, region?, ...thingSeedFields })`: creates a new thing at the specified location (or current player location when omitted) via the `thing-generator-single` flow and returns the final created name (useful when requested names are normalized/adjusted by name checks). Seed fields include preferred name/description, type, slot, rarity, value, weight, relative level, boolean flags such as `isVehicle`, `isCraftingStation`, `isProcessingStation`, `isHarvestable`, `isSalvageable`, and `isContainer`, plus attribute bonuses, status effects, and freeform properties.
  - `alterThing({ thing, alteration })`: resolves a thing by ID/name and runs the existing `thing-alter` prompt flow against the whole resolved thing stack. Partial stack changes should split the stack first, then alter the split stack.
  - `alterNpc({ npc, alteration })`: resolves an NPC by ID/name and runs the existing `alter_npc` event flow. Player characters are rejected; use this only for NPCs.
  - `alterLocation({ location, region?, alteration })`: resolves a location by ID/name (optionally disambiguated by region) and runs the existing `alter_location` event flow to update the location description/name/base level/short description.
- For world-mutation tools above, recoverable problems are returned to the model as structured `<toolError>` output (including disambiguation candidates with IDs and location context) so it can choose follow-up calls. This includes async tool-handler rejections such as `ToolVisibleError` failures from stub-creation helpers.
- When realtime streaming is enabled, the final response may omit `eventChecks`, `events`, and other event artifacts (they are stripped for streaming clients).
- Realtime `chat_complete` websocket payloads may include `completionSoundPath` (from `chat_completion_sound` config) so clients can play a completion cue; travel actions may defer playback until movement completes.
- When travel prose is returned and a player destination is present/effective, event checks are split into origin/destination; the response includes `eventChecksOrigin`/`eventsOrigin` and `eventChecksDestination`/`eventsDestination`.
- Turn-end `event-summary` chat entries now append a time-passed summary item when `timeProgress.advancedMinutes > 0`, using natural duration text such as `1 minute passed.`, `4 hours and 3 minutes passed.`, or `1 day, 3 hours, and 4 minutes passed.` When exit-driven travel overrides an LLM-authored `time_passed`, the summary uses the effective exit travel time instead of the discarded prompt duration.
- `<travelProse><vehicleInfo>` is optional. Vehicle moves are parsed from `<vehicleInfo><name>...</name></vehicleInfo>` plus `<vehicleInfo><vehicleDestination><location>...</location><region>...</region></vehicleDestination></vehicleInfo>` (legacy plain-text `<vehicle>name</vehicle>` and legacy `<vehicle><destination>...</destination>` are rejected). In destination blocks, `<location>` and `<region>` are individually optional but at least one must be present. When a vehicle name and effective vehicle destination are present, that vehicle location/region is resolved against the parsed vehicle destination.
- When a vehicle name is present, `<vehicleInfo><travelTime>...</travelTime></vehicleInfo>` is parsed into minutes. Positive travel times start an underway trip by setting `vehicleInfo.ETA`/`departureTime`, preserving the vehicle's current outside exit for location tracking, storing the requested target in `vehicleInfo.pendingDestination`, and deferring unknown destination creation plus final `currentDestination` resolution until arrival finalization. `0` (or omitted `travelTime`) keeps the old immediate-move behavior. For location vehicles traveling across regions, immediate travel and due-arrival finalization now also reassign the vehicle location itself into the destination region instead of leaving it in the origin region with a cross-region outside exit. Until that arrival finalization completes, the tracked outward vehicle exit remains hidden even if `ETA` has already elapsed. Providing `travelTime` without a vehicle name is rejected.
- Malformed player-action/creative travel XML now gets one shared `xml_fix` retry: the server sends the broken XML plus the first fatal strict-parser error text to `prompts/xml-fix.xml.njk`, then re-parses the repaired XML once. If the retry still fails, the request is rejected with the parse diagnostics instead of falling through to later travel-prose validation errors.
- `<travelProse><playerDestination>` is interpreted as the optional player destination and must use structured tags (`<playerDestination><location>...</location><region>...</region></playerDestination>`; legacy `<destination>` and plain-text destination content are rejected). In destination blocks, `<location>` and `<region>` are individually optional but at least one must be present. If omitted, or ignored because vehicle movement takes precedence, or ignored because the player's active vehicle arrived at that location/region earlier in the same turn, all travel prose segments are concatenated and event-checked as a single final-prose pass.
- If player and vehicle destinations match, vehicle movement takes precedence and player destination is ignored unless the vehicle is already at that destination and did not just arrive there this turn. On the turn a vehicle arrives, disembark moves to that location/region are deferred until the following turn.
- For split `<travelProse>` turns, origin/destination event-check passes allow `item_appear` and `scenery_appear` outcomes to be applied even after movement is marked processed.
- Travel-prose destination handling now unstubs both region-entry stubs and regular location stubs before applying either player or vehicle movement.
- When a travel-prose vehicle destination requires creating a new destination location/stub, that creation is anchored to the vehicle's source location (not the player's current location). If that origin is a location vehicle, the helper-created plain origin exit is suppressed so the vehicle keeps only its dedicated vehicle exit to the destination, that suppression intent persists through later location-stub expansion, and travel-driven unstub/expansion now stamps the suppression flag onto already-existing destination stubs before expansion as well.
- If a travel-prose destination names an unknown region, the server creates/resolves it through the region-entry stub flow instead of failing. For timed vehicle travel, that creation is deferred until arrival finalization; region-only destinations (`<region>...</region>` with no `<location>`) then resolve to the region's entrance.
- If a travel-prose vehicle move targets a region-entry stub, the stub is expanded and only the vehicle is moved; the player stays at their current location.
- When a travel-prose vehicle move changes a vehicle's outside location, the server appends an event-themed chat summary entry (`📋 Events – Vehicle Movement`) using that vehicle's icon.
- Region random-event seed generation (`random_event_seed_region`) is fire-and-forget during turn handling; if the current region has no seeded regional events yet, random-event triggering is skipped for that request.
- For event-driven travel turns that return `<finalProse>` (not `<travelProse>`), non-travelProse event checks still apply narrated movement; metadata destination enforcement only forces the travel destination when no move has already been applied that turn.
- If the travel prose destination does not match a known location or region, the server creates the missing destination through the event-driven location/region creation flow instead of failing the turn.
- Travel actions are guarded by a per-player non-blocking move lock; overlapping move requests for the same player return `409`.
- If the player has pending level-up ability picks, `/api/chat` returns `409` with `pendingAbilitySelection` and does not resolve the turn.
- Event-driven travel origin/destination resolution now requires authoritative `gameLocations` presence (no `Location` index fallback for movement).
- Movement integrity checks repair stale region membership by removing region `locationIds` entries whose locations are no longer registered, with a server warning. Other broken movement graph references, such as the current player location or exit destinations pointing at missing locations, still fail loudly.
- Supplemental story info prompts append `supplemental-story-info` entries linked to the main turn entry; these are stored server-side for base-context prompts and are not sent to clients. They run asynchronously after turn resolution and do not block the response. Frequency is controlled by `supplemental_story_info_prompt_frequency` (`0` disables, `>0` runs every X turns), prompts also run on turns where new NPCs or things were generated, and automatic scheduling is additionally gated by `extra_plot_prompts.supplemental_story_info`. Only one supplemental story info prompt runs at a time; additional requests are skipped while one is in flight.
- Party-memory `npc_memories` prompts run as post-response background work. They can add memories, update goals/dispositions, and emit `chat_history_updated` if a disposition summary entry is created, but the chat/travel HTTP response no longer waits for those prompts to finish.
- Plot summary prompts append hidden `plot-summary` entries linked to the main turn entry. They are scheduled every 10 player action submissions (normal/creative actions; excludes `?`, `@`, `!!`, and `#` flows), run asynchronously (fire-and-forget), and do not block event checks or response delivery. Automatic scheduling is gated by `extra_plot_prompts.plot_summary`. Old entries remain in saved chat history but are hidden from client history and excluded from normal base-context history assembly.
- Plot expander prompts append hidden `plot-expander` entries linked to the main turn entry. They are scheduled on eligible player action turns using `plot_expander_prompt_frequency` (default `10`, `0` disables), run asynchronously (fire-and-forget), and do not block event checks or response delivery. Automatic scheduling is also gated by `extra_plot_prompts.plot_expander`. Old entries remain in saved chat history but are hidden from client history and excluded from normal base-context history assembly.
- When a player turn changes the player's location, the server also performs a blocking base-context `while-you-were-away` pass before the arrival scene is refreshed. `whileYouWereAwayNpcs` now includes all current-location NPCs with valid reunion last-seen data so already-present NPCs are not mistaken for arrivals, but the prompt still only runs when one or more of them were not with the player on the previous round and have been away at least `while_you_were_away_threshold_minutes` (default `240`). The response can apply NPC need-bar percentage deltas, optionally move those NPCs via structured `<travelDestination>` data, accepts additional arrival-only current-location updates marked with literal `HERE`, always stores a hidden `while-you-were-away` chat entry linked to the main turn entry, and also appends a normal visible `while-you-were-away-player` assistant entry when the prompt returns non-empty `<proseForPlayer>`.
- Offscreen NPC activity prompts also append hidden server-side entries (`offscreen-npc-activity-daily`, `offscreen-npc-activity-weekly`) linked to the main turn entry:
  - Twice daily when world time crosses `07:00` or `19:00`, requesting `offscreen_npc_activity_prompt_count` non-present NPC updates since last mention; automatic scheduling is gated by `extra_plot_prompts.offscreen-npc-activity-daily`.
  - For daily runs, the hidden heading reports elapsed in-game minutes since the previous successful daily run; first run uses the standard twice-daily heading.
  - For weekly runs, the hidden heading reports elapsed in-game minutes since the previous successful weekly run; first run uses the standard weekly heading.
  - Weekly when world time crosses the weekly checkpoint (`dayIndex % 7 == 0` at `07:00`), requesting 15 non-present NPC updates over the past week, excluding names already surfaced by twice-daily prompts during that week; automatic scheduling is gated by `extra_plot_prompts.offscreen-npc-activity-weekly`.
  - If elapsed time crosses multiple offscreen checkpoints in one turn, only one offscreen NPC activity prompt runs for that turn.
  - When an offscreen entry marks an NPC as moved (`<moved>true</moved>`), the server attempts to update that NPC's `currentLocation` and location NPC lists using the reported region/location, and logs the result server-side only (no client-facing movement notification).

Errors:
- 400: `{ error: string, requestId?, streamMeta? }` (missing `messages`, invalid `travelMetadata`, etc.)
- 409: `{ error: string, pendingAbilitySelection?, requestId?, streamMeta? }` (concurrent move lock contention or pending player ability selection)
- 408: `{ error: string, requestId?, streamMeta? }` (timeout)
- 503: `{ error: string, requestId?, streamMeta? }` (connection issues)
- 500: `{ error: string, requestId?, streamMeta? }`

## GET /api/chat/history
Returns pruned chat history (system entries and some summaries filtered).

Notes:
- Uses `client_message_history.max_messages` as a turn-based visibility cap for client history.
- This is independent from `recent_history_turns`, which only affects base-context prompt construction.
- Query options:
  - `includeAllEntries=true|false` (default `false`): when `true`, returns the full stored `chatHistory` in oldest-first order with no pruning and no hidden/orphan filtering. Intended for Story Tools/admin-style views.
  - Accepted boolean values: `true`, `false`, `1`, `0`, `yes`, `no`, `on`, `off`.

Response (200):
- `{ history: ChatEntry[], count: number, worldTime: object }` (no `success` flag)

Errors:
- 400: `{ error: string }` when `includeAllEntries` is provided but not a valid boolean value.

## DELETE /api/chat/history
Clears chat history.

Response (200):
- `{ message: 'Chat history cleared', count: 0 }` (no `success` flag)

## PUT /api/chat/message
Edits a single chat entry by id or timestamp.

Request:
- Body: `{ content: string, id?: string, timestamp?: string }` (must include `content` and either `id` or `timestamp`)

Response:
- 200: `{ success: true, entry }`
- 400: `{ success: false, error }` (missing content/id)
- 404: `{ success: false, error: 'Message not found' }`

Notes:
- Editing an `event-summary` entry clears `summaryItems` and normalizes `summaryTitle`.

## DELETE /api/chat/message
Deletes a chat entry by id or timestamp and removes orphaned children.

Request:
- Body: `{ id?: string, timestamp?: string }`

Response:
- 200: `{ success: true, removed: ChatEntry, orphaned: ChatEntry[] }`
- 400: `{ success: false, error }`
- 404: `{ success: false, error: 'Message not found' }`
