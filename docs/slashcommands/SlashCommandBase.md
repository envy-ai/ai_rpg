# SlashCommandBase

## Purpose
`SlashCommandBase.js` is the shared base class for command classes exported from `slashcommands/*.js`. It supplies common static metadata defaults, generated usage text, primitive argument validation, and the command list consumed by `/help`.

Command modules usually extend this class, but registration depends on `SlashCommandRegistry.js`: a module must expose a non-empty static `name` and an `execute(interaction, args)` function. Registry lookup trims and lowercases command labels, registers aliases from a static `aliases` array, and keeps only the first module for duplicate labels.

## Static Contract
- `get name()`: required canonical command label without the leading slash. The base getter throws `Name not implemented`.
- `get aliases()`: optional alternate labels without leading slashes. The base getter returns `[]`.
- `get description()`: required short help text. The base getter throws `Description not implemented`.
- `get showExecutionOverlay()`: optional boolean metadata for `/api/slash-command`. The base getter returns `true`.
- `get args()`: required argument definition array. The base getter throws `Args not implemented`.
- `get usage()`: generated usage string based on `args`, with required args rendered as `<name>` and optional args rendered as `[name]`.
- `validateArgs(providedArgs)`: validates supplied values against `args` and returns an array of error strings.
- `listCommands()`: reads the live slash-command registry and returns sorted canonical command entries for `/help`.

`handleUpload(interaction, args, uploads)` is not implemented by the base class. Commands that return a file-upload reply action must define this static method so `/api/slash-command/upload` can route the follow-up request.

## Argument Definitions
`args` entries use this shape:

```js
{ name: 'amount', type: 'integer', required: true }
```

Supported primitive types are:

- `string`
- `integer`
- `boolean`

The base validator reports missing required values, non-string string args, non-integer integer args, non-boolean boolean args, and unknown declared types. Extra supplied args are ignored by the base validator so commands can parse raw `interaction.argsText` or custom fields when needed.

The HTTP slash-command path fills missing declared args from raw `argsText` before calling `validateArgs(...)`. Positional parsing respects double-quoted strings. Declared integer and boolean positional args are coerced by `api.js`; booleans accept `true` and `false`.

## Command Listing
`listCommands()` uses `getRegisteredSlashCommands()` from `SlashCommandRegistry.js`.

- Alias registry entries are skipped, so `/help` lists each command once by canonical name.
- Entries without a command module or usable name are skipped.
- `description` is read defensively; missing or throwing metadata becomes an empty string.
- `usage` is read defensively; missing or throwing metadata falls back to `/<canonicalName>`.
- The returned entries have `{ name, description, usage }` and are sorted by `name`.

`slashcommands/help.js` formats this list into the `/help` reply.

## Replies, Uploads, And Overlays
Command handlers send output through `interaction.reply(payload)`. Return values from `execute(...)` and `handleUpload(...)` are ignored by the API route.

Reply payloads are normalized in `api.js`:

- A reply must include `content` or `action`.
- `content` must be a string. Action-only replies receive `content: ''`.
- `ephemeral` must be a boolean and defaults to `false`.
- The supported action type is `request_file_upload`.

The `request_file_upload` action opens the shared chat upload modal in `public/js/chat.js`. The client posts selected text-file payloads to `/api/slash-command/upload`, which requires the target command to implement `handleUpload(interaction, args, uploads)`. Upload entries are normalized to `{ filename, content, mimeType, size }`; filename and string content are required.

`showExecutionOverlay` controls the delayed `Executing command...` UI overlay for the initial `/api/slash-command` request. The API returns `executionOptions.showExecutionOverlay`; values other than booleans raise an error. Commands that immediately open UI, such as `/import_item`, set `showExecutionOverlay` to `false` so the client cancels the pending overlay before processing the reply action.

## Relevant Code And Tests
- `SlashCommandBase.js`: metadata defaults, usage generation, validation, and canonical command listing.
- `SlashCommandRegistry.js`: directory loading, command/alias registration, lookup, and registry enumeration.
- `api.js`: request normalization, positional arg filling, reply/action normalization, upload handling, execution options, and interaction construction.
- `public/js/chat.js`: slash-command client dispatch, reply rendering, upload modal handoff, and execution overlay handling.
- `tests/api.slash_command_upload_helpers.test.js`: action-only replies, upload normalization, unsupported action rejection, and overlay metadata validation.
- `tests/import_item_command.test.js`: upload-action command behavior and `showExecutionOverlay: false`.
