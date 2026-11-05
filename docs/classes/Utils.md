# Utils

## Purpose

Static utility helpers used across the server for set math, title casing, duration/time parsing, k-gram text overlap checks, XML extraction/parsing, game-state serialization, save hydration, pending-region stub maintenance, and chat summary queues.

## Set, Text, And Duration Helpers

- `intersection(setA, setB)`, `difference(setA, setB)`, `union(setA, setB)`.
- `roundAwayFromZero(value)`.
- `longestCommonSubstringLength(a, b)`: returns the length of the longest shared contiguous substring and throws if either argument is not a string.
- `capitalizeProperNoun(str, { remove_articles = false })`: title-cases and normalizes item/location names, optionally stripping a/an/the from the start.
- `parseDurationToMinutes(value, { fieldName, allowSigned, currentWorldMinute })`: strict shared duration parser accepting numeric minute values, integer minute strings, `HH:MM`, and unit text for days, hours, minutes, seconds, and rounds. Supplying a non-negative integer `currentWorldMinute` additionally enables player-action clock targets such as `until 6:00 AM`, `until 6 AM`, or 24-hour `until 18`; minutes and a leading hour zero are optional, and an exact or already-passed target resolves to its next-day occurrence. Without that explicit clock reference, `until` remains invalid so travel times and other duration fields cannot silently change meaning. Unit-bearing quantities may be decimal (`2.5 hours`), second values are rounded to the nearest minute, and numeric inputs are rounded to the nearest minute; bare decimal strings without units are rejected. Shared abbreviations include `day`/`d`, `hr`/`hrs`/`h`, `min`/`mins`/`m`, `sec`/`secs`/`s`, and `rnd`/`rnds`, and adjacent compact forms like `3d4h2m` are accepted. Before parsing, stray punctuation is scrubbed by deletion rather than replacement, preserving decimals plus `:`/`,` and an optional leading unary sign, so inputs like `8+ hours` become `8 hours` and `minute(s)` becomes `minutes`. A single leading unary `+` is accepted for positive durations with or without an intervening space (for example `+10m`, `+ 2.5 hours`, or `+01:30`). A leading `-` requires `allowSigned: true` (for example `-3 hours` or `- 1d5h`); negative numeric inputs remain subject to the same gate. Repeated leading signs are rejected before punctuation scrubbing. Clock-target syntax after `until` is unchanged. Parse failures emit a console backtrace before throwing.
- `normalizeGeneratedExitTravelTimeMinutes(value, { fieldName })`: validates prompt-generated exit minute values and promotes explicit `0`-minute AI output to `1`, preserving `0` as the “unpopulated travel time” sentinel for save/load and backfill flows.
- `formatMinutesAsDuration(value, { includeAgo })`: formats integer minutes as `X days, Y hours, Z minutes` with zero-value units omitted except for exact zero (`0 minutes`). Returns `null` for non-finite or non-integer inputs; negative values append `ago` when `includeAgo` is true.
- `formatMinutesAsNaturalDuration(value, { includeAgo })`: formats integer minutes for prose/notification text using natural joins: `A`, `A and B`, or `A, B, and C`. Returns `null` for non-finite or non-integer inputs.
- `formatAbsoluteWorldMinutesAgo(value, { currentTotalMinutes })`: converts an absolute “minutes since game start” timestamp into natural `ago` text. Nullish timestamps return `null`; finite non-negative timestamps are required, and `currentTotalMinutes` cannot be earlier than the timestamp.
- K-gram utilities:
  - `normalizeKgramTokens(text, { excludeNpcNames = true })`: lowercases and tokenizes text, removes common words, and by default removes tokenized NPC names and aliases from the current `Player` registry.
  - `normalizeKgramTokenSpans(text, { excludeNpcNames = true })`: applies the same normalization while returning `{ token, start, end }` source spans. Live deslop uses these spans to rewind to the raw model token that began a normalized n-gram.
  - `pruneContainedKgrams(ngrams)`.
  - `hasKgramOverlap(a, b, { k, minMatches })`.
  - `findKgramOverlaps(a, b, { minK, maxK })`.
  - `findKgramOverlap(a, b, { k })`.

