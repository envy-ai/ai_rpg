# Scene Summaries API

Browser-facing endpoints for the Story Tools scene-summary editor.

## GET /api/scene-summaries

Lists stored scene summaries in display order.

Response:
- 200: `{ success: true, sceneSummaries, count }`
- Each summary includes `sceneNumber`, `startIndex`, `endIndex`, `startEntryId`, `endEntryId`, `summary`, `details`, and `quotes`.
- `quotes` entries are `{ character, text }`.

## PUT /api/scene-summaries/:index

Updates one existing scene summary by its 1-based display number.

Request:
- Body: `{ summary: string, details?: string[] | string, quotes?: Array<{ character: string, text: string }> }`
- `summary` is required and non-empty.
- `details` may be an array of strings or a newline-delimited string. Submitted details replace the existing detail list.
- `quotes` must be an array of objects with non-empty `character` and `text` fields. Submitted quotes replace the existing quote list.

Response:
- 200: `{ success: true, sceneSummary, persisted }`
- 400 for invalid input, missing summaries, malformed quotes, or unknown display numbers.

`persisted` is `true` when a loaded save directory was available and the route rewrote `sceneSummaries.json` plus `metadata.json`; otherwise runtime state is updated and the next normal save persists it.

## Chat Tool Reruns

Generic prompt chat tools can call `rerunSceneSummary({ sceneNumber })` to regenerate an existing stored scene by display number. The tool resolves the scene's stored range, reruns the server-side scene-summary prompt for that range with `redo: true`, replaces overlapping stored summaries, and persists the current save's scene-summary files when a save directory is loaded.
