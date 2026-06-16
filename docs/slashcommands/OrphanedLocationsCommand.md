# OrphanedLocationsCommand

## Purpose
`/orphaned_locations` reports locations that are disconnected from the world graph because they lack a valid region membership, lack an exit to an existing destination, or satisfy both conditions.

## Usage
```text
/orphaned_locations
```

The command has no arguments or aliases.

## Behavior
- Reads every `Location` and `Region` from the runtime indexes.
- Throws `Location list is unavailable.` or `Region list is unavailable.` if either model index does not return an array.
- Builds a region lookup from regions with non-empty string ids.
- Classifies each non-null location into mutually exclusive report sections:
  - `Missing/Invalid Region Links`: the location has no non-empty `regionId`, the `regionId` does not resolve to a region, or the resolved region's `locationIds` array does not include the location id.
  - `No Valid Exits`: the location has no exit whose `destination` resolves to an existing `Location`.
  - `Both Missing Region + Exits`: the location fails both checks.
- Adds `Encountered null location entry.` to a `Warnings` section for null location entries.

## Output
- Replies publicly with a plain markdown report headed `Orphaned Locations Report`.
- Lists `(none)` for empty sections.
- Sorts entries case-insensitively within each section.
- Labels locations by trimmed `name`, then `Location <id>`, then `Location <missing id>`.
- Includes the region-link failure reason for missing-region entries:
  - `missing regionId`
  - `invalid regionId (<id>)`
  - `region missing location (<region label>)`

## Notes
- A usable exit requires a direction from `location.getAvailableDirections()`, an exit from `location.getExit(direction)`, a truthy `exit.destination`, and a matching `Location.get(exit.destination)` result.
- Region membership is checked against `region.locationIds.includes(location.id)`.
- The command reports disconnected locations only; it does not mutate regions, exits, or locations.
