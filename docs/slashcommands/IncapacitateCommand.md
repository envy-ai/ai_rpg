# IncapacitateCommand

## Purpose
`/incapacitate` marks a named NPC as disabled without killing them or lowering their stored health.

## Registration
- Implemented by `slashcommands/incapacitate.js`.
- Canonical command: `/incapacitate`.
- Aliases: none.
- Help usage comes from the declared required `character` argument: `/incapacitate <character>`.

## Args
- `character` (string, required): NPC name or alias.

## Usage
- `/incapacitate Gallery Sentinel`
- `/incapacitate "Gallery Sentinel"`
- `/incapacitate character="Gallery Sentinel"`

For a plain positional target, the command reads the raw argument text, so multi-word NPC names work without quotes. When named-argument syntax is present, it reads `character` from the parsed args object.

## Behavior
- Resolves targets from the live player/NPC registries, with players disallowed.
- Checks direct `Globals.playersByName` lookup first. A direct player match raises an error because the command only targets NPCs.
- If direct lookup does not find an allowed NPC, exact sanitized NPC names and aliases are matched through `Globals.playersById`.
- Uses the invoking player's current location only as an ambiguity tie-break. The command can target a globally unique NPC even when that NPC is elsewhere.
- Aborts with an ephemeral ambiguity warning if multiple NPC matches remain after the location tie-break. No NPC is mutated in that case.
- Sets `npc.isDead = false`.
- Preserves the NPC's prior numeric health. If clearing the dead flag changes the health value, the command restores the prior value with `npc.setHealth(priorHealth)`.
- Applies an intrinsic `StatusEffect` with description `Incapacitated` and `duration: null`. This effect has no scheduled expiration, replaces an existing intrinsic effect with the same description, and makes `npc.isDisabled` true even when health is above zero.
- Does not call `setHealth(0)`, advance world time, save the game, or request a client refresh.

## Replies And Errors
- Success reply: `<NPC name> is incapacitated.` with `ephemeral: false`.
- Ambiguous target reply: `Warning: "<character>" is ambiguous. Matches: ... No NPC was incapacitated.` with `ephemeral: true`.
- Throws for an empty `character`, a direct player-character match, or a target that cannot be resolved to an NPC.

## Notes
- `tests/incapacitate_command.test.js` covers the core side effect: health is preserved, `isDead` is cleared, `isDisabled` becomes true, and the `Incapacitated` status is present.