## XML Helpers

- `innerXML(node)`.
- `extractXmlNodeContent(node)`: serializes prompt-node children individually, unwrapping each direct CDATA child as verbatim text while preserving ordinary sibling XML elements and comments. This supports fully CDATA-wrapped prompts as well as mixed prompts whose response schema is ordinary XML and whose literal tag-bearing instructions use CDATA.
- `extractFinalXmlRootBlock(input, rootTags, { requireComplete = false })`: selects the final top-level envelope with one of the requested root names. Root attributes, nested same-name roots, and self-closing roots are supported. The shared [XmlResponse](XmlResponse.md) scanner ignores tag-shaped text in quotes, comments, CDATA, declarations, and matched inline code. An incomplete final envelope stays selected rather than returning an earlier draft or valid descendant; `requireComplete: true` returns an empty string for that incomplete final selection. No matching root returns an empty string.
- `extractFinalXmlBlockFromResponse(input)`: selects the final outer XML envelope without requiring a known root name. It strips surrounding commentary and Markdown fences, preserving an incomplete final envelope for parser diagnostics. An open outer root cannot be replaced by a valid inner element.
- `parseXmlDocument(xmlContent, mimeType)`: always isolates the first outer root before parsing with `@xmldom/xmldom`, stripping all preceding/following content. When `Globals.config.strictXMLParsing` is false, the isolated root first passes through the existing cheerio XML-mode normalization and punctuation stripping for attribute names. Strict mode parses the isolated root directly.
- `parseXmlDocumentStrict(xmlContent, mimeType)`: isolates the first outer root and parses it directly with diagnostics enabled. Surrounding prose, fences, other roots, comments, or declarations cannot cause outside-root parse errors. Malformed XML inside the selected envelope still throws with collected syntax diagnostics, including parser-reported line/column data when available. Extraction never repairs internal XML. Both parser helpers explicitly reject input with no root element before invoking the XML parser.
- XML parse failures log a bounded diagnostic with the error message, input length, parser position when available, and a short excerpt instead of dumping the full XML/prompt payload to the console.

## Game Balance Helpers

- `getMinimumUnmitigatedWeaponDamage(rarity, level)` (uses rarity definitions from `Thing` and `Globals.config.baseWeaponDamage`).

## Game State Serialization

- `serializeGameState(context)`.
  - Serializes locations, location exits, regions, things, players, factions, skills, chat history, generated images, pending region stubs, setting data, world time, calendar definition, per-game config override YAML, chat summaries, scene summaries, mystery boxes, mystery threads, and scheduled events.
  - Writes metadata counts, current player identity, `IdGenerator` counters, active plot analysis from `Globals.getPlotAnalysis()`, and `enabledMods` normalized as a sorted unique array for load-time mod manifest comparison.
  - Requires the mystery box/thread, scheduled event, and scene summary serializers to be available; missing serializers throw explicit errors.
- `writeFileAtomic(filePath, contents)` (async).
  - Writes `contents` to a temporary file in the target directory and renames it over `filePath`, so readers never observe a partially written file. Used by the runtime save-metadata, scene-summary, and mystery box/thread persistence paths in `api.js` that overwrite files inside an existing save directory.
  - Removes the temporary file and rethrows on failure.
- `writeSerializedGameState(saveDir, serialized)` (async).
  - Uses `fs.promises` and writes the per-file payloads concurrently so large saves do not block the event loop. Callers must await it; `performGameSave` and the load-time setting backfill in `api.js` do.
  - Writes the save directory files used by `loadSerializedGameState`, including `gameWorld.json`, `chatHistory.json`, `images.json`, `things.json`, `allPlayers.json`, `factions.json`, `mysteryBoxes.json`, `mysteryThreads.json`, `scheduledEvents.json`, `skills.json`, `metadata.json`, `pendingRegionStubs.json`, `worldTime.json`, `calendarDefinition.json`, `gameConfigOverride.yaml`, `chatSummaries.json`, `sceneSummaries.json`, and `setting.json` when a setting is present.
