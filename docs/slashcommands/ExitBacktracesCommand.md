# ExitBacktracesCommand

## Purpose
`/exit_backtraces` lists every exit from the current location with the runtime creation backtrace stored on each `LocationExit`.

The command is a developer diagnostic for tracking where loaded exits were constructed. Backtraces are runtime-only; saved exits receive a construction backtrace when they are hydrated.

## Registration
- Implementation: `slashcommands/exit_backtraces.js`.
- Canonical command name: `exit_backtraces`.
- Aliases: none.
- `/help` lists the command through `SlashCommandBase.listCommands()` with the description `List every exit in the current location along with the captured creation backtrace.`

## Args
- None.

## Behavior
- Reads `Globals.currentPlayer` and the player's `currentLocationObject`.
- Requires the current location to expose `getAvailableDirections()` and `getExit(direction)`.
- Sorts available directions lexicographically.
- Replies with non-ephemeral markdown headed `## Exit Backtraces: <region>:<location> (<location id>)`.
- Prints `(no exits)` when the current location has no available directions.
- For each exit, prints:
  - Direction heading.
  - Exit id.
  - Description.
  - Destination display label and destination id.
  - Stored destination-region hint from `exit.getDetails().destinationRegion`.
  - Vehicle-exit flag and vehicle type.
  - A fenced `text` block containing `exit.backtrace`, or `Backtrace unavailable` when the property is empty.

## Errors
- Throws `Current player is unavailable.` when there is no current player.
- Throws `Current location is unavailable.` when the current player has no current location object.
- Throws `Current location does not expose exit helpers.` when the location object lacks the required exit helper methods.

## Notes
- Destination labels prefer the resolved destination location label, including the destination region name when available. If the destination location cannot be resolved, the command falls back to `exit.name` or `exit.destination`.
- `LocationExit.toJSON()` and normal API serialization exclude the `backtrace` property.
