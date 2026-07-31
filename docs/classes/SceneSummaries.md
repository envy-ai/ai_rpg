# SceneSummaries

## Purpose
`SceneSummaries` manages scene-level summaries derived from chat history. The store supports older-history prompt compaction, scene-summary coverage diagnostics, Story Tools editing, and chat tools that inspect or rebuild stored scene ranges.

The implementation class lives in `SceneSummaies.js` (the project filename uses that spelling) and is initialized as `Globals.sceneSummaries` during server startup.

## Stored Model
- `_scenes`: normalized scene records shaped as `{ startIndex, endIndex, startEntryId, endEntryId, summary, details, quotes }`.
- `_entryIdToIndex`: chat entry id to 1-based scene-summary index position.
- `_entryIdToNpcNames`: chat entry id to NPC names observed for absent-character checks.
- `_metadata`: `{ version, updatedAt, lastSummarizedRange? }`.

`startIndex` and `endIndex` are inclusive positions in the shared scene-summary index, not raw `chatHistory` array offsets. `startEntryId` and `endEntryId` anchor each stored range back to saved chat entries.

Saves store the serialized payload in `sceneSummaries.json`. `Utils.serializeGameState()` requires a serializable scene-summary store, `Utils.writeSerializedGameState()` writes the file, and `Utils.loadSerializedGameState()` reads it with `{}` as the missing-file default. `Utils.hydrateGameState()` loads it into `Globals.getSceneSummaries()`; validation failures warn, clear the summary store, and allow the rest of the save to load.

## Shared Scene-Summary Index
`scene_summary_index.js` defines the indexed entry set used by generation, range diagnostics, slash commands, chat tools, and automatic threshold summarization.

The index excludes:
- system-role and ephemeral prompt-history entries;
- prompt diagnostics such as `tool-call-debug`, `check-results`, debug tool-call metadata, check-result metadata, or diagnostic text headers;
- entries marked with `metadata.excludeFromBaseContextHistory === true`;
- `event-summary`, `status-summary`, `plot-summary`, and `plot-expander` entries;
- summary-style entries excluded by `shouldExcludeSummaryEntry(...)` when `excludeSummaries` is true;
- entries containing omitted-result markers such as crafting, event, quest, additional-result, or salvage headings.

Hidden story-note entries remain eligible when they carry narrative content. This includes `supplemental-story-info`, `offscreen-npc-activity-daily`, `offscreen-npc-activity-weekly`, and `while-you-were-away`.

Indexed text comes from `content` or, if content is empty, `summary`. Normalization strips scene-illustration markdown lines, removes leading `!`, `!!`, or `#` markers from lines, compacts blank lines, and requires every indexed entry to have a non-empty persisted id.

## Generation Flow
`Globals.summarizeScenesForHistoryRange({ chatHistory, startIndex, endIndex, redo })` is the server-side scene summarizer.

- It requires a configured AI backend.
- It builds the shared index with `excludeSummaries: true`.
- `startIndex` and `endIndex` accept positive integers or `"all"`.
- `"all"`, with or without `redo`, always generates from entry 1 through the current end and atomically replaces the complete stored scene list and entry-id index map only after generation and validation succeed.
- Numeric-range `redo: true` deletes overlapping stored summaries through `deleteSummariesOverlappingRange(...)`, then reruns the uncovered range with a bounded overlap extension based on `summaries.scene_summary_max_entries_per_prompt`.
- Long ranges are chunked against `summaries.scene_summary_max_entries_per_prompt` or the default of `500`.
- Each chunk renders `prompts/scene-summarize.xml.njk` and calls `LLMClient.chatCompletion(...)` with `metadataLabel: 'scene_summarize'`, `runInBackground: true`, and whole-response XML validation disabled.
- The returned prompt and response are logged through `LLMClient.logPrompt(...)` under the `scene_summarize` prefix.
- Parsing extracts the final `<scenes>...</scenes>` block, so Step 1 and Step 2 prose in the prompt response does not have to be valid XML.
- Parsed `<details>` text is split into trimmed bullet lines. `<quote>` nodes require non-empty `character` and `text`.
- The final parsed scene is used as the boundary marker for the preceding scene and is not stored as a completed summary.
- Stored `entryIndexMap` entries include `npcNames` from chat-entry metadata when present.
- `addSummaryResult(...)` anchors the first and last stored scene to `summarizedRange` when the model skips leading or trailing indexed entries, provided the entry ids exist in the map.

Range errors use `scene_summary_diagnostics.js` and include scalar call context: requested start/end, resolved range, `redo`, and indexed-entry count.

