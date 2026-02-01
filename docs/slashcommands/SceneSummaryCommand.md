# SceneSummaryCommand

## Purpose
Slash command `/summarize` (alias `/scene_summary`) to summarize chat history into scenes and export to a text file.

## Args
- `range` (string, required): "check", "all", "N", or "N-M".
- `redo` (boolean, optional): re-summarize and extend the range slightly.

## Behavior
- When `range` is "check", counts unsummarized entries using `SceneSummaries`.
- Otherwise parses the range and calls `Globals.summarizeScenesForHistoryRange`.
- Writes a text export file and replies with the result path.

## Notes
- Uses `filterChatHistoryEntries` and `normalizeEntryText` to count entries.
