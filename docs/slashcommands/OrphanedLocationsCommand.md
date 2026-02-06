# OrphanedLocationsCommand

## Purpose
Slash command `/orphaned_locations` to list locations missing valid region links and/or usable exits.

## Args
- None.

## Behavior
- Scans all locations and regions.
- Reports locations with:
  - Missing/invalid region linkage (no regionId, invalid regionId, or region missing the location id).
  - No usable exits (all exits missing or pointing to missing destination locations).
  - Both of the above.
- Includes warnings for null entries.

## Notes
- Exits are only counted if they point to an existing destination location.
