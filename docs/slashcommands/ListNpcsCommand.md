# ListNpcsCommand

## Purpose
`/list_npcs` lists every loaded NPC with their current location and short description.

## Registration
- Command: `/list_npcs`
- Aliases: none
- Description shown by `/help`: `List NPCs with location and short description.`
- Default usage from metadata: `/list_npcs`
- Execution overlay: default slash-command overlay behavior.

## Arguments
- None.

## Behavior
- Reads all loaded `Player` records through `Player.getAll()` and only includes records with `isNPC === true`.
- Ignores player characters.
- Reads all `Location` records through `Location.getAll()` and resolves NPC `currentLocation`, `locationId`, or `location` values by id.
- Reports active party members at the active player's location when `Globals.currentPlayer.getPartyMembers()` includes the NPC id.
- Uses `shortDescription` when present; otherwise it uses the first sentence of `description`.
- Sorts NPC rows alphabetically by NPC name with base string sensitivity.
- Escapes markdown table pipes and line breaks in displayed values.

## Output
- Replies are public (`ephemeral: false`).
- Replies with a markdown table:
  - Columns: `NPC`, `Location`, `Short Description`
  - Blank location values render as `Unknown`; unresolved non-blank ids render as the raw id.

## Errors
- Throws `Player list is unavailable.` if `Player.getAll()` does not return an array.
- Throws `Location list is unavailable.` if `Location.getAll()` does not return an array.

## Test Coverage
- `tests/list_npcs_command.test.js` covers table shape, public replies, NPC-only scope, alphabetized output, location resolution, and description fallback.
