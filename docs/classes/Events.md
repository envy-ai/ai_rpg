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
- `runEventChecks({ textToCheck, stream, allowEnvironmentalEffects, isNpcTurn, _depth, followupQueue })`:
  - Renders event-check prompts, calls `LLMClient.chatCompletion`, parses responses, applies results.
- `runQuestChecks({ allowWithoutEventChecks })`: LLM check for quest objective completion.
- `applyEventOutcomes(parsedEvents, context)`: applies structured changes to world state.
- `processQuestObjectiveCompletionEntries(entries, context)`: applies quest objective completion and rewards.
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
- `LLMClient.logPrompt` is always used for event-check logging; failures should surface loudly.
- Many helpers are defensive and throw on missing dependencies to avoid silent corruption.
- Item alteration updates `Thing.shortDescription` when provided by the alteration prompt, otherwise preserving the existing value.
