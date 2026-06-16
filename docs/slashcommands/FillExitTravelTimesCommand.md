# FillExitTravelTimesCommand

## Purpose
`/fill_exit_travel_times` fills missing `LocationExit.travelTimeMinutes` values across loaded regions. It uses existing reverse-link times when possible and prompts the LLM for unresolved region exit pairs.

## Args
- `force` (optional boolean): when `true`, processes every region with exits and regenerates each eligible connected pair. When omitted or `false`, the command processes regions containing at least one exit whose `travelTimeMinutes` is `0`.

Boolean slash-command parsing accepts named syntax such as `/fill_exit_travel_times force=true`; positional boolean parsing also accepts `/fill_exit_travel_times true`.

## Behavior
- Throws if no game is loaded.
- Requires `interaction.backfillRegionExitTravelTimes` in the slash-command context and a region list from `Region.getAll()`.
- Scans each region's `locationIds` and inspects every listed location's available exits.
- Without `force`, selects regions with at least one exit whose numeric `travelTimeMinutes` is `0`.
- With `force=true`, selects regions with at least one available exit regardless of populated travel-time values.
- Calls `interaction.backfillRegionExitTravelTimes({ region, force })` for each selected region in sequence.
- Wraps helper failures with the number of regions completed before the error.
- Replies with total prompted, generated, mirrored-reverse, and copied-from-reverse counts, followed by per-region counts.
- Replies without prompting when no regions match: either all exit travel times are populated, or `force=true` found no regions with exits.

## Region Backfill
- Validates the region, its member locations, each exit destination, and every existing `travelTimeMinutes` value. Missing locations, dangling exits, invalid accessors, and non-integer or negative travel times raise errors.
- Builds prompt context from the active setting, region summary, all region locations, known exits, and pending exits.
- Treats positive existing travel times as known exits when `force` is `false`.
- For a blank exit with a positive reverse exit, copies the reverse value onto the blank exit and skips the prompt for that direction.
- Prompts each remaining connected pair once when a reverse exit exists. One-way exits are prompted as directed exits.
- Logs the LLM prompt and response through `LLMClient.logPrompt()` with the `region_exit_travel_times` label.
- Requires the LLM response to contain exactly one `<exit>` entry for each requested pending exit, using the requested source and destination ids. Missing, duplicate, or unexpected response entries raise errors.
- Parses generated duration text with the shared duration parser and normalizes generated `0`-minute values to `1` minute.
- Writes the generated time to the source exit. When the reverse exit exists and is blank, it mirrors the generated value onto the reverse exit; with `force=true`, it overwrites the reverse exit as well.
- Returns per-region counts for prompted exits, generated exits, mirrored reverse exits, and reverse-time copies.

## Notes
- `0` minute exit times are the sentinel for unpopulated travel time, not intentional instant travel.
- A region can be processed without an LLM prompt if every blank exit can copy a positive reverse-exit time.
- The command does not request a client refresh or perform a save by itself; it mutates loaded exit objects through the shared backfill helper.
