# TurnEventRecovery

`TurnEventRecovery.js` validates decisions after an interactive player-action vehicle move fails its fixed-route check. Before vehicle mutation, the API pauses on the existing client-scoped player-input channel using `mode: "choice"` and `promptLabel: "vehicle_route_recovery"`. The themed modal shows the failure, allowed stops, intended time-skip destination/duration, and expandable original stack trace.

## Decisions

- `rerun`: end post-action work and return this request's exact starting autosave. The browser stores the original action/travel metadata, loads that save through the ordinary cancellation/hydration boundary, reloads, and resubmits with a new request id. Empty actions are supported. Without this turn's autosave, the option is disabled; no unrelated save is selected.
- `accept-route`: accept narration as a character time-skip. The player, living party, and named accompanying NPCs disembark to the final player destination, or the vehicle stop when no player destination exists. The failed trip does not edit the vehicle route/location/trip metadata or create an exit from it to the time-skip destination; unselected passengers and drivers stay aboard. Ordinary time-based arrivals still run when advancing the world clock. Narrated vehicle and onward player durations advance the clock once. Identical destinations count vehicle time once; missing durations contribute no estimated time. Events continue at the characters' destination with duplicate movement/time suppressed. Earlier event passes are not replayed.
- `skip-events`: keep prose and previously committed changes, and stop remaining post-action work: quest checks, NPC turns, corpse handling, response-time arrivals/scheduled events, and memory work. Direct/map travel callers stop before their separate mechanical move.

Rerun/skip throw a `TURN_EVENT_RECOVERY` decision, converted into an early successful `/api/chat` response with `eventsSkipped: true` and `turnEventRecovery: { action, autosaveName }`. Successful time-skips return `travelTimeSkipped: true`, preventing direct/map callers from moving again. Accepted time-skip failures propagate as `TURN_EVENT_RECOVERY_FAILED`; original route errors retain their identifying code through travel wrappers.

## Validation and lifecycle

`validateChoice` rejects unknown/disabled options before consuming a pending request. `timeSkipMinutes` validates and sums integer minute durations without clamping. Timeout, cancellation, unavailable realtime clients, and failed accepted movement raise explicit errors. Pending decisions are runtime waits cancelled by game loads and Stop & Undo. Tabs sharing a client id close their modals when one answers. Saves persist relocated characters and time through existing serializers.

Both standard and TinyBrain player actions use this boundary. Interactive TinyBrain sets `currentVehicle.routeRecoveryAvailable`, allowing syntactically valid off-route destinations to reach the modal without substituting another stop. Syntax, complete canonical route context, retry anchoring, and ambiguous allowed-stop checks remain strict. Non-interactive TinyBrain retains early route rejection; non-interactive movement fails explicitly.

`tests/turn_event_recovery.test.js` executes the actual movement/event closures and companion mover for standard/TinyBrain time-skips, preserved vehicle data, unselected occupants, exact clock changes, destination events, and error branches. `tests/e2e/turn-event-recovery.spec.js` covers the modal, phone layout, failed submissions, and exact-autosave resubmission with mutation requests intercepted.
