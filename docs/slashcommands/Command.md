# Command

## Purpose
Slash command `/awardxp` to grant experience points to the invoking player or a named character.

## Args
- `amount` (integer, required): XP to award.
- `character` (string, optional): character name to receive XP.

## Behavior
- Validates positive integer XP.
- Resolves target player by name or invoking user id.
- Calls `targetPlayer.addRawExperience(amount)`.
- Replies with confirmation or validation errors.

## Notes
- This class is defined in `slashcommands/awardxp.js`.
