# Utils

## Purpose
Collection of static utility helpers used across the server: set math, text similarity, XML parsing, game-state serialization, pending region stub maintenance, and chat summary queues.

## Set/Text Helpers
- `intersection(setA, setB)`, `difference(setA, setB)`, `union(setA, setB)`.
- `roundAwayFromZero(value)`.
- `longestCommonSubstringLength(a, b)`.
- `capitalizeProperNoun(str, { remove_articles = false })`: title-cases and normalizes item/location names, optionally stripping a/an/the from the start.
- K-gram utilities:
  - `pruneContainedKgrams(ngrams)`.
  - `hasKgramOverlap(a, b, { k, minMatches })`.
  - `findKgramOverlaps(a, b, { minK, maxK })`.
  - `findKgramOverlap(a, b, { k })`.

## XML Helpers
- `innerXML(node)`.
- `parseXmlDocument(xmlContent, mimeType)` with cheerio-based normalization for malformed XML.

## Game Balance Helpers
- `getMinimumUnmitigatedWeaponDamage(rarity, level)` (uses rarity definitions from `Thing` and `Globals.config.baseWeaponDamage`).

## Game State Serialization
- `serializeGameState(context)`.
- `writeSerializedGameState(saveDir, serialized)`.
- `loadSerializedGameState(saveDir)`.
- `hydrateGameState(serialized, context)`.

## Pending Region Stub Maintenance
- `rebuildPendingRegionStubs({ pendingRegionStubs, regions, gameLocations, gameLocationExits })`.
- `mergeDuplicatePendingRegionStubs({ pendingRegionStubs, regions, gameLocations, gameLocationExits })`.

## Chat Summary Store/Queue
- `setChatSummary(messageId, summaryPayload)` / `getChatSummary(messageId)` / `hasChatSummary(messageId)`.
- `serializeChatSummaries()` / `loadChatSummaries(data)` / `getAllChatSummaries()`.
- `enqueueChatSummaryCandidate(candidate)` / `dequeueChatSummaryBatch(batchSize)`.
- `getChatSummaryQueueLength()` / `peekChatSummaryQueue()`.

## Private Helpers (Selected)
- K-gram internals: `#normalizeKgramTokens`, `#buildKgramSet`, `#containsSubgram`.
- XML internals: `#getDomParserInstance`, `#normalizeXmlWithCheerio`.
- Lazy module getters: `#getLocationModule`, `#getLocationExitModule`, `#getRegionModule`, `#getThingModule`, `#getPlayerModule`, `#getSkillModule`.

## Notes
- `serializeGameState`/`writeSerializedGameState` also persist canonical world time and calendar definition (`worldTime.json`, `calendarDefinition.json`), and hydration restores them through `Globals.hydrateWorldTime(...)`.
- `serializeGameState` and `hydrateGameState` coordinate `Location`, `Region`, `Thing`, `Player`, `Skill`, and stubs into a consistent save/load flow.
- Pending region stubs are aggressively validated; missing ids or duplicates throw explicit errors.
