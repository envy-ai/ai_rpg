# ClearPlotNotesCommand

## Purpose
Slash command `/clear_plot_notes` removes hidden plot summary and plot expander entries from chat history.

## Aliases
- `/clear_plot_summaries`
- `/clear_plot_expander`

## Args
- None.

## Behavior
- Reads the live slash-command chat history from the interaction context.
- Removes object entries whose trimmed string `type` is one of:
  - `plot-summary`
  - `plot-expander`
- Ignores malformed entries and entries with other types.
- Leaves history unchanged and skips save/realtime work when chat history is unavailable, empty, or contains no matching entries.
- Persists removals with `performGameSave()`.
- Emits `chat_history_updated` through `Globals.realtimeHub` with:
  - `removedEntryIds`: ids collected from removed entries that have an `id`.
  - `removedEntries`: number of removed entries.
- Replies publicly with the number of removed plot-note entries.

## Error and Empty States
- If chat history is unavailable, replies ephemerally: `Chat history is unavailable in the current command context.`
- If chat history is empty, replies ephemerally: `No chat history available to clean.`
- If no matching entries exist, replies publicly: `No plot summary or plot expander entries were found in chat history.`
- If entries are removed but `performGameSave()` or the realtime hub is unavailable, command execution throws a clear error instead of silently treating the cleanup as successful.

## Registration
- `SlashCommandRegistry` auto-loads the command from `slashcommands/clear_plot_notes.js`.
- The registry dispatches the canonical command and both aliases to this implementation.
- `/help` lists the canonical `/clear_plot_notes` command; aliases are dispatch names, not separate help entries.
