# RandomCommand

## Purpose
Slash command `/random` to trigger a random event of a given type and broadcast the resulting text.

## Args
- `type` (string, required): one of `common`, `rare`, `location`, `region`.

## Behavior
- Validates event type.
- Calls `Globals.triggerRandomEvent({ type, entryCollector })`.
- Replies with the last collected entry or summary text.
- Emits `chat_history_updated` via `Globals.realtimeHub`.

## Notes
- Returns an ephemeral error when invalid type or when triggering fails.
