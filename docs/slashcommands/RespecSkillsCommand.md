# RespecSkillsCommand

## Purpose
Slash command `/respec_skills` to rebuild an NPC's skill allocation from scratch for its current level.

## Args
- `character` (string, required): NPC name to respec. Multi-word names can be passed as the full command text.

## Behavior
- Resolves the named NPC from the live character registry by exact name or alias.
- If multiple NPCs match, prefers the one at the invoking player's current location.
- If multiple matches still remain after the location tie-break, aborts and reports the ambiguous candidates instead of guessing.
- Rejects player characters; this command is NPC-only.
- Does not require the target NPC to currently be placed in a location; when location data is absent, the respec prompt proceeds without NPC-specific location/region overrides.
- Reuses the NPC creation progression prompt to request a fresh skill priority assignment for that NPC.
- Resets all registered skills to the formula baseline, then reapplies skill points as if the NPC had leveled from 1 to its current level.
- Rolls back to the prior skill map if the respec fails after mutation begins.

## Notes
- This class is defined in `slashcommands/respec_skills.js`.
- The command depends on `Globals.respecNpcSkillsForCharacter`, which is wired in `server.js`.
