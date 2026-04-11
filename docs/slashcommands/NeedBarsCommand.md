# NeedBarsCommand

## Purpose
Slash command `/needbars` to list defined need bars or directly set/add/subtract need-bar values for the player, a named character, the current party, the current location, or a combined `all` target set.

## Usage
- `/needbars list`
- `/needbars set <key|all> <integer value> [character|party|location|all]`
- `/needbars add <key|all> <integer value> [character|party|location|all]`
- `/needbars subtract <key|all> <integer value> [character|party|location|all]`

## Behavior
- `list` returns a markdown table with icon, key, and display name for every loaded need-bar definition.
- `set` writes the exact integer value through `Player.setNeedBarValue(...)`, so min/max overflow clamps through the normal model path.
- `add` and `subtract` read the current stored bar value, apply the signed delta, and then write through `Player.setNeedBarValue(...)`.
- `key=all` applies the same operation/value to every stored need bar on each targeted character.
- Omitting the target defaults to the invoking player.
- `party` targets the invoking player's party members only.
- `location` targets every character whose `currentLocation` matches the invoking player's current location.
- `all` targets the invoking player, current party members, and all characters physically at the current location, with id-based deduplication.
- Named character targets use the shared alias-aware resolver with current-location ambiguity tie-breaking.
- After a successful mutation, the command asks the invoking tab to refresh its normal player/location UI so the need bars redraw immediately.

## Notes
- Fails loudly when no game is loaded, the target set is empty, the key does not exist, the value is not an integer, or a specific keyed bar is not stored for one or more targeted actors.
- This class is defined in `slashcommands/needbars.js`.
