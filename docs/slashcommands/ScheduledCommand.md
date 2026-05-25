# ScheduledCommand

## Purpose
Slash command `/scheduled` to list pending scheduled events in readable markdown.

## Args
- None.

## Behavior
- Reads pending `ScheduledEvent` records through `ScheduledEvent.getPending()`.
- Replies with `No pending scheduled events.` when no pending events exist.
- Otherwise replies with a numbered markdown list ordered by scheduled due time, then id.
- Each entry includes:
  - Scheduled event id
  - Due in-world date/time
  - Relative time from the current world clock
  - Region name/id
  - Location name/id
  - Full event text on its own wrapped lines
- Resolved and skipped scheduled events are not shown.

## Notes
- This is a read-only diagnostic command. It does not process due events or mutate scheduled-event state.
- This class is defined in `slashcommands/scheduled.js`.
