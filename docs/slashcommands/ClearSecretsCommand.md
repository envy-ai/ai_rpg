# ClearSecretsCommand

## Purpose
Slash command `/clear_secrets` removes hidden supplemental and offscreen NPC story info entries from chat history.

## Aliases
- None.

## Args
- None.

## Behavior
- Reads the live slash-command chat history from `interaction.getChatHistory()` when available, otherwise from `interaction.chatHistory`.
- Removes object entries whose trimmed string `type` is one of:
  - `supplemental-story-info`
  - `offscreen-npc-activity-daily`
  - `offscreen-npc-activity-weekly`
- Ignores malformed entries and entries with other types.
- Leaves history unchanged and skips save/realtime work when chat history is unavailable, empty, or contains no matching entries.
- Persists removals with `performGameSave()`.
- Emits `chat_history_updated` through `Globals.realtimeHub` with:
  - `removedEntryIds`: ids collected from removed entries that have an `id`.
  - `removedEntries`: number of removed entries.
- Replies publicly with the number of removed secret entries.

## Error and Empty States
- If chat history is unavailable, replies ephemerally: `Chat history is unavailable in the current command context.`
- If chat history is empty, replies ephemerally: `No chat history available to clean.`
- If no matching entries exist, replies publicly: `No secret entries were found in chat history.`
- If entries are removed but `performGameSave()` or the realtime hub is unavailable, command execution throws a clear error instead of treating the cleanup as successful.

## Registration
- `SlashCommandRegistry` auto-loads the command from `slashcommands/clear_secrets.js`.
- `/help` lists the canonical `/clear_secrets` command.

## Notes
- The command removes hidden chat-history entries only. It does not edit region `secrets` arrays or other world-state secret fields.
