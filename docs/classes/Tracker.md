# Tracker

## Purpose
`Tracker` is a persisted plot-state record created by LLM tool calls to track an important changing value. Active trackers are included in base context, saved with game state, and displayed in the chat player/party sidebar.

## Types
Valid `type` values are:

- `countdown`
- `numerical_count`
- `x_out_of_total`
- `percentage`
- `short_string`

## Fields
- `id`: compact `tracker_n` identifier allocated by `IdGenerator.next('tracker')`, or an explicit id loaded from saves.
- `name`: player/sidebar display name and model lookup label.
- `type`: one of the valid tracker type values.
- `value`: persisted string value. Type-specific validation applies.
- `hiddenFromPlayer`: hides the tracker from the sidebar unless the hidden tracker eye toggle is active.
- `lastUpdatedWorldMinute`: absolute world minute when the value was created or last changed.
- `countdownUntilWorldMinute`: countdown-only absolute world minute target. New or updated countdown trackers derive this from `lastUpdatedWorldMinute + value duration`; legacy saved countdowns without the field keep their raw value until updated.
- `description`: one paragraph of LLM-facing guidance describing what the tracker means and when future tool calls should update it.
- `note`: optional private LLM-facing note explaining why the current `value` is what it is.
- `createdAt` / `updatedAt`: real ISO timestamps for save and diagnostics.

## Validation
- Constructor payloads must be objects.
- `name`, `type`, `value`, and `description` are required and non-empty after trimming.
- `lastUpdatedWorldMinute` must be a non-negative integer.
- `short_string` values must use no more words than `trackers.short_string_max_words`, defaulting to four.
- `note` must be a string when provided and must be 100 words or fewer.
- `x_out_of_total` values must use `x/total` with non-negative integer parts.
- `percentage` values must be finite numeric values; the `%` suffix is optional on input and values are stored canonically with `%`.
- Countdown values are non-empty strings. New/update mutation paths parse them as concrete durations through `Utils.parseDurationToMinutes(...)` and store `countdownUntilWorldMinute`; no numeric clamping is applied.
- Numerical-count values are non-empty strings.

## Static API
- `validTypes`: returns the valid type list.
- `defaultShortStringMaxWords`: returns the built-in fallback `short_string` word limit.
- `shortStringMaxWords(config?)`: resolves `trackers.short_string_max_words` from config, defaulting to four and throwing when the configured value is not an integer greater than or equal to `1`.
- `shortStringMaxWordsText(config?)`: returns the resolved word limit as prompt/error text.
- `noteMaxWords`: returns the built-in 100-word tracker note limit.
- `clear()`: removes all in-memory trackers.
- `getAll()`: returns all active trackers in registry order.
- `getById(id)`: returns a tracker by trimmed id, or `null`.
- `findByNameOrKey(query)`: searches id and name using normalized phrase matching.
- `fromJSON(payload)`: constructs a tracker from a serialized payload.
- `serializeAll()`: returns an id-keyed object map of `toJSON()` payloads.
- `loadAll(payload)`: replaces the in-memory registry from an id-keyed object map.
- `removeById(id)`: removes and returns a tracker by id, or `null`.

## Instance API
- `updateValue(value, { worldMinute, countdownUntilWorldMinute?, note? })`: validates and stores a new value, updates `lastUpdatedWorldMinute`, optionally replaces `note`, resets a countdown target when applicable, and refreshes `updatedAt`.
- `updateEditableFields({ name, type, value, hiddenFromPlayer, lastUpdatedWorldMinute, countdownUntilWorldMinute?, description, note })`: replaces all fields exposed by the manual edit modal, derives a countdown target when one is not supplied, updates `lastUpdatedWorldMinute`, and refreshes `updatedAt`.
- `displayValue({ formatCountdownValue })`: returns the player/prompt display value. Countdown trackers with a stored deadline use the formatter to show remaining time; legacy countdowns without a deadline return the raw value.
- `toPromptContext({ formatLastUpdated, formatCountdownValue })`: returns compact context fields for `base-context.xml.njk`.
- `toPromptLine(options)`: renders one plain-text tracker line for prompt context.
- `toClientJSON({ formatLastUpdated, formatCountdownValue })`: returns the sidebar payload without the private description.
- `toJSON()`: returns the persisted record shape.

## Prompt Context
`server.js` adds active trackers to `base-context.xml.njk` near the end of `<gameState>`, after active mystery threads and before recent story history. The template emits plain text inside `<trackers>` to avoid token-heavy nested XML:

```text
tracker_1 | Gate Stability | type=percentage | value=60% | hidden=true | lastUpdated=12 minutes ago | guidance=Update when the planar gate weakens or stabilizes. | note=The gate is stable because two anchors are still intact.
```

`lastUpdated` is formatted from `lastUpdatedWorldMinute` with `Utils.formatAbsoluteWorldMinutesAgo(...)`.

