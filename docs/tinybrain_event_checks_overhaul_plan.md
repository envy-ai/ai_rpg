# TinyBrain Event-Check Overhaul Plan

Implementation status: implemented on 2026-08-07. The document below records the approved design and its failure contract.

Follow-up implementation: sectioned movement event checks now use one turn-scoped TinyBrain continuation. Origin, transit, destination, and tracker programs append their newly rendered context and validated responses to one conversation and prompt log, while preserving their own stage allowlists and parser retry boundaries. WYWA remains a separate prompt family.

## Goal

Replace the generic "next 1-2 events" loop with section-aware, category-specific extraction. Movement turns use the nonempty `ORIGIN`, `BETWEEN`, and `DESTINATION` prose sections already produced by player-action; non-movement turns use one `CURRENT` section. Every response must validate at its own `llmparse` checkpoint, and the final XML must be assembled locally from accepted values. Tracker updates run after the other event stages.

## Implementation plan

1. Add explicit event-section inputs carrying section id, prose, location/region context, allowed categories, and time-passage policy. Empty movement sections do not create prompts.
2. Distinguish authoritative player-action movement, authoritative no-movement, and callers that still need movement inferred. Authoritative movement never asks the event model to recreate `moveLocation`, `moveNewLocation`, or `arriveAtLocation`.
3. Define a canonical TinyBrain event-stage manifest that maps every supported XML tag to a category and valid section. Use the same manifest to render prompts, enforce parser allowlists, preserve ordering, and include registered mod events.
4. Replace generic chunks with explicit section stages for scene/location, items/inventory, characters/presence, combat/recovery, and quests/progression. Each stage names every allowed tag and returns one `<events>` block or `<done/>`.
5. Preserve current transit semantics initially: `BETWEEN` accepts only `thingMoveWithCharacter`. Travel time, player movement, and accompanying-character movement remain authoritative and are not inferred from transit prose.
6. End each section with a final sweep for supported non-tracker events missed by earlier stages, while rejecting duplicates and wrong-section tags.
7. Ask for tracker updates last, using all section prose and accepted event summaries. Require the canonical `<trackerUpdates><trackerUpdate>...</trackerUpdate></trackerUpdates>` format or `<done/>`.
8. Uncomment the tracker-update documentation in `_includes/events-xml-schema.njk` so both TinyBrain and one-shot prompts contain the actual accepted format.
9. Replace permissive chunk parsing with stage-aware semantic validation. Validate XML shape, tag allowlists, required children and values, suppressed categories, section legality, and duplicates before accepting a checkpoint.
10. Let `TinyBrainPromptRunner` discard and retry only the malformed checkpoint. Exhausted configured retries fail explicitly; malformed XML is never included in the assembled result.
11. Use a terminal `llmresult` builder to assemble canonical `<events>` XML locally from completed checkpoint values instead of requesting or trusting a final raw model response.
12. Keep extraction ahead of mutation where possible, then apply origin events, authoritative movement/time, transit-carried things, destination events, tracker updates, follow-up checks/housekeeping, and quest checks in order.
13. Preserve need-bar staging, ignored-event keys, environmental and generation suppression, mod events, logging, queue reservations, progress groups, and follow-up event behavior.
14. Log section/category labels, attempts, validation failures, accepted fragments, and locally assembled XML under the single logical event run.
15. Add coverage for current/origin/between/destination selection, empty sections, phase allowlists, tracker documentation, checkpoint-local retry of `<updateTracker>`, duplicate rejection, retry exhaustion, local assembly, mutation ordering, and surrounding need-bar/quest/housekeeping/mod behavior.

## Expected movement flow

1. Validate all `ORIGIN` category responses.
2. Apply origin outcomes.
3. Perform the authoritative player/vehicle move and travel-time adjustment.
4. Validate/apply the optional `BETWEEN` carried-thing response at the destination.
5. Validate/apply all `DESTINATION` category responses.
6. Run and apply one tracker-update stage over the complete movement prose.
7. Continue housekeeping and quest processing.

## Expected non-movement flow

1. Run the same category stages once against `CURRENT` prose and context.
2. Run the final sweep.
3. Run tracker updates last.
4. Apply only the locally assembled, fully validated event result.

## Failure contract

Semantic mistakes such as `<updateTracker>` must fail inside the responsible `llmparse` stage. The runner removes that malformed assistant response and retries the unchanged stage while retaining accepted prior stages. No raw or invalid model XML may reach event application or the final assembled response.
