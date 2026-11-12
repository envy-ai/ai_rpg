# ShortDescriptionCheckCommand

## Purpose
`/short_description_check` reports regions, locations, things, character abilities, and catalogue techniques whose `shortDescription` value is blank or absent.

## Args
- None.

## Behavior
- Reads regions from `Region.getAll()`, locations from `Location.getAll()`, things from `Thing.getAll()`, and players/NPCs from `Player.getAll()`.
- Raises an error if any required entity collection is unavailable or is not an array.
- Checks every region, location, and thing for a blank or absent `shortDescription`.
- Checks every ability returned by each player's `getAbilities()` method for a blank or absent `shortDescription`.
- Reads the canonical catalogue through `TechniqueService.getDefinitions()` and checks every technique once, independently of how many characters know or have it granted.
- Treats a location stub as described when either `stubMetadata.stubShortDescription` or `stubMetadata.shortDescription` contains text.
- Replies publicly with sorted sections for regions, locations, things, abilities, and techniques. Empty sections display `- (none)`.

## Output Details
- Region and location labels use the entity name, fall back to the entity id, and mark stubs with `(stub)`.
- Thing labels use the thing name, fall back to the thing id, or show `<missing id>` if both are absent.
- Ability labels include the owning player/NPC label and the ability name as `Owner -> Ability`.
- Technique labels include name and ID, distinguishing same-named catalogue entries.
- The warning section appears when the command encounters null region/location/thing/technique entries, unavailable ability lists, null abilities, or abilities without names.
