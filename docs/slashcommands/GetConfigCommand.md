# GetConfigCommand

## Purpose
Read a value from the runtime configuration object exposed as `Globals.config`.

`/get` is a read-only diagnostic command. It does not reload configuration files, mutate `Globals.config`, or persist anything to disk.

## Registration
- Implementation: `slashcommands/get.js`.
- Canonical command: `/get`.
- Aliases: none.
- `/help` lists the command through `SlashCommandBase.listCommands()` with generated usage `/get <path>`.

## Args
- `path` (string, required): dot-delimited path inside `Globals.config`.

## Usage

```text
/get <path>
```

Examples:

```text
/get ai.backend
/get random_event_frequency
/get "npc_turns.enabled"
```

## Behavior
- The slash-command API fills the required `path` argument from the first positional token in `argsText`, unless a named `path=...` argument is already present.
- The command trims the path and removes one matching pair of surrounding single or double quotes.
- The command splits the path on `.`, trims each segment, and ignores empty segments.
- Lookup starts at `Globals.config` and walks each segment as an object property. Array indexes also work as property names when the current value is an array.
- A found object, array, or `null` value is rendered as a fenced `json` block.
- Primitive values are rendered inline in backticks with `String(value)`.
- A successful reply is a normal system message with the heading `Configuration value for \`path\`:`.

## Error Replies
- Missing or non-string `path`: ephemeral reply asking for a configuration path.
- Uninitialized `Globals.config`: ephemeral reply `Configuration has not been initialized yet.`
- Empty path after normalization: ephemeral reply `Invalid configuration path provided.`
- Missing value, identified by a final value of `undefined`: ephemeral reply `No configuration value found at \`path\`.`

## Notes
- The command reports the normalized path in replies by joining the retained path segments with `.`.
- Configuration keys that themselves contain `.` cannot be addressed because `.` is always treated as a segment separator.
- Values whose effective value is `undefined` are reported as missing; `null`, `false`, `0`, and empty strings are reported as found values.
