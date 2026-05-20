# IncapacitateCommand

## Purpose
Slash command `/incapacitate` to mark an NPC incapacitated without reducing their current health.

## Args
- `character` (string, required): NPC name.

## Behavior
- Resolves the NPC by exact name or alias, preferring a unique alias match at the invoking player's current location when necessary.
- Aborts with an ambiguity warning instead of incapacitating if multiple NPC matches still remain.
- Clears `npc.isDead` without changing current health, then applies the permanent `Incapacitated` status effect.

## Notes
- Throws if the name is invalid or resolves to a player character.
