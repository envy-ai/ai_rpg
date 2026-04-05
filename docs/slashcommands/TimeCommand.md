# TimeCommand

## Purpose
Slash command `/time` to advance or rewind the world clock by a signed duration.

## Args
- Raw duration text in `interaction.argsText`, for example:
  - `/time 9 hours`
  - `/time -3 hours, 2 minutes`
  - `/time +10m`
  - `/time -1d5h`

## Behavior
- Parses the supplied duration through `Utils.parseDurationToMinutes(..., { allowSigned: true })`.
- Positive durations use the normal forward world-time path, apply elapsed per-minute need/status-effect processing, and then process due vehicle arrivals.
- Negative durations rewind the raw world clock without trying to undo arrivals, expired effects, offscreen actions, or other already-processed time-driven mutations.
- Broadcasts an updated world-time payload so the chat UI clock refreshes immediately, and asks the client to reload the current player/location panels after positive adjustments so need bars redraw.
- Replies with the applied duration, the new current time/date, and any processed due-arrival count.

## Notes
- Throws if no game is loaded.
- Throws on empty or malformed duration text.
- Rewinding before day `0`, `12:00 AM` is rejected.
