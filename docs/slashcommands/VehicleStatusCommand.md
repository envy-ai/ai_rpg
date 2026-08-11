# VehicleStatusCommand

## Purpose
`/vehicle_status` displays non-ephemeral Markdown diagnostics for the vehicle occupied by `Globals.currentPlayer`. It is intended for inspecting vehicle route, destination, and trip timing state from the active player context.

## Arguments
- None.

## Behavior
- Requires `Globals.currentPlayer`; missing player state throws `Current player is unavailable.`
- Requires `player.currentVehicle` to return an object; non-vehicle player context throws `Current player is not inside a vehicle.`
- Resolves the active vehicle owner from the player's current location, preferring a vehicle `Region` over a vehicle `Location`.
- Throws `Active vehicle could not be resolved from the current player context.` if `player.currentVehicle` exists but the owning vehicle record cannot be found.
- Replies through `interaction.reply({ content, ephemeral: false })`.

## Markdown Output
- Heading: `## Vehicle Status: <vehicle name>`, using `player.currentVehicle.name`, then the owner entity name/id, then `Unknown Vehicle`.
- Vehicle kind: `Region vehicle` or `Location vehicle`.
- Vehicle id as inline code.
- Player location inside vehicle: the current location name without a region prefix, plus the location id.
- Vehicle description from `player.currentVehicle.description` or the owner entity description.
- Outside location from `player.currentVehicle.location`.
- Current destination from `vehicleInfo.currentDestination`, resolved to a location label plus id when available.
- Pending destination from `vehicleInfo.pendingDestination`; if there is no concrete `currentDestination`, `player.currentVehicle.destination` is used as the display fallback.
- Fixed-route destinations from `vehicleInfo.destinations`, resolved as location labels plus ids when available.
- Trip-state booleans from `player.currentVehicle`: `isUnderway`, `hasArrived`, and `isArriving`, rendered as `Yes` or `No`.
- Travel start time from `vehicleInfo.departureTime`.
- Arrival time from `vehicleInfo.ETA`.
- Remaining travel from `player.currentVehicle.minutesToDestination` and `player.currentVehicle.timeToDestination`.
- Vehicle exit id from `vehicleInfo.vehicleExitId`.
- Icon from `vehicleInfo.icon`.
- Terrain tags from `vehicleInfo.terrainTypes`.

## Formatting Rules
- Blank, null, or unresolved scalar values render as `-`.
- Markdown table separators and newlines in plain text values are escaped or flattened; ids are rendered as inline code.
- Absolute minute fields render as raw minute counts. When `Globals.getTimeConfig()`, `Globals.formatDate(...)`, and `Globals.formatTime(...)` are available, they also include a formatted in-world date/time label. Unset `departureTime` and `ETA` values render as `-`; null is not coerced to elapsed minute zero.
- Pending destination labels prefer explicit `locationName`/`regionName`, then stored location or region ids, then `rawText`, then the fallback label.

## Implementation
- Command class: `slashcommands/vehicle_status.js`.
- The command depends on `Player.currentVehicle` for computed trip state and on `VehicleInfo` fields for stored route/timing metadata.
- Dedicated tests: `tests/vehicle_status_command.test.js`.
