# Scene Summaries API

Browser-facing endpoints for the Story Tools scene-summary editor, plus the related chat tools that inspect or mutate stored scene summaries.

Scene numbers are 1-based display numbers from `SceneSummaries.getScenesInOrder()`, sorted by scene `startIndex`. `startIndex` and `endIndex` are 1-based scene-summary index positions, not raw `chatHistory` array offsets. The shared scene-summary index excludes prompt-excluded/system entries, diagnostics such as `tool-call-debug` and `check-results`, event/status summaries, and plot-summary/plot-expander entries; hidden story-note entries such as supplemental/offscreen/while-you-were-away entries remain eligible.

Stored scene records include:
- `sceneNumber`: 1-based display number supplied by the API response.
- `startIndex`, `endIndex`: inclusive scene-summary index range.
- `startEntryId`, `endEntryId`: chat entry ids anchoring the stored range.
- `summary`: required non-empty summary text.
- `details`: array of trimmed detail strings.
- `quotes`: array of `{ character, text }` notable quote records.

There are no browser routes for creating or deleting scene summaries. Generation and range rebuilds run through the scene summarizer and chat/slash-command paths. When the `scene_summarize` TinyBrain family is enabled, that same summarizer uses staged boundary proposal/correction and per-completed-scene validation before local result assembly; disabling the family preserves the one-shot prompt path.

## GET /api/scene-summaries

Lists stored scene summaries in display order.

Response:
- 200: `{ success: true, sceneSummaries, count }`
- Each summary includes `sceneNumber`, `startIndex`, `endIndex`, `startEntryId`, `endEntryId`, `summary`, `details`, and `quotes`.
- `quotes` entries are `{ character, text }`.
- 500: `{ success: false, error }` when the scene-summary store is unavailable.

## PUT /api/scene-summaries/:index

Updates one existing scene summary by its 1-based display number.

Request:
- Body: `{ summary: string, details?: string[] | string, quotes?: Array<{ character: string, text: string }> }`
- `summary` is required and non-empty.
- `details` may be an array of strings or a newline-delimited string. Values are trimmed and blank lines are discarded.
- `quotes` must be an array of objects with non-empty `character` and `text` fields.
- The update is a full replacement for editable fields. `details` or `quotes` omitted from the request are stored as empty lists, not preserved from the stored scene.
- The stored range and entry ids are preserved.

Response:
- 200: `{ success: true, sceneSummary, persisted }`
- 400: `{ success: false, error }` for invalid input, missing summaries, malformed details or quotes, unknown display numbers, unavailable edit support, or persistence errors.

`persisted` is `true` when an active save directory is available and the route rewrites `sceneSummaries.json` plus `metadata.json` with `totalSceneSummaries`. When no active save directory is available, `persisted` is `false`; runtime state is still updated and the next normal save writes it. If active save metadata points at a directory that does not exist, the route returns an error.

## Story Tools UI

The Story Tools `Scene Summaries` tab uses:
- `GET /api/scene-summaries` when the tab is opened or refreshed.
- `PUT /api/scene-summaries/:index` when the selected scene form is saved.

The UI displays `Scene N` and the stored entry range, edits summary text, sends detail lines as a trimmed string array, and parses quote lines in `Character: quote` format before sending quote objects. A successful save displays whether the active save was written immediately (`persisted: true`) or only runtime state was updated (`persisted: false`).

## Chat Tools

`getFullScene({ sceneNumber })` is an information tool for prompt use. It resolves a stored `Scene N` by the same display number used by `/scene_summaries` and the Story Tools list, walks the shared scene-summary index over chat history, and returns `<fullScene>` XML with the stored summary plus delineated scene entries. Entries include scene-summary index, zero-based `historyIndex`, id/type/role/timestamp/location when present, a label such as `Action by Player`, `Action by NPC`, `Storyteller prose`, or `Hidden scene note (...)`, and the entry content.

`rerunSceneSummary({ sceneNumber, reason? })` is a generic-prompt-only mutation tool. It resolves the stored scene range, calls `Globals.summarizeScenesForHistoryRange({ chatHistory, startIndex, endIndex, redo: true })`, and calls the same active-save persistence helper used by the browser route. The summarizer stages overlap deletion, reads bounded following-scene context, and replaces only the complete original overlap range after validation; failure preserves the stored summaries. The tool returns `<rerunSceneSummaryResult>` XML with the original range, rerun range, summarized range, generated scene count, persisted flag, and optional private reason.

`editSceneSummary({ sceneNumber, summary, details?, quotes?, reason? })` is a generic-prompt-only mutation tool. It uses the same `SceneSummaries.updateSceneAtDisplayIndex(...)` path as the browser route, preserves the scene range and entry ids, and calls the same active-save persistence helper. `summary` is required and non-empty; `details` must be an array of strings when provided; `quotes` must be an array of `{ character, text }` objects with non-empty fields. Omitted `details` or `quotes` are stored as empty lists. The tool returns `<editSceneSummaryResult>` XML with status, scene number, persisted flag, summary, detail count, quote count, and optional private reason.
