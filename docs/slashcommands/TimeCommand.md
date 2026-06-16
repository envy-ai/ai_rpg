# TimeCommand

## Purpose
`/time` moves the loaded game's world clock forward or backward by a signed duration.

## Command Metadata
- Source: `slashcommands/time.js`.
- Class: `TimeCommand`, extending `SlashCommandBase`.
- Name: `time`.
- Aliases: none.
- Args: none. The command reads the raw duration from `interaction.argsText`.
- Usage: `/time <signed duration>`.

## Input
The duration is free-form text after the command name. Examples:

```text
/time 9 hours
/time -3 hours, 2 minutes
/time +10m
/time -1d5h
```

Parsing uses `Utils.parseDurationToMinutes(interaction.argsText, { fieldName: '/time duration', allowSigned: true })`. Supported parser forms include integer minutes, `HH:MM`, unit-bearing day/hour/minute/second/round text, compact adjacent units such as `3d4h2m`, and an optional leading `+` or `-`. Decimal unit values are rounded to the nearest minute; bare decimal strings without units are invalid.

## Execution
- Throws `Cannot use /time when no game is loaded.` unless `Globals.gameLoaded === true`.
- Throws `World-time adjustment helper is unavailable for slash commands.` when the interaction lacks `adjustWorldTimeByMinutes`.
- Throws `Usage: /time <signed duration>` when no duration text is supplied.
- Calls `interaction.adjustWorldTimeByMinutes(deltaMinutes, { source: 'slash_command_time' })`.
- Non-negative deltas use the shared forward world-time path: `Globals.advanceTime(...)`, status-effect need-bar application, due vehicle arrivals, due scheduled events, and realtime world-time payload emission. Positive adjustments also request location/player refresh through the slash-command helper so need bars and panels can redraw.
- Negative deltas rewind the raw world clock through `Globals.elapsedTime` without undoing prior arrivals, expired effects, offscreen actions, scheduled-event resolutions, or other processed time-driven mutations.
- Rewinding before day `0`, `12:00 AM` is rejected by the shared helper.

## Reply
The command replies once with non-ephemeral text:

- Positive deltas: `Advanced time by <duration>.`
- Negative deltas: `Turned back the clock by <duration>.` plus the rewind warning.
- Zero: `Time did not change.`
- Includes `Current world time: <time> on <date>.` when the helper returns `worldTime.timeLabel` and/or `worldTime.dateLabel`.
- Includes `Processed <n> due vehicle arrival(s).` when the helper returns one or more vehicle arrivals.

## Notes
- Scheduled events and status/need adjustments can be processed by the forward-time helper, but the `/time` reply only counts vehicle arrivals.
- Malformed duration text propagates the parser error for `/time duration`.
