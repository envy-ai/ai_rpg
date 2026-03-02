# LocateCommand

## Purpose
Slash command `/locate` to find NPCs (by name or alias) and things (by name) using case-insensitive substring matching.

## Args
- `query` (string, optional): substring to match. The command primarily uses raw `argsText`, so multi-word queries work without named args.

## Behavior
- Scans NPCs:
  - Matches on NPC full name or aliases.
  - Returns rows as type `npc`.
- Scans things:
  - Matches on thing name.
  - Returns rows as type `item` or `scenery`.
- Outputs a markdown table with columns:
  - `Full Name`
  - `Location`
  - `Region`
  - `Type`
- If a thing is in an inventory, location is rendered as `OwnerName's inventory`.
- Party member location override:
  - NPC party members are reported at the current player's location.
  - Thing owners who are party members also use the player's location for region resolution.

## Output
- On matches: markdown table.
- On no matches: `No NPCs or things found for substring "<query>".`

## Notes
- Fails with a clear error when query is missing.
