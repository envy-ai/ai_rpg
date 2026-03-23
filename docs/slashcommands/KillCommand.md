# KillCommand

## Purpose
Slash command `/kill` to immediately kill an NPC by name.

## Args
- `character` (string, required): NPC name.

## Behavior
- Resolves the NPC by exact name or alias, preferring a unique alias match at the invoking player's current location when necessary.
- Aborts with an ambiguity warning instead of killing if multiple NPC matches still remain.
- Sets `npc.isDead = true` and `npc.setHealth(0)`.

## Notes
- Throws if the name is invalid or resolves to a player character.
