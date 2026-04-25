# SceneSummaryCommand

## Purpose
Slash command `/summarize` (alias `/scene_summary`) to summarize chat history into scenes and export to a text file.

## Args
- `range` (string, required): "check", "all", "N", or "N-M".
- `redo` (boolean, optional): re-summarize and extend the range slightly.

## Behavior
- When `range` is "check", counts unsummarized entries using the same scene-summary index as the summarizer.
- Otherwise parses the range and calls `Globals.summarizeScenesForHistoryRange`.
- `range=all` without `redo` summarizes only the unsummarized tail.
- `range=all` with `redo=true` clears overlapping scene summaries and rebuilds all scenes from entry 1.
- Writes a text export file and replies with the result path.

## Notes
- Scene-summary entry numbers are 1-based scene-summary index numbers, not raw `chatHistory` array offsets.
- The shared scene-summary index excludes `event-summary` and `status-summary` entries, plus plot-summary/plot-expander entries, while preserving hidden supplemental/offscreen story entries such as `while-you-were-away`.
