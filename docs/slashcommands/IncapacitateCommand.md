# IncapacitateCommand

## Purpose
Slash command `/incapacitate` to drop an NPC to zero health without killing them.

## Args
- `character` (string, required): NPC name.

## Behavior
- Resolves NPC via `Globals.playersByName`.
- Sets `npc.isDead = false` and `npc.setHealth(0)`.

## Notes
- Throws if the name is invalid or not an NPC.
