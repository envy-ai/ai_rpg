# Faction housekeeping runtime integration

> Cadence superseded: the current implementation uses independent `faction_housekeeping.interval` (default 11), with positive shared eligible-turn count modulo that interval and no offset. The original offset decisions below are historical; see [current configuration](../../config.md#housekeeping-and-quest-check-intervals).

## Scope and intended behavior

Run the existing faction-housekeeping worksheet automatically at the ordinary `housekeeping.interval`, offset by one eligible top-level turn. Apply proposed faction creation through existing full faction authoring, retain sparse relations, and save compact per-faction plans for shared base context. Standard and TinyBrain modes share the compact proposal contract. This does not add a separate offscreen-event simulation or awareness ledger.

## Decisions

- Use the existing persisted eligible housekeeping counter, incremented once per eligible top-level event pass. With interval 4, ordinary housekeeping runs at 4, 8, ... and faction housekeeping at 5, 9, ... . A fresh game does not run faction housekeeping at turn 1. With interval 1, the first faction review is turn 2 and both run on each later eligible turn.
- Recursive, suppressed, while-away and replay event passes do not advance the automatic cadence. Split movement counts once after its merged result. Manual housekeeping retains its ordinary bypass behavior and does not shift faction cadence.
- A failed ordinary housekeeping run does not shift faction scheduling. A faction-review failure preserves already-applied turn outcomes and surfaces the original stack through the existing post-processing error mechanism.
- Prior faction plans are intentions/directives, not evidence that offscreen actions occurred. Pass them into later reviews as proposed activity; use actual story records for established facts and exposure.
- A successful review replaces the previous compact plan list, allowing obsolete or unnecessary plans to disappear. New faction draft references resolve to permanent shared integer-counter IDs after creation.
- New opposing factions do not receive invented negative player standing. Ordinary absent-standing behavior remains in force.
- Only deadlines already communicated to the player can bypass the per-thread awareness gate. The withdrawn tracker-specific knowledge instructions remain withdrawn.

## Implementation sequence

1. Add the dedicated service: prepare explicit current context, run the logged standard or staged prompt with bounded parse correction, and stage full faction generation before installation.
2. Reuse full faction authoring against detached copies of existing faction records. Preserve proposed names/concepts. Validate every candidate, reference and sparse directed edge before applying. Existing ties remain unchanged; newly generated ties must touch a new faction, and unconnected pairs remain absent.
3. Commit the new factions and replacement compact plan state together. Failure before commit must not leak new factions, registry entries, or relationship edits. Use narrow game/player identity checks for runtime replacement, not full snapshots of fluctuating character resources.
4. Add the faction runner beside the existing maintenance scheduler, sharing one eligible counter increment and its movement/suppression semantics.
5. Persist/reset/hydrate plans and successful review history boundary. Legacy saves without the new state begin with no faction plans. Include XML-escaped plans and their next steps/awareness constraints in shared base context.
6. Register the TinyBrain family and prompt label without adding a separate interval setting. Update module, API, save and configuration documentation plus the documentation index.

## Verification

Focused mocked tests cover cadence and suppression, split movement, standard/staged proposal execution, full new-faction generation, sparse incoming/outgoing relations, draft-reference resolution, atomic failure behavior, persistence/reset/legacy hydration, escaped base-context output, and failure reporting that preserves the event result. Syntax checks apply to changed JavaScript. Tests use the required 16 GB/no-swap transient systemd limit.

Strata is stopped under the user's notification-before-testing hold. Do not start it or run real-model tests without a concrete test handoff to the lifecycle owner and fresh user approval. No server restart or live-save repair is authorized by this implementation request.

## Completion evidence

Implemented the service, scheduler integration, detached full authoring, sparse relation commit, saved state, shared base context, and TinyBrain registration. JavaScript syntax checks and default YAML parsing passed. Focused verification passed 47 cases across `faction_housekeeping_integration`, `faction_housekeeping_prompt`, `events.housekeeping_prompt`, `events.maintenance_prompt_intervals`, and `api.event_check_sequencing`. The final batch passed 46 cases; its sole stale scaffold-registration assertion was updated for the now-registered family and passed its targeted rerun. Tests ran inside the required systemd memory/no-swap limit (367 MB batch peak, no swap).

Events, service execution, and save hydration were exercised with mocked model completions and generation. Merged movement scheduling was verified at source level rather than through a live game. No real model calls, service starts, server restarts, or live-save mutations were performed for this integration.
