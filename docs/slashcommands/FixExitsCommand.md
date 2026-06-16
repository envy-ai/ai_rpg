# FixExitsCommand

## Command
- Slash command: `/fix_exits`
- Aliases: none
- Usage: `/fix_exits`
- Help description: `Create missing reverse exits so one-way connections become two-way.`

## Purpose
Repairs loaded location graph edges where a source location has an exit to a destination location, but the destination location has no exit back to the source.

## Behavior
- Requires `server.ensureExitConnection` and `Location.getAll()`; the command throws a clear error if either dependency is unavailable.
- Builds a lookup table from loaded location ids, then scans each loaded location that exposes `getAvailableDirections()` and `getExit()`.
- Counts every scanned exit, including exits that cannot be repaired.
- Skips exits with an empty destination id or a destination id that does not resolve to a loaded location.
- Skips self-referential exits.
- Treats an exit as already repaired when the destination location has any exit, in any direction, whose destination is the source location id.
- Marks the source exit as `bidirectional=true` before running the shared repair helper.
- Calls `ensureExitConnection(sourceLocation, destinationLocation, { bidirectional: true, ... })` for each missing reverse connection.
- Uses the source exit description when present; otherwise it uses the destination location name or id as the source-exit description.
- Resolves the destination-region option from `exit.destinationRegion` first. When that is empty, it compares the source and destination region ids or stub metadata and passes the destination region only for cross-region links.
- Forwards vehicle-edge metadata. A source exit with either `isVehicle=true` or a non-empty `vehicleType` is treated as a vehicle edge, and `vehicleType` is passed through when present.
- Keeps the source exit travel time and lets `ensureExitConnection` apply it to the reverse edge.
- Relies on `ensureExitConnection` to create or reuse the reverse exit. The helper chooses the reverse direction key and uses `Path back to <source name or id>` for the reverse description.
- Mutates loaded location/exit objects in memory. It does not call `performGameSave()` and does not request a client refresh.

## Reply
- Sends one non-ephemeral reply.
- Includes counts for scanned exits, repaired one-way connections, skipped missing destinations, and skipped self-referential exits.
- Includes up to 20 repaired connection samples formatted as `Source -> Destination`.
- If more than 20 connections were repaired, adds a final line with the remaining count.

## Notes
- Exits that point to missing destinations are not removed.
- Reverse exits created by `ensureExitConnection` are direct return edges; the helper is responsible for storing new exits in the global exit registry.
