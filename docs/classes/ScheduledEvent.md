# ScheduledEvent

## Purpose

`ScheduledEvent` is the persisted record for a planned future event created through the `scheduleEvent` chat tool. The record stores timing, target location, lifecycle state, and resolution text; runtime API hooks perform due-event resolution and any resulting world mutations.

## Creation

- The `scheduleEvent` chat tool requires `event`, `region`, and `location`, plus exactly one timing mode:
  - `in`: a future duration string or numeric minute count parsed by `Utils.parseDurationToMinutes(...)`.
  - `at`: canonical world time `{ dayIndex, timeMinutes }`.
- `scheduleEvent` is available to regular prose prompts, scheduled-event resolution, generic prompt actions, and background `plot-analysis` prompts. Plot analysis receives it only alongside `addTracker` and `setRelationship`, so it can add new timed events and non-player character relationship labels without broader mutation tools.
- `createScheduledEventScheduler(...)` resolves the region by id or exact name, resolves the location by id or name, and validates that the location belongs to the requested region.
- Region and location ambiguity raises an error instead of selecting an arbitrary match. Same-named locations are resolved inside the requested region when that region identifies a single matching location.
- Relative timings must be positive. Exact timings must be inside the configured day cycle and strictly after `Globals.getTotalWorldMinutes()`.
- Successful scheduling creates a `ScheduledEvent` with a compact `sevent_n` id, absolute `targetWorldMinute`, canonical `targetWorldTime`, and creation time copied from the active world clock.

## Fields

- `id`: compact `sevent_n` identifier allocated by `IdGenerator.next('scheduledEvent')`, or an explicit id loaded from saves.
- `event`: non-empty description of the planned event.
- `regionId` / `regionName`: resolved region target.
- `locationId` / `locationName`: resolved location target.
- `targetWorldMinute`: absolute minute when the event becomes due.
- `targetWorldTime`: canonical `{ dayIndex, timeMinutes }` target time.
- `createdAtWorldMinute` / `createdAtWorldTime`: world time at scheduling.
- `status`: `pending`, `resolved`, or `skipped`; defaults to `pending`.
- `resolutionSummary`: hidden chat-log summary for a resolved event.
- `playerProse`: player-facing prose for a resolved event when the player was present at the target location. Same-location player-action interruptions suppress a separate visible scheduled-event entry and fold this prose into the rewritten player-action prose.
- `resolvedAtWorldMinute` / `resolvedAtWorldTime`: world time when the event was resolved or skipped; `null` while pending.
- `createdAt` / `updatedAt`: real ISO timestamps for save and diagnostics.

## Validation

- The constructor requires an object payload, non-empty event/region/location fields, non-negative integer world-minute fields, world-time objects with non-negative integer `dayIndex` and `timeMinutes`, and one of the valid statuses.
- `markResolved(...)` requires a non-empty `summary`.
- `markSkipped(...)` clears `resolutionSummary` and `playerProse`.
- `loadAll(payload)` clears the in-memory registry, requires an object map, and hydrates each entry through the constructor.

## Static API

- `clear()`: removes all in-memory scheduled events.
- `getAll()`: returns all records in insertion/map order.
- `getById(id)`: returns a record by trimmed id, or `null`.
- `getPending()`: returns pending records sorted by `targetWorldMinute`, then id.
- `getPendingDue(worldMinute)`: returns pending records with `targetWorldMinute <= worldMinute`, sorted by due time and id.
- `getPendingBetween(startWorldMinute, endWorldMinute)`: returns pending records with `targetWorldMinute > startWorldMinute` and `targetWorldMinute <= endWorldMinute`, sorted by due time and id. It throws if the end minute is before the start minute.
- `fromJSON(payload)`: constructs a record from a serialized payload.
- `serializeAll()`: returns an id-keyed object map of `toJSON()` payloads.
- `loadAll(payload)`: replaces the in-memory registry from an id-keyed object map.

## Instance API

