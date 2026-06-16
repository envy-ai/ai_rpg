# RunPlotSummaryCommand

## Purpose
Slash command `/runplotsummary` runs the plot-summary prompt on demand and stores the generated text as a hidden `plot-summary` chat entry.

## Args
- `show` (optional boolean): when `true`, the command reply contains the generated plot summary text. When omitted or `false`, the reply is `Plot summary generated and stored.`

## Behavior
- Requires `interaction.runPlotSummaryPrompt`; if that helper is unavailable, execution throws `Plot summary execution is unavailable in this command context.`
- Uses the shared plot-summary prompt runner for the current player location. The interaction helper resolves the location through `currentPlayer.currentLocation` and the server's location-id validation.
- The prompt runner renders `base-context.xml.njk` with `promptType: 'plot-summary'`, sends the rendered prompts through `LLMClient.chatCompletion()` with `metadataLabel: 'plot_summary'`, `validateXML: false`, and `runInBackground: true`, then records the request and response with `LLMClient.logPrompt()`.
- A successful run stores an assistant entry with:
  - `type: 'plot-summary'`
  - `content` and `summary` set to the trimmed generated text
  - `locationId` set to the resolved location
  - `metadata.excludeFromBaseContextHistory: true`
- `plot-summary` is a hidden chat-entry type in `server.js`, and scene-summary indexing also excludes plot-summary entries.
- The command replies publicly. `show=true` replies with the generated summary text; omitted or `false` replies with the confirmation message.

## Notes
- Only one plot-summary prompt can run at a time. If the shared runner returns no stored entry, including the in-progress case, the command throws `Plot summary did not produce a stored entry (it may already be running).`
- The `extra_plot_prompts.plot_summary` setting gates automatic scheduling only; this manual slash command still calls the shared runner.
