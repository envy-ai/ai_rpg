# RegexReplaceCommand

## Purpose
`/regex_replace` applies one JavaScript regular-expression replacement across persisted story and world text. It shares its mutation implementation with the generic-prompt `regexReplace` tool.

## Command Metadata
- File: `slashcommands/regex_replace.js`.
- Class: `RegexReplaceCommand`, extending `SlashCommandBase`.
- Canonical command: `regex_replace`.
- Aliases: none.
- Help description: `Replace text across the story log, memories, NPCs, locations, and items using regular expressions.`
- Usage from declared args: `/regex_replace <pattern> <replacement> [flags] [scope]`.

## Args
- `pattern` (string, required): Trimmed before execution. A missing, null, or all-whitespace pattern returns an ephemeral `Pattern is required.` reply.
- `replacement` (string or null, required): String values are trimmed before execution. `null`, an empty string, or an all-whitespace string replaces matches with empty text. The argument must be present; omitted or `undefined` values fail validation.
- `flags` (string, optional, default `g`): Trimmed before execution. Only `g`, `i`, `m`, `s`, `u`, and `y` characters pass the command's flag-character check. Duplicate or otherwise invalid flag combinations fail when the command constructs `new RegExp(pattern, flags)`.
- `scope` (string, optional): Trimmed before execution. Omit it to search every supported category. Special scopes are `story` (all chat entry types), `memories`, `npcs`, `locations`, and `items`. Any other value remains an exact chat-entry `type` filter, preserving commands such as `/regex_replace old new g player-action`. Because `flags` comes before `scope`, slash text with a scope must include the flags argument.

## Validation
- `validateArgs(...)` requires `pattern` to be a string and `replacement` to be present as either a string or `null`.
- `flags` may be omitted, `null`, or a string. Other flag value types fail validation.
- `scope` may be omitted, `null`, or a string. Other scope value types fail validation.
- Execution rejects invalid flag characters before constructing the `RegExp`.
- Execution catches `RegExp` construction errors and replies with `Invalid regex pattern: ...`.

## Execution
- `regex_replace_runtime.js` compiles the expression once, computes every prospective edit, validates required fields, then applies the batch. This prevents an invalid required item description from causing a partially applied replacement.
- Supported text is intentionally allowlisted:
  - Story: string `content` on eligible chat-history entries. Edited rows receive a new `lastEditedAt` ISO timestamp.
  - Memories: every actor's `importantMemories` strings. Assignment uses the Player memory setter, so blank results are removed and duplicate results are normalized.
  - NPCs only: `description`, `shortDescription`, `personalityType`, `personalityTraits`, `personalityNotes`, `aiNotes`, `resistances`, and `vulnerabilities`.
  - Locations: `description` and `shortDescription`.
  - Items and scenery: `description` and `shortDescription`.
- Names, ids, aliases, image prompts/ids, type/classification fields, references, mechanics, and object-graph fields are never searched or changed.
- Counts distinguish replacement occurrences, modified text values, messages, memories, entity fields, and unique entity owners.
- If nothing is edited, the command replies `No matches found for the given pattern.` and does not save or emit a refresh event.

## Persistence And Refresh
- After edits, the command attempts `interaction.performGameSave()` when that helper is a function.
- Missing save helpers and save failures are logged as warnings; they do not stop the success reply.
- The command emits `chat_history_updated` through `Globals.realtimeHub.emit(null, ...)` when a realtime hub is available.
- The refresh payload is:

```js
{
  modifiedEntryIds,
  totalReplacements,
  modifiedEntries,
  modifiedChatEntries,
  modifiedMemories,
  modifiedMemoryOwners,
  modifiedNpcFields,
  modifiedNpcs,
  modifiedLocationFields,
  modifiedLocations,
  modifiedItemFields,
  modifiedItems,
  // plus the corresponding modified owner-id arrays
}
```

## Replies
- Missing pattern: ephemeral `Pattern is required.`
- Missing replacement during execution: ephemeral `Replacement is required.`
- Invalid flags: ephemeral `Invalid regex flags: ...`
- Invalid regex: ephemeral `Invalid regex pattern: ...`
- Missing/empty history: ephemeral `No chat history available to modify.`
- No matches: visible `No matches found for the given pattern.`
- Chat-only edits retain the visible compatibility reply `Replaced N occurrence(s) in M message(s). Changes have been saved.`
- Multi-category edits report each nonzero target count, such as messages, memories, NPC fields, location fields, and item fields.

## Generic-Prompt Tool
- `regexReplace({ pattern, replacement, flags?, scope? })` is declared as a generic-prompt-only built-in tool.
- `pattern` and `replacement` are required. `replacement` may be an empty string. `flags` defaults to `g`; `scope` uses the same category or exact-chat-type rules as the slash command.
- It returns `<regexReplaceResult>` with total replacements and per-category modified counts, plus the complete structured counts and modified owner ids in tool metadata.
- The tool is excluded from the shared regular-prose tool schema, so only context-bearing generic prompts (`@`, `@@`, and `@@@`) can invoke it. No-context generic prompts expose no tools.

## Tests
- `tests/regex_replace_command.test.js` covers deletion, chat-type and world-category scopes, story/memory/NPC/location/item mutations, identity-field exclusion, saving, realtime payloads, edit timestamps, and argument validation.
- `tests/chat_tool_calls.test.js` covers the generic tool schema, shared runtime execution, category scoping, XML output, and structured metadata.
