# ClearSecretsCommand

## Purpose
Slash command `/clear_secrets` to remove hidden supplemental story info entries from chat history.

## Args
- None.

## Behavior
- Removes entries whose `type` is `supplemental-story-info`.
- Persists changes via `performGameSave()`.
- Emits `chat_history_updated` to refresh clients.

## Notes
- Returns a count of removed entries.