## Instance API
- `clear()`: empties scenes, entry maps, NPC-name maps, and metadata.
- `addSummaryResult(summaryResult)`: validates `scenes` and `entryIndexMap`, ingests entry ids and NPC names, anchors to `summarizedRange` when supplied, removes stored scenes overlapping the incoming coverage, stores the normalized scenes, and updates metadata.
- `replaceWithSummaryResult(summaryResult)`: validates a result in a temporary `SceneSummaries` instance, then atomically replaces scenes, entry mappings, NPC-name mappings, and metadata. Invalid replacement data leaves the existing store unchanged.
- `containsEntry(entryId)`: resolves an entry id through `_entryIdToIndex` and returns whether that index is covered by a stored scene.
- `getFirstUnsummarizedIndex(totalEntries)`: returns the first uncovered 1-based index or `null` when all entries through `totalEntries` are covered.
- `deleteSummariesOverlappingRange(startIndex, endIndex)`: removes overlapping stored scenes and returns the uncovered range that should be summarized.
- `getScenes()`: returns cloned scenes in insertion order.
- `getScenesInOrder()`: returns cloned scenes sorted by `startIndex`.
- `updateSceneAtDisplayIndex(displayIndex, updates)`: replaces editable fields for the 1-based stored display number while preserving range and entry ids.
- `ingestNpcNamesFromEntries(entries)`: updates `_entryIdToNpcNames` for indexed chat entries with `metadata.npcNames`.
- `getAbsentCharactersByScene(characterNames)`: returns a `Map` from scene `startIndex` to character names absent from indexed entries in that scene.
- `serialize()`: returns `{ version, metadata, scenes, entryIndexMap }` with sorted entry mappings and NPC-name data.
- `load(data)`: clears current state, treats empty data as no stored summaries, and throws when scene data or entry mappings are incomplete.

Required scene fields are validated with explicit errors: positive `startIndex`, valid `endIndex`, non-empty `startEntryId`, non-empty `endEntryId`, and non-empty `summary`. `details` defaults to `[]` when omitted and must be an array when provided. `quotes` defaults to `[]`; quote objects require non-empty `character` and `text`.

## Prompt Context Rendering
Base-context rendering uses stored scenes for the older portion of history selected by `max_summarized_log_entries` and `max_unsummarized_log_entries`.

`buildSceneSummarySegments(...)`:
- reads ordered scenes and serialized entry mappings from `Globals.getSceneSummaries()`;
- ingests NPC names from the selected older-history entries;
- computes absent characters for each scene against the characters currently relevant to context;
- emits one scene block when the selected history first reaches a covered scene;
- skips hidden chat entries while walking history;
- falls back to per-entry summary lines for selected entries not covered by a stored scene.

Rendered scene blocks include:
- `Scene N:` where `N` is local to emitted scene blocks in the selected older-history window;
- an in-world start-time label when the scene start entry has `metadata.worldTime`;
- `[absent characters: ...]`;
- the stored summary;
- detail bullets under `Details for scene N:`;
- quote lines under `Quotes for scene N:`.

Because base-context scene numbers are local to the emitted older-history window, they are not always the same as the global stored display numbers from `getScenesInOrder()`.

## Commands
- `/scene_summaries` and `/summary_ranges` list stored summaries in display order, show `Entry N` or `Entries N-M`, and report coverage gaps against the shared scene-summary index.
- `/summarize check` reports unsummarized indexed-entry counts.
- `/summarize all` and `/summarize all true` rebuild every scene from entry 1 and replace the complete mapping store after successful validation. A failed rebuild preserves the previous store.
- `/summarize N` and `/summarize N-M` summarize explicit shared-index ranges.
- Successful `/summarize` runs write a text export under `exports/`.
- `/scrub_legacy_debug [dry_run]` removes stored diagnostic pollution such as `Checks: ...` and `Tool call debug: ...` lines from chat history and scene summaries without running the scene summarizer. It refuses to blank a required scene summary.

## API And UI
`GET /api/scene-summaries` returns stored scenes in display order as `{ success, sceneSummaries, count }`.

`PUT /api/scene-summaries/:index` edits one stored scene by 1-based display number. The request requires non-empty `summary`; accepts `details` as an array or newline-delimited string; requires `quotes` to be an array of `{ character, text }`; preserves the stored range and entry ids; and returns `{ success, sceneSummary, persisted }`.

The persistence helper rewrites `sceneSummaries.json` and `metadata.json` with `totalSceneSummaries` when an active save directory is available. It returns `persisted: false` when runtime state is loaded without an active save directory and throws if active save metadata points to a missing directory.

The Story Tools `Scene Summaries` tab loads the list with `GET /api/scene-summaries`, displays `Scene N` plus the stored entry range, edits summary and detail text, parses quote lines as `Character: quote`, and saves through the `PUT` route.

## Chat Tools
- `getFullScene({ sceneNumber })` is an information-gathering tool. It resolves the 1-based stored display number from `getScenesInOrder()`, walks chat history through the shared scene-summary index, and returns `<fullScene>` XML containing the stored summary and delineated scene entries. Entry labels cover player actions, user questions, generic prompts, NPC actions, storyteller prose, and eligible hidden scene notes.
- `rerunSceneSummary({ sceneNumber, reason? })` is a generic-prompt-only mutation tool. It resolves a stored scene range, calls `Globals.summarizeScenesForHistoryRange(...)` with `redo: true`, merges the regenerated summaries, calls the active-save persistence helper, and returns `<rerunSceneSummaryResult>` XML with range and persistence metadata.
- `editSceneSummary({ sceneNumber, summary, details?, quotes?, reason? })` is a generic-prompt-only mutation tool. It uses `updateSceneAtDisplayIndex(...)`, stores omitted `details` or `quotes` as empty arrays, calls the active-save persistence helper, and returns `<editSceneSummaryResult>` XML with update metadata.

Direct chat-history edits through `editChatLogEntry(...)` do not automatically delete or rerun scene summaries. A caller can follow such edits with `rerunSceneSummary(...)` for affected stored scenes.
