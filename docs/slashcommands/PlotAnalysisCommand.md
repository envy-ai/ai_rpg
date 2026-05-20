# PlotAnalysisCommand

`/plot_analysis` displays the latest background plot analysis stored in `Globals.plotAnalysis`.

- Takes no arguments.
- Returns Markdown with the last update time, active plot threads, and the current plot-complication chain.
- If the latest output could not be parsed into the expected XML structure, the command also shows the parse error and raw output.
- If no player-action-triggered plot-analysis prompt has completed yet, it replies with `No plot analysis is available yet.`

