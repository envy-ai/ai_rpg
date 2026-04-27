# Events

## Purpose
Runs LLM-based event checks on narrative text, parses structured outcomes, and applies those outcomes to the game world (locations, items, NPCs, quests, and status effects). Tracks discovered/altered entities to avoid duplicates.

For a full reference of non-dummy event type keys, payloads, and application behavior, see [EventsEventTypes.md](EventsEventTypes.md). For the planned single-prompt XML event format, see [EventsXmlEventSchema.md](EventsXmlEventSchema.md).

## Key State (Static)
- Dependency container: `_deps` (promptEnv, parseXMLTemplate, prepareBasePromptContext, Location, players, things, findRegionByLocationId, config accessors, etc).
- Parsers/aggregators/handlers: `_parsers`, `_aggregators`, `_handlers`.
- Tracking sets: `animatedItems`, `alteredItems`, `newItems`, `obtainedItems`, `destroyedItems`, `droppedItems`, `alteredCharacters`, `newCharacters`, `arrivedCharacters`, `departedCharacters`, `defeatedEnemies`, `movedLocations`.
- Timeouts and durations: `_baseTimeout`, `DEFAULT_STATUS_DURATION`, `MAJOR_STATUS_DURATION`.

## Public API (Static)
- `initialize(deps)`: registers dependencies and builds parsers/aggregators/handlers.
- `runEventChecks({ textToCheck, actionText, stream, allowEnvironmentalEffects, isNpcTurn, suppressMoveEvents, allowMoveTurnAppearances, _depth, followupQueue })`:
    - Renders grouped event-check prompts plus a dedicated parallel need-bar prompt, calls `LLMClient.chatCompletion`, parses `<final>` and `<characters>` responses, and applies results through the shared handler pipeline.
- `runQuestChecks({ allowWithoutEventChecks })`: LLM check for quest objective completion, including per-objective prompt `statusReason` text for completed objectives.
- `applyEventOutcomes(parsedEvents, context)`: applies structured changes to world state.
- `processQuestObjectiveCompletionEntries(entries, context)`: applies quest objective completion and rewards (items/xp/currency plus per-faction reputation deltas when configured on the quest), preserving the prompt-supplied completion reason on emitted objective updates.
- `mergeQuestOutcomesIntoStructured(parsedEvents, questOutcomes)`.
- `extractItemAndSceneryNames(rawEvents)`.
- `resolveLocationCandidate(candidate)`.
- `addThingToLocation(thing, candidate)` / `removeThingFromLocation(thing, candidate)`.
- `cleanEventResponseText(text)` / `escapeHtml(text)`.
- `logEventCheck({ systemPrompt, generationPrompt, responseText, label, requestPayload, responsePayload })`.

## Accessors (Static)
- `get config()`.
- `get currentPlayer()`.
- `get players()` / `get things()`.

## Private Helpers (Grouped)
- Tracking helpers: `_resetTrackingSets`, `_isItemAlreadyTracked`, `_trackItemsFromParsing`, `_pruneExcludedItemEntries`.
- Prompt helpers: `_enqueueFollowupEventCheck`, `_runEventChecksForRewardProse`, `_runNeedBarEventChecks`.
- Parser helpers: `_buildParsers`, `_parseEventPromptResponse`, `_extractNumberedResponses`, `_parseNeedBarPromptResponse`, `_serializeNeedBarPromptEntries`.
- NPC ensuring: `_ensureNpcMentions`.
- Aggregation/handler builders: `_buildAggregators`, `_buildHandlers`.
- Location alteration: `_parseLocationAlterXml`, `_applyLocationAlteration`, `_logAlterLocation`, `_clearLocationImage`.
- Quest generation: `_parseQuestXml`, `_logQuestGeneration`, `_generateQuestName`, `parseQuestObjectiveStatusXml`.
- NPC/character alteration: `_parseCharacterAlterXml`, `_applyCharacterAlteration`, `_handleAlterNpcEvents`.
- Items: `_generateItemsIntoWorld`, `_ensureItemsExist`, `_removeItemFromInventories`, `_detachThingFromKnownLocation`, `_detachThingFromWorld`, `_resolveContainingThing`, `_placeSplitThingWithSourceContext`, `_createPlaceholderThingForAlter`.
- Combat/healing helpers: `_estimateHealingAmount`, `_severityToDamage`.
- Attribute normalization: `_mapAttributeRatingToValue`, `_clampAttributeValue`, `_clampLevel`, `_resolveNpcBaseLevelReference`.
- Scene helpers: `_buildSceneItemNameSet`.

