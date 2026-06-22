# Utils

## Purpose

Static utility helpers used across the server for set math, title casing, duration/time parsing, k-gram text overlap checks, XML extraction/parsing, game-state serialization, save hydration, pending-region stub maintenance, and chat summary queues.

## Set, Text, And Duration Helpers

- `intersection(setA, setB)`, `difference(setA, setB)`, `union(setA, setB)`.
- `roundAwayFromZero(value)`.
- `longestCommonSubstringLength(a, b)`: returns the length of the longest shared contiguous substring and throws if either argument is not a string.
- `capitalizeProperNoun(str, { remove_articles = false })`: title-cases and normalizes item/location names, optionally stripping a/an/the from the start.
- `parseDurationToMinutes(value, { fieldName, allowSigned })`: strict shared duration parser accepting numeric minute values, integer minute strings, `HH:MM`, and unit text for days, hours, minutes, seconds, and rounds. Unit-bearing quantities may be decimal (`2.5 hours`), second values are rounded to the nearest minute, and numeric inputs are rounded to the nearest minute; bare decimal strings without units are rejected. Shared abbreviations include `day`/`d`, `hr`/`hrs`/`h`, `min`/`mins`/`m`, `sec`/`secs`/`s`, and `rnd`/`rnds`, and adjacent compact forms like `3d4h2m` are accepted. Before parsing, stray punctuation is scrubbed by deletion rather than replacement, preserving decimals plus `:`/`,` and an optional leading unary sign, so inputs like `8+ hours` become `8 hours` and `minute(s)` becomes `minutes`. When `allowSigned` is `true`, a leading unary `+` or `-` is accepted with or without an intervening space (for example `+10m`, `-3 hours`, or `- 1d5h`). Signed values throw unless `allowSigned` is enabled. Parse failures emit a console backtrace before throwing.
- `normalizeGeneratedExitTravelTimeMinutes(value, { fieldName })`: validates prompt-generated exit minute values and promotes explicit `0`-minute AI output to `1`, preserving `0` as the “unpopulated travel time” sentinel for save/load and backfill flows.
- `formatMinutesAsDuration(value, { includeAgo })`: formats integer minutes as `X days, Y hours, Z minutes` with zero-value units omitted except for exact zero (`0 minutes`). Returns `null` for non-finite or non-integer inputs; negative values append `ago` when `includeAgo` is true.
- `formatMinutesAsNaturalDuration(value, { includeAgo })`: formats integer minutes for prose/notification text using natural joins: `A`, `A and B`, or `A, B, and C`. Returns `null` for non-finite or non-integer inputs.
- `formatAbsoluteWorldMinutesAgo(value, { currentTotalMinutes })`: converts an absolute “minutes since game start” timestamp into natural `ago` text. Nullish timestamps return `null`; finite non-negative timestamps are required, and `currentTotalMinutes` cannot be earlier than the timestamp.
- K-gram utilities:
  - `normalizeKgramTokens(text, { excludeNpcNames = true })`: lowercases and tokenizes text, removes common words, and by default removes tokenized NPC names and aliases from the current `Player` registry.
  - `pruneContainedKgrams(ngrams)`.
  - `hasKgramOverlap(a, b, { k, minMatches })`.
  - `findKgramOverlaps(a, b, { minK, maxK })`.
  - `findKgramOverlap(a, b, { k })`.

## XML Helpers

