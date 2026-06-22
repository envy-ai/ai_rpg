# Trackers API

Browser-facing endpoints for manually creating, editing, loading, and deleting active plot trackers from the chat sidebar.

Tracker tool-call behavior is documented in `docs/classes/Tracker.md` and `docs/api/chat.md`. These routes operate on the same in-memory `Tracker` registry and use exact tracker ids such as `tracker_1`; they do not resolve names or aliases.

## Payloads

Sidebar tracker payloads come from `GET /api/player` and intentionally omit private `description` and `note` fields. They include:

- `id`
- `name`
- `type`
- `value`: display value; countdowns show remaining time when a target minute is available.
- `rawValue`: persisted string value.
- `hiddenFromPlayer`
- `lastUpdated`: display text.
- `lastUpdatedWorldMinute`
- `countdownUntilWorldMinute`

The tracker edit payload returned by `GET /api/trackers/:id` and mutation responses includes the persisted fields from `Tracker.toJSON()`, plus:

- `displayValue`: sidebar/prompt display value.
- `lastUpdated`: display text.
- `countdownUntilWorldMinute`: present as a number for countdowns or `null` otherwise.

That edit payload includes private `description` and `note` so the modal can edit them. The sidebar cards still render only name and current value.

## GET /api/trackers/:id

Loads one tracker by exact persisted id for the edit modal.

Response:

- 200: `{ success: true, tracker }`
- 400: blank id or serialization failure
- 404: no tracker exists with that id

## POST /api/trackers

Creates a tracker.

Request body:

- `name`: required non-empty string.
- `type`: required tracker type (`countdown`, `numerical_count`, `x_out_of_total`, `percentage`, or `short_string`).
- `value`: required non-empty string validated for the selected type.
- `hiddenFromPlayer`: optional boolean, defaulting to `false`.
- `description`: required non-empty LLM-facing guidance.
- `note`: optional private explanation of why the current value is what it is, at most 100 words.

Response:

- 200: `{ success: true, message, tracker, trackerId, trackers }`
- 400: invalid field values or unavailable world minute

For `countdown` trackers, `value` is parsed as a concrete duration and `countdownUntilWorldMinute` is derived from the current world minute. The route does not accept a direct target-minute override.

For `percentage` trackers, the submitted value may include or omit `%`; accepted values are stored with the `%` suffix.

## PUT /api/trackers/:id

Replaces the editable fields of an existing tracker.

Request body:

- `name`
- `type`
- `value`
- `hiddenFromPlayer`
- `description`
- `note`

The route expects a full edit payload. Missing `hiddenFromPlayer` becomes `false`; missing `note` clears the note; missing required string fields fail validation.

Response:

- 200: `{ success: true, message, tracker, trackerId, trackers }`
- 400: blank id, invalid field values, or unavailable world minute
- 404: no tracker exists with that id

The edit updates `lastUpdatedWorldMinute` to the current world minute. Countdown edits derive a new `countdownUntilWorldMinute` from the submitted duration.

## DELETE /api/trackers/:id

Deletes a tracker by exact persisted id.

Response:

- 200: `{ success: true, message, tracker: null, trackerId, trackers }`
- 400: blank id or deletion failure
- 404: no tracker exists with that id

## Sidebar UI Use

The chat sidebar uses:

- `POST /api/trackers` when the plus button creates a tracker.
- `GET /api/trackers/:id` when an edit button opens the modal.
- `PUT /api/trackers/:id` when the modal saves an existing tracker.
- `DELETE /api/trackers/:id` when the trash button deletes a tracker.

Mutation responses include a refreshed `trackers` sidebar list. Runtime state is updated immediately; the next normal game save writes the registry through `trackers.json`.
