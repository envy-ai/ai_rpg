# SetLastSeenCommand

## Purpose
Slash command `/set_last_seen` to set the persisted NPC `last_seen_time` / `last_seen_location` fields for every NPC currently at a specified location.

## Usage
- `/set_last_seen <location> <H AM/PM>`
- `/set_last_seen <location> <H:MM AM/PM>`
- `/set_last_seen all <H AM/PM>`
- `/set_last_seen <location> <duration> ago`
- Examples:
  - `/set_last_seen "Town Square" 3 PM`
  - `/set_last_seen "Town Square" 3:15 PM`
  - `/set_last_seen all 8 PM`
  - `/set_last_seen Area 51 1 day 2 hours ago`

## Behavior
- Resolves the location by exact id first, then by exact location name.
- Also accepts the reserved location keyword `all`, which targets every location except the current player's current location.
- Targets NPCs only; player characters are left unchanged.
- Exact times use 12-hour `h AM/PM` or `h:MM AM/PM` parsing; bare hours are treated as `:00`.
- Exact times earlier than or equal to the current world clock resolve on the current in-world day.
- Exact times later than the current world clock resolve to the previous in-world day.
- Relative `ago` inputs strip the trailing `ago` and parse the remaining duration through `Utils.parseDurationToMinutes(...)`.
- Every targeted NPC is updated through `recordLastSeenByPlayer(...)`, so both `last_seen_time` and `last_seen_location` are validated through the normal model path. When using `all`, each NPC keeps their own current location as the stored `last_seen_location`.
- The command also forces `was_in_player_location_previous_round = false` for targeted NPCs so current-location reunion/while-you-were-away prompt logic can surface them immediately.

## Notes
- Fails loudly when no game is loaded, the location cannot be resolved, `all` is used without a current player location, no NPCs are currently at the target location set, the time text is malformed, or the resolved absolute timestamp would fall before world minute `0`.
- Exact-time parsing assumes the configured in-world day length is long enough to contain the requested clock time; otherwise the command throws with a clear error.
- This class is defined in `slashcommands/set_last_seen.js`.
