# HealCommand

## Purpose
Slash command `/heal` (alias `/resurrect`) to restore an NPC to full health and clear the dead flag.

## Args
- `character` (string, required): NPC name.

## Behavior
- Resolves NPC via `Globals.playersByName`.
- Sets `npc.isDead = false` and `npc.setHealth(npc.maxHealth)`.

## Notes
- Throws if the name is invalid or not an NPC.
