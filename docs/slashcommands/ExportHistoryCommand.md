# ExportHistoryCommand

## Purpose
Slash command `/export_history` exports story chat history to a UTF-8 text or HTML file under `exports/`.

## Usage
```text
/export_history [format] [filename] [excludeSummaries] [useIndex]
```

Examples:
```text
/export_history
/export_history html
/export_history html session.html false false
/export_history text "session notes" true false
```

## Args
- `format` (string, optional, default `text`): `text`, `txt`, or `html`. `txt` is treated as `text`.
- `filename` (string, optional): base filename or filename with a matching extension.
- `excludeSummaries` (boolean, optional, default `true`): omits summary-style status/event entries when `true`.
- `useIndex` (boolean, optional, default `true`): uses sequential export indexes when `true`; uses stored chat entry ids when `false`.

## Behavior
- Reads the live interaction chat history through `interaction.getChatHistory()` when available, otherwise `interaction.chatHistory`.
- Rejects unavailable chat history, empty chat history, unsupported formats, mismatched filename extensions, and filters that leave no exportable entries.
- Filters entries with `filterChatHistoryEntries(chatHistory, { excludeSummaries })`.
- Always excludes system-role entries and entries whose content or summary contains the shared omitted-entry markers:
  - `🛠️ Crafting Results`
  - `📋 Events`
  - `🗒️ Quest`
  - `✅ Quest`
  - `✨ Additional`
  - `♻️ Salvage`
- With `excludeSummaries=true`, also excludes `status-summary` entries and `event-summary` entries whose header begins with `📋 Events` or `🌾 Harvest Results`.
- Uses entry `content` first and entry `summary` when `content` is blank.
- Normalizes rendered text by removing scene illustration image lines, stripping leading `!`, `!!`, or `#` line markers, trimming whitespace, and collapsing repeated newlines.
- Maps role `assistant` to `Storyteller`; maps role `user` to `Globals.currentPlayer.name`; leaves other role labels unchanged.
- Requires a resolvable current player name when exported entries include `user` role entries.
- Skips entries without usable rendered text during formatting.
- Creates `exports/` with `recursive: true` and writes the export file with UTF-8 encoding.
- Replies publicly with `Exported <chatHistory.length> entries to <absolute output path>.` The count is the raw live history length, not the filtered or rendered entry count.

## Output Format
- Text exports use `.txt`. Each rendered entry is separated by a blank line and starts with `[record] [role]` when labels are available.
- HTML exports use `.html`. The command writes a complete HTML document with escaped entry metadata/content, one `<article class="entry">` per rendered entry, and embedded presentation CSS.
- Sequential indexes start at `1` and count rendered entries.
- Stored-id labels require each rendered entry to have a non-empty string `id`; missing ids produce a formatting error reply.

## Filename Handling
- If `filename` is omitted or blank, the command uses `story_history_<timestamp>`.
- Filename characters invalid on common filesystems (`<`, `>`, `:`, `"`, `/`, `\`, `|`, `?`, `*`, and control characters) are replaced with `_`.
- The command appends `.txt` or `.html` when the provided filename has no extension.
- A provided extension must match the resolved format extension.

## Chat Argument Notes
- The chat UI sends positional arguments and also lowercases named `key=value` keys before API dispatch.
- Use positional arguments in chat for `excludeSummaries` and `useIndex`.
- Direct API callers can send exact camelCase `args.excludeSummaries` and `args.useIndex` values.

## Registration And Help
- `SlashCommandRegistry` loads the command from `slashcommands/export_history.js`.
- The command has no aliases.
- `/help` lists the canonical command with generated usage from `SlashCommandBase`.
- The command uses the default slash-command execution overlay behavior.
