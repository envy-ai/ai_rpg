# Location hostile arrival service

`LocationHostileArrivalService.js` owns arrival-only supplemental hostile population. It uses `Location.generationHints.numHostiles` as capacity and makes at most one durable decision for a player arrival id.

## Eligibility and ordering

The canonical movement paths snapshot destination visit state and the prior visit minute before `Player.setLocation(...)` marks the destination. After movement and While You Were Away event application, they call `runLocationHostileArrival(...)`. First visits, missing/non-true visit snapshots, same-location actions, null prior visit times, missing/zero capacity, full capacity, and rating-1-only locations stop without a presence roll.

Occupancy counts living, non-deleted NPCs currently assigned to the destination whose player-relative disposition passes `isActorDispositionHostile(...)`. Hidden NPCs count. Dead, departed, deleted, and merely `isHostile`-flagged non-hostile NPCs do not.

One successful arrival roll creates a pending record containing the selected `wild` or `faction` source before prompting. Pending and completed arrival ids persist in `saveMetadata.locationHostileArrivalState`. A later actual arrival hook for the same destination resumes the saved arrival id and source instead of rolling again; success or invalidation completes both the saved id and the later transition id so either duplicate hook is idempotent. Same-location actions and save loading do not invoke that hook. The service serializes work per destination and records structured skip, roll, selection, success, and failure diagnostics.

## Focused generation and commit

`server.js` renders the canonical base-context prefix with `hostile-presence.njk` or its TinyBrain suffix according to the effective `hostile_presence` AI configuration. It supplies the authoritative source, maximum deficit, local fiction, public faction details when relevant, enemy concepts, and local living/dead names. It does not supply ratings, odds, weights, or roll values.

The dedicated logged prompt uses the shared configured NPC retry policy. Standard and TinyBrain responses pass strict XML and semantic validation; exact parser errors are appended to retry conversations. Every generated individual has quantity one, all normal NPC fields, `isHostile=true`, and one direct nonblank `disposition`. Faction-source drafts must resolve to the selected faction, and names must be unique across existing and generated characters.

Drafts remain unregistered until the whole response validates. Before commit, the runtime re-reads current capacity and occupancy, then rechecks the active player/save/world identity, arrival and pending ids, destination, effective danger inputs, control, violence, standing, and matrix result. It then registers the full batch or rolls back every created registry and location-membership entry. Capacity, occupancy, danger, control, or faction-state invalidation cancels and completes the saved decision without choosing a replacement source; generation/parser failures retain it for a later real arrival. Each NPC persists `hostileArrivalProvenance` with arrival id, pending-attempt id, and source. A `hostile-arrival` chat entry presents a separate presence beat; movement turns already skip NPC actions, so the newcomers first act on a later player turn.

If generation or commit fails, movement remains complete and the pending source remains available for retry. Committed direct movement and fast travel return `arrivalProcessingError` with the server message and backtrace, allowing the client to refresh the destination before opening its normal error popup instead of presenting a false movement failure.
