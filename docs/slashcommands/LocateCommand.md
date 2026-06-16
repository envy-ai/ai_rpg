# LocateCommand

## Purpose
`/locate` finds NPCs by exact name or alias and reports where matching NPCs are located.

## Registration
- Command: `/locate`
- Aliases: none
- Description shown by `/help`: `Locate NPCs by exact name or alias.`
- Default usage from metadata: `/locate [query]`
- Execution overlay: default slash-command overlay behavior.

## Arguments
- `query` (string): NPC full name or alias to match.

The command resolves the query from raw `interaction.argsText` when the text does not contain named-argument syntax. This lets unquoted multi-word names work, such as `/locate Captain Ashara`. If `argsText` contains `key=value` syntax, the command uses `args.query`, so named usage is `/locate query="Captain Ashara"`.

`query` is declared optional in command metadata, so `/help` displays `[query]`, but execution requires a non-empty resolved query. A single pair of surrounding single or double quotes is stripped before matching.

## Behavior
- Reads all `Player` records and only considers records with `isNPC === true`.
- Ignores player characters, things, locations, and substring matches.
- Normalizes the query, NPC names, and aliases with `sanitizeLookupKey(...)`, which removes punctuation and underscores, collapses whitespace, and compares case-insensitively.
- Matches exact normalized NPC full names or exact normalized aliases.
- Returns every matching NPC, sorted by full name with base string sensitivity.
- Reports NPC party members at the active player's location when the active player has that NPC in `getPartyMembers()`.
- Resolves location labels from `Location.getAll()` by id. Missing ids or missing labels render as `Unknown`.
- Resolves region labels from the location's `regionId`, `stubMetadata.regionId`, `stubMetadata.targetRegionId`, or containing `Region.locationIds`. Missing regions render as `Unknown`.
- Escapes markdown table cell pipes and line breaks in displayed values.

## Output
- Replies are public (`ephemeral: false`).
- On matches, replies with a markdown table:
  - Header: `Locate results for "<query>":`
  - Columns: `NPC`, `Location`, `Region`, `Matched`
  - `Matched` is `name: <full name>` or `alias: <alias>`.
- On no matches: `No NPCs found for name or alias "<query>".`

## Errors
- Missing resolved query: `Query is required. Usage: /locate <npc name or alias>`
- Query with no searchable characters after normalization: `Query must contain at least one searchable character.`
- Unavailable player, location, or region registries raise clear errors instead of returning partial data.

## Test Coverage
- `tests/locate_command.test.js` covers exact alias matches returning multiple NPC rows, markdown table shape, public replies, NPC-only scope, thing exclusion, and substring exclusion.
