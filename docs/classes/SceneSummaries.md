# SceneSummaries

## Purpose
Stores and manages scene summaries extracted from chat history. Tracks scene ranges, entry id mappings, and per-entry NPC names to support gap detection and absence checks.

## Key State
- `_scenes`: list of normalized scene objects `{ startIndex, endIndex, startEntryId, endEntryId, summary, details, quotes }`.
- `_entryIdToIndex`: map from entry id to index.
- `_entryIdToNpcNames`: map from entry id to NPC names.
- `_metadata`: `{ version, updatedAt, lastSummarizedRange }`.

## Instance API
- `clear()`: resets all stored data.
- `addSummaryResult(summaryResult)`: validates and merges a summary payload (scenes + entryIndexMap), replacing any existing scenes that overlap the incoming summarized range.
- `containsEntry(entryId)`: checks if an entry index falls within any scene range.
- `getFirstUnsummarizedIndex(totalEntries)`: returns the first gap index or null if all summarized.
- `deleteSummariesOverlappingRange(startIndex, endIndex)`: removes overlapping scenes and returns the gap range needing resummarization.
- `getScenes()`: returns cloned scenes (safe copies).
- `getScenesInOrder()`: returns scenes sorted by start index.
- `ingestNpcNamesFromEntries(entries)`: stores NPC name lists per entry id when available.
- `getAbsentCharactersByScene(characterNames)`: returns a Map of scene start index to names missing from that scene.
- `serialize()`: returns a stable JSON-friendly payload including entry index map and NPC names.
- `load(data)`: clears and loads from serialized data, validating completeness.

## Diagnostics
- `/scene_summaries` lists stored scene summaries by display number and covered 1-based entry range, and reports coverage gaps against the current scene-summary-eligible chat history.
- Scene-summary entry counts come from `scene_summary_index.js`, shared by `/summarize`, `/summarize check`, `/scene_summaries`, automatic threshold summarization, and the actual server-side scene summarizer. The shared index excludes event/status summary entries and plot-summary/plot-expander entries while preserving hidden supplemental/offscreen story entries.
- Chat prompts can call `getFullScene({ sceneNumber })` for a stored `Scene N` listed inside `<olderStoryHistory>`; this uses the same display number as `/scene_summaries`. The tool resolves the stored scene range through the shared scene-summary index and returns delineated entries for user actions, NPC action plans, storyteller prose, and eligible hidden scene notes.

## Private Helpers
- `#ingestEntryIndexMap(entryIndexMap)`: validates and populates entry id/index and NPC name maps.
- `#normalizeScene(scene)`: validates and normalizes scene shape.
- `#cloneScene(scene)`: deep-ish copy used by `getScenes`.

## Notes
- All validation is strict; missing fields throw explicit errors to avoid silent corruption.
- Scene records store entry ranges and entry ids, not formatted dates. Base-context rendering looks up the scene start entry and, when that chat entry has `metadata.worldTime`, prints the scene's start time relative to the current in-game day plus the calendar date immediately after `Scene N:`.
