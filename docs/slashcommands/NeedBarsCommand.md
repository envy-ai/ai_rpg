# NeedBarsCommand

## Purpose
`/needbars` lists loaded need-bar definitions and edits stored need-bar values for the invoking player, a named character, party members, characters at the invoking player's location, or the combined `all` target set.

## Implementation
- Class: `slashcommands/needbars.js`.
- Extends `SlashCommandBase` with canonical name `needbars`, no aliases, and no declared positional `args`.
- Parses `interaction.argsText` directly with the quote-aware positional helpers from `slashcommand_utils/characterTargeting.js`.
- Requires `Globals.gameLoaded === true` and an invoking player id that resolves through `Globals.playersById`.

## Usage
- `/needbars list`
- `/needbars set <key|all> <integer value> [character|party|location|all]`
- `/needbars add <key|all> <integer value> [character|party|location|all]`
- `/needbars subtract <key|all> <integer value> [character|party|location|all]`

Target names with spaces can be supplied after the value; surrounding single or double quotes are accepted.

## Listing
- `/needbars list` accepts no extra tokens.
- The reply is a public markdown table with `Icon`, `Key`, and `Name` columns from `Player.getNeedBarDefinitionsForContext()`.
- Definitions are sorted by display name. If no definitions are loaded, the reply is `No need bars are currently defined.`

## Need-Bar Keys
- Mutation keys must be `all` or a case-insensitive id from `Player.needBarDefinitions`.
- Need-bar display names and YAML aliases are not accepted by command key normalization.
- For a specific key, every targeted actor must already have that bar in `actor.getNeedBars({ scope: 'stored' })`.
- `key=all` iterates every stored need bar on each targeted actor.

## Target Resolution
- Omitting the target defaults to the invoking player.
- `party` targets the invoking player's party members only; it does not include the invoking player.
- `location` targets every character whose `currentLocation` matches the invoking player's current location.
- `all` targets the invoking player, current party members, and all characters physically at the current location, with id-based deduplication.
- Named character targets use the shared alias-aware resolver with current-location ambiguity tie-breaking.

## Mutation Behavior
- `value` must be a signed integer token.
- `set` passes the integer value through to `Player.setNeedBarValue(...)`.
- `add` and `subtract` read the actor's stored bar value with `actor.getNeedBarValue(...)`, apply the signed delta, and write the result through `Player.setNeedBarValue(...)`.
- Writes call `Player.setNeedBarValue(bar.id, nextValue, { allowInactive: true, allowPlayerOnly: false })`.
- Because the command operates on stored bars and allows inactive bars, a stored bar can be edited even when it is not active for the actor's audience state.
- NPC writes still respect player-only need-bar restrictions enforced by `Player.setNeedBarValue(...)`.
- The `Player` model validates finite numeric values, applies definition min/max bounds, and refreshes the bar's `currentThreshold`.

## Replies And Refresh
- Mutation replies are public and summarize the operation, value, need-bar key, and targeted actor names.
- After a mutation, the command calls `interaction.requestClientRefresh({ locationRefreshRequested: true })` when the helper is present.
- `/api/slash-command` emits a targeted `chat_history_updated` payload only when the request includes a client id; the chat client reloads the current location for `locationRefreshRequested` payloads.

## Error Cases
- No game is loaded.
- The invoking player id is missing or does not resolve to a player.
- The subcommand, usage shape, need-bar key, or integer value is invalid.
- The target set is empty, the invoking player has no party members for `party`, the invoking player has no resolvable location for `location` or `all`, or a named target is missing or ambiguous.
- A specific keyed bar is not stored for one or more targeted actors.
- A target actor is missing need-bar helper methods, a stored bar has a non-finite current value, or no stored bars are available for the requested operation.

## Test Coverage
- No dedicated `/needbars` command test file is present under `tests/`.
- Related coverage includes generic slash-command reply/execution option tests in `tests/api.slash_command_upload_helpers.test.js` and need-bar storage/audience behavior tests in `tests/player.need_bar_audience.test.js`.
