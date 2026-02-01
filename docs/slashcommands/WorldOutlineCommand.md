# WorldOutlineCommand

## Purpose
Slash command `/world_outline` to list regions with their locations and pending region stubs.

## Args
- None.

## Behavior
- Fetches all regions, sorts by name, and prints location names.
- Loads `pendingRegionStubs` from `server` and lists entrance stub info.
- Replies with a formatted outline.

## Notes
- Throws if pending stubs are unavailable to avoid silent failures.
