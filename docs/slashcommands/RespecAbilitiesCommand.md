# RespecAbilitiesCommand

## Purpose
Slash command `/respec_abilities` rebuilds a player or NPC's ability selections for an inclusive level range.

## Args
- `character` (string, optional): character name or alias. When omitted, the command targets the invoking player's character.
- `start_level` (integer, optional): first level in the respec range (defaults to `1`).
- `end_level` (integer, optional): last level in the respec range (defaults to target's current level).

Levels may be passed as integers or integer strings. Named-argument syntax is supported for all arguments.

## Positional Forms
- `/respec_abilities`: respecs the invoking player's abilities from level `1` through the current level.
- `/respec_abilities 2 4`: respecs the invoking player's abilities from level `2` through level `4` when no character named `2` is found.
- `/respec_abilities Mira 3`: respecs `Mira` from level `3` through her current level.
- `/respec_abilities Mira Vale 2 4`: resolves `Mira Vale` before interpreting the trailing level range.

## Behavior
- Resolves a named target by exact stored name before searching sanitized names and aliases.
- Allows both player characters and NPCs as targets.
- Uses the invoking player's current location as a tie-breaker when sanitized name or alias lookup has multiple matches.
- Fails with an ambiguity error when more than one candidate remains after the location tie-breaker.
- Uses the invoking player's character when no target name is provided.
- Interprets raw positional text before relying on parsed args, which preserves unquoted multi-word names and aliases.
- Treats requested levels below `1` as level `1`.
- Rejects a start or end level above the target's current level.
- Rejects ranges where the effective end level is lower than the effective start level.
- Requires the target to expose `getAbilities()` and `setAbilities()`.
- Removes only abilities whose level falls within the effective inclusive range. Abilities without a numeric level count as level `1`.
- Player target (`isNPC === false`):
  - Stores the kept abilities immediately.
  - Clears pending ability option cards for each level in the respec range when the player object supports pending option storage.
  - Leaves replacement choice to the player level-up ability selection modal.
- NPC target (`isNPC === true`):
  - Calls `Globals.generateLevelUpAbilitiesForCharacter` with `previousLevel` set to the level before the range and `newLevel` set to the end of the range.
  - Passes `requireAbilityAddition: true` when the command removed at least one ability.
  - Restores the original ability snapshot when regeneration is unavailable, throws an error, or produces no replacement abilities for a range that removed abilities.
  - Sorts final abilities by level and name before sending the completion summary.

## Notes
- The command replies publicly on successful respecs and ephemerally on validation or regeneration errors.
- Player replacements are selected through `/api/player/ability-selection`; that endpoint generates option cards for the next pending level when the modal requests them.
