# Command (`/awardxp`)

## Purpose
Admin slash command that grants raw experience points to the invoking player, another player, or an NPC.

## Metadata
- File: `slashcommands/awardxp.js`
- Exported class: `Command`
- Canonical command: `/awardxp`
- Aliases: none
- Description: `Award experience points to yourself or another character.`
- Usage: `/awardxp <amount> [character]`

## Args
- `amount` (integer, required): positive XP amount to grant.
- `character` (string, optional): player or NPC name/alias to receive XP.

The command accepts positional arguments such as `/awardxp 50 "Mira Dawn"` or named arguments such as `/awardxp amount=50 character="Mira Dawn"`. For positional input, any tokens after `amount` are joined as the character target, so unquoted multi-word names also resolve as a trailing target.

## Behavior
- Requires `amount` to be a positive integer. Invalid values receive an ephemeral validation reply from the command, or an API validation error when argument coercion fails before execution.
- Uses the invoking player as the target when `character` is omitted. If the invoking user has no character in `Globals.playersById`, the command replies with an ephemeral error asking for an explicit character name.
- Resolves an explicit `character` through `slashcommand_utils/characterTargeting.js` with players and NPCs allowed.
- Checks direct name lookup first, then exact sanitized name/alias matches from `Globals.playersById`.
- Uses the invoking player's current location to break ties when multiple alias/name matches exist and exactly one match is at that location.
- Refuses to grant XP when the explicit character target is missing or ambiguous after tie-breaking, and replies with an ephemeral error that lists ambiguous matches.
- Calls `targetPlayer.addRawExperience(amount)`. This grants the exact raw amount without the normal gameplay level divisor or party-recipient scaling. Standard `Player` XP side effects apply, including experience overflow/level-up handling and raw party propagation when the target is a non-NPC with party members.
- Replies publicly with `Awarded {amount} XP to {targetPlayer.name}.` on success.

## Related Runtime Paths
- Registration and lookup: `SlashCommandRegistry.js`
- Usage generation for `/help`: `SlashCommandBase.usage` and `slashcommands/help.js`
- HTTP execution path: `/api/slash-command` in `api.js`
- Client parsing and dispatch: `public/js/chat.js`
- Raw XP implementation: `Player.addRawExperience(amount)`
