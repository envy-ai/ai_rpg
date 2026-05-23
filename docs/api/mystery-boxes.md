# Mystery Boxes API

Browser-facing endpoints for persisted private `MysteryBox` continuity notes.

## GET /api/mystery-boxes

Lists all mystery boxes as lightweight summaries, alphabetized by name.

Response:
- 200: `{ success: true, mysteryBoxes, count }`
- Each summary: `{ id, name, keys, resolved, threadId, threadName, createdAt, updatedAt, mentionCount }`

## GET /api/mystery-boxes/:id

Returns one full mystery box by exact id.

Response:
- 200: `{ success: true, mysteryBox }`
- 400 when `id` is blank
- 404 when no box exists

`mysteryBox` includes `{ id, name, keys, resolved, threadId, threadName, text, mentions, createdAt, updatedAt }`.

## PUT /api/mystery-boxes/:id

Updates one existing mystery box for Story Tools editing.

Request:
- Body: `{ name: string, keys?: string[] | string, text?: string }`
- `name` is required and non-empty.
- `keys` may be an array of strings or a newline-delimited string. Submitted keys replace the editable alias list; removed aliases stop matching this mystery box.
- `text` may be an empty string; Story Tools edits can clear a note.

Response:
- 200: `{ success: true, mysteryBox, persisted }`
- 400 for invalid input
- 404 when no box exists

`persisted` is `true` when a loaded save directory was available and the route rewrote `mysteryBoxes.json`, `mysteryThreads.json`, and metadata counts; otherwise the runtime object is updated and the next normal save will persist it.
