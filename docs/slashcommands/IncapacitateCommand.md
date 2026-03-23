# IncapacitateCommand

## Purpose
Slash command `/incapacitate` to drop an NPC to zero health without killing them.

## Args
- `character` (string, required): NPC name.

## Behavior
- Resolves the NPC by exact name or alias, preferring a unique alias match at the invoking player's current location when necessary.
- Aborts with an ambiguity warning instead of incapacitating if multiple NPC matches still remain.
- Sets `npc.isDead = false` and `npc.setHealth(0)`.

## Notes
- Throws if the name is invalid or resolves to a player character.
