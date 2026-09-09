# MysteryBox

## Purpose
`MysteryBox` stores private continuity notes for offscreen actors, secrets, conspiracies, unexplained artifacts, and other unresolved background threads. It is intentionally free-form: the object keeps searchable keys/aliases plus GM-only text, rather than trying to model a full quest, NPC, or faction.

The event system updates these records when the XML event prompt emits `mysteryBoxMention`. This lets the game commit to a concrete hidden explanation when a mystery is introduced or materially expanded, without running a scheduled plot expander that advances unrelated offscreen material.

## Stored Shape
- `id`: compact persisted id, allocated as `mystery_n`.
- `name`: primary display/search name.
- `keys`: aliases and lookup keys. The name is always included.
- `text`: free-form private note containing the coherent hidden truth, current interpretation, and continuity constraints.
- `resolved`: boolean flag set when the private mystery is known in general story context. Resolved boxes remain persisted and searchable but are omitted from active mystery-thread base context and from the automatic update prompt's unresolved box index.
- `mentions`: list of source mentions with optional `name`, `context`, `sourceEntryId`, `worldTime`, and `createdAt`.
- `createdAt` / `updatedAt`: ISO timestamps.

## Public API
- `new MysteryBox({ name, keys?, text?, resolved?, mentions?, id?, createdAt?, updatedAt? })`: creates and registers a box.
- `MysteryBox.clear()`: resets the runtime registry.
- `MysteryBox.getAll()`: returns all registered boxes.
- `MysteryBox.getById(id)`: resolves an exact id.
- `MysteryBox.getByKey(key)`: resolves by case/punctuation-insensitive name, key, or alias.
- `MysteryBox.findByNameOrKey(query)`: returns every box whose id, name, key, or alias matches the normalized query exactly or by substring/term containment.
- `MysteryBox.listBySearchPhrase(query?)`: returns every box when the query is blank, or boxes whose id, name, keys, aliases, or private text contain the normalized phrase.
- `MysteryBox.fromJSON(payload)`: hydrates one serialized box.
- `MysteryBox.serializeAll()`: returns the save-file object map.
- `MysteryBox.loadAll(payload)`: clears and hydrates all boxes from a save-file object map.
- `box.applyUpdate({ name?, keys?, text?, mention? })`: merges aliases, replaces note text only when `text` is a non-empty string, appends an optional mention, and refreshes `updatedAt`.
- `box.applyManualEdit({ name, keys?, text? })`: replaces the editable name/alias set, optionally replaces note text including empty text, removes stale key lookups, and refreshes `updatedAt`.
- `box.markResolved()`: marks the box resolved and refreshes `updatedAt`.
- `box.toJSON()`: serializes the persisted shape.

## Notes
- Lookups normalize punctuation and case, so `ELLISON-SEVEN`, `ellison seven`, and `Ellison Seven` target the same key.
- `applyUpdate(...)` treats returned `name` as the canonical key. Prompt-side create/update responses must include non-empty `<text>`; that text replaces the existing private note, so the update prompt is responsible for preserving important existing details while incorporating the mention.
- `applyManualEdit(...)` is for browser/editor workflows. Unlike prompt updates, it replaces aliases rather than merging them, so removed aliases no longer resolve to the box.
- `MysteryBox.loadAll(...)` fails loudly on invalid save payloads rather than silently dropping private continuity.
- Saves persist all boxes to `mysteryBoxes.json`, and save metadata includes `totalMysteryBoxes`.
- During save hydration, boxes load before threads. A save with boxes and no threads receives one inactive `Legacy Mystery Boxes` thread containing the loaded box ids.
- Mystery boxes are contained by `MysteryThread.boxIds`; the box itself remains separately persisted in `mysteryBoxes.json`. Browser API responses include computed `threadId` / `threadName` metadata when a box is assigned.
- The `mysteryBoxMention` event flow runs `mystery-thread-check` before `mystery-box-update` when active mystery threads exist. The check can mark active threads inactive and can mark individual boxes resolved. Active threads still enter base context, but resolved boxes are filtered out of their `<mysteryBoxes>` block.
- The `mystery-box-update` prompt can create, update, or skip. Create/update responses must attach the box to a `MysteryThread`; active-thread creation/activation is bounded by `mystery_threads.max_active`, and each thread is bounded by `mystery_threads.max_unresolved_boxes_per_thread` (default `3`). Resolved boxes free capacity. Existing boxes remain updatable at capacity, but a new box is rejected before construction when its target thread is full, preventing orphan records.
- The periodic `mystery_box_cleanup` prompt and `/resolve_mystery_threads` command review active threads and unresolved contained boxes by exact id. Returned boxes with `<revealed>true</revealed>` are applied through `box.markResolved()` and stay persisted/searchable while dropping out of active prompt context.
- The `listMysteryBoxes({ query? })` chat tool returns lightweight id/name/key/timestamp entries for all boxes or boxes whose id/name/keys/text contain a phrase, without returning full private notes. `findMysteryBoxes({ query })` searches id/name/key/alias and returns matching full private notes, while `getMysteryBox({ key })` retrieves one exact id/name/key/alias match.
- The generic-prompt-only `updateMysteryBoxFields({ mysteryBox, fields })` chat tool directly edits `name`, `keys`, and/or `text` for one box resolved by id/name/key/alias. It uses replacement semantics like Story Tools edits: submitted `keys` replace editable aliases instead of merging, removed aliases stop resolving, and `text` may be an empty string.
- The browser Story Tools UI edits boxes inside a selected mystery thread. Manual box edits write the runtime registry and, when a current save directory is active, immediately rewrite `mysteryBoxes.json`, `mysteryThreads.json`, and metadata counts.
