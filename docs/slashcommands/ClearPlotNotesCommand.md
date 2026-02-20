# ClearPlotNotesCommand

## Purpose
Slash command `/clear_plot_notes` to remove hidden plot-summary and plot-expander entries from chat history.

## Aliases
- `/clear_plot_summaries`
- `/clear_plot_expander`

## Args
- None.

## Behavior
- Removes entries whose `type` is one of:
  - `plot-summary`
  - `plot-expander`
- Persists changes via `performGameSave()`.
- Emits `chat_history_updated` to refresh clients.

## Notes
- Returns a count of removed entries.
