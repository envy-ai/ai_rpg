# Events

## Purpose
Runs LLM-based event checks on narrative text, parses structured outcomes, and applies those outcomes to the game world (locations, items, NPCs, quests, and status effects). Tracks discovered/altered entities to avoid duplicates.

## Key State (Static)
- Dependency container: `_deps` (promptEnv, parseXMLTemplate, prepareBasePromptContext, Location, players, things, findRegionByLocationId, config accessors, etc).
- Parsers/aggregators/handlers: `_parsers`, `_aggregators`, `_handlers`.
- Tracking sets: `animatedItems`, `alteredItems`, `newItems`, `obtainedItems`, `destroyedItems`, `droppedItems`, `alteredCharacters`, `newCharacters`, `arrivedCharacters`, `departedCharacters`, `defeatedEnemies`, `movedLocations`.
- Timeouts and durations: `_baseTimeout`, `DEFAULT_STATUS_DURATION`, `MAJOR_STATUS_DURATION`.

## Public API (Static)
- `initialize(deps)`: registers dependencies and builds parsers/aggregators/handlers.
- `runEventChecks({ textToCheck, actionText, stream, allowEnvironmentalEffects, isNpcTurn, suppressMoveEvents, allowMoveTurnAppearances, _depth, followupQueue })`:
    - Renders event-check prompts, calls `LLMClient.chatCompletion`, parses `<final>` block responses, applies results.
- `runQuestChecks({ allowWithoutEventChecks })`: LLM check for quest objective completion.
- `applyEventOutcomes(parsedEvents, context)`: applies structured changes to world state.
- `processQuestObjectiveCompletionEntries(entries, context)`: applies quest objective completion and rewards (items/xp/currency plus per-faction reputation deltas when configured on the quest).
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
- Prompt helpers: `_enqueueFollowupEventCheck`, `_runEventChecksForRewardProse`.
- Parser helpers: `_buildParsers`, `_parseEventPromptResponse`, `_extractNumberedResponses`.
- NPC ensuring: `_ensureNpcMentions`.
- Aggregation/handler builders: `_buildAggregators`, `_buildHandlers`.
- Location alteration: `_parseLocationAlterXml`, `_applyLocationAlteration`, `_logAlterLocation`, `_clearLocationImage`.
- Quest generation: `_parseQuestXml`, `_logQuestGeneration`, `_generateQuestName`, `parseQuestObjectiveStatusXml`.
- NPC/character alteration: `_parseCharacterAlterXml`, `_applyCharacterAlteration`, `_handleAlterNpcEvents`.
- Items: `_generateItemsIntoWorld`, `_ensureItemsExist`, `_removeItemFromInventories`, `_detachThingFromKnownLocation`, `_detachThingFromWorld`, `_createPlaceholderThingForAlter`.
- Combat/healing helpers: `_estimateHealingAmount`, `_severityToDamage`.
- Attribute normalization: `_mapAttributeRatingToValue`, `_clampAttributeValue`, `_clampLevel`, `_resolveNpcBaseLevelReference`.
- Scene helpers: `_buildSceneItemNameSet`.

## Notes
- Event prompts are grouped (locations, items, NPCs, misc) and run sequentially with structured parsing.
- Event check responses must include a `<final>` block; `runEventChecks` enforces this via `requiredRegex` so the LLM client retries when it is missing.
- Combined answers across groups are stitched into a single numbered list and parsed as the final block text (no extra `<final>` wrapper).
- Before applying outcomes, event checks ensure referenced NPCs exist (excluding death/incapacitation and defeated-enemy mentions), so downstream handlers can resolve actors; new NPC names are normalized via `Utils.capitalizeProperNoun` with leading-article stripping, while existing NPCs are left untouched. During ensure, if no exact name exists but the requested name is a leading token of an NPC currently in the same location (for example `Bob` vs `Bob Ross`), the first matching location NPC is reused instead of generating a new one.
- `LLMClient.logPrompt` is always used for event-check logging; failures should surface loudly.
- Many helpers are defensive and throw on missing dependencies to avoid silent corruption.
- Item alteration updates `Thing.shortDescription` when provided by the alteration prompt, otherwise preserving the existing value.
- `item_inflict` events ignore the prompt-provided status effect text and always apply the item's configured target inflict effect (`causeStatusEffectOnTarget`) to the target when available.
- When `item_inflict` applies a status, Events emits a synthesized `status_effect_change` entry so status summaries are delivered to the client even if no separate NPC-group status entry is present.
- `status_effect_change` de-duplicates gained effects against same-turn `item_inflict` applications for the same entity; duplicate gain entries are skipped when names match exactly or when the status-change name starts with the item-inflict effect name.
- `death_incapacitation` skips `dead` outcomes for NPCs already marked dead, preventing duplicate death application.
- `suppressMoveEvents` skips applying `move_location` and `move_new_location` outcomes; this is primarily used for split `<travelProse>` origin/destination checks where movement is handled by the travel pipeline.
- Non-`<travelProse>` turns should generally leave move suppression disabled so narrated movement in event checks can still move the player.
- Follow-up event-check passes inherit `suppressMoveEvents`/`allowMoveTurnAppearances` from the parent check to keep move-handling behavior consistent across queued reward/follow-up prose.
- `allowMoveTurnAppearances` allows `item_appear` / `scenery_appear` handlers to run even when `Globals.processedMove` is true (used for `<travelProse>` event-check passes).
- `_generateItemsIntoWorld` passes generation `options` to `generateItemsByNames`; `treatAsScenery` / `treatAsResource` now preserve scenery classification in generated `Thing` records.
- `time_passed` parsing uses `Utils.parseDurationToMinutes` (`HH:MM`, integer minutes, or day/hour/minute units); malformed values are logged and skipped.
- `time_passed` accepts `0` from event checks; when this occurs, Events still advances canonical world time by 1 minute to avoid fully static clocks on zero-time turns.
- Arrow-delimited event parsing accepts both ASCII `->` and unicode arrows (for example `→`), preventing malformed NPC/item names when models emit typographic arrows.
- `disposition_check` is parsed and applied directly to NPC disposition toward the current player, and applied deltas are emitted as `dispositionChanges`.
- `faction_reputation_change` is parsed and applied to player faction standings with fixed magnitudes (`a little` = `1`, `a lot` = `4`, signed by increase/decrease); entries are ignored unless a witness from that faction is present at the current location or in the party, and applied deltas are emitted as `factionReputationChanges`.
