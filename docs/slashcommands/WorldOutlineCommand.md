# WorldOutlineCommand

## Purpose
`/world_outline` prints a text outline of the generated world. It includes live regions, the locations attached to each live region, and unresolved pending region-entry stubs.

## Args
- None.

## Behavior
- Reads live regions through `Region.getAll()`. The command expects an array and throws if the region list is unavailable.
- Filters out regions without a non-empty string name, sorts the remaining regions by name with base sensitivity, and prints each region under `World Outline:`.
- Reads each region's `locations` getter and prints each location's trimmed `name`. If a location has no usable name, the location `id` is used. Regions with no printable locations show `  (no locations)`.
- Prints `- (no regions)` when no live regions are printable.
- Loads `pendingRegionStubs` from `server.js`. The command requires this export to be a `Map`.
- Prints pending stubs under `Pending Region Stubs:`. Empty maps show `- (none)`.
- Sorts pending stubs by the first available display value among `name`, `originalName`, `targetRegionName`, and `id`.
- Prints each pending stub using the same display-value priority. If a distinct `id` is available, the id is appended in parentheses.
- For stubs with `entranceStubId`, resolves the entrance through `Location.get()` and prints the entrance location's `name`, then `id`, then the raw `entranceStubId`.
- Replies with `ephemeral: false`, so the outline is visible in the chat stream.

## Failure Modes
- Throws `Region list is unavailable.` if `Region.getAll()` does not return an array.
- Throws `Failed to load pending region stubs: ...` if requiring `server.js` fails.
- Throws `Pending region stubs are unavailable.` if `server.js` does not export a `Map` at `pendingRegionStubs`.
- Throws `Pending region stub is missing a name and id.` when a pending stub cannot be displayed.

## Implementation
- Command source: `slashcommands/world_outline.js`.
- Region data: `Region.getAll()` and the `Region.locations` getter.
- Entrance lookup: `Location.get(stub.entranceStubId)`.
- Pending region data: `server.js` exports `pendingRegionStubs`.
- Dedicated command tests are not present under `tests/`; related slash-command tests cover other command implementations and shared slash-command helper behavior.
