# RegexReplaceCommand

## Purpose
`/regex_replace` applies a JavaScript regular-expression replacement across the live chat history array. It is intended for direct repair or cleanup of story log text.

## Command Metadata
- File: `slashcommands/regex_replace.js`.
- Class: `RegexReplaceCommand`, extending `SlashCommandBase`.
- Canonical command: `regex_replace`.
- Aliases: none.
- Help description: `Replace strings throughout the story log using regular expressions.`
- Usage from declared args: `/regex_replace <pattern> <replacement> [flags] [scope]`.

## Args
- `pattern` (string, required): Trimmed before execution. A missing, null, or all-whitespace pattern returns an ephemeral `Pattern is required.` reply.
- `replacement` (string or null, required): String values are trimmed before execution. `null`, an empty string, or an all-whitespace string replaces matches with empty text. The argument must be present; omitted or `undefined` values fail validation.
- `flags` (string, optional, default `g`): Trimmed before execution. Only `g`, `i`, `m`, `s`, `u`, and `y` characters pass the command's flag-character check. Duplicate or otherwise invalid flag combinations fail when the command constructs `new RegExp(pattern, flags)`.
- `scope` (string, optional): Trimmed before execution. When omitted or blank, all chat history entries remain eligible. When provided, only entries whose `type` exactly matches the scope value are eligible, for example `player-action`. Because `flags` comes before `scope`, slash text with a scope must include the flags argument, such as `/regex_replace old new g player-action`.

## Validation
- `validateArgs(...)` requires `pattern` to be a string and `replacement` to be present as either a string or `null`.
- `flags` may be omitted, `null`, or a string. Other flag value types fail validation.
- `scope` may be omitted, `null`, or a string. Other scope value types fail validation.
- Execution rejects invalid flag characters before constructing the `RegExp`.
- Execution catches `RegExp` construction errors and replies with `Invalid regex pattern: ...`.

## Execution
- Reads `interaction.chatHistory` directly and requires it to be a non-empty array.
- Processes only entries whose `content` is a string and, when `scope` is present, whose `type` exactly equals that scope.
- Replaces entry content with `originalContent.replace(regex, replacement)`.
- Sets `entry.lastEditedAt` to the current ISO timestamp for each edited entry.
- Tracks each truthy edited `entry.id` in `modifiedEntryIds`.
- Counts edited entries separately from replacement occurrences. Occurrences are counted from `originalContent.match(regex)`.
- If no entries are edited, replies `No matches found for the given pattern.` and does not save or emit a refresh event.

## Persistence And Refresh
- After edits, the command attempts `interaction.performGameSave()` when that helper is a function.
- Missing save helpers and save failures are logged as warnings; they do not stop the success reply.
- The command emits `chat_history_updated` through `Globals.realtimeHub.emit(null, ...)` when a realtime hub is available.
- The refresh payload is:

```js
{
  modifiedEntryIds,
  totalReplacements,
  modifiedEntries
}
```

## Replies
- Missing pattern: ephemeral `Pattern is required.`
- Missing replacement during execution: ephemeral `Replacement is required.`
- Invalid flags: ephemeral `Invalid regex flags: ...`
- Invalid regex: ephemeral `Invalid regex pattern: ...`
- Missing/empty history: ephemeral `No chat history available to modify.`
- No matches: visible `No matches found for the given pattern.`
- Edits applied: visible `Replaced N occurrence(s) in M message(s). Changes have been saved.`

## Tests
- `tests/regex_replace_command.test.js` covers empty-string deletion, `null` replacement deletion, scoped entry-type replacement, omitted-scope all-entry behavior, save invocation, realtime emission, `lastEditedAt` stamping, modified id payloads, and validation that accepts `null` replacement while rejecting an omitted replacement.
