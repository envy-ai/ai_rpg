# Region offsets, map level colors, and current parse diagnosis

## Requested outcome

1. Other new-region creation paths request a level offset instead of silently treating an omitted offset as zero.
2. Regions on the maps receive colors from their level difference relative to the player: blue at -5, green between -5 and 0, yellow at 0, orange between 0 and +5, red at +5. The user confirmed this usual gradient.
3. After implementing and verifying those changes, diagnose the current parse failure from its existing evidence.
4. Subsequent user instruction: successful event-based technique learning grants missing discipline access. This includes narrative first-use discovery by PCs and NPCs, which caused the observed access failure.

Do not restart the server, change live region levels, load a save, or retry a live prompt. Existing pending-region offsets and explicit intentional zero offsets remain intact.

## Native findings

- Pending-region expansion already adds its stored offset once to its source-region base. Before this change, ordinary travel, discovered-exit events and offscreen creation could omit that offset and the shared creation helper turned omission into zero.
- Connected-region planning already requests +1 through +4. A shared, logged XML offset request for genuinely new regions without a supplied offset can cover the other native callers without changing every narrative response protocol.
- Direct/manual generation previously used the prompt's hardcoded region-level value of 1 as an accidental absolute average. It now computes the captured source-relative level before constructing the region. Initial-world creation retains its explicit starting-level policy.
- World Map labels/groups and convex hulls already share a region palette lookup. Region Map exits have their own native bubble styling. These are the intended color integration points; ordinary location images and current/visited/focus behavior remain native.

## Scope and ownership

- Region implementation: shared missing-offset generation, caller audit, direct generation level handling, authoritative map API level fields, region docs and docs index.
- Map implementation: one shared color helper, existing map palette/style integrations, script inclusion and map documentation. The user's gradient clarification is resolved.
- Verification: strict offset XML and retries, new/existing/pending/explicit-zero paths, source-level application exactly once, map gradient/unknown-level behavior and isolated browser rendering.
- Coordinator: scope decisions, integration review, this plan, and the final read-only parse diagnosis.

## Ordered work and acceptance

1. Finalize the shared offset request boundary. Capture the source level once; require a valid positive generated offset instead of fabricating one. Preserve provided offsets and existing saved identities/levels. Use existing prompt logging and retry ownership; do not add maxTokens.
2. Supply actual player/region levels to the native map readers. Unknown region levels remain unknown.
3. Apply the clarified map gradient through shared native palettes. Use endpoint colors beyond the displayed interval without changing stored levels or their computed difference.
4. Run focused Node checks and an isolated browser check. Compile any changed SCSS and rebuild widgets only if their authoritative sources change.
5. Diagnose the failure that was current when requested. Initial evidence filenames include `logs/2026-11-08T22-34-59-023Z_turn_prompt_errors_audit_5122.log` and the `technique_intent` attempts through `2026-11-08T22-38-37-653Z`; these identify evidence to inspect later, not a diagnosis.
6. Report changes, verification, the actual parse failure and its cause, and the no-restart state.

## Status

- [x] Region offset implementation and focused checks.
- [x] User clarification of intermediate map colors: usual blue/green/yellow/orange/red.
- [x] Map color implementation and browser verification: 39/39 focused Node checks and 1/1 isolated browser check, including native hull and player-level refresh behavior.
- [x] Current parse failure diagnosis after the changes.
- [x] Atomic discipline-access grant on event/discovery learning and focused verification: 105/105 affected technique tests, plus targeted registration-failure, saved-access and first-use retry checks.

## Parse failure findings

The captured turn audit `audit_5122` ends at 22:38:37 UTC. Dewdrop's novel Cooling Compress attempt alternates between missing semantic recipe selectors and a private Hydration Technician Arts discipline with no established actor access. The final response omits `recipe.components[1].statusStatName`; a buff targeting an attribute must select the actual attribute rather than making the parser guess. Earlier attempts also omitted component skill selections. These are domain-validation failures, not unclosed XML.

A later live turn, `audit_5123` (22:49:57–22:54:34 UTC), repeats the access failure for Dewdrop's Microclimate Humidity Field. Five of its seven attempts lack discipline access; the other two try to change the rejected intent into `none` or rename the locked discipline. The engine correctly rejects those attempted escapes. The subsequent user instruction authorizes fixing the access-grant boundary; recipe and other qualification validation remain strict.

## Additional learning change

TechniqueEvents learning and the shared TechniquePrompt discovery parser select a trusted native `establishDisciplineAccess` acquisition mode. Low-level ordinary learning remains strict by default. The selected discipline stays private; the mode stages an actor-owned access record with actual learning provenance and installs it only with the successful learned entry/first-use commit. Preview, failed validation, cancellation, resource rejection and rollback must leave no new access. Replays must not duplicate access or learning. Existing acquisition/use requirements and trainer/item qualification remain enforced.

Domain ID registrations precede actor/catalogue mutation after validation, so an allocator failure cannot leave a learned technique or discipline access without a successful transaction. Normal unused identity reservations may still leave the documented counter gaps. Player JSON round-trip verification preserves the new access record.

All changed JavaScript passed syntax checks; affected Nunjucks templates parsed successfully. No SCSS or widget-source changes required compilation. No server restart, live learning grant, saved-world rewrite or model retry was performed.