- `innerXML(node)`.
- `extractXmlNodeContent(node)`: returns trimmed text for prompt nodes containing CDATA children, while preserving serialized inner XML for ordinary prompt nodes.
- `extractFinalXmlRootBlock(input, rootTags)`: finds the last complete XML block whose root tag is one of the requested names and returns only that block. Root attributes are supported. Matching starts from the final closing tag for each candidate root and walks backward, tracking same-named nested tags, so fields such as `<region>...</region>` inside a root `<region>` do not truncate the extracted block and unmatched earlier opening tags do not block the final complete block. Player-action XML parsing uses this so draft/thinking text containing earlier `<turnResult>`, `<moveTurnResult>`, or `<rejected>` tags does not confuse final prose selection.
- `extractFinalXmlBlockFromResponse(input)`: infers the final XML root from the last closing tag in an LLM response, strips trailing text after that closing tag, then returns the final complete block for that root using backward depth-aware root extraction. This supports responses with analysis or draft XML before the final XML answer and commentary after it.
- `parseXmlDocument(xmlContent, mimeType)`: parses XML with `@xmldom/xmldom`. When `Globals.config.strictXMLParsing` is false, it first runs cheerio XML-mode normalization and strips punctuation from attribute names; when strict parsing is enabled, it parses the trimmed input directly.
- `parseXmlDocumentStrict(xmlContent, mimeType)`: parses the trimmed XML directly with parser diagnostics enabled. Malformed XML throws with collected syntax diagnostics, including parser-reported line/column data when available.
- XML parse failures log a bounded diagnostic with the error message, input length, parser position when available, and a short excerpt instead of dumping the full XML/prompt payload to the console.

## Game Balance Helpers

- `getMinimumUnmitigatedWeaponDamage(rarity, level)` (uses rarity definitions from `Thing` and `Globals.config.baseWeaponDamage`).

## Game State Serialization

- `serializeGameState(context)`.
  - Serializes locations, location exits, regions, things, players, factions, skills, chat history, generated images, pending region stubs, setting data, world time, calendar definition, per-game config override YAML, chat summaries, scene summaries, mystery boxes, mystery threads, and scheduled events.
  - Writes metadata counts, current player identity, `IdGenerator` counters, active plot analysis from `Globals.getPlotAnalysis()`, and `enabledMods` normalized as a sorted unique array for load-time mod manifest comparison.
  - Requires the mystery box/thread, scheduled event, and scene summary serializers to be available; missing serializers throw explicit errors.
- `writeSerializedGameState(saveDir, serialized)`.
  - Writes the save directory files used by `loadSerializedGameState`, including `gameWorld.json`, `chatHistory.json`, `images.json`, `things.json`, `allPlayers.json`, `factions.json`, `mysteryBoxes.json`, `mysteryThreads.json`, `scheduledEvents.json`, `skills.json`, `metadata.json`, `pendingRegionStubs.json`, `worldTime.json`, `calendarDefinition.json`, `gameConfigOverride.yaml`, `chatSummaries.json`, `sceneSummaries.json`, and `setting.json` when a setting is present.
- `loadSerializedGameState(saveDir)`.
  - Reads the same file set and returns defaults for missing files. JSON/text read failures are warned and return the file's default shape.
- `hydrateGameState(serialized, context)`.
  - Runs save migrations before object hydration, resets and seeds `IdGenerator`, restores `metadata.plotAnalysis` through `Globals.setPlotAnalysis(...)`, restores world time/calendar through `Globals.hydrateWorldTime(...)`, and loads chat and scene summaries.
  - Clears transient queues/maps supplied in `context` (`jobQueue`, image jobs, pending image work, NPC generation promises, generated images) and clears live registries/maps before re-instantiating saved entities.
  - Hydrates skills first, then factions, mystery boxes, mystery threads, scheduled events, things, players, generated images, chat history, locations, location exits, regions, and pending region stubs. Invalid skill/faction/thing/player/region entries are skipped with warnings.
  - Calls `Player.clearRuntimeRegistries()` and clears static indexes for `Quest`, `Thing`, `Location`, `Region`, `Faction`, `MysteryBox`, `MysteryThread`, `ScheduledEvent`, and `Tracker` before rebuilding records so stale in-memory instances do not survive a load.
  - Normalizes non-string saved location descriptions to an empty string, restores saved `visited` and `favorite` flags, defaults missing `favorite` to false, and infers `visited` as true for non-stub legacy locations and false for stub legacy locations.
  - Defaults missing saved exit `travelTimeMinutes` values to `0`; invalid saved exit minute values throw.
  - Loads mystery boxes through `MysteryBox.loadAll(...)`, mystery threads through `MysteryThread.loadAll(...)`, and scheduled events through `ScheduledEvent.loadAll(...)`. Legacy saves with boxes but no threads hydrate those boxes into one inactive `Legacy Mystery Boxes` thread.
  - Rebuilds pending region stubs and merges duplicate pending-region entries before returning `{ metadata, setting }`.

