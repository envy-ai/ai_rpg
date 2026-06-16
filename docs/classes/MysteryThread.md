# MysteryThread

## Purpose
`MysteryThread` groups related `MysteryBox` records into one GM-private continuity thread. The thread stores the broader hidden situation, consistency constraints, and ordered contained box ids. Active threads are eligible for base-context prompt injection and automatic mystery tracking; inactive and concluded threads remain persisted, searchable, and editable.

## Stored Shape
- `id`: compact persisted id, allocated as `mthread_n` unless an id is supplied.
- `name`: required canonical display/search name.
- `status`: `active`, `inactive`, or `concluded`; missing or blank input normalizes to `inactive`.
- `keys`: aliases and lookup keys. The canonical `name` is included automatically, and lookups normalize case and punctuation.
- `summary`: trimmed GM-private summary for the whole thread.
- `constraints`: trimmed, deduplicated list of canonical facts or consistency rules.
- `boxIds`: trimmed, deduplicated ordered list of related `MysteryBox` ids.
- `createdAt` / `updatedAt`: ISO timestamps.

## Registry And Lookup
- `MysteryThread.clear()`: clears the runtime registry and key index.
- `MysteryThread.getAll()`: returns registered thread instances.
- `MysteryThread.getById(id)`: resolves an exact persisted id.
- `MysteryThread.getByKey(key)`: resolves a normalized name/key/alias.
- `MysteryThread.getContainingBox(boxId)`: returns the first registered thread whose `boxIds` contains the id.
- `MysteryThread.getActive({ max })`: returns active threads in registry order. `max` must be `Infinity` or a non-negative integer.
- `MysteryThread.findByNameOrKey(query)`: searches id, name, keys, and aliases by normalized exact match, substring, or all-term containment.
- `MysteryThread.listBySearchPhrase(query?)`: returns every thread for a blank query, or threads whose id, name, status, keys, summary, constraints, or `boxIds` contain the normalized phrase.

The class stores containment as ids only and does not enforce global uniqueness across all threads. The Story Tools box-assignment API removes assigned ids from other threads when replacing a thread's `boxIds`.

## Construction And Save Loading
- `new MysteryThread({ name, status?, keys?, summary?, constraints?, boxIds?, id?, createdAt?, updatedAt? })`: validates the options object, requires a non-empty `name`, registers the id with `IdGenerator`, and indexes normalized keys.
- `MysteryThread.fromJSON(payload)`: hydrates one serialized thread and requires an object payload.
- `MysteryThread.serializeAll()`: returns an object map keyed by thread id.
- `MysteryThread.loadAll(payload)`: clears existing threads and hydrates every payload entry. Invalid non-object maps throw.
- `MysteryThread.ensureLegacyThreadForBoxes(boxes)`: compatibility helper for saves that contain mystery boxes but no thread map. It creates one inactive `Legacy Mystery Boxes` thread containing the supplied box ids only when no threads are registered.

`Utils.serializeGameState(...)` includes `mysteryThreads`, `Utils.writeSerializedGameState(...)` writes `mysteryThreads.json`, and `Utils.hydrateGameState(...)` loads `MysteryBox` records before `MysteryThread` records. Save metadata tracks `totalMysteryThreads`. Starting a fresh game clears the thread registry.

## Update Semantics
- `thread.applyUpdate(...)`: prompt-side merge helper. It accepts optional `name`, `status`, `keys`, `summary`, `constraints`, `boxId`, and `boxIds`.
- `applyUpdate(...)` keeps the existing summary when the submitted summary is blank, replaces constraints only when an array is supplied, merges keys with existing keys, appends submitted box ids, deduplicates lists, refreshes `updatedAt`, and reindexes keys.
- `thread.applyManualEdit(...)`: replacement helper for Story Tools and direct field tools. It requires a non-empty `name`, replaces status, keys, summary, constraints, and `boxIds`, deduplicates lists, removes stale key lookups, refreshes `updatedAt`, and reindexes keys.
- `thread.replaceBoxIds(boxIds)`: replaces only the containment list, deduplicates ids, refreshes `updatedAt`, and reindexes keys.
- `thread.toJSON()`: serializes the persisted shape.

## Prompt And Event Behavior
- Base-context prompt construction includes only active threads, capped by `mystery_threads.max_active`. The default config sets this cap to `3`; runtime helpers fall back to `2` when the active config omits a valid non-negative integer.
- A cap of `0` keeps mystery-thread continuity out of base context and causes the automatic mystery-box update prompt to skip tracking.
- Active prompt context includes thread id, name, status, keys, summary, constraints, and contained unresolved boxes. Resolved boxes remain in `boxIds` but are omitted from `<mysteryBoxes>`.
- A `mysteryBoxMention` event runs `mystery-thread-check` before `mystery-box-update` when active threads exist. The check can inactivate matching active threads and mark matching boxes resolved.
- Resolved thread names are matched by id, key, or active name/key search. Unknown returned thread or box names are warned and ignored.
- `mystery-box-update` can create, update, or skip one `MysteryBox`, then applies the returned thread data through `MysteryThread`. Creating or activating an active thread is rejected when the active count is at `mystery_threads.max_active`.
- Both mystery prompts are logged through `LLMClient.logPrompt()`.

## API And Story Tools
- `GET /api/mystery-threads`: returns sorted lightweight summaries, optional phrase filtering, and `maxActive`.
- `GET /api/mystery-threads/:id`: loads one full thread by exact id or exact normalized key/name/alias.
- `PUT /api/mystery-threads/:id`: Story Tools-style field replacement by exact id. It preserves `boxIds`, validates active-cap activation, and persists through the mystery persistence helper.
- `PUT /api/mystery-threads/:id/boxes`: replaces the thread's assigned box ids, validates every id, removes those ids from other threads, and persists.
- Browser Story Tools centers the Mystery Boxes panel on threads. The thread form edits name, status, summary, and constraints; it does not expose aliases, so saving through that form leaves the canonical name as the retained key.
- Mystery API mutations rewrite `mysteryBoxes.json`, `mysteryThreads.json`, and metadata counts when a current save directory is attached. Without a current save directory, runtime state is updated and a later normal save writes the data. A configured but missing save directory is an error.

## Chat Tools
- `listMysteryThreads({ query? })`: returns lightweight XML summaries and contained box ids/names; it omits full box text.
- `getMysteryThread({ key })`: returns full private continuity for one thread, including contained box text. It resolves exact id/key first and then the first partial name/key match.
- `updateMysteryThreadFields({ mysteryThread, fields })`: generic-prompt direct edit tool for `name`, `status`, `keys`, `summary`, and `constraints`. It resolves by id/name/key/alias search, reports ambiguous matches with candidates, uses replacement semantics, and preserves `boxIds`.
- The dedicated `mystery-box-update` prompt can use thread read tools (`listMysteryThreads`, `getMysteryThread`) but not `updateMysteryThreadFields`.
