# TinyBrain Parser Hardening Backlog

This document records known TinyBrain parser cases that still require stricter semantic validation. It complements `classes/TinyBrainPromptParsers.md`, which documents implemented behavior.

## Parser-boundary rule

Any future semantic validation must run in the checkpoint parser or retryable final parser. A TinyBrain response must not first pass the runner and then fail semantic parsing in its downstream consumer. Downstream consumers may parse an already-approved response to obtain values, but that parse must not introduce a validation rule that was absent from the retryable parser.

Presentation-only instructions should remain advisory or be normalized when their meaning is unambiguous. In particular, prose length and paragraph guidance must not reject a turn merely because the model exceeded the requested presentation limit.

## Hardening items

1. **Schema-aware exact-root checkpoints.** `exact_xml_root` currently confirms the expected root and nonempty/empty-root policy but does not know the allowed child schema. Give schema-sensitive uses dedicated parsers. The quest reward plan should require one valid plan entry for every reward index. The while-away item/scenery checkpoint should allow only unique, nonempty `<itemName>` children. Avoid adding a generic permissive fallback.

2. **Narrative-scope consistency.** Reject a scope with `travel=false` and nonempty during-travel facts, require meaningful travel facts when `travel=true`, and make random-event and creative-mode final parsers require the root selected by the approved scope (`turnResult` versus `moveTurnResult`). Put the cross-stage check in `parseTurnNarrativeResult()` or a dedicated final parser.

3. **Turn-result child schemas.** `parseTurnNarrativeResult()` should reject unexpected direct children, duplicate prose fields, and movement results whose structured movement metadata is internally incomplete. Account for the intentionally different schemas used by random events, creative actions, NPC actions, player actions, and scheduled-event interruption rewrites rather than imposing one global child allowlist.

4. **Need-bar actor and direction semantics.** Validate need-bar character names against the actors supplied to the prompt. Reject direction/magnitude contradictions such as `increase + empty` and `decrease + full`. Preserve the current decision not to enforce the ten-word reason guidance.

5. **Checked-container outcome completeness.** The retryable final parser now validates exactly one successful check-tool invocation, exact tool identity, authoritative success, failure/permanent-open consistency, and parseable elapsed duration. Remaining work is to define and validate the exact relationship between success degree, the free-text `<checkResult>`, and whether a successful method is temporary or permanently removes the check requirement.

6. **While-away world references.** Replace the current downstream warning-and-ignore behavior for unresolved arrival names, unknown need-bar identifiers, and nonexistent/ineligible item or scenery moves. Pass explicit allowlists or side-effect-free resolver callbacks into the checkpoint/final parsers and reject invalid references before accepting the program. Destination existence and party/exact-location eligibility belong in the retryable parser as well.

7. **Event no-result syntax.** Bare no-event replies are intentionally tolerated, but the current `<done` substring check is too broad. Parse a real empty `<done/>` element or a recognized plain no-result token; do not accept malformed XML merely because it begins with `<done`.

8. **Nested event schemas and semantic duplicate detection.** Validate allowed, unique direct children for every built-in event type. Canonicalize events by their parsed semantic fields so reordering children or adding ignored children cannot evade duplicate detection and apply the same event twice. Registered mod events should use their registered schema/validator. Implemented subset: a TinyBrain `defeatedEnemy` for a live zero-health actor is rejected unless a matching dead/incapacitated outcome appears in the current or an earlier accepted checkpoint; this closes the defeat-XP-without-persistent-outcome case without inspecting prose.

9. **SKIP — prose-to-fact verification.** Do not add parser enforcement that attempts to prove quest-reward, crafting, location-modification, NPC-action, or game-intro prose contains every authoritative fact. Coverage/audit checkpoints and normal prompt review remain responsible for prose fidelity; brittle substring or heuristic prose validation would create false failures.

10. **IMPLEMENTED — scheduled-event tool-plan reconciliation.** The structured plan parser validates supported mutation targets and calls, collapses identical duplicates, rejects conflicting updates, and the execution parser proves that every accepted planned call completed successfully. Legitimate no-mutation events remain valid. Planning may use read-only lookups before committing the mutation plan, and the tool loop terminates locally once the accepted obligations are complete. Hidden-summary fidelity remains model/audit judgment rather than heuristic prose validation.

## Operational retry feedback

Implemented: parse retries remove the malformed terminal response, retain prior successful tool calls/results, and append a concise correction request containing the parser's message without its stack trace. The correction explicitly forbids repeating successful tool calls already present in the conversation. This gives deterministic semantic failures actionable feedback instead of resampling an unchanged checkpoint until `ai.retryAttempts` is exhausted.
