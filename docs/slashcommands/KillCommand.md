# KillCommand

## Purpose
`/kill` immediately kills a named NPC.

## Registration
- Implemented by `slashcommands/kill.js`.
- Canonical command: `/kill`.
- Aliases: none.
- Help usage comes from the declared required `character` argument: `/kill <character>`.

## Args
- `character` (string, required): NPC name or alias.

## Usage
- `/kill Gallery Sentinel`
- `/kill "Gallery Sentinel"`
- `/kill character="Gallery Sentinel"`

For a plain positional target, the command reads the raw argument text, so multi-word NPC names work without quotes. When named-argument syntax is present, it reads `character` from the parsed args object.

## Behavior
- Resolves targets from the live player/NPC registries, with players disallowed.
- Checks direct `Globals.playersByName` lookup first. A direct player match raises an error because the command only targets NPCs.
- If direct lookup does not find an allowed NPC, exact sanitized NPC names and aliases are matched through `Globals.playersById`.
- Uses the invoking player's current location only as an ambiguity tie-break. The command can target a globally unique NPC even when that NPC is elsewhere.
- Aborts with an ephemeral ambiguity warning if multiple NPC matches remain after the location tie-break. No NPC is mutated in that case.
- Throws when the target is empty, resolves directly to a player character, or cannot be resolved to an NPC.
- Sets `npc.isDead = true` and `npc.setHealth(0)`.
- Does not add a status effect, advance world time, save the game, or request a client refresh.

## Replies And Errors
- Success reply: `<NPC name> has been killed.` with `ephemeral: false`.
- Ambiguous target reply: `Warning: "<character>" is ambiguous. Matches: ... No NPC was killed.` with `ephemeral: true`.
- Missing argument validation can fail before command execution with `Missing required argument: character`.
