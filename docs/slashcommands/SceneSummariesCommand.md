# SceneSummariesCommand

## Purpose
Slash command `/scene_summaries` (alias `/summary_ranges`) to list stored scene summaries and the scene-summary entry ranges they cover.

## Args
- None.

## Behavior
- Reads `Globals.getSceneSummaries().getScenesInOrder()` without generating, replacing, or deleting summaries.
- Replies with each stored scene numbered in display order, including `Entry N` or `Entries N-M` plus the scene summary text.
- Reports coverage gaps against the current scene-summary-eligible chat history, so missing ranges are visible while debugging base-context coverage.
- Does not display legacy one-line per-entry summaries.

## Notes
- Entry numbers are the 1-based scene-summary index numbers stored on `SceneSummaries`, not raw array offsets into the saved `chatHistory` file.
- Coverage uses the same shared scene-summary index as `/summarize` and automatic scene-threshold summarization, excluding event/status summary entries while preserving hidden supplemental/offscreen story entries.
