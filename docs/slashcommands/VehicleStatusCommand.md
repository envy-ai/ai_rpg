# VehicleStatusCommand

## Purpose
Slash command `/vehicle_status` to display detailed markdown status for the vehicle the current player is currently inside.

## Args
- None.

## Behavior
- Resolves the active vehicle from the current player context, following the same precedence as `Player.currentVehicle`:
  - Region vehicle first
  - Then location vehicle
- Throws when the current player is not inside a vehicle.
- Replies with markdown including:
  - Vehicle kind (`Region vehicle` or `Location vehicle`)
  - Vehicle id
  - Player's current inside-vehicle location
  - Vehicle description
  - Current outside location label
  - Current destination label + location id
  - Fixed-route destination list
  - Trip-state booleans (`isUnderway`, `hasArrived`, `isArriving`)
  - Travel start time / `departureTime`
  - `ETA`
  - `minutesToDestination` / `timeToDestination`
  - `vehicleExitId`
  - Icon and terrain tags

## Notes
- Absolute minute fields are rendered as raw minute counts plus formatted in-world date/time labels when calendar helpers are available.
- This class is defined in `slashcommands/vehicle_status.js`.
