# ImportItemCommand

## Purpose
`/import_item` opens the shared slash-command upload modal, accepts one or more XML files, parses `<item>`, `<thing>`, and `<scenery>` entries through `interaction.parseThingsXml(...)`, and creates `Thing` records in the invoking player's current location.

## Command
- Name: `/import_item`
- Aliases: none.
- Implementation: `slashcommands/import_item.js`.
- Help usage: `/import_item [level]`
- Args:
  - `level` (optional integer): positive absolute level assigned to every imported entry. It can be supplied positionally or as `level=<N>`.

`SlashCommandRegistry` registers the command from the `slashcommands/` directory. `/help` lists the canonical command through `SlashCommandBase.listCommands()`.

## Upload Flow
- `execute(...)` replies with a `request_file_upload` action instead of doing the import immediately.
- `showExecutionOverlay` is `false`, so `/api/slash-command` returns `executionOptions.showExecutionOverlay: false` and the chat client cancels the pending `Executing command...` overlay before opening the upload modal.
- The upload action title is `Import XML Items`.
- Accepted upload types are `.xml,text/xml,application/xml`.
- Multiple files are allowed.
- The chat client reads the selected files as text and posts normalized upload entries to `/api/slash-command/upload`.
- `handleUpload(interaction, args, uploads)` performs the actual import.

## Level Resolution
- `level` is validated as a positive integer before `execute(...)` or `handleUpload(...)` runs.
- When `level` is supplied, every imported `Thing` receives that absolute level and parsed XML `relativeLevel` is ignored.
- When `level` is omitted, the command requires the current location to have a finite `baseLevel`.
- Without an explicit `level`, each entry uses `current location baseLevel + parsed XML relativeLevel`; missing or non-finite parsed `relativeLevel` counts as `0`.
- Imported `Thing` records store the resolved absolute level and set `relativeLevel` to `null`. The `Thing` model normalizes stored finite levels to an integer minimum of `1`.

## Import Behavior
- Each uploaded file must contain at least one parsed entry. If any file parses to zero entries, the command throws before creating imported things for the batch.
- The invoking player is resolved from `interaction.user.id` through `Player.getById(...)`; `interaction.currentPlayer` is used when no indexed player is found for the user id.
- Imported entries are attached to the invoking player's current location through `location.addThingId(thing.id)`.
- Imported entries are registered in `interaction.thingRegistry`, which must be a `Map`.
- A parsed `itemOrScenery` or `thingType` of `scenery` creates a scenery `Thing`; every other value creates an item `Thing`.
- Missing descriptions use `Imported scenery.` for scenery and `Imported item.` for items.
- The command maps these parsed fields into the new `Thing`: `name`, `description`, `shortDescription`, thing type, rarity, item type, slot, attribute bonuses for items, scoped cause-status effects, `count`, resolved level, and vehicle/crafting/processing/harvest/salvage flags.
- The command stores import metadata for location id/name, rarity, item type, value, weight, properties, slot, attribute bonuses, scoped cause-status effects, resolved level, and the same vehicle/crafting/processing/harvest/salvage flags.
- Parser fields outside the command's import mapping, including container seed fields and mod-registered XML parser fields, are not passed into the imported `Thing` by this command.

## Failure Cases
The command raises clear errors when:

- `interaction.parseThingsXml` is unavailable.
- No upload entries are provided.
- No active invoking player can be resolved.
- The invoking player has no current location.
- The current location cannot be found.
- A file contains no importable `<item>`, `<thing>`, or `<scenery>` entries.
- `interaction.thingRegistry` is unavailable.
- `level` is omitted and the current location has no finite `baseLevel`.

## Notes
- `parseThingsXml(...)` throws for malformed XML or invalid registered-field data and returns an empty array only when a parseable file has no importable entries; `/import_item` reports either result as an import failure for the file.
- Repeated `causeStatusEffectOnTarget` or `causeStatusEffectOnEquipper` tags are tolerated because the parser reads the first direct matching child tag.
- Successful imports mutate live runtime state. The command does not call `interaction.performGameSave(...)`; imported things persist when the game state is saved through the normal save path.

## Test Coverage
- `tests/import_item_command.test.js` covers overlay suppression, upload action metadata, positive integer level validation, multi-file imports, explicit level override behavior, and empty-file failure.
- `tests/api.slash_command_upload_helpers.test.js` covers upload action normalization, upload payload validation, and `showExecutionOverlay` metadata handling.
