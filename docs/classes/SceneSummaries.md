# SceneSummaries

## Purpose
Stores and manages scene summaries extracted from chat history. Tracks scene ranges, entry id mappings, and per-entry NPC names to support gap detection and absence checks.

## Key State
- `_scenes`: list of normalized scene objects `{ startIndex, endIndex, startEntryId, endEntryId, summary, quotes }`.
- `_entryIdToIndex`: map from entry id to index.
- `_entryIdToNpcNames`: map from entry id to NPC names.
- `_metadata`: `{ version, updatedAt, lastSummarizedRange }`.

## Instance API
- `clear()`: resets all stored data.
- `addSummaryResult(summaryResult)`: validates and merges a summary payload (scenes + entryIndexMap).
- `containsEntry(entryId)`: checks if an entry index falls within any scene range.
- `getFirstUnsummarizedIndex(totalEntries)`: returns the first gap index or null if all summarized.
- `deleteSummariesOverlappingRange(startIndex, endIndex)`: removes overlapping scenes and returns the gap range needing resummarization.
- `getScenes()`: returns cloned scenes (safe copies).
- `getScenesInOrder()`: returns scenes sorted by start index.
- `ingestNpcNamesFromEntries(entries)`: stores NPC name lists per entry id when available.
- `getAbsentCharactersByScene(characterNames)`: returns a Map of scene start index to names missing from that scene.
- `serialize()`: returns a stable JSON-friendly payload including entry index map and NPC names.
- `load(data)`: clears and loads from serialized data, validating completeness.

## Private Helpers
- `#ingestEntryIndexMap(entryIndexMap)`: validates and populates entry id/index and NPC name maps.
- `#normalizeScene(scene)`: validates and normalizes scene shape.
- `#cloneScene(scene)`: deep-ish copy used by `getScenes`.

## Notes
- All validation is strict; missing fields throw explicit errors to avoid silent corruption.
