# RandomCommand

## Purpose
Slash command `/random` to trigger a random event of a given type and broadcast the resulting text.

## Args
- `type` (string, required): one of:
  - `location`, `region`
  - file-based types from `random_event_frequency` (always includes `common` and `rare`)

## Behavior
- Validates event type against:
  - `location` / `region`
  - configured file-based random event types from `random_event_frequency` (excluding control keys like `enabled`, `locationSpecific`, `regionSpecific`)
- Calls `Globals.triggerRandomEvent({ type, entryCollector })`.
- Replies with the last collected entry or summary text.
- Emits `chat_history_updated` via `Globals.realtimeHub`.

## Notes
- Returns an ephemeral error when invalid type or when triggering fails.
- File-based types load seeds from `random_events/<type>.txt`.