- `markResolved({ summary, playerProse, worldMinute, worldTime })`: sets `status` to `resolved`, stores trimmed resolution text, records resolution world time, and refreshes `updatedAt`.
- `markSkipped({ worldMinute, worldTime })`: sets `status` to `skipped`, clears resolution text, records resolution world time, and refreshes `updatedAt`.
- `toJSON()`: returns the persisted record shape with cloned world-time objects.

## Save And Load

- `Utils.serializeGameState(...)` writes scheduled events through `ScheduledEvent.serializeAll()`.
- `Utils.writeSerializedGameState(...)` stores the map in `scheduledEvents.json`.
- Save metadata includes `totalScheduledEvents`.
- `Utils.loadSerializedGameState(...)` reads `scheduledEvents.json`, defaulting to `{}` when the file is absent or cannot be parsed.
- `Utils.hydrateGameState(...)` loads scheduled events through `ScheduledEvent.loadAll(...)` before hydrating things, players, chat history, locations, exits, and regions.
- `/api/new-game` clears the scheduled-event registry during its in-memory reset before generating the starting region, preventing due-event records from an old game from leaking into the new game.
- Constructors and loaders register scheduled-event ids with `IdGenerator` so loaded ids are not reused.

## Due-Event Resolution

`api.js` owns runtime processing for due scheduled events:

- `processDueScheduledEvents(...)` guards against re-entrant resolution, reads `ScheduledEvent.getPendingDue(Globals.getTotalWorldMinutes())`, and resolves due events in chronological order.
- Due-event sweeps run after due vehicle arrivals in the main `/api/chat` response path, crafting actions, location modification actions, positive world-time adjustments, travel/fast-travel time adjustments, and `/time` forward adjustments.
- Negative world-time adjustments move the raw clock backward and do not process due scheduled events.
- Each due event renders `base-context.xml.njk` with `promptType: 'scheduled-event-resolution'`, which includes `prompts/_includes/scheduled-event-resolution.njk`.
- With the `scheduled_event_resolution` TinyBrain family enabled, the prompt separately decides applicability, may run read-only lookup tools, produces a parser-validated mutation plan, completes its execution checkpoint, approves a hidden summary, and drafts/audits visible prose when the player is present. The plan does not echo the raw scheduled-event text or value. It structurally identifies direct-update targets, allowlisted fields, JSON values, and richer mutating tool calls; identical planned operations collapse safely while conflicting updates to the same field fail. Direct-update-only and no-change plans execute deterministically through existing server mechanics. Successful deterministic operations are cached for the resolution and reused across checkpoint retries, while structured tool failures are not cached. A failed invocation makes the checkpoint fail; if retries are exhausted, the request fails loudly and the scheduled record remains pending rather than being marked resolved or skipped. Any world-time adjustment that made the event due has already occurred and is not transactionally rolled back. Richer plans retain the ordinary model tool loop, but execution terminates locally as soon as the parser can prove all accepted obligations completed. A local result builder then assembles final XML from the approved summary and prose. Both prompt variants state that their base context describes the scheduled location and that player presence controls visibility only: a feasible event must not be skipped merely because the player is elsewhere or the affected object is not in player inventory.
- Resolution prompts use metadata label `scheduled_event_resolution`, are logged through `LLMClient.logPrompt()`, and use the configured prompt-progress target for that label.
- Scheduled-event resolution receives the full built-in and registered mod chat-tool list, including world-mutation tools. Silent event-check housekeeping uses a mutation-capable scope that excludes generic chat-history edit/rerun helpers and additionally verifies that `createQuest`, `updateTracker`, and `removeTracker` are present before calling the model.
- `requestUserInput` is in the scheduled-event tool list. It succeeds only with an active client stream/id, realtime delivery, and enabled configuration; otherwise the tool loop returns a visible tool error to the model.
- The parser uses the final `<scheduledEventResult>` block in the model response. A self-closing result, or a result with no summary and no `proseForPlayer`, skips the event.
- A happened result must include `summary`. If the player is at the scheduled location, it must also include `proseForPlayer`.
- Happened events store a hidden `scheduled-event` chat entry with `hiddenFromClient: true`.
- When the player is present and visible prose is not suppressed, happened events also store a visible `scheduled-event-prose` entry. Slop removal can run on that visible scheduled-event prose before storage.
- `markResolved(...)` stores player prose only when the player was present. Off-location resolutions keep `playerProse` empty.
- Resolved/skipped lifecycle fields serialize with saves and are restored by hydration. Pending sweeps query only records whose status is still `pending`, so a resolved record cannot run again merely because its due minute remains in the past. `EVENT-8-save-reload-idempotency.json` verifies the full API path: two offscreen records resolve once, a named save restores their exact minute-666 lifecycle state, and both a pre-reload ten-minute advance and a post-reload one-minute advance create no new completion, mutation, or scheduled-event history.

