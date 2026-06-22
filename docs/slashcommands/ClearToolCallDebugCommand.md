# ClearToolCallDebugCommand

## Purpose
Slash command `/clear_tool_call_debug` removes visible `tool-call-debug` diagnostic entries from chat history and asks the invoking browser tab to reload.

## Aliases
- `/clear_tool_calls`
- `/clear_tool_debug`

## Args
- None.

## Behavior
- Reads the live slash-command chat history from `interaction.getChatHistory()` when available, otherwise from `interaction.chatHistory`.
- Removes object entries whose trimmed string `type` is exactly `tool-call-debug`.
- Ignores malformed entries and entries with other types, including `check-results`.
- Persists removals with `performGameSave()` only when at least one entry is removed.
- Emits `chat_history_updated` through `Globals.realtimeHub` only when at least one entry is removed, with:
  - `removedEntryIds`: ids collected from removed entries that have an `id`.
  - `removedEntries`: number of removed entries.
- Replies publicly with the number of removed entries and a `reload_page` reply action delayed by 250 ms so the user can see the count briefly.

## Error and Empty States
- If chat history is unavailable, replies ephemerally: `Chat history is unavailable in the current command context.`
- If no matching entries exist, replies publicly with `Removed 0 tool-call debug entries from chat history. Reloading page...`, skips save/realtime work, and still requests a page reload.
- If entries are removed but `performGameSave()` or the realtime hub is unavailable, command execution throws a clear error instead of silently treating the cleanup as successful.

## Registration
- `SlashCommandRegistry` auto-loads the command from `slashcommands/clear_tool_call_debug.js`.
- The registry dispatches the canonical command and both aliases to this implementation.
- `/help` lists the canonical `/clear_tool_call_debug` command; aliases are dispatch names, not separate help entries.
