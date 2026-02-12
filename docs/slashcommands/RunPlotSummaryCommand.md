# RunPlotSummaryCommand

## Purpose
Slash command `/runplotsummary` to run the plot-summary prompt immediately and store it as a hidden `plot-summary` chat entry.

## Args
- `show` (optional boolean)
  - `true`: reply with the generated plot summary text.
  - omitted/`false`: do not print the generated summary text.

## Behavior
- Calls the server's plot-summary prompt runner directly (same prompt path used by scheduled runs).
- Stores the result in chat history as `type: plot-summary` with hidden/base-context-excluded metadata.
- Replies with either:
  - the generated summary text when `show=true`, or
  - a confirmation message when `show` is omitted/false.

## Notes
- If a plot summary run is already in progress, command execution fails instead of silently no-oping.
