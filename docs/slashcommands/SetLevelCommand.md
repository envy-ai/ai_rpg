# SetLevelCommand

## Purpose
`/setlevel` sets the invoking player, another player, or an NPC to an exact level without modifying stored XP.

## Metadata
- File: `slashcommands/setlevel.js`
- Exported class: `SetLevelCommand`
- Canonical command: `/setlevel`
- Aliases: none
- Description: `Set a character level directly.`
- Usage: `/setlevel <level> [character]`

## Args
- `level` (integer, required): target level from 1 to 20.
- `character` (string, optional): player or NPC name/alias to update.

The command accepts positional input such as `/setlevel 7 Mira Dawn` or `/setlevel 7 "Mira Dawn"`, and named arguments such as `/setlevel level=7 character="Mira Dawn"`. For positional input, the command treats all tokens after `level` as the character target, so unquoted multi-word names are supported.

## Behavior
- Requires `level` to be an integer between 1 and 20. Invalid command-handler values receive an ephemeral validation reply; invalid positional integer coercion can fail earlier in the `/api/slash-command` argument resolver.
- Uses the invoking player from `interaction.user.id` and `Globals.playersById` when `character` is omitted.
- Resolves an explicit `character` through shared character targeting with both players and NPCs allowed.
- Checks direct `Globals.playersByName` lookup first, then exact sanitized character names and aliases from `Globals.playersById`.
- Uses the invoking player's current location only to break ambiguous name/alias ties when exactly one match is at that location.
- Refuses to mutate any character when the explicit target is missing or ambiguous, and replies with an ephemeral error.
- Throws if the selected character's current `level` is not a positive integer before applying the requested level.
- If the target already has the requested level, replies publicly and leaves XP unchanged.
- For level increases, calls `targetPlayer.levelUp(level - currentLevel)`. `Player.levelUp()` increments the stored level, resets health to calculated base health, updates `lastUpdated`, and invokes the configured level-up handler.
- For level decreases, calls `targetPlayer.setLevel(level)`. `Player.setLevel()` validates the same 1 to 20 range, recalculates level-derived max health, scales current health proportionally, and updates `lastUpdated`.
- Does not call XP mutators, award party XP, respec skills, remove abilities, save the game, advance world time, or request a client refresh.

## Replies
- No invoking player and no explicit target: `You do not have a character in the game. Specify a character name to set a level.` with `ephemeral: true`.
- Missing explicit target: `Character "<character>" not found.` with `ephemeral: true`.
- Ambiguous explicit target: `Character "<character>" is ambiguous. Matches: ...` with `ephemeral: true`.
- Target already at level: `<name> is already level <level>. XP was left unchanged.` with `ephemeral: false`.
- Successful level update: `Set <name> from level <old> to level <new>. XP was left unchanged.` with `ephemeral: false`.

## Related Runtime Paths
- Registration and lookup: `SlashCommandRegistry.js`
- Usage generation for `/help`: `SlashCommandBase.usage` and `slashcommands/help.js`
- HTTP execution path: `/api/slash-command` in `api.js`
- Shared target resolution: `slashcommand_utils/characterTargeting.js`
- Level mutation methods: `Player.levelUp(count)` and `Player.setLevel(level)`

## Test Coverage
- No direct `setlevel` command test exists under `tests/`.
- Shared command targeting behavior is covered by adjacent character-targeting command tests such as `tests/heal_command.test.js` and `tests/incapacitate_command.test.js`.
- `tests/player.float_health.test.js` covers `Player.setLevel(...)` preserving float health behavior.
