# RunPlotExpanderCommand

## Purpose
Slash command `/runplotexpander` to run the plot-expander prompt immediately and store it as a hidden `plot-expander` chat entry.

## Args
- `show` (optional boolean)
  - `true`: reply with the generated plot expander text.
  - omitted/`false`: do not print the generated text.
- `specificPlot` (required string)
  - Name/description of the plot thread to expand.
  - For positional usage, provide it in quotes after `show`.

## Behavior
- Calls the server's plot-expander prompt runner directly (same prompt path used by scheduled runs).
- Stores the result in chat history as `type: plot-expander` with hidden/base-context-excluded metadata.
- Passes `specificPlot` through to the prompt template as `specificPlot`.
- Replies with either:
  - the generated text when `show=true`, or
  - a confirmation message when `show` is omitted/false.

## Example
- `/runplotexpander false "The missing tome"`

## Notes
- If a plot expander run is already in progress, command execution fails instead of silently no-oping.
