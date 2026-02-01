# TeleportCommand

## Purpose
Slash command `/teleport` to move the invoking player to a location by id or quoted name.

## Args
- `destination` (string, required): location id or quoted name.

## Behavior
- Resolves invoking player via `Globals.playersById`.
- Looks up destination via `Location.get` or `Location.getByName`.
- Calls `player.setLocation(destination)`.

## Notes
- Rejects missing user id or unknown locations with explicit errors.
