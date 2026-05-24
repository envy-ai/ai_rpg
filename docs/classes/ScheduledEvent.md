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
- `playerProse`: visible prose stored only when the player was at the event location.
- `resolvedAtWorldMinute` / `resolvedAtWorldTime`: world time when processed.
- `createdAt` / `updatedAt`: real timestamps for save/debug use.

## API
- `getPendingDue(worldMinute)`: returns pending due events sorted by target minute, then id.
- `markResolved({ summary, playerProse, worldMinute, worldTime })`: records a happened event.
- `markSkipped({ worldMinute, worldTime })`: records a due event that no longer made sense.
- `serializeAll()` / `loadAll(payload)`: save/load map helpers used by `Utils`.

## Runtime Flow
When time advances, API hooks process due `ScheduledEvent` records. Each due event renders `prompts/_includes/scheduled-event-resolution.njk`, receives the complete built-in and registered mod chat-tool definition list, uses the default `scheduled_event_resolution` prompt-progress target, logs the prompt through `LLMClient.logPrompt()`, and parses `<scheduledEventResult>`. This includes world-mutation tools. `requestUserInput` is also exposed; it succeeds only when the processing context has an active client and config allows it, otherwise the tool result is a visible `<toolError>`. A self-closing or empty result marks the event `skipped`. A happened result stores a hidden `scheduled-event` chat entry and, if the player is in the event location, a visible `scheduled-event-prose` entry.
