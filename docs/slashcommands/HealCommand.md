# HealCommand

## Purpose
Slash command `/heal` restores a player or NPC to full health and clears the character's `isDead` flag. `/resurrect` is an alias for the same command.

## Usage
- `/heal`
- `/heal <character name>`
- `/heal character="<character name>"`
- `/resurrect [character name]`

## Args
- `character` (string, optional): Player or NPC name. If omitted, the invoking player is healed.

## Behavior
- When called without `character`, resolves the invoking player from `interaction.user.id` and `Globals.playersById`.
- When called with a bare positional target, treats the full remaining `argsText` as the character name, so unquoted multi-word names are accepted.
- When called with named-argument syntax, reads `character`; values containing spaces must be double quoted by the client-side slash parser.
- Resolves explicit targets by registered character name first, then by sanitized player/NPC name or alias through `resolveCharacterTarget(...)`.
- If multiple sanitized name or alias matches exist, prefers a single match at the invoking player's current location. If multiple matches remain, replies with an ephemeral ambiguity warning and does not mutate any character.
- On success, sets `targetCharacter.isDead = false` and calls `targetCharacter.setHealth(targetCharacter.maxHealth)`.
- Replies with `<name> has been fully restored.` as a non-ephemeral command reply.

## Notes
- `/help` lists the canonical usage as `/heal [character]`; aliases are registered for lookup but are not listed as separate help entries.
- The command does not remove status effects such as `Deceased` or `Incapacitated`, adjust need bars, move the character, or request a client refresh.
- Throws if the named character cannot be resolved, no target is provided and the invoking player cannot be determined, or no invoking-player record exists.
