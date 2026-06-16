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
- `createdAt` / `updatedAt`: real ISO timestamps for save and diagnostics.

## Validation
- Constructor payloads must be objects.
- `name`, `type`, `value`, and `description` are required and non-empty after trimming.
- `lastUpdatedWorldMinute` must be a non-negative integer.
- `short_string` values must be three words or fewer.
- `x_out_of_total` values must use `x/total` with non-negative integer parts.
- `percentage` values must be a finite numeric value followed by `%`.
- Countdown values are non-empty strings. New/update mutation paths parse them as concrete durations through `Utils.parseDurationToMinutes(...)` and store `countdownUntilWorldMinute`; no numeric clamping is applied.
- Numerical-count values are non-empty strings.

## Static API
- `validTypes`: returns the valid type list.
- `clear()`: removes all in-memory trackers.
- `getAll()`: returns all active trackers in registry order.
- `getById(id)`: returns a tracker by trimmed id, or `null`.
- `findByNameOrKey(query)`: searches id and name using normalized phrase matching.
- `fromJSON(payload)`: constructs a tracker from a serialized payload.
- `serializeAll()`: returns an id-keyed object map of `toJSON()` payloads.
- `loadAll(payload)`: replaces the in-memory registry from an id-keyed object map.
- `removeById(id)`: removes and returns a tracker by id, or `null`.

## Instance API
- `updateValue(value, { worldMinute, countdownUntilWorldMinute? })`: validates and stores a new value, updates `lastUpdatedWorldMinute`, resets a countdown target when applicable, and refreshes `updatedAt`.
- `displayValue({ formatCountdownValue })`: returns the player/prompt display value. Countdown trackers with a stored deadline use the formatter to show remaining time; legacy countdowns without a deadline return the raw value.
- `toPromptContext({ formatLastUpdated, formatCountdownValue })`: returns compact context fields for `base-context.xml.njk`.
- `toPromptLine(options)`: renders one plain-text tracker line for prompt context.
- `toClientJSON({ formatLastUpdated, formatCountdownValue })`: returns the sidebar payload without the private description.
- `toJSON()`: returns the persisted record shape.

## Prompt Context
`server.js` adds active trackers to `base-context.xml.njk` near the end of `<gameState>`, after active mystery threads and before recent story history. The template emits plain text inside `<trackers>` to avoid token-heavy nested XML:

```text
tracker_1 | Gate Stability | type=percentage | value=60% | hidden=true | lastUpdated=12 minutes ago | guidance=Update when the planar gate weakens or stabilizes.
```

`lastUpdated` is formatted from `lastUpdatedWorldMinute` with `Utils.formatAbsoluteWorldMinutesAgo(...)`.

Countdown `value` is displayed as time remaining until `countdownUntilWorldMinute`, using the two most significant units: days+hours, hours+minutes, or minutes. If the current game time is past the target, the display uses `past`, such as `12 minutes past`, to avoid implying the deadline event has already resolved. The raw entered value remains persisted for diagnostics and save compatibility.

## Tools
The chat tool runtime exposes these world-mutation tools when mutation tools are available, including generic prompts and scheduled-event resolution:

- `addTracker({ name, type, value, hiddenFromPlayer?, description })`
- `updateTracker({ tracker, value })`
- `removeTracker({ tracker })`

Regular prose prompts and background `plot-analysis` prompts receive only the creation subset: `addTracker` plus `scheduleEvent`. They can add new trackers when the current turn or analysis finds useful tension or state to track, but they cannot update or remove existing trackers.

`tracker` accepts an id or unique name match. Ambiguous names return a visible tool error with candidate ids instead of choosing arbitrarily.

For `countdown`, `value` must be a concrete duration such as `29 days`, `1 hour 30 minutes`, or `00:45`. Adding a countdown stores `countdownUntilWorldMinute = current game minute + parsed duration`; updating a countdown resets the stored target the same way. Countdown trackers do not need routine tick updates just because time passes.

## Event Updates
`Events.js` can also mutate trackers through the `tracker_updates` event type. XML event checks emit an optional `<trackerUpdates>` block containing one or more `<trackerUpdate>` entries, and the legacy grouped event parser accepts `[tracker] -> [type] -> [add|update|remove] -> [value] -> [reason]`. A missing `<trackerUpdates>` block means no tracker changes.

Each tracker update entry is parsed and applied independently. Bad entries are logged with `console.error` and skipped while later entries continue. Percentage update values may include or omit `%`; applied values are stored in the canonical `%` form required by `Tracker`. Countdown add/update values are durations and reset the stored absolute target from the current game minute.

## Sidebar UI
The player payload includes `trackers` only for the player record. `views/index.njk` renders active trackers below the party list in the chat sidebar. Hidden trackers are invisible by default; the tracker eye button toggles them and marks hidden rows with a distinct hidden treatment.

## Save And Load
- `Utils.serializeGameState(...)` writes trackers through `Tracker.serializeAll()`.
- `Utils.writeSerializedGameState(...)` stores the map in `trackers.json`.
- Save metadata includes `totalTrackers`.
- `Utils.loadSerializedGameState(...)` reads `trackers.json`, defaulting to `{}` when absent.
- `Utils.hydrateGameState(...)` loads trackers through `Tracker.loadAll(...)`.
- Constructors and loaders register tracker ids with `IdGenerator` so loaded ids are not reused.

## Reference Tests
- `tests/tracker.test.js`: model validation, registry behavior, JSON round-trip, and save/load hydration.
- `tests/chat_tool_trackers.test.js`: tool schemas and add/update/remove execution.
- `tests/events.tracker_updates.test.js`: XML and legacy event parsing plus event-handler add/update/remove behavior.
- `tests/base_context_inventory_value.test.js`: compact base-context `<trackers>` rendering.
- `tests/tracker_sidebar_ui.test.js`: sidebar markup, renderer hooks, server payload, and SCSS source checks.
