# LocateCommand

## Purpose
Slash command `/locate` to find NPCs by exact name or alias and report their current location.

## Args
- `query` (string, optional): NPC name or alias to match. The command primarily uses raw `argsText`, so multi-word names work without named args.

## Behavior
- Scans NPCs:
  - Matches exact normalized NPC full names or aliases, case-insensitively.
  - Returns every NPC with the requested name or alias.
- Outputs a markdown table with columns:
  - `NPC`
  - `Location`
  - `Region`
  - `Matched`
- Party member location override:
  - NPC party members are reported at the current player's location.

## Output
- On matches: markdown table.
- On no matches: `No NPCs found for name or alias "<query>".`

## Notes
- Fails with a clear error when query is missing.
