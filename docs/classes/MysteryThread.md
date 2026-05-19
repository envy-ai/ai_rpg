# MysteryThread

## Purpose
`MysteryThread` groups related `MysteryBox` records into a single GM-private continuity thread. Active threads are injected into base-context prompts so the LLM sees the current hidden explanation, constraints, and contained mystery boxes before it invents new mystery material.

## Stored Shape
- `id`: compact persisted id, allocated as `mthread_n`.
- `name`: primary display/search name.
- `status`: `active`, `inactive`, or `concluded`.
- `keys`: aliases and lookup keys. The name is always included.
- `summary`: compact private summary of the whole mystery thread.
- `constraints`: canonical facts or consistency rules the GM should preserve.
- `boxIds`: authoritative ordered containment list for related `MysteryBox` ids.
- `createdAt` / `updatedAt`: ISO timestamps.

## Public API
- `new MysteryThread({ name, status?, keys?, summary?, constraints?, boxIds?, id?, createdAt?, updatedAt? })`: creates and registers a thread.
- `MysteryThread.clear()`: resets the runtime registry.
- `MysteryThread.getAll()`: returns all registered threads.
- `MysteryThread.getById(id)`: resolves an exact id.
- `MysteryThread.getByKey(key)`: resolves by case/punctuation-insensitive name, key, or alias.
- `MysteryThread.getContainingBox(boxId)`: returns the thread whose `boxIds` contains the box id.
- `MysteryThread.getActive({ max })`: returns active threads capped by the supplied non-negative integer.
- `MysteryThread.findByNameOrKey(query)` / `listBySearchPhrase(query?)`: lookup helpers for tools and editor views.
- `MysteryThread.serializeAll()` / `loadAll(payload)`: save/load object-map helpers.
- `MysteryThread.ensureLegacyThreadForBoxes(boxes)`: creates one inactive `Legacy Mystery Boxes` thread for old saves that have boxes but no threads.
- `thread.applyUpdate(...)`: prompt-side merge/update helper.
- `thread.applyManualEdit(...)`: Story Tools replacement edit helper.
- `thread.replaceBoxIds(boxIds)`: replaces authoritative containment order.

## Notes
- Saves persist threads to `mysteryThreads.json`; metadata includes `totalMysteryThreads`.
- Only `active` threads are included in base context, capped by `mystery_threads.max_active`.
- Inactive/concluded threads remain editable and searchable but are not injected into base-context prompts.
- The reactive `mysteryBoxMention` flow runs a private `mystery-thread-check` prompt before `mystery-box-update`; matching returned active thread names are marked `inactive`, while names that do not resolve to an active thread are console-warned and ignored.
