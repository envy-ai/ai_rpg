# Utils

## Purpose
Collection of static utility helpers used across the server: set math, text similarity, XML parsing, game-state serialization, pending region stub maintenance, and chat summary queues.

## Set/Text Helpers
- `intersection(setA, setB)`, `difference(setA, setB)`, `union(setA, setB)`.
- `roundAwayFromZero(value)`.
- `longestCommonSubstringLength(a, b)`.
- `capitalizeProperNoun(str, { remove_articles = false })`: title-cases and normalizes item/location names, optionally stripping a/an/the from the start.
- `parseDurationToMinutes(value, { fieldName, allowSigned })`: strict shared duration parser accepting minute numbers, `HH:MM`, and day/hour/minute/round unit text; unit-bearing quantities may be decimal (`2.5 hours`) and the final result is rounded to the nearest minute. Shared abbreviations include `day`/`d`, `hr`/`hrs`/`h`, and `min`/`m`, and adjacent compact forms like `3d4h2m` are accepted. Before parsing, stray punctuation is scrubbed globally by deletion rather than replacement, preserving decimals plus `:`/`,` and an optional leading unary sign, so inputs like `8+ hours` become `8 hours` and `minute(s)` becomes `minutes`. When `allowSigned` is `true`, a leading unary `+` or `-` is also accepted with or without an intervening space (for example `+10m`, `-3 hours`, or `- 1d5h`). Parse failures emit a console backtrace before throwing.
- `normalizeGeneratedExitTravelTimeMinutes(value, { fieldName })`: validates prompt-generated exit minute values and promotes explicit `0`-minute AI output to `1`, preserving `0` as the “unpopulated travel time” sentinel for save/load and backfill flows.
- `formatMinutesAsDuration(value, { includeAgo })`: shared minute-based display formatter returning `X days, Y hours, Z minutes` with zero-value units omitted (except `0 minutes` for an exact zero); negative values can append `ago`.
- `formatMinutesAsNaturalDuration(value, { includeAgo })`: shared minute-based formatter for prose/notification text using natural joins: `A`, `A and B`, or `A, B, and C`.
- `formatAbsoluteWorldMinutesAgo(value, { currentTotalMinutes })`: converts an absolute “minutes since game start” timestamp into `X days, Y hours, Z minutes ago` text using the shared natural-duration formatter and current total world minutes.
- K-gram utilities:
  - `pruneContainedKgrams(ngrams)`.
  - `hasKgramOverlap(a, b, { k, minMatches })`.
  - `findKgramOverlaps(a, b, { minK, maxK })`.
  - `findKgramOverlap(a, b, { k })`.

## XML Helpers
- `innerXML(node)`.
- `parseXmlDocument(xmlContent, mimeType)` with cheerio-based normalization for malformed XML.
- `parseXmlDocumentStrict(xmlContent, mimeType)` for strict XML parsing with collected syntax diagnostics; malformed XML throws with parser-reported line/column details instead of being normalized.

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
- `hydrateGameState` includes legacy save migration passes that convert hour-based fields to minute-canonical data (`worldTime`, elapsed/visited timestamps, status-effect duration/appliedAt, weather duration fields, and offscreen scheduler snapshots), scale pre-`1.1` saved player/NPC need-bar values by `10`, and default missing saved exit `travelTimeMinutes` values to `0`, then bump the in-memory save metadata version to `1.1` so the migration does not reapply after the next save.
- `hydrateGameState` clears `Player` runtime registries before re-instantiating saved actors, preventing stale in-memory duplicate instances from surviving loads.
- During `hydrateGameState`, location descriptions are loaded as-is, and non-string descriptions are normalized to an empty string so save hydration continues without placeholder substitution.
- Legacy migration triggers when `serialized.worldTime` has `timeHours` without `timeMinutes`; migrated data is written in-memory before object hydration.
- Pending region stubs are aggressively validated; missing ids or duplicates throw explicit errors.
