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
- `updateSceneAtDisplayIndex(displayIndex, updates)`: edits a scene by its 1-based display number while preserving its entry range and entry ids. `summary`, `details`, and `quotes` are validated through the same strict scene normalization used for generated summaries.
- `ingestNpcNamesFromEntries(entries)`: stores NPC name lists per entry id when available.
- `getAbsentCharactersByScene(characterNames)`: returns a Map of scene start index to names missing from that scene.
- `serialize()`: returns a stable JSON-friendly payload including entry index map and NPC names.
- `load(data)`: clears and loads from serialized data, validating completeness.

## Diagnostics
- `/scene_summaries` lists stored scene summaries by display number and covered 1-based entry range, and reports coverage gaps against the current scene-summary-eligible chat history.
- Story Tools includes a `Scene Summaries` tab backed by `GET /api/scene-summaries` and `PUT /api/scene-summaries/:index`. Manual edits update the runtime store and immediately rewrite `sceneSummaries.json` for the active save when one is loaded.
- Scene-summary entry counts come from `scene_summary_index.js`, shared by `/summarize`, `/summarize check`, `/scene_summaries`, automatic threshold summarization, and the actual server-side scene summarizer. The shared index excludes system-role entries, prompt diagnostics such as `tool-call-debug` and `check-results`, event/status summary entries, and plot-summary/plot-expander entries while preserving hidden supplemental/offscreen story entries.
- Chat prompts can call `getFullScene({ sceneNumber })` for a stored `Scene N` listed inside `<olderStoryHistory>`; this uses the same display number as `/scene_summaries`. The tool resolves the stored scene range through the shared scene-summary index and returns delineated entries for user actions, NPC action plans, storyteller prose, and eligible hidden scene notes.
- Generic prompt chat tools can call `rerunSceneSummary({ sceneNumber })` to resolve that same stored display number, rerun `Globals.summarizeScenesForHistoryRange(...)` for the stored range with `redo: true`, merge the regenerated scenes through `addSummaryResult(...)`, and rewrite the active save's scene-summary files when a save is loaded.
- Generic prompt chat tools can call `editSceneSummary({ sceneNumber, summary, details?, quotes? })` to directly replace a stored scene summary's validated summary text, detail lines, and quote records by display number, using the same strict update path as the Story Tools Scene Summaries tab and rewriting the active save copy when available.
- `/scrub_legacy_debug [dry_run]` can remove legacy `Checks: ...` and `Tool call debug: ...` pollution lines from stored scene summaries without regenerating the summaries. It refuses to blank a required scene summary; use `/summarize ... true` or Story Tools editing for those cases.

## Private Helpers
- `#ingestEntryIndexMap(entryIndexMap)`: validates and populates entry id/index and NPC name maps.
- `#normalizeScene(scene)`: validates and normalizes scene shape.
- `#cloneScene(scene)`: deep-ish copy used by `getScenes`.

## Notes
- All validation is strict; missing fields throw explicit errors to avoid silent corruption.
- The scene-summary prompt allows Step 1/2 prose before the XML answer. Server parsing ignores that prose and validates only the final `<scenes>...</scenes>` block, so XML-like brainstorming text cannot break summary ingestion.
- Scene records store entry ranges and entry ids, not formatted dates. Base-context rendering looks up the scene start entry and, when that chat entry has `metadata.worldTime`, prints the scene's start time relative to the current in-game day plus the calendar date immediately after `Scene N:`.
- Direct chat-history edits made through `editChatLogEntry(...)` do not automatically delete or rerun affected scene summaries. The LLM can explicitly follow an edit with `rerunSceneSummary(...)` for any known impacted scene.
- Filtering system/diagnostic entries prevents new scene-summary pollution but does not rewrite existing stored scene summary text. Existing polluted summaries remain unchanged until explicitly edited or regenerated.
- `/scrub_legacy_debug` is the explicit opt-in cleanup path for existing legacy debug pollution.
