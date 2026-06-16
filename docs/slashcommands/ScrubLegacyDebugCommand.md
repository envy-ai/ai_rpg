# ScrubLegacyDebugCommand

## Purpose
Slash command `/scrub_legacy_debug` removes legacy check/tool-call debug pollution from chat history and stored scene summaries.

Aliases:
- `/scrub_debug_history`
- `/scrub_debug`

## Args
- `dry_run` (boolean, optional). When `true`, reports affected counts without mutating history or saving.

## Behavior
- Removes standalone legacy diagnostic chat entries with type `tool-call-debug` or `check-results`.
- Removes standalone entries with debug metadata (`metadata.debugToolCalls` or `metadata.checkResults`), structured `toolCalls` or `checkResults` arrays, or text made entirely from legacy `Checks for...`, `Tool calls for...`, `Checks: N check...`, or `Tool call debug: N call...` diagnostics.
- Preserves non-debug `system` entries instead of deleting every system-role row.
- Strips embedded legacy debug lines matching `Checks: N check...` and `Tool call debug: N call...` from chat-entry `content` and `summary`.
- Strips the same embedded lines from stored scene-summary `summary`, `details`, and quote text. Empty detail and quote text items are removed from the stored scene.
- Refuses to scrub a stored scene summary if removing debug text would leave the scene with an empty required summary.
- Updates `lastEditedAt` on modified chat entries.
- If no scrub targets are found, replies without saving.
- In `dry_run` mode, replies with removal/scrub counts without mutating chat history, updating scene summaries, saving, or emitting realtime events.
- When scrubbing is applied, persists with `interaction.performGameSave()` and emits `chat_history_updated` when chat entries were removed or modified.
- Raises explicit errors when chat history, scene summaries, save persistence, or the realtime hub needed for chat refresh is unavailable.
