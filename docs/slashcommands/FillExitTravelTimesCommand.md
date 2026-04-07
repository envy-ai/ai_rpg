# FillExitTravelTimesCommand

## Purpose
Slash command `/fill_exit_travel_times` to generate missing exit travel times for every region that still has unpopulated exits.

## Args
- `force` (optional boolean): when `true`, regenerates travel times for every region exit pair instead of only filling blank (`0`) values.

## Behavior
- Throws if no game is loaded.
- Scans all regions and selects only those whose member locations still have at least one exit with `travelTimeMinutes === 0`.
- With `force=true`, scans all regions that have at least one exit, even if all their times are already populated.
- Calls `interaction.backfillRegionExitTravelTimes({ region, force })` for each candidate region.
- Each region backfill first copies a positive reverse-exit time when one already exists, then prompts the AI only for the remaining unpopulated exits.
- With `force=true`, existing populated values are ignored and overwritten by the regenerated pair time.
- AI-generated `0`-minute travel times are normalized to `1` minute before application.
- Replies with total prompted/generated/mirrored/copied counts plus a per-region summary.

## Notes
- `0` minute exit times are treated as “not populated yet”, not as intentional instant travel.
- If a reverse exit exists and is also blank, the generated time is mirrored onto that reverse exit so both directions match.
- In `force=true` mode, an existing reverse exit is also overwritten so both directions end up with the same regenerated value.
