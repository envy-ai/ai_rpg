# RefillNeedsCommand

## Purpose
`/refill_needs` refills stored need bars for one NPC, resolved by name or alias, or for every NPC in the loaded game with the `all` target.

## Registration
- Command: `/refill_needs`
- Aliases: none
- Description shown by `/help`: `Refill stored need bars for one NPC or every NPC.`
- Usage: `/refill_needs <npc name|alias|all>`
- Execution overlay: default slash-command overlay behavior.

## Arguments
- `target` (string, required): NPC full name, NPC alias, or `all`.

Unquoted multi-word names are accepted through `interaction.argsText`, such as `/refill_needs Captain Ashara`. Named syntax is also accepted as `/refill_needs target="Captain Ashara"`.

## Behavior
- Requires a loaded game.
- Resolves named targets through `slashcommand_utils/characterTargeting.js`, including exact aliases and current-location tie-breaking for ambiguous character names.
- Rejects non-NPC targets. The command does not refill player-character need bars.
- `all` iterates every loaded `Player` record with `isNPC === true`.
- For each targeted NPC, reads stored need bars with `getNeedBars({ scope: 'stored' })`.
- Sets every stored bar to that bar's own finite `max` through `setNeedBarValue(barId, max, { allowInactive: true, allowPlayerOnly: false })`.
- Inactive-but-stored NPC bars are refilled so party/non-party audience swaps retain full values.
- Disabled or otherwise unstored bars remain absent.
- After a successful refill, requests `locationRefreshRequested` when the interaction helper is available.

## Output
- Replies are public (`ephemeral: false`).
- Single NPC: `Refilled <count> stored need bars for <name>.`
- `all`: `Refilled <bar count> stored need bars for <NPC count> NPCs: <names>.`

## Errors
- No game is loaded.
- Missing target text.
- No NPCs are available for `all`.
- A named target is missing, ambiguous, or resolves to a non-NPC character.
- A target lacks need-bar helper methods.
- A target has no stored need bars.
- A stored need bar is missing an id or finite max value.
- `Player.setNeedBarValue(...)` rejects the mutation.

## Test Coverage
- `tests/refill_needs_command.test.js` covers command registration, alias-based NPC refill to per-bar max values, `all` refilling every NPC while excluding player actors, refresh requests, and non-NPC target rejection.
