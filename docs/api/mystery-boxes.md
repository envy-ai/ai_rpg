# Mystery Boxes API

Browser-facing endpoints for persisted private `MysteryBox` continuity notes. Mystery boxes store GM-only hidden explanations, aliases, resolved state, and mention history. Story Tools displays them through mystery threads, but the box routes expose list, exact-load, and manual-edit operations for the box records themselves.

## Client Payloads

Box summary payloads contain:

- `id`: persisted mystery box id, normally `mystery_n`.
- `name`: canonical display name.
- `keys`: alias/key list. The canonical name is included automatically by the model.
- `resolved`: `true` when the box has been resolved.
- `threadId` / `threadName`: computed from the containing `MysteryThread`, or `null` when unassigned.
- `createdAt` / `updatedAt`: ISO timestamps, or `null` if unavailable.
- `mentionCount`: number of recorded mentions.

Full box payloads contain all summary fields except `mentionCount`, plus:

- `text`: private GM-only note text.
- `mentions`: read-only mention records with any stored `name`, `context`, `sourceEntryId`, `worldTime`, and `createdAt`.

## GET /api/mystery-boxes

Lists every mystery box as a lightweight summary. Results are sorted by `name`, then `id`, with case-insensitive comparison.

Response:

- 200: `{ success: true, mysteryBoxes, count }`
- 500: unexpected listing/serialization failure

This route does not filter by query. Phrase search and alias/key lookup are available through chat tools such as `listMysteryBoxes`, `findMysteryBoxes`, and `getMysteryBox`.

## GET /api/mystery-boxes/:id

Returns one full mystery box by exact persisted id.

Response:

- 200: `{ success: true, mysteryBox }`
- 400: `id` is blank
- 404: no box exists with that exact id
- 500: unexpected load/serialization failure

The route uses `MysteryBox.getById(...)`; it does not resolve names, keys, or aliases. Use `/api/mystery-threads/:id` to load a thread with its contained full box payloads, or use chat tools for alias/key lookup.

## PUT /api/mystery-boxes/:id

Edits one existing mystery box for Story Tools.

Request body:

- `name`: required string. It is trimmed and must remain non-empty.
- `keys`: optional `string[]` or newline-delimited string. Entries are trimmed, blank entries are discarded, and the submitted alias list replaces the editable alias list. The canonical `name` remains a key automatically.
- `text`: optional string. When present, it replaces the private note text; an empty string clears the note. When omitted, the existing note text is preserved.

Behavior:

- The lookup target is the exact persisted `id`; renaming the box does not change its id.
- Removed aliases stop matching the box after the edit.
- The route does not edit `resolved`, `mentions`, or thread assignment.
- Thread assignment is controlled by `MysteryThread.boxIds` and the `/api/mystery-threads/:id/boxes` route.

Response:

- 200: `{ success: true, mysteryBox, persisted }`
- 400: invalid input, invalid save state, or edit/persistence failure
- 404: no box exists with that exact id

`persisted` is `true` when a loaded save directory is available. In that case the route rewrites `mysteryBoxes.json`, `mysteryThreads.json`, and `metadata.json`, including `totalMysteryBoxes` and `totalMysteryThreads`. When no current save directory is attached, runtime state holds the edit and the next normal save writes it to disk.

## Story Tools Use

The Story Tools Mystery Boxes panel is thread-centered:

- `GET /api/mystery-threads` supplies the thread list and lightweight contained box summaries.
- `GET /api/mystery-threads/:id` loads the selected thread plus full payloads for its contained boxes.
- `PUT /api/mystery-boxes/:id` saves edits to the selected box's name, keys, and private note.
- Mention history is displayed beside the editable fields and is not editable through this route.
