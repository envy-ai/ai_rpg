# RegexReplaceCommand

## Purpose
Slash command `/regex_replace` to apply a regular expression replacement across chat history entries.

## Args
- `pattern` (string, required).
- `replacement` (string, required).
- `flags` (string, optional, default `g`).

## Behavior
- Validates regex flags and pattern.
- Iterates through `interaction.chatHistory`, replacing matches and updating `lastEditedAt`.
- Persists changes via `interaction.performGameSave()` when available.
- Emits `chat_history_updated` with modified ids.

## Notes
- Returns a count of replacements and modified messages.
