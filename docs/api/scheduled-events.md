# Scheduled Events API

Scheduled-event creation and resolution behavior is documented in [ScheduledEvent.md](../classes/ScheduledEvent.md). The route here is a read-only Story Tools/admin projection used for inspection, persistence verification, and backend playtest snapshots. It intentionally exposes hidden schedule details and is not part of the ordinary Adventure payload.

## GET /api/story-tools/scheduled-events

Returns every hydrated scheduled-event record, including pending, resolved, and skipped events.

Response:

- 200: `{ success: true, scheduledEvents, count }`
  - `scheduledEvents` contains complete `ScheduledEvent.toJSON()` records sorted by `targetWorldMinute`, then `id`.
  - `count` is the exact array length.
- 500: `{ success: false, error }` when the registry contains an invalid collection or record.

The endpoint does not mutate or resolve events. The follow-up API playtest harness includes this response as `scheduledEvents` in every state snapshot so due ordering, idempotency, and save hydration can be asserted structurally.
