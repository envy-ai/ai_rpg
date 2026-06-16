# RunPlotExpanderCommand

## Purpose
`/runplotexpander` runs the plot-expander prompt for a named plot thread and stores the response as a hidden `plot-expander` assistant entry.

## Args
- `show` (optional boolean)
  - `true`: replies with the generated plot-expander text.
  - omitted or `false`: replies with a storage confirmation.
- `specificPlot` (required string)
  - Name or description of the plot thread to expand.
  - In chat input, positional usage includes the `show` value before the quoted plot string because `show` is the first declared argument.

## Behavior
- Requires `interaction.runPlotExpanderPrompt`; command execution fails when that helper is unavailable.
- Trims `specificPlot` and requires a non-empty string.
- Calls the server plot-expander prompt runner with `{ specificPlot }`.
- The prompt runner renders `base-context.xml.njk` with `promptType: 'plot-expander'` and passes the trimmed `specificPlot` into the plot-expander include.
- The stored entry has `role: 'assistant'`, `type: 'plot-expander'`, `content` and `summary` set to the generated text, the resolved current location id, and `metadata.excludeFromBaseContextHistory: true`.
- Prompt requests use `metadataLabel: 'plot_expander'`, `validateXML: false`, and `runInBackground: true`; the rendered prompt and response are logged through `LLMClient.logPrompt()`.
- Replies with either:
  - the generated text when `show` is `true`, or
  - `Plot expander generated and stored.` when `show` is omitted or `false`.

## Failure Cases
- A blank or missing `specificPlot` fails validation.
- A missing plot-expander helper fails with `Plot expander execution is unavailable in this command context.`
- If the prompt runner returns no stored entry, the command fails with `Plot expander did not produce a stored entry (it may already be running).`
- If `show` is `true` and the stored entry has no text content, the command fails with `Plot expander entry was created without content.`

## Example
- `/runplotexpander false "The missing tome"`
- `/runplotexpander true "The missing tome"`
