# RespecAbilitiesCommand

## Purpose
Slash command `/respec_abilities` to respec a character's abilities within a selected level range.

## Args
- `character` (string, optional): character name. Defaults to invoking player's character.
- `start_level` (integer, optional): first level in the respec range (defaults to `1`).
- `end_level` (integer, optional): last level in the respec range (defaults to target's current level).

## Behavior
- Resolves the named target by exact name or alias, preferring a unique alias match at the invoking player's current location when necessary.
- Falls back to the invoking player's character when no name is provided.
- If multiple matches still remain after the location tie-break, the command fails with an ambiguity error listing matches.
- Supports numeric positional shorthand: `/respec_abilities 2 4` is interpreted as levels `2-4` when no matching character named `2` is found.
- Positional parsing uses the raw command text, so multi-word names and aliases (including unquoted ones) are handled before interpreting trailing levels.
- Validates `start_level`/`end_level` against current level and ensures `end_level >= start_level`.
- Removes abilities only in the inclusive range `[start_level, end_level]`.
- Player target (`isNPC === false`):
  - Does not regenerate automatically.
  - Clears pending generated ability options for the specified levels.
  - Relies on the player level-up selection modal flow to choose replacement abilities.
- NPC target (`isNPC === true`):
  - Calls `Globals.generateLevelUpAbilitiesForCharacter` with `{ previousLevel: start_level - 1, newLevel: end_level }`.
  - Requires replacement abilities when abilities were removed from the selected range; if replacements cannot be matched/applied, the command retries generation with explicit excluded-name guidance, then fails and restores the original ability snapshot.
  - Sorts final abilities by level then name and replies with summary.

## Notes
- If NPC regeneration fails, restores the original ability snapshot.