Countdown `value` is displayed as time remaining until `countdownUntilWorldMinute`, using the two most significant units: days+hours, hours+minutes, or minutes. If the current game time is past the target, the display uses `past`, such as `12 minutes past`, to avoid implying the deadline event has already resolved. The raw entered value remains persisted for diagnostics and save compatibility.

## Tools
The chat tool runtime exposes these world-mutation tools when mutation tools are available, including generic prompts and scheduled-event resolution:

- `addTracker({ name, type, value, hiddenFromPlayer?, description, note? })`
- `updateTracker({ tracker, value, note? })`
- `removeTracker({ tracker })`

Each tracker tool also accepts batch mode as `{ items: [...] }`, where each item uses the same fields as the single-item call. Batch calls attempt every item in order and return per-item success/error records; successful items remain applied even when another item in the same batch fails.

Regular prose prompts and background `plot-analysis` prompts receive the narrow creation/non-player-relationship subset: `addTracker`, `scheduleEvent`, and `setRelationship`. They can add new trackers when the current turn or analysis finds useful tension or state to track, but they cannot update or remove existing trackers. Parser-only housekeeping does not expose these tools to the model; its returned `<trackers>` XML is converted afterward into `addTracker`, `updateTracker`, and `removeTracker` executions so it can maintain tracker state after event checks. Successful non-hidden housekeeping tracker additions, updates, and deletions are also summarized in visible `tracker-updates` chat entries for the player; those entries are excluded from all LLM prompt-history paths.

`tracker` accepts an id or unique name match. Ambiguous names return a visible tool error with candidate ids instead of choosing arbitrarily.

`note` is private model-facing context explaining why the current tracker value is what it is. It is persisted and appears in base context, but it is omitted from the player/sidebar payload. `updateTracker` leaves the existing note unchanged when `note` is omitted and replaces it when provided.

For `countdown`, `value` must be a concrete duration such as `29 days`, `1 hour 30 minutes`, or `00:45`. Adding a countdown stores `countdownUntilWorldMinute = current game minute + parsed duration`; updating a countdown resets the stored target the same way. Countdown trackers do not need routine tick updates just because time passes.

## Event Updates
`Events.js` can also mutate trackers through the `tracker_updates` event type. XML event checks emit an optional `<trackerUpdates>` block containing one or more `<trackerUpdate>` entries, and the legacy grouped event parser accepts `[tracker] -> [type] -> [add|update|remove] -> [value] -> [reason]`. A missing `<trackerUpdates>` block means no tracker changes.

Each tracker update entry is parsed and applied independently. Bad entries are logged with `console.error` and skipped while later entries continue. Percentage update values may include or omit `%`; applied values are stored in the canonical `%` form required by `Tracker`. Countdown add/update values are durations and reset the stored absolute target from the current game minute.

## Sidebar UI
The player payload includes `trackers` only for the player record. `views/index.njk` renders active trackers below the party list in the chat sidebar. Hidden trackers are invisible by default; the tracker eye button toggles them and marks hidden rows with a distinct hidden treatment.

`percentage` and `x_out_of_total` tracker rows render a display-only progress fill behind the name/value row. The fill is computed from the raw tracker value when available, clamped to the `0%` through `100%` display range, and does not alter the persisted tracker value. `x_out_of_total` values with a zero total render without a progress fill.

Tracker cards show edit and delete buttons as hover/focus overlays, without reserving permanent row space for those controls. Those controls use the top tracker-card stacking layer above progress fills and text. Hovering a tracker card opens the shared floating tooltip style used by item details and shows only `description`, `note`, and the `lastUpdated` time-ago label. The plus button in the tracker header opens the same modal in create mode. The modal edits `name`, `type`, `value`, `hiddenFromPlayer`, `description`, and `note` through `/api/trackers`; sidebar cards continue to show only the tracker name and current value.

## Save And Load
- `Utils.serializeGameState(...)` writes trackers through `Tracker.serializeAll()`.
- `Utils.writeSerializedGameState(...)` stores the map in `trackers.json`.
- Save metadata includes `totalTrackers`.
- `Utils.loadSerializedGameState(...)` reads `trackers.json`, defaulting to `{}` when absent.
- `Utils.hydrateGameState(...)` loads trackers through `Tracker.loadAll(...)`.
- `/api/new-game` clears the tracker registry during its in-memory reset before generating the starting region, preventing old absolute world-minute timestamps from appearing in new-game base prompt context.
- Constructors and loaders register tracker ids with `IdGenerator` so loaded ids are not reused.

## Reference Tests
- `tests/tracker.test.js`: model validation, registry behavior, JSON round-trip, and save/load hydration.
- `tests/chat_tool_trackers.test.js`: tool schemas and add/update/remove execution.
- `tests/events.tracker_updates.test.js`: XML and legacy event parsing plus event-handler add/update/remove behavior.
- `tests/base_context_inventory_value.test.js`: compact base-context `<trackers>` rendering.
- `tests/tracker_sidebar_ui.test.js`: sidebar markup, renderer hooks, display-only progress fill hooks, server payload, and SCSS source checks.
