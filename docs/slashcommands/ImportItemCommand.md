# ImportItemCommand

## Purpose
`/import_item` opens the shared slash-command upload modal, accepts one or more XML files, parses all `<item>`, `<thing>`, and `<scenery>` entries with the existing `parseThingsXml(...)` helper, and imports the resulting `Thing` records into the invoking player's current location.

## Command
- Name: `/import_item`
- Args:
  - `level` (optional integer): absolute level assigned to every imported entry. When omitted, the command uses the invoking player's current location base level plus each entry's parsed XML `relativeLevel` (if any).

## Upload Flow
- `execute(...)` replies with a `request_file_upload` action instead of doing the import immediately.
- `showExecutionOverlay` is overridden to `false`, so the chat client cancels the pending `Executing command...` overlay before opening the upload modal.
- The chat client opens the reusable upload modal, reads the selected file text, and posts it to `/api/slash-command/upload`.
- `handleUpload(interaction, args, uploads)` performs the actual import.

## Import Behavior
- Every parsed entry across every uploaded file is imported.
- Imported entries are attached to the invoking player's current location and registered in the live server `things` map.
- The command assigns one absolute level to every imported entry.
- If `/import_item level=<N>` is provided, every imported entry uses that exact absolute level and XML `relativeLevel` is ignored.
- If no explicit slash-command level is provided, each imported entry uses `current location base level + parsed XML relativeLevel`, with missing `relativeLevel` treated as `0`.
- The command preserves parsed item/scenery data, including rarity, slot, bonuses, and the first parsed on-target/on-equipper cause-effect payloads.
- Uploads that contain no importable `<item>`, `<thing>`, or `<scenery>` entries fail loudly instead of partially importing.

## Notes
- Repeated `causeStatusEffectOnTarget` / `causeStatusEffectOnEquipper` tags are tolerated because the shared parser ignores extras rather than rejecting the XML.
