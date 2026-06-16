# SetLastSeenCommand

## Purpose
Slash command `/set_last_seen` sets persisted NPC `last_seen_time`, `last_seen_location`, and `was_in_player_location_previous_round` data for NPCs at a selected location or across all non-current locations.

## Usage
- `/set_last_seen <location|all> <H AM/PM>`
- `/set_last_seen <location|all> <H:MM AM/PM>`
- `/set_last_seen <location|all> <duration> ago`
- Examples:
  - `/set_last_seen "Town Square" 3 PM`
  - `/set_last_seen "Town Square" 3:15 PM`
  - `/set_last_seen all 8 PM`
  - `/set_last_seen all 2 hours ago`
  - `/set_last_seen Area 51 1 day 2 hours ago`

## Behavior
- Requires a loaded game and reads the command text from `interaction.argsText`.
- Resolves single-location input by exact location id first, then by exact location name. Quoted location text is accepted.
- The reserved location keyword `all` targets every indexed location except the current player's current location.
- Targets actors in `Globals.playersById` with `isNPC === true` and a matching `currentLocation`; player characters are left unchanged.
- Exact times use case-insensitive 12-hour `h AM/PM` or `h:MM AM/PM` parsing. Bare hours are treated as `:00`, hours must be `1` through `12`, and minutes must be `00` through `59`.
- Exact times earlier than or equal to the current world clock resolve on the current in-world day.
- Exact times later than the current world clock resolve to the previous in-world day.
- Relative `ago` inputs strip the trailing `ago` and parse the remaining non-signed duration through `Utils.parseDurationToMinutes(...)`. Supported duration text includes integer minutes, `HH:MM`, day/hour/minute/second/round units, and compact unit forms such as `3d4h2m`; seconds are rounded to the nearest minute by the shared parser.
- Every targeted NPC is updated through `recordLastSeenByPlayer(...)`, so `last_seen_time`, `last_seen_location`, and `was_in_player_location_previous_round` are validated through the normal `Player` model path.
- The stored `last_seen_location` is the NPC's own `currentLocation`. In `all` mode, each NPC keeps its own location rather than sharing a single command-level location.
- Targeted NPCs receive `was_in_player_location_previous_round = false` so current-location reunion and while-you-were-away prompt logic can surface them.
- The command replies publicly with the number of updated NPCs, the number or name of affected locations, and the formatted resolved world time/date.

## UI Entry Points
- The main location menu and map location context menu expose `Set Last Seen`.
- The modal accepts the same exact-time and relative-duration input as the slash command and dispatches through the shared slash-command execution path.

## Notes
- Fails when no game is loaded, the location cannot be resolved, `all` is used without a current player location, `all` has no non-current locations to scan, no NPCs are at the target location set, the time text is malformed, or the resolved absolute timestamp would fall before world minute `0`.
- Exact-time parsing requires the configured in-world day length to contain the requested clock time; otherwise the command throws with a clear error.
- This class is defined in `slashcommands/set_last_seen.js`.
