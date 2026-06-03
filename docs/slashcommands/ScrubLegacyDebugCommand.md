# ScrubLegacyDebugCommand

## Purpose
Slash command `/scrub_legacy_debug` to remove old check/tool-call debug pollution from chat history and stored scene summaries.

Aliases:
- `/scrub_debug_history`
- `/scrub_debug`

## Args
- `dry_run` (boolean, optional). When `true`, reports what would change without mutating history or saving.

## Behavior
- Removes standalone legacy diagnostic chat entries such as `tool-call-debug`, `check-results`, debug metadata entries, and entries whose text is only a legacy `Checks for...` or `Tool calls for...` block.
- Preserves non-debug `system` entries instead of deleting every system-role row.
- Strips embedded scene-summary pollution lines matching `Checks: N check...` and `Tool call debug: N call...` from chat-entry `content`/`summary` and stored scene summary `summary`, `details`, and quote text.
- Refuses to scrub a stored scene summary if removing debug text would leave the scene with an empty required summary.
- Persists changes with `interaction.performGameSave()` and emits `chat_history_updated` when chat entries were removed or modified.