## Notes
- Event prompts are grouped (locations, items, NPCs, misc), and `runEventChecks` now also runs `prompts/_includes/need-bars.njk` in parallel so need-bar effects are decided independently of the numbered event groups; the dedicated need-bar prompt is submitted first, then the grouped event prompts are queued.
- Event check responses must include a `<final>` block; `runEventChecks` enforces this via `requiredRegex` so the LLM client retries when it is missing.
- Combined answers across groups are stitched into a single numbered list and parsed as the final block text (no extra `<final>` wrapper).
- Dedicated need-bar checks require a `<characters>` block, are logged under the `need_bar_event_checks` prompt label, and are converted into ordinary `needbar_change` entries before `applyEventOutcomes(...)` runs.
- Before applying outcomes, event checks ensure referenced NPCs exist (excluding death/incapacitation and defeated-enemy mentions), so downstream handlers can resolve actors; new NPC names are normalized via `Utils.capitalizeProperNoun` with leading-article stripping, while existing NPCs are left untouched. During ensure, if no exact name exists but the requested name is a leading token of an NPC currently in the same location (for example `Bob` vs `Bob Ross`), the first matching location NPC is reused instead of generating a new one.
- `LLMClient.logPrompt` is always used for event-check logging; failures should surface loudly.
- Many helpers are defensive and throw on missing dependencies to avoid silent corruption.
- Item alteration updates `Thing.shortDescription` when provided by the alteration prompt, otherwise preserving the existing value.
- Item alteration treats optional list/effect fields in the returned item XML as authoritative. Missing or empty attribute bonuses and `causeStatusEffectOnTarget`/`causeStatusEffectOnEquipper` tags remove the corresponding previous data; populated tags replace it. Populated target/equipper status effects are synchronously expanded through status-effect generation before the altered item is persisted or logged, so normal `alter_item` events and chat-tool alterations get the same mechanical stats.
- `item_inflict` events ignore the prompt-provided status effect text and always apply the item's configured target inflict effect (`causeStatusEffectOnTarget`) to the target when available.
- `item_ingest` events now parse as `[item] → [target]` and infer the applied status effect from the ingested item's configured target effect instead of requiring the prompt to name the effect.
- Quantity-aware item events now require explicit positive-integer quantities for `consume_item`, `transfer_item`, `pick_up_item`, `drop_item`, `harvest_gather`, and `item_appear`; `alter_item` requires a positive integer or `all`; legacy quantity-less forms are rejected during parsing.
- Quantity-aware item handlers now move, remove, or alter exact stack amounts instead of implicitly acting on a whole `Thing`. Partial-stack moves/consumption/alterations preserve the original item's stats/image and keep existing `metadata.value` unchanged while only adjusting stack count; partial `alter_item` splits the requested quantity into the same owner/location/container before altering that new stack.
- If the same turn reports both `item_ingest` and `item_inflict` for the same item-target pair, the `item_inflict` entry is ignored so the effect is only applied once.
- When `item_inflict` or `item_ingest` applies a status, Events emits a synthesized `status_effect_change` entry so status summaries are delivered to the client even if no separate NPC-group status entry is present.
- `status_effect_change` de-duplicates gained effects against same-turn item-triggered status applications for the same entity; duplicate gain entries are skipped when names match exactly or when the status-change name starts with the already-applied item-triggered effect name.
- `death_incapacitation` skips `dead` outcomes for NPCs already marked dead, preventing duplicate death application. New dead outcomes zero current health with a finite delta before setting `isDead`, then apply the `Deceased` status effect; incapacitated outcomes still zero health and apply `Incapacitated` without setting `isDead`.
- `alter_npc` requests now require an `<npc>...</npc>` block from the model and always log prompt/response payloads through `LLMClient.logPrompt` before parse/apply.
- `alter_location` can be invoked from event checks, the chat `alterLocation` tool, or API helpers such as current-location modification; when a caller supplies `context.location`, the handler matches that location instead of only the global current location.
- `alter_location` accepts `context.preserveBaseLevel=true` or an entry-level `preserveBaseLevel=true` for flows that may rewrite the location name, short description, and description while keeping the existing `baseLevel` unchanged. The location-modification UI endpoint uses this option so player-made scenery/environment changes do not silently retune encounter difficulty.
- `_parseCharacterAlterXml` can parse wrapped or escaped model output by decoding basic entities and extracting the first `<npc>...</npc>` block before XML parsing.
- `suppressMoveEvents` skips applying `move_location` and `move_new_location` outcomes; this is primarily used for split `<travelProse>` origin/destination checks where movement is handled by the travel pipeline.
- `move_new_location` parsing treats `sublocation` as `location` so sublocations generate full location stubs when move events are applied (unless move events are suppressed).
- When `move_new_location` entries are present but `context.location` is missing, the handler now logs a warning before skipping movement/exit creation.
- Non-`<travelProse>` turns should generally leave move suppression disabled so narrated movement in event checks can still move the player.
- Follow-up event-check passes inherit `suppressMoveEvents`/`allowMoveTurnAppearances` from the parent check to keep move-handling behavior consistent across queued reward/follow-up prose.
- `allowMoveTurnAppearances` allows `item_appear` / `scenery_appear` handlers to run even when `Globals.processedMove` is true (used for `<travelProse>` event-check passes).
- `move_location` no longer pre-marks destinations in `Events.movedLocations` before movement; destination tracking is now only recorded after a successful `setLocation` write.
- `movePlayerToDestination(...)` enforces at most one player move per turn (`Globals.processedMove`, unless `allowAdditionalPlayerMoves` is explicitly true in context) and sets `Globals.processedMove` only after verifying the player's `currentLocation` matches the resolved destination id. For non-vehicle player/party event movement, it advances world time using `Location.findShortestTravelTimeMinutes(...)`; if no route exists, it uses `1` minute and suppresses later `time_passed` advancement for that event pass.
- `applyExitDiscovery(...)` now silently skips forbidden event-created exits with `console.warn(...)` diagnostics: any new exit from a location vehicle origin, and any new region exit from a region-vehicle origin. Existing matching exits remain usable by event movement.
- `new_exit_discovered` now accepts the prompt's optional fifth arrow field for travel time, parses it through `Utils.parseDurationToMinutes`, and threads the resulting `travelTimeMinutes` into event-created location stubs, region stubs, and direct exit/reverse-exit wiring. Legacy four-field entries still parse with no travel time.
- Event-created location stubs now store both a concrete stub base level and the original relative-level base so later stub expansion keeps location-relative difficulty anchored to the origin location level instead of drifting to player/default prompt context; event-created region-entry stubs likewise stamp a concrete stub base level from the current region average.
- `_generateItemsIntoWorld` passes generation `options` to `generateItemsByNames`; `treatAsScenery` / `treatAsResource` now preserve scenery classification in generated `Thing` records.
- `_parseCharacterAlterXml` treats a missing/blank `<relativeLevel>` as null (no level write), preventing accidental resets to base-relative level 0 during `alter_npc`.
- `time_passed` parsing ignores the prompt's leading reasoning field and parses only the final arrow-delimited duration segment through `Utils.parseDurationToMinutes` (`HH:MM`, integer minutes, or day/hour/minute/round units); legacy duration-only responses still work, and malformed duration values are logged and skipped.
- `time_passed` accepts `0` from event checks; when this occurs, Events still advances canonical world time by 1 minute to avoid fully static clocks on zero-time turns.
- Arrow-delimited event parsing accepts both ASCII `->` and unicode arrows (for example `→`), preventing malformed NPC/item names when models emit typographic arrows.
- `disposition_check` is parsed and applied directly to NPC disposition toward the current player, and applied deltas are emitted as `dispositionChanges`.
- `faction_reputation_change` is parsed and applied to player faction standings with fixed magnitudes (`a little` = `1`, `a lot` = `4`, signed by increase/decrease); entries are ignored unless a witness from that faction is present at the current location or in the party, and applied deltas are emitted as `factionReputationChanges`.
