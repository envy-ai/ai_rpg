# housekeeping_update_log.js

`housekeeping_update_log.js` builds player-facing chat-log entries from successful housekeeping mutation tool executions.

## Entry Types

- `tracker-updates`: one Markdown entry listing successful non-hidden tracker additions, updates, and deletions from housekeeping.
- `relationship-updates`: one Markdown entry listing successful relationship label additions, updates, and deletions from housekeeping, including reciprocal labels when the tool set them.

The entries are visible to the player, but they are not prompt history. Each entry is stored with `metadata.excludeFromBaseContextHistory: true`, and `base_context_history.js` treats both types as always-excluded so normal prompts, generic all-entry prompts, and `getHistory` cannot return them. The chat entry type supplies the visible box label, so the Markdown body contains update rows only and does not repeat a heading.

## Tracker Updates

The formatter consumes `addTracker`, `updateTracker`, and `removeTracker` invocation metadata. Hidden trackers are skipped by checking `hiddenFromPlayer === true`. Deleted tracker rows depend on `removeTracker` returning the removed tracker's visibility metadata before deletion.

Formatted rows use the tracker name and value when available:

```text
- Added **Gate Stability**: 60%
- Updated **Keys Found**: 2/3
- Deleted **Alarm State**
```

## Relationship Updates

The formatter consumes `setRelationship` invocation metadata. The tool records previous labels and reports `added`, `updated`, or `deleted` for the direct edge and for the reciprocal edge when supplied.

`tests/rel7.housekeeping_relationship_lifecycle.test.js` covers the full deterministic REL-7 chain with a case-owned setup: parsed housekeeping XML adds, updates, and removes the same directed edge through the real batch relationship tool, the formatter emits all three visible actions, and the resulting `relationship-updates` entry is rejected by both ordinary and all-entry base-context history filters.

Formatted rows use directed character names:

```text
- Added **Mira** -> **Neka**: trusted ally
- Updated **Neka** -> **Mira**: guarded patron
- Deleted **Toma** -> **Mira**
```

Current housekeeping relationship XML supports `<action>remove</action>` for a directed relationship edge. Removing both directions requires two relationship blocks, one for each direction.

## Runtime Use

`api.js` calls `buildHousekeepingUpdateLogEntries()` after `Events._applyHousekeepingXmlResponse()` finishes executing housekeeping XML mutations. Automatic event-check housekeeping can start the LLM request before event outcomes finish, but update-log rows are still created only after the returned XML is applied at the post-event housekeeping point. Stored entries are pushed through the normal chat-history path and emit `chat_history_updated` when a stream is active. Event-check callers that already have an entry collector pass it through to housekeeping so the new rows can be included in the current response payload.

## Reference Tests

- `tests/housekeeping_update_log.test.js`
- `tests/base_context_history.test.js`
- `tests/chat_tool_trackers.test.js`
- `tests/chat_tool_relationships.test.js`
