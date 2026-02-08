# ClearSecretsCommand

## Purpose
Slash command `/clear_secrets` to remove hidden supplemental/offscreen NPC story info entries from chat history.

## Args
- None.

## Behavior
- Removes entries whose `type` is one of:
  - `supplemental-story-info`
  - `offscreen-npc-activity-daily`
  - `offscreen-npc-activity-weekly`
- Persists changes via `performGameSave()`.
- Emits `chat_history_updated` to refresh clients.

## Notes
- Returns a count of removed entries.
