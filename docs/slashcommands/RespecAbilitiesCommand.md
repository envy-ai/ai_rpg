# RespecAbilitiesCommand

## Purpose
Slash command `/respec_abilities` to remove and regenerate a character's abilities from a given start level.

## Args
- `character` (string, optional): character name. Defaults to invoking player's character.
- `start_level` (integer, optional): lowest level to regenerate (defaults to 1).

## Behavior
- Resolves target player by name or invoking user id.
- Validates start level against current level.
- Removes abilities at or above `start_level`, preserves lower-level abilities.
- Calls `Globals.generateLevelUpAbilitiesForCharacter` to regenerate abilities.
- Sorts final abilities by level then name and replies with summary.

## Notes
- If regeneration fails, restores the original ability snapshot.
