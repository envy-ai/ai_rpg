# Minute-Based Time Migration Archive

This finished design note records the migration from decimal-hour canonical time to
minute-based canonical time. It is no longer an active task list. Current
behavior is documented first; the original design intent is preserved afterward so
later time-related work can tell what was deliberate.

## Current Implemented Behavior

- Canonical world time is minute-based: `worldTime = { dayIndex, timeMinutes }`.
  Saves write `worldTime.json` in this shape.
- `Globals.getTotalWorldMinutes()` is the canonical elapsed-time helper.
  `Globals.advanceTime(minutes, { source })` requires a non-negative integer
  minute count and returns `advancedMinutes`; transition entries use
  `atTimeMinutes`.
- `Globals.getTotalWorldHours()` still exists as a read convenience, but
  decimal hours are not the persisted or API contract.
- `Globals.formatTime(...)` renders 12-hour `h:MM AM/PM` labels from
  `timeMinutes`.
- `Player.elapsedTime`, location/region `lastVisitedTime`, vehicle trip timing,
  NPC last-seen fields, scheduled events, offscreen NPC activity snapshots, and
  history `metadata.worldTime` all use minute semantics.
- New-game `startTime` is intentionally still an hour-only `0`-`23` input in the
  UI/API. The server applies it through the minute path as `startTime * 60`.
- API and client-facing payloads use minute names such as `timeMinutes`,
  `advancedMinutes`, `timeTakenMinutes`, `travelTimeMinutes`, `durationMinutes`,
  and `nextChangeMinutes`.

## Duration Parsing

`Utils.parseDurationToMinutes(value, { fieldName, allowSigned })` is the shared
duration parser for current code. It accepts:

- numeric minute values and bare integer minute strings
- `HH:MM` duration strings, interpreted as elapsed time rather than clock time
- day/hour/minute/second/round unit strings, including compact forms such as
  `3d4h2m`
- decimal unit quantities such as `2.5 hours`

Unknown units, malformed separators, bare decimal strings without units, and
disallowed signed values throw explicit errors. Some model-output parse paths
catch those parser errors and skip a bad optional model result, but the parser
itself is fail-loud.

## Time Advancement Paths

- Player-action `<timePassed>` and event-check `time_passed` values are parsed
  to minutes. Event-check `time_passed` only advances time when an earlier action
  or travel path has not already produced `timeProgress`.
- Event-check zero-duration time still advances by the historical minimum of
  one minute.
- Crafting, salvage, harvest, and location-modification result `<timeTaken>`
  values are parsed to `timeTakenMinutes`; successful applied actions advance at
  least one minute and return `timeProgress`.
- Time advancement triggers the surrounding elapsed-time work: need/status
  ticking, due vehicle arrivals, scheduled events, and world-time payload refresh.

## Domain-Specific Minute State

- Status effects store `duration` and `appliedAt` in minutes. `-1` is permanent,
  `null` means no scheduled expiration or unknown duration, and unit-bearing
  strings are normalized through `Utils.parseDurationToMinutes(...)`.
- Weather definitions store duration ranges as `minMinutes`/`maxMinutes`.
  Active weather state stores `nextChangeMinutes` and `durationMinutes`.
- `LocationExit` travel times are `travelTimeMinutes`; `0` remains the
  unpopulated-travel-time sentinel for saved exits and backfill flows.
- Scheduled events use absolute world minutes plus canonical
  `{ dayIndex, timeMinutes }` target snapshots.

## Compatibility That Remains

Legacy hour-based saves are still supported. During load, hour-based saves are
detected when `serialized.worldTime` has `timeHours` without `timeMinutes`.
Migration converts compatible hour fields to minute fields before object
hydration, including:

- world-time snapshots
- player elapsed/visited timestamps
- location/region visited timestamps
- status-effect `duration` and `appliedAt`
- weather duration ranges and active weather state
- offscreen NPC activity scheduler snapshots

Some runtime normalizers also accept old hour fields, such as `timeHours`,
`minHours`/`maxHours`, `durationHours`, and `nextChangeHours`, then normalize to
minute fields. New writes should continue to use only the minute-canonical field
names.

## Original Design Notes

The migration was designed around these decisions:

1. Canonical internal and persisted elapsed time should be minutes, not
   decimal hours.
2. New-game start time should remain a simple hour selector.
3. LLM-facing duration fields should allow human-readable forms such as `HH:MM`,
   `2 hours`, `45 minutes`, `1 day, 2 hours`, and round counts.
4. Invalid duration data should surface clearly instead of being silently
   converted through ad hoc string stripping.
5. Display labels should stay human-readable even though storage is numeric
   minutes.
6. Legacy saves should load through explicit migration, but current saves and
   API payloads should write the minute-canonical names.

These notes explain why current code still has a small number of compatibility
reads for hour-shaped data while treating minute-shaped data as the active
contract.

## Current Reference Points

Use the current focused docs for implementation details:

- `docs/classes/Globals.md`
- `docs/classes/Utils.md`
- `docs/classes/StatusEffect.md`
- `docs/classes/Region.md`
- `docs/classes/Events.md`
- `docs/api/chat.md`
- `docs/api/crafting.md`
- `docs/api/game.md`
- `docs/api/serialization.md`

Useful regression anchors include duration parser tests, event time-passed
tests, crafting time-result tests, world-time/calendar tests, weather payload
tests, and scheduled-event tests.
