# SetConfigCommand

## Purpose
Update a value on the live runtime configuration object exposed as `Globals.config`.

`/set` is a diagnostic/admin command for changing server behavior in memory during the current process. It does not write YAML, reload definition caches, or persist the value across restart.

## Registration
- Implementation: `slashcommands/set.js`.
- Canonical command: `/set`.
- Aliases: none.
- `/help` lists the command through `SlashCommandBase.listCommands()` with generated usage `/set <path> <value>`.

## Args
- `path` (string, required): dot-delimited path inside `Globals.config`.
- `value` (string, required): value to assign. Positional `true` and `false` values are converted to booleans; all other positional values remain strings.

## Usage

```text
/set <path> <value>
```

Examples:

```text
/set ai.backend codex
/set use_legacy_prompt_checks false
/set "random_events.frequency" frequent
/set setting_generation.defaultTone "hopeful adventure"
```

## Behavior
- The slash-command API fills `path` and `value` from positional tokens in `argsText`, unless named arguments are supplied in the request body.
- The command trims `path` and removes one matching pair of surrounding single or double quotes.
- The command trims `value`, removes one matching pair of surrounding single or double quotes, and converts case-insensitive `true` and `false` to booleans.
- The command splits `path` on `.`, trims each segment, and ignores empty segments.
- Assignment starts at `Globals.config` and walks each retained path segment as an object property. Array indexes also work as property names when the current value is an array.
- Missing intermediate objects are created. Existing intermediate `null` or primitive values are replaced with objects so the assignment can continue.
- The final segment is assigned directly. The command does not validate that the target key is known to the config schema.
- A successful reply is a normal system message in the form `Configuration updated: \`path\` = \`value\``.

## Error Replies
- Missing or non-string `path`: ephemeral reply asking for a configuration path.
- Missing or non-string `value`: rejected by slash-command argument validation before `execute(...)` runs.
- Uninitialized `Globals.config`: ephemeral reply `Configuration has not been initialized yet.`
- Empty path after normalization: ephemeral reply `Invalid configuration path provided.`

## Notes
- Configuration keys that themselves contain `.` cannot be addressed because `.` is always treated as a segment separator.
- Numeric, object, array, and `null` values are not parsed from chat positional input. For example, `/set tuning.limit 10` stores the string `"10"`.
- In the chat UI, named `value=...` arguments are parsed before the request is sent. Numeric literals and `true`/`false` named values become non-string values and fail this command's string argument validation. Use positional form for those values.
- Because the command mutates `Globals.config` directly, later code reads the updated value through the shared runtime config object.
