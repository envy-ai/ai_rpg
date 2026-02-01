# KillCommand

## Purpose
Slash command `/kill` to immediately kill an NPC by name.

## Args
- `character` (string, required): NPC name.

## Behavior
- Resolves NPC via `Globals.playersByName`.
- Sets `npc.isDead = true` and `npc.setHealth(0)`.

## Notes
- Throws if the name is invalid or not an NPC.
