# RegexReplaceCommand

## Purpose
Slash command `/regex_replace` to apply a regular expression replacement across chat history entries.

## Args
- `pattern` (string, required).
- `replacement` (string or null, required). Empty string and null replace matches with empty text.
- `flags` (string, optional, default `g`).

## Behavior
- Validates regex flags and pattern.
- Allows an explicit empty or null replacement so matches can be deleted.
- Iterates through `interaction.chatHistory`, replacing matches and updating `lastEditedAt`.
- Persists changes via `interaction.performGameSave()` when available.
- Emits `chat_history_updated` with modified ids.

## Notes
- Returns a count of replacements and modified messages.
