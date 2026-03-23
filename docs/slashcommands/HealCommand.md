# HealCommand

## Purpose
Slash command `/heal` (alias `/resurrect`) to restore an NPC to full health and clear the dead flag.

## Args
- `character` (string, required): NPC name.

## Behavior
- Resolves the NPC by exact name or alias, preferring a unique alias match at the invoking player's current location when necessary.
- Aborts with an ambiguity warning instead of healing if multiple NPC matches still remain.
- Sets `npc.isDead = false` and `npc.setHealth(npc.maxHealth)`.

## Notes
- Throws if the name is invalid or resolves to a player character.
