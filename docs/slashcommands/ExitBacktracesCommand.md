# ExitBacktracesCommand

## Purpose
Slash command `/exit_backtraces` to list every exit in the current location, along with the runtime backtrace captured when each `LocationExit` object was created.

## Args
- None.

## Behavior
- Resolves the current player and current location.
- Sorts the location's exits by direction.
- Replies with markdown including, for each exit:
  - Direction
  - Exit id
  - Description
  - Destination label and id
  - Derived destination region id
  - Vehicle flag and vehicle type
  - A fenced `text` block containing `exit.backtrace`
- Throws if the current player or current location is unavailable.

## Notes
- The backtrace is runtime-only and is not serialized into saves or normal API JSON.
- This class is defined in `slashcommands/exit_backtraces.js`.