## Save Migration Compatibility

- Hour-based saves are detected when `serialized.worldTime` has `timeHours` without `timeMinutes`. Migration converts world-time snapshots, player elapsed/visited timestamps, location/region visited timestamps, status-effect duration/appliedAt fields, weather duration ranges/state, and offscreen NPC activity snapshots to minute-canonical values before hydration.
- Pre-`1.1` saves have player/NPC need-bar numeric fields scaled by `10`; `1.1` saves keep those values as stored.
- Pre-`1.2` saves have persisted domain object IDs and exact structured references migrated to compact counter IDs (`char_1`, `thing_1`, `loc_1`, `exit_1`, `region_1`, `faction_1`, `quest_1`, `obj_1`, `status_1`). Migration stores the resulting counters in `metadata.idCounters` and bumps `metadata.saveFileSaveVersion` to `1.2` in memory.
- ID migration rewrites exact structured references, map keys, quest/objective ids, faction relations, pending-region references, status-effect ids, and `metadata.playerId`; it does not rewrite arbitrary prose strings embedded in chat/history metadata.

## Pending Region Stub Maintenance

- `rebuildPendingRegionStubs({ pendingRegionStubs, regions, gameLocations, gameLocationExits })`: validates that `pendingRegionStubs` is a `Map`, removes entries whose regions exist, rebuilds unresolved region-entry stubs from location stub metadata and exit destinations, preserves/merges `locationIds`, and throws when required region identifiers are missing.
- `mergeDuplicatePendingRegionStubs({ pendingRegionStubs, regions, gameLocations, gameLocationExits })`: validates required maps, groups pending regions by normalized name, chooses a canonical entry using entrance references/existence/creation time/id ordering, rewires exits and member location metadata to the canonical region id, preserves merged `locationIds`, updates entrance exit names, and deletes merged duplicate entries.

## Chat Summary Store/Queue

- `setChatSummary(messageId, summaryPayload)` / `getChatSummary(messageId)` / `hasChatSummary(messageId)`: store and retrieve per-entry summary payloads by message id.
- `serializeChatSummaries()` / `loadChatSummaries(data)` / `getAllChatSummaries()`.
- `enqueueChatSummaryCandidate(candidate)` / `dequeueChatSummaryBatch(batchSize)`: enqueue unique `{ entryId, content, locationId, type, timestamp }` summary candidates and return batches only when the queue has at least `batchSize` entries.
- `getChatSummaryQueueLength()` / `peekChatSummaryQueue()`.

## Private Helpers (Selected)

- K-gram internals: `#normalizeKgramTokens`, `#buildKgramSet`, `#containsSubgram`.
- XML internals: `#getDomParserInstance`, `#normalizeXmlWithCheerio`, parse diagnostic formatting, and bounded parse-failure diagnostics.
- Save migration internals: hour-to-minute migration helpers, need-bar scaling helpers, and domain-ID migration helpers.
- Lazy module getters: `#getLocationModule`, `#getLocationExitModule`, `#getRegionModule`, `#getThingModule`, `#getPlayerModule`, `#getSkillModule`, `#getFactionModule`, `#getQuestModule`, `#getMysteryBoxModule`, `#getMysteryThreadModule`, `#getScheduledEventModule`.

## Notes

- `Utils` is a static class; callers require `Utils.js` and invoke methods directly.
- Save/load helpers coordinate `Location`, `LocationExit`, `Region`, `Thing`, `Player`, `Skill`, `Faction`, `MysteryBox`, `MysteryThread`, `ScheduledEvent`, chat summaries, scene summaries, and pending stubs into one serialized state shape.
- `metadata.idCounters` is persisted so compact IDs are not reused after deleted objects disappear from the live world.
- Duration parse failures trace before throwing; XML parse failures warn with bounded excerpts; pending-region validation and invalid saved exit travel times throw explicit errors.