## Player-Action Interruptions

Normal player-action `<turnResult>` responses with parsed `<timePassed>` can be interrupted by same-location scheduled events before slop removal:

- The chat route skips interruption handling for travel prose, questions, generic prompts, and responses without parsed player-action time.
- `findScheduledEventInterruptionForPlayerAction(...)` checks `getPendingBetween(turnStart, turnEnd)` and filters to the player's current location.
- If multiple local events share the earliest due minute inside the action interval, all events at that minute resolve together.
- The route advances world time to the interruption minute, applies status/need ticking for that elapsed segment, then resolves the local events with source `player_action_interruption` and `suppressVisibleProse: true`.
- If at least one event happened, `prompts/_includes/scheduled-event-interruption-rewrite.njk` rewrites the original player-action XML so the scheduled-event prose is incorporated into the player-facing action prose.
- With the `scheduled_event_interruption_rewrite` family enabled, the rewrite is planned, drafted, audited, and parsed in one staged conversation. Draft and optional revision checkpoints accept prose only; if the model returns a complete XML result there, that checkpoint retries instead of nesting the wrapper inside the final prose CDATA. Its final invariant parser permits changes only beneath player-facing prose tags and rejects any root, hidden-note, duration, destination, vehicle, or other non-prose drift.
- The rewrite must preserve non-prose XML fields, must not convert the response to travel prose, must not reject the action, and must preserve the original `<timePassed>` duration. For `<turnResult>` responses, the rewrite edits the direct `<prose>` child while preserving that wrapper, direct child `<hidden>` notes, and nested hidden notes inside prose.
- The interruption prompt intentionally keeps only one temporal contract and one event contract. It does not impose exact grammar, forbid harmless embellishment, or freeze NPCs and bystanders after the event. Because scheduled interruptions are rare, preserve full live failures for review and reconsider this permissive policy only if future examples show a recurring material contradiction with the scheduled event or authoritative state; prose preference alone is not a reason to add another rule.
- The remaining player-action time advances after the rewrite. Regular slop removal, event checks, quest checks, autosave, and response shaping continue on the rewritten prose.
- Due events in other locations remain pending during the interruption pass and are eligible for the regular due-event sweep at response time.

## Diagnostics

- `GET /api/story-tools/scheduled-events` returns every complete `toJSON()` record sorted by target minute and id for Story Tools/admin inspection and backend persistence tests. It is read-only and deliberately separate from ordinary Adventure payloads because event descriptions may be hidden.
- `/scheduled` is a read-only slash command backed by `ScheduledEvent.getPending()`.
- It replies with `No pending scheduled events.` when none are pending.
- Otherwise it returns a numbered Markdown list sorted by due time and id, including due date/time, relative time, region name/id, location name/id, and the full event text.
- Resolved and skipped records are omitted from `/scheduled`.

## Reference Tests

- `tests/scheduled_event.test.js`: model lifecycle, due ordering, interval bounds, and save/load round-trip.
- `tests/scheduled_event_runtime.test.js`: scheduler timing, region/location validation, same-name region-scoped lookup, and result XML parsing.
- `tests/chat_tool_schedule_event.test.js`: chat-tool schema, delegation, result XML, and invalid timing-mode errors.
- `tests/scheduled_command.test.js`: `/scheduled` registration and Markdown output.
- `tests/scheduled_event_api_integration.test.js`: API wiring for scheduling, resolution prompts, tool list, prompt logging, chat entry types, and vehicle-before-scheduled ordering.
- `tests/api.player_action_rejection.test.js`: scheduled-event interruption rewrite order before slop removal.