- `loadSerializedGameState(saveDir)`.
  - Reads the same file set and returns defaults for missing files. JSON/text read failures are warned and return the file's default shape.
- `hydrateGameState(serialized, context)`.
  - Runs save migrations before object hydration, resets and seeds `IdGenerator`, restores `metadata.plotAnalysis` through `Globals.setPlotAnalysis(...)`, restores world time/calendar through `Globals.hydrateWorldTime(...)`, and loads chat and scene summaries. Scene-summary hydration reconciles persisted mappings against the authoritative live chat index, pruning legacy look-ahead/duplicate mappings and invalidating only an affected suffix after genuine manual deletion.
  - Invalid or incomplete persisted scene-summary data is warning-cleared so it cannot block loading the rest of a save. The scene-summary runtime store must still exist and support both `load()` and recovery `clear()` operations.
  - Clears transient queues/maps supplied in `context` (`jobQueue`, image jobs, pending image work, NPC generation promises, generated images) and clears live registries/maps before re-instantiating saved entities.
  - Hydrates skills first, then factions, mystery boxes, mystery threads, scheduled events, things, players, generated images, chat history, locations, location exits, regions, and pending region stubs. Invalid skill/faction/thing/player/region entries are skipped with warnings.
  - Reserves supplied ability, ability-status, and pending attachment draft IDs across all serialized actors through `Player.registerAbilityIdentities(...)` before hydrating any players. Missing legacy ability IDs use the shared name-derived allocator without colliding with explicit IDs belonging to later actors; saved IDs and references remain unchanged.
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
- `enqueueChatSummaryCandidate(candidate)` / `dequeueChatSummaryBatch(batchSize)`: enqueue unique `{ entryId, content, locationId, type, timestamp }` summary candidates and return batches only when the queue has at least `batchSize` entries. Enqueue excludes diagnostic candidates through the shared history predicate before this lossy projection. The queue is transient; `api.js` also checks drained candidates and current source history at prompt assembly, before content mapping and summary-index association.
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

Save serialization preserves generic `worldLineageId` and `runtimeMechanicsFingerprint` from runtime save metadata across manual saves/autosaves/export, alongside Player namespaced snapshots. Hydration restores metadata without importing any independent mod library. These identities distinguish the actual saved world/timeline from reusable profile IDs and survive Stop & Undo.

## Technique world persistence

Game serialization includes `techniques`, saved as `techniques.json` alongside actors/items. Missing legacy files mean empty technique state; an existing unreadable/malformed file throws instead of using a placeholder. `hydrateGameState` validates incoming definitions/owner pins/item grants/status receipt references before clearing the live world, hydrates the catalogue before actors, and verifies active references after construction. Malformed technique-bearing actors/items propagate their original error instead of being skipped. See [TechniqueService](TechniqueService.md).

Technique summon templates and active world-minute leases are saved in `techniqueSummons.json`. Incoming state is strictly validated before live registries are cleared and hydrated after actors and locations. Due leases expire when the next world-time update runs after the current player is rebound. See [TechniqueUtilityEffects](TechniqueUtilityEffects.md).

## Charge operation persistence

`serializeGameState` includes the `ItemChargeService` ledger as `itemCharges`, written to `itemCharges.json`. A genuinely absent legacy file initializes an empty ledger; unreadable/malformed existing files throw. Incoming pools and the ledger are validated before world replacement. Ledger hydration follows `Thing.clear()` so clearing old item registries cannot erase restored receipts. Charge-bearing malformed Things propagate their original hydration errors. The existing recursive legacy ID migration includes nested request/result item, ammunition and actor references.
