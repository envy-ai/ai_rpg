# Mystery Threads API

Browser-facing endpoints for persisted private `MysteryThread` continuity records. A mystery thread groups related `MysteryBox` records, tracks whether the thread is active for prompt context, and stores GM-only summary/constraint text used to keep hidden continuity consistent.

Active threads are injected into base-context prompts up to `mystery_threads.max_active`. Inactive and concluded threads remain persisted, searchable, and editable through these routes. Resolved mystery boxes remain visible in API payloads, but active prompt context omits resolved boxes from a thread's `<mysteryBoxes>` block.

## Client Payloads

Thread summary payloads contain:

- `id`: persisted mystery thread id, normally `mthread_n`.
- `name`: canonical display/search name.
- `status`: one of `active`, `inactive`, or `concluded`.
- `keys`: alias/key list. The canonical name is included automatically by `MysteryThread`.
- `summary`: private GM-only thread summary.
- `constraints`: private canonical facts or consistency rules.
- `boxIds`: ordered persisted ids assigned to the thread.
- `boxes`: lightweight box summaries for assigned ids that resolve to existing `MysteryBox` records.
- `boxCount`: number of resolvable boxes included in `boxes`.
- `createdAt` / `updatedAt`: ISO timestamps, or `null` if unavailable.

Contained lightweight box summaries contain `id`, `name`, `keys`, `resolved`, `threadId`, `threadName`, `createdAt`, `updatedAt`, and `mentionCount`.

Full thread payloads contain the same thread fields, but `boxes` contains full box payloads with `text` and read-only `mentions` instead of `mentionCount`.

## GET /api/mystery-threads

Lists mystery threads as lightweight summaries. Results are sorted by `name`, then `id`, with case-insensitive comparison.

Query parameters:

- `query`: optional string. When present and non-blank, filters by normalized phrase against thread id, name, status, keys, summary, constraints, and `boxIds`.

Response:

- 200: `{ success: true, mysteryThreads, count, maxActive }`
- 500: unexpected listing/serialization failure

`maxActive` is read from `config.mystery_threads.max_active` when it is a non-negative integer. The route falls back to `2` if the active runtime config does not provide a valid value.

## GET /api/mystery-threads/:id

Returns one full mystery thread by exact persisted id or exact normalized key/alias/name.

Response:

- 200: `{ success: true, mysteryThread }`
- 400: `id` is blank
- 404: no thread exists with that exact id or normalized key
- 500: unexpected load/serialization failure

`mysteryThread.boxes` follows the thread's `boxIds` order, skips missing box ids, and includes each full box payload's private note text, mention history, resolved state, and computed `threadId` / `threadName`.

## PUT /api/mystery-threads/:id

Edits one existing mystery thread for Story Tools-style replacement updates. The lookup target is the exact persisted `id`; this route does not resolve names, keys, or aliases.

Request body:

- `name`: required string. It is trimmed and must remain non-empty.
- `status`: string status. Valid values are `active`, `inactive`, and `concluded`; omitted or blank status normalizes to `inactive`.
- `keys`: optional `string[]` or newline-delimited string. Entries are trimmed, blank entries are discarded, and the submitted alias list replaces the editable alias list. The canonical `name` remains a key automatically. Omitting `keys` leaves only the canonical name as a key.
- `summary`: optional string. It is trimmed and replaces the private summary. An empty, omitted, or non-string value clears the summary.
- `constraints`: optional `string[]` or newline-delimited string. Entries are trimmed, blank entries are discarded, and the submitted list replaces the previous constraint list. Omitting `constraints` clears the list.

Behavior:

- Renaming the thread does not change its id.
- Removed aliases stop resolving to the thread after the edit.
- The route preserves the existing `boxIds`; use `PUT /api/mystery-threads/:id/boxes` for assignment changes.
- Activating an inactive or concluded thread is rejected when the active thread count is already at `mystery_threads.max_active`. Editing a thread that is already active does not revalidate the cap.

Response:

- 200: `{ success: true, mysteryThread, persisted }`
- 400: invalid input, active-cap violation, invalid save state, or edit/persistence failure
- 404: no thread exists with that exact id

## PUT /api/mystery-threads/:id/boxes

Replaces the selected thread's assigned box ids. The lookup target is the exact persisted thread `id`.

Request body:

- `boxIds`: `string[]` or newline-delimited string. Entries are trimmed and blank entries are discarded.

Behavior:

- Every submitted box id must resolve to an existing `MysteryBox`.
- Duplicate ids collapse through `MysteryThread.replaceBoxIds(...)`; the first occurrence determines order.
- Assigned box ids are removed from every other thread, so a box has at most one visible parent thread in Story Tools.
- The route does not create, delete, rename, resolve, or edit mystery boxes.

Response:

- 200: `{ success: true, mysteryThread, persisted }`
- 400: invalid input, unknown box id, invalid save state, or persistence failure
- 404: no thread exists with that exact id

## Persistence

Mutation responses include `persisted`.

- `true`: a current save directory is attached and exists. The route rewrites `mysteryBoxes.json`, `mysteryThreads.json`, and `metadata.json`, including `totalMysteryBoxes` and `totalMysteryThreads`.
- `false`: no current save directory is attached. Runtime state is updated and the next normal save writes the changes.

A missing configured save directory is an error, not an in-memory-only save.

## Related Surfaces

- Story Tools uses `GET /api/mystery-threads` for the thread list, `GET /api/mystery-threads/:id` for the selected thread and contained boxes, `PUT /api/mystery-threads/:id` for thread field edits, and `PUT /api/mystery-boxes/:id` for contained box edits.
- The chat tools `listMysteryThreads({ query? })` and `getMysteryThread({ key })` expose thread lookup to prompts; `getMysteryThread` can use id, key, alias, name, or a partial normalized match.
- The generic-prompt `updateMysteryThreadFields({ mysteryThread, fields })` tool resolves by id/name/key/alias, replaces selected `name`, `status`, `keys`, `summary`, and/or `constraints`, and preserves `boxIds`.
