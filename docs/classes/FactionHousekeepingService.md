# FactionHousekeepingService

`FactionHousekeepingService.js` turns the [faction housekeeping prompt](FactionHousekeepingPrompt.md) into automatic faction creation and saved planning guidance. It runs after settled event outcomes at its independent `faction_housekeeping.interval` (default `11`). A positive eligible-turn count divisible by that interval runs a review, with no offset: 11/22 by default, or from turn 1 at interval 1. Ordinary housekeeping retains its separate interval. One shared counter advances once per eligible top-level pass. Recursive, suppressed, manual, reprocessing, and while-away passes do not add faction runs; split movement runs once after merging its results. Normal-housekeeping failure does not alter faction cadence. The existing persisted counter remains the shared eligible-turn clock; changing configuration uses its current value without a reset or new counter. The first-review history window also uses the faction interval.

The API registers the service during server startup. Changes take effect after a normal server reload; this implementation does not restart the running server or invoke models as part of verification.

## Context and generation

`buildFactionHousekeepingContext({ baseContext, factions, chatHistory, previousState, currentPlayer, interval, textToCheck, actionText, currentEventText, currentTurnId, scheduledEvents, isHiddenEntry, publicText })` returns `{ context, boundary }`. It uses actual faction IDs/content, active quest objectives and mystery threads, current trackers, private mystery/supplemental facts, saved tentative plans, recorded scheduled attempts, and public stored story passages. Named NPC-role prose is eligible public evidence. Production injects the existing server hidden-entry and hidden-note projectors, and the shared history helper excludes diagnostics. Settled current-turn event text is included even before its summary is stored. Current status and timestamps govern interpretation of older passages.

Saved plans are tentative intentions, not evidence of action or exposure. Hidden scheduled clocks do not establish an awareness exception. No awareness ledger is created: `awarenessConstraints` steers later narrative prompts, and only actual public communication can justify a known-deadline exception. An empty pre-verified deadlines list does not assert that no genuine communicated deadline exists.

`runFactionHousekeeping(...)` accepts the same context inputs plus `promptEnv`, `parseXMLTemplate`, `config`, `generateFactionsList`, and `assertCurrent`; completion/log callbacks can be injected for tests. Effective `faction_housekeeping` model configuration chooses the standard parse-and-correct path or registered ten-stage TinyBrain program. Both paths disable tools, log attempts through `LLMClient.logPrompt()`, and preserve parser feedback within the configured retry budget. TinyBrain keeps its queue reservation across completions and uses the documented fixed-wrapper/bare-program protocol.

The ordinary request declares `factionHousekeepingProposal` as its XML response root. TinyBrain declares each section's parser-argument root separately and the proposal parser declares `factionHousekeepingProposal`; the ordinary wrapper never leaks into section generation. These contracts scope the shared XML guard while leaving semantic proposal validation unchanged.

## Detached authoring and atomic commit

`stageFactionHousekeepingProposal({ proposal, factions, generateFactionsList, settingDescription })` calls the shared full generator with the exact proposed count, `asDraft: true`, detached existing faction DTOs, concept notes, and `requiredNames`. Exact proposed names/cardinality are validated inside its core-generation correction budget. The shared generator then supplies full faction descriptions, goals, assets, violence, reputation tiers, and sparse directed relations. Mutations to detached existing DTO relation maps cannot leak into the live world.

Staging validates every generated faction with `new Faction({ ...draft, register: false })`, requiring its explicit temporary ID and allocating/registering nothing. Incoming relations are validated the same way. Only meaningful edges touching a new faction are eligible for commit; omitted pairs stay absent, existing edges remain preserved, and generated existing-to-existing additions are ignored. Neutral entries remain valid only as explicit meaningful ties under the shared authoring contract.

`commitFactionHousekeepingProposal({ staged, factions, boundary, assertCurrent, setState })` checks active-game identity and the faction-content fingerprint immediately before synchronous commit. Artwork fields and timestamps do not invalidate the review. Shared `IdGenerator.next('faction', data.name)` allocates actual IDs from the first three name words, with numeric suffixes for collisions; generated temporary IDs and proposal-local draft references are remapped in relations and saved plans. All new factions, incoming edges, and the replacement plan list commit together. Failure leaves existing plans/boundary unchanged and removes any partial faction registrations/edges; unused name reservations retain their collision high-water marks. Source-roster changes reject stale work. No broad character/resource freshness snapshot is used.

The service does not assign player standing. New factions retain ordinary absent/neutral standing unless an actual reputation change occurs through existing game mechanics. It creates no faction activity events, offscreen executor, scheduler mutations, narration, or exposure receipts. Full faction creation does not imply that a proposed activity has occurred.

## Persistence and base context

`Globals.getFactionHousekeepingState()` returns an isolated normalized snapshot; the setter validates before replacing state. `Utils` serializes it in `metadata.factionHousekeepingState` and hydrates it on load. Missing older-save state becomes an empty list and null boundary; new games reset it. Present malformed data raises a clear error.

Each successful review replaces the entire plan list, including replacing it with an empty list; omitted obsolete plans are not silently retained. It also advances `lastReviewedTurnId`/`lastReviewedTurnTimestamp`. Failure advances neither. The shared history helper resumes after this boundary, including deletion-resistant timestamp recovery.

`server.buildBasePromptContext()` supplies the most recent successful review's saved plans and canonical faction IDs. Shared `base-context.xml.njk` includes `_includes/faction-housekeeping-plans.njk` immediately before the recent story history boundary, after trackers. This readable Markdown digest gives each faction's name/ID, role, plan, bulleted next steps, and awareness/timing constraints for standard and TinyBrain consumers. Text remains XML-escaped within the surrounding prompt template. The introduction describes plans as future attempts rather than accomplished events; empty plan lists omit the section. Rendering uses saved fields directly without another model call.

Automatic failures use `FACTION_HOUSEKEEPING_AFTER_EVENT_CHECKS_FAILED` through the existing stack-bearing event post-processing error path. Already-applied turn outcomes and required structured flags remain available to response construction and the client error UI.

## Verification

Mocked tests cover cadence/warmup, excluded passes, independent failure handling, standard/TinyBrain routing and reservation, full detached generation and sparse incoming/outgoing edges, draft-to-actual IDs, atomic failure/cancellation, saved-state roundtrip/older-save reset, public/private context, and shared XML plan context. Run under the required memory/no-swap scope:

```bash
systemd-run --wait --collect --pipe -p MemoryMax=16G -p MemorySwapMax=0 -p "WorkingDirectory=$PWD" node --test tests/faction_housekeeping_prompt.test.js tests/faction_housekeeping_integration.test.js
```

These tests make no actual model calls. Runtime integration planning is recorded in [the implementation plan](../superpowers/plans/2026-10-30-faction-housekeeping-runtime.md).
