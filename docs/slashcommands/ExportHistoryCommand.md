# ExportHistoryCommand

## Purpose
Slash command `/export_history` to export chat history to a text or HTML file.

## Args
- `format` (string, optional, default `text`): `text` or `html` (accepts `txt`).
- `filename` (string, optional): base filename (extension validated).
- `excludeSummaries` (boolean, optional, default true): omit summary entries.
- `useIndex` (boolean, optional, default true): use sequential index labels.

## Behavior
- Filters chat history with `filterChatHistoryEntries`.
- Formats output as plain text or HTML with role labels.
- Writes to `exports/` under the project base directory.
- Replies with file path or validation errors.

## Notes
- Rejects mismatched extensions to avoid silent format conflicts.
