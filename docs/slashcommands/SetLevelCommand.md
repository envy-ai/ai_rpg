# SetLevelCommand

## Purpose
Slash command `/setlevel` to set the invoking player or a named character to an exact level.

## Args
- `level` (integer, required): Target level from 1 to 20.
- `character` (string, optional): Character name to update.

## Behavior
- Validates that the target level is an integer between 1 and 20.
- Resolves the named target by exact name or alias, preferring a unique alias match at the invoking player's current location when necessary.
- Falls back to the invoking player when no character is provided.
- Aborts with an ambiguity warning instead of changing levels if multiple matches still remain.
- If the new level is higher, uses the normal `levelUp()` path so level-up side effects still fire.
- If the new level is lower, uses `setLevel()` directly.
- Leaves stored XP unchanged.

## Notes
- This class is defined in `slashcommands/setlevel.js`.
- Lowering a level does not automatically remove abilities or otherwise respec the character.
