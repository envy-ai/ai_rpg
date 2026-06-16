# RespecSkillsCommand

## Purpose
Slash command `/respec_skills` rebuilds an NPC's skill allocation for the NPC's current level.

## Args
- `character` (string, required): NPC name or alias to respec. When the command text does not use named-argument syntax, the full remaining command text is treated as the character name, so multi-word names do not need quotes.

## Behavior
- Resolves the named NPC from the live character registry by exact name first, then by sanitized exact name or alias.
- If multiple NPCs match, prefers the one at the invoking player's current location.
- If multiple matches still remain after the location tie-break, aborts and reports the ambiguous candidates instead of guessing.
- Rejects player characters; `/respec_skills` only operates on NPCs.
- Requires `Globals.respecNpcSkillsForCharacter` to be installed. The command throws a clear error if the server helper is unavailable.
- The server helper requires a valid NPC object, non-empty NPC name, and integer level of at least 1.
- NPCs do not need to be placed in a location. If `currentLocation` is empty, the skill prompt runs without location or region overrides.
- If `currentLocation` is set, the referenced location and containing region must resolve successfully.
- Captures the existing skill map, resets registered skills to the formula baseline, computes the formula skill budget from the NPC's level and attributes, and requests NPC skill assignments in `skill_points` mode.
- Applies returned skill `<points>` allocations through the point-budget allocator. Under-budget and over-budget returned totals are warning-logged and corrected by randomly distributing or removing points across valid returned skill targets.
- Restores the prior skill map if the respec fails after mutation begins. If restoration also fails, the raised error includes both the respec failure and rollback failure.

## Reply Output
- Missing `character`: ephemeral prompt to provide an NPC name.
- Player target: ephemeral message that the target is not an NPC.
- Missing target: ephemeral `Character "<name>" not found.` message.
- Ambiguous target: ephemeral warning listing the ambiguous candidate names.
- Respec failure from the server helper: ephemeral `Failed to respec skills for <name>: <error>` message.
- Success: public message with the NPC name, level, spent skill-point count, and up to eight non-baseline top skills sorted by point value and name. If no non-baseline points are present, the reply says no non-baseline skill points were available.

## Notes
- This class is defined in `slashcommands/respec_skills.js`.
- The command depends on `Globals.respecNpcSkillsForCharacter`, which is wired in `server.js`.
- `tests/server.respec_npc_skills_without_location.test.js` covers NPCs without `currentLocation` and verifies the `skill_points` request mode and point-budget application path.
- `tests/npc_levelup_point_allocations.test.js` covers shared point-allocation parsing and under/over budget rebalancing behavior used by NPC progression allocation helpers.
