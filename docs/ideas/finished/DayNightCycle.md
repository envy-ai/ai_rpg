# Day/Night Cycle

This archive design doc records the original day/night-cycle goals and the current state of the implemented clock/calendar systems. For current reference docs, see `docs/classes/Globals.md`, `docs/config.md`, `docs/api/game.md`, `docs/api/chat.md`, `docs/ui/chat_interface.md`, and `docs/classes/ScheduledEvent.md`.

## Current Behavior

- `Globals` owns the canonical world clock as `worldTime = { dayIndex, timeMinutes }`.
- Runtime config `time` controls `cycleLengthMinutes`, `tickMinutes`, and named `segmentBoundaries`. Defaults are a 1440-minute day, a 15-minute tick, and `dawn`, `day`, `dusk`, and `night` boundaries.
- `Globals.getWorldTimeContext()` derives the current segment, season, formatted `h:MM AM/PM` time, formatted date, holiday context, lighting text, and optional segment/season transition entries.
- `calendarDefinition` is normalized and persisted with `yearName`, `months`, `weekdays`, `seasons`, and `holidays`. Months store `name`, `lengthDays`, and optional `seasonName`; seasons store `name`, `description`, `startMonth`, `startDay`, optional `dayLengthMinutes`, and ordered `timeDescriptions`.
- New games use a calendar from the active setting when present. Otherwise the server runs the calendar-generation prompt and falls back to the built-in Gregorian-style calendar if generation fails.
- Save/load writes `worldTime.json` and `calendarDefinition.json`. Legacy hour-based `worldTime.timeHours` data is migrated to minute-canonical `timeMinutes`.
- Forward time advancement goes through `Globals.advanceTime(minutes, { source })`, returns `advancedMinutes` plus transition data, and syncs the non-NPC current player's elapsed time.
- Time advances from parsed player-action elapsed time, `time_passed` / `timePassed` event fallbacks, route/exit travel time, crafting/process/salvage/harvest actions, checked-container opening, location modification, positive `/time` adjustments, and related fast-travel paths.
- Forward advancement paths process time-based need/status work, due vehicle arrivals, and due `ScheduledEvent` records where the calling flow supports those effects. Negative `/time` rewinds only the raw clock and does not undo already processed arrivals, statuses, scheduled events, or offscreen work.
- Base prompt context includes `worldTime` with date, segment, season, light-level text, local weather context, and calendar season summaries. Chat-history entries can store `metadata.worldTime` for in-world history labels.
- The Adventure UI world-time chip shows time, date, segment/season, light-level text, and current local weather when available. It updates from chat/history payloads and realtime world-time refreshes.
- `GET /api/calendar` returns the active calendar and world-time payload. `PUT /api/calendar` validates and replaces the calendar while preserving the current `{ dayIndex, timeMinutes }`. The in-game calendar modal and world-profile Calendar tab both edit structured calendar data.
- `/calendar_info` displays the normalized active calendar and current world-time context. `/time` adjusts the world clock by a signed duration.
- Region weather resolution uses the current season and total world minutes. Optional ComfyUI location variants use the current world-time lighting and regional weather to render display-only weather/lighting image variants.
- The `scheduleEvent` chat tool persists future `ScheduledEvent` records by relative duration or exact `{ dayIndex, timeMinutes }`; due records resolve through the scheduled-event runtime and may create visible prose when the player is present.

## Original Design Context

The original design goal was a shared world rhythm that could influence danger, travel planning, time-sensitive events, services, NPC behavior, stealth, and environmental presentation. The core vocabulary still applies:

- **World Time**: a shared clock for gameplay, prompts, saves, logs, and UI.
- **Calendar**: named months, weekdays, holidays, and seasons for the setting.
- **Season**: calendar-derived context used for descriptions and weather.
- **Time Segment**: named ranges such as dawn, day, dusk, and night.
- **Lighting**: environmental visibility or light-level text derived from season/time data or segment fallback.
- **Events**: timed future beats represented in current code by `ScheduledEvent`.

The implemented data model differs from the early sketch:

- `WorldTime` stores only canonical `dayIndex` and `timeMinutes`; segment, season, date, holiday, and lighting values are derived views.
- `CalendarMonth.notes`, generic `Schedule`, and generic segment-triggered `TimeEvent` records were not added.
- Season `weatherBias`, `encounterBias`, and `factionBehaviorBias` were not added as calendar fields. Seasonal weather lives on `Region.weather`; faction or encounter behavior remains prompt/system logic rather than a calendar schema.
- Segment boundaries define coarse labels. Seasonal `timeDescriptions` supply more specific light-level descriptions, but they do not currently recalculate segment boundaries or mechanically change day length.

## Deferred Ideas

These ideas are useful archive context but are not current general-purpose systems:

- NPC/service schedule templates keyed to segment and season.
- Mechanical visibility, stealth, encounter, and faction modifiers tied directly to time segment.
- Automatic merchant, healer, inn, patrol, or black-market availability based on the clock.
- Generic quest windows or calendar-date trigger rules beyond explicit scheduled events and prompt-authored world mutations.
- Segment-boundary hooks that re-evaluate NPC routines or service availability automatically.
- Calendar holidays that directly unlock quests, markets, or NPC routines without a prompt/tool path.

## Current Integration Map

- **Globals**: canonical clock, calendar normalization, date/segment/season/light helpers, serialization helpers, and forward time advancement.
- **Config**: `time.cycleLengthMinutes`, `time.tickMinutes`, and `time.segmentBoundaries`.
- **Save/load**: persisted `worldTime.json`, `calendarDefinition.json`, and hour-to-minute compatibility migration.
- **API**: `/api/chat`, travel, crafting, locations, things, `/api/calendar`, and slash-command time adjustment all return or update world-time payloads where relevant.
- **Events**: `time_passed` / `timePassed` is a fallback time source when no action/travel time was already applied; movement time uses route/exit timing where available.
- **ScheduledEvent**: explicit future event records with due processing by absolute world minute.
- **Prompts**: base prompt context includes world time, calendar, lighting, season, and weather context; prompt logs are handled through the normal prompt execution paths.
- **UI**: world-time chip, calendar edit modal, world-profile Calendar tab, weather/light transition summaries, and optional weather/lighting image variants.
