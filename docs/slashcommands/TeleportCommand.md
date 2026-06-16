# TeleportCommand

## Purpose
`/teleport` moves the invoking player record to an existing location by location id or exact location name.

## Registration
- Command: `/teleport`
- Aliases: none
- Description shown by `/help`: `Teleport yourself to a location by ID or quoted name.`
- Default usage from metadata: `/teleport <destination>`
- Execution overlay: default slash-command overlay behavior.

## Usage
- `/teleport <location-id>`
- `/teleport "Location Name"`
- `/teleport destination="<Location Name>"`

## Arguments
- `destination` (string, required): location id or exact location name.

The HTTP slash-command path fills `destination` from the first positional token in `argsText` unless the client already supplied `args.destination`. Server positional parsing respects double-quoted strings, so location names with spaces should be double quoted. The command trims whitespace and strips one matching pair of surrounding single or double quotes before lookup.

## Behavior
- Requires `interaction.user.id` and resolves the invoking player through `Globals.playersById`.
- Resolves the destination with `Location.get(normalizedDestination)` first, then `Location.getByName(normalizedDestination)`.
- If the player is already at the destination id, replies without mutating state.
- Otherwise calls `player.setLocation(destination)`.
- For non-NPC player records, `Player.setLocation(...)` records the destination's pre-arrival visit state through `Globals.recordPlayerArrivalVisitState(...)` and marks the destination visited.

## Output
- Already at destination: `You are already at <name-or-id>.`
- Successful move: `Teleported to <name-or-id> (<id>).`
- Replies are public (`ephemeral: false`).

## Errors
- Missing invoking user id: `Cannot teleport: invoking user ID is missing.`
- Missing active player record: `Cannot teleport: no active character found for this user.`
- Blank destination in direct command execution: `Destination is required. Provide a location ID or quote the location name.`
- Unknown destination: `Location '<destination>' not found.`
- Missing `destination` through `/api/slash-command` fails slash-command argument validation before execution.

## Notes
- The command does not advance world time, run travel prose, run arrival processing, create event summaries, move party members, or request a client refresh.
- No dedicated `TeleportCommand` test file is present. Related coverage exists for slash-command request/reply helpers in `tests/api.slash_command_upload_helpers.test.js` and for location mutation semantics in `tests/globals.player_arrival_visit_state.test.js` and `tests/location.visited_state.test.js`.
