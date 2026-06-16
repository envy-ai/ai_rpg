# SceneSummariesCommand

## Purpose
Slash command `/scene_summaries` (alias `/summary_ranges`) lists stored scene summaries and the scene-summary index ranges they cover.

## Args
- None.

## Behavior
- Requires `Globals.getSceneSummaries().getScenesInOrder()` and chat history from `interaction.getChatHistory()` or `interaction.chatHistory`; missing scene-summary state or chat history raises an error.
- Reads stored summaries without generating, replacing, persisting, or deleting summaries.
- Replies publicly with a Markdown report headed `## Scene Summaries`.
- When stored scenes exist, prints `Stored summaries: N`, then lists each stored scene by 1-based display number in `startIndex` order.
- Each scene line uses `Entry N` or `Entries N-M` plus the scene `summary` collapsed to one line.
- Omits scene `details`, `quotes`, and unsummarized per-entry summary text.
- When no stored scenes exist, reports `No scene summaries are stored.`
- Always appends a coverage line for the current scene-summary-eligible chat history: `Coverage gaps: none.`, `Coverage gaps: no scene-summary-eligible entries.`, or a comma-separated list of uncovered `entry` / `entries` ranges.

## Notes
- Entry numbers are 1-based positions in the shared scene-summary index, not raw array offsets into saved `chatHistory`.
- Display numbers are the ordered positions returned by `SceneSummaries.getScenesInOrder()`.
- Coverage uses `countSceneSummaryIndexEntries(chatHistory)`, the same shared index used by `/summarize` and automatic scene-threshold summarization.
- The shared index excludes prompt-excluded/system entries, diagnostics such as `tool-call-debug` and `check-results`, event/status summaries, and plot-summary/plot-expander entries. Hidden story-note entries with narrative content, including supplemental/offscreen/while-you-were-away entries, remain eligible.
