# ScheduledEvent

## Purpose
Persistent record for a planned future event created by the `scheduleEvent` chat tool.

## Fields
- `id`: compact `sevent_n` identifier from `IdGenerator`.
- `event`: description of what is planned to happen.
- `regionId` / `regionName`: resolved target region.
- `locationId` / `locationName`: resolved target location.
- `targetWorldMinute`: absolute world minute when the event becomes due.
- `targetWorldTime`: canonical `{ dayIndex, timeMinutes }` target time.
- `createdAtWorldMinute` / `createdAtWorldTime`: world time when scheduled.
- `status`: `pending`, `resolved`, or `skipped`.
- `resolutionSummary`: hidden chat-log summary when the event happened.
- `playerProse`: player-facing prose returned when the player was at the event location; this is normally stored visibly, but same-location player-action interruptions fold it into the rewritten player-action prose instead.
- `resolvedAtWorldMinute` / `resolvedAtWorldTime`: world time when processed.
- `createdAt` / `updatedAt`: real timestamps for save/debug use.

## API
- `getPendingDue(worldMinute)`: returns pending due events sorted by target minute, then id.
- `getPendingBetween(startWorldMinute, endWorldMinute)`: returns pending events with `targetWorldMinute` greater than the start and less than or equal to the end, sorted by target minute, then id.
- `markResolved({ summary, playerProse, worldMinute, worldTime })`: records a happened event.
- `markSkipped({ worldMinute, worldTime })`: records a due event that no longer made sense.
- `serializeAll()` / `loadAll(payload)`: save/load map helpers used by `Utils`.

## Diagnostics
- `/scheduled` lists pending scheduled events in readable markdown, ordered by due time and id. It is read-only and does not process due events.

## Runtime Flow
When time advances, API hooks process due `ScheduledEvent` records. Each due event renders `prompts/_includes/scheduled-event-resolution.njk`, receives the complete built-in and registered mod chat-tool definition list, uses the default `scheduled_event_resolution` prompt-progress target, logs the prompt through `LLMClient.logPrompt()`, and parses `<scheduledEventResult>`. This includes world-mutation tools. `requestUserInput` is also exposed; it succeeds only when the processing context has an active client and config allows it, otherwise the tool result is a visible `<toolError>`. A self-closing or empty result marks the event `skipped`. A happened result stores a hidden `scheduled-event` chat entry and, if the player is in the event location, a visible `scheduled-event-prose` entry.

For normal `<finalProse>` player actions with parsed `<timePassed>`, the chat route checks `getPendingBetween(turnStart, turnEnd)` before slop removal. If the earliest due event is in the player's current location, the route advances time to that interruption minute, resolves same-minute local scheduled events with visible scheduled-event prose suppressed, then renders `prompts/_includes/scheduled-event-interruption-rewrite.njk` to rewrite the player-action XML while preserving non-prose fields such as `<hidden>` and `<timePassed>`. The rewritten prose then goes through the regular slop-removal and event-check path. Due events elsewhere remain pending until the normal due-event sweep processes them outside the player prose.
