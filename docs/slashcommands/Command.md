# Command

## Purpose
Slash command `/awardxp` to grant experience points to the invoking player or a named character.

## Args
- `amount` (integer, required): XP to award.
- `character` (string, optional): character name to receive XP.

## Behavior
- Validates positive integer XP.
- Resolves the named target by exact name or alias, preferring a unique alias match at the invoking player's current location when necessary.
- Falls back to the invoking player when no character is provided.
- Aborts with an ambiguity warning instead of awarding XP if multiple matches still remain.
- Calls `targetPlayer.addRawExperience(amount)`, so `/awardxp` remains an exact admin grant and does not apply the normal gameplay level-based XP divisor.
- Replies with confirmation or validation errors.

## Notes
- This class is defined in `slashcommands/awardxp.js`.
