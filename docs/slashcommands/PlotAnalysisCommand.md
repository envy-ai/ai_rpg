# PlotAnalysisCommand

`/plot_analysis` displays the current stored background plot-analysis state from `Globals.getPlotAnalysis()`.

## Usage

`/plot_analysis`

The command takes no arguments and replies publicly (`ephemeral: false`).

## State Source

Normal player-action prompts schedule a non-blocking `plot-analysis` prompt when `plot_analysis.enabled` is not `false`. Completed prompt output is normalized into `Globals.plotAnalysis`, persisted in save metadata, and exposed through `Globals.getPlotAnalysis()`. The background prompt can call only `addTracker` and `scheduleEvent` to create new trackers or timed events after producing its XML analysis. The scheduler uses a sequence/token guard so stale background completions do not replace the stored state or execute tracker/event tool calls after being superseded.

The slash command only reads the stored state. It does not schedule or run a plot-analysis prompt.

## Output

When plot-analysis state is available, the reply is Markdown with:

- `## Plot Analysis`
- `Updated: ...` when `updatedAt` is present
- `### Active Plot Threads`, including `**[current]**` for the thread marked `isCurrentFocus`
- `### Current Plot Complications`, numbered in stored order
- `### Parse Error` when the stored state contains `parseError`
- `### Raw Output` when raw prompt output is available and the parsed state is incomplete or has a parse error

When no plot-analysis state is available, the reply is:

```text
No plot analysis is available yet.
```

If `Globals.getPlotAnalysis` is unavailable, execution throws `Plot analysis state is unavailable.` rather than returning placeholder text.
