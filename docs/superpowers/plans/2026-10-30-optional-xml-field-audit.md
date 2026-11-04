# Optional XML field omission audit

## Scope

Audit structured model-response parsers for fields that already accept an empty value, `N/A`, or an empty collection but unnecessarily require the XML element. Accept omission with the same domain meaning and normalized result. Start with generated NPC behavioral `disposition` and cover standard generation, TinyBrain checkpoints/finals, events, and peripheral structured prompts. This is parser tolerance, not XML repair or a change to required game mechanics.

## Acceptance criteria

- Omitted optional fields produce the same no-value result as their already accepted empty/sentinel form; downstream readers do not dereference absent nodes.
- Required roots, identity/reference fields, actual numeric values, boolean decisions, required narration and authoritative outcomes remain required unless they already have a defined no-value contract.
- Duplicate fields, malformed XML, invalid supplied values, reference/coverage drift and atomic mutation boundaries retain their checks.
- Standard and TinyBrain paths agree on domain meaning. Prompt guidance no longer insists on placeholders for newly optional fields.
- Do not apply a global `allowEmpty` to `allowMissing` shortcut without checking field semantics and consumers. In particular, omitting a collection must not bypass required selected-candidate or reward coverage.
- Do not change patch semantics: an omitted patch field still means preserve the existing value, rather than clearing it.
- No invented defaults for required mechanics, no clamping, no new model calls, no service restarts or live-game changes.

## Work and verification

1. Inventory existing no-value contracts and presence checks, including prompt instructions and downstream normalization.
2. Implement narrow reusable optional-field readers where appropriate, with explicit per-field adoption.
3. Exercise omitted/empty/sentinel equivalence and meaningful negative checks in affected real parser paths. Preserve required-value, duplicate, malformed and coverage failures.
4. Update module documentation and the documentation index, recording inspected coverage and any remaining deliberate required fields.

All tests run under the required 16 GB/no-swap systemd limit. Verification is scoped to affected parsers and integrations; no live model execution is required.

## Audited coverage

Core and peripheral generation findings are recorded in [server/LLM notes](../../server_llm_notes.md). Changes cover NPC behavioral/no-value descriptors, sparse faction relation lists, starting-technique lists, ability attachment lists, and faction worksheet/proposal lists. Location/region/item/status and mod XML generation were inspected; their other optional fields already accept omission, while meaningful entry identities and mechanics remain required.

The staged/turn audit covers [TinyBrain parsers](../../classes/TinyBrainPromptParsers.md), [resolution plans](../../classes/PlayerActionResolutionPlan.md), the attack-check parser in `api.js`, and conditional no-value fields in [Events](../../classes/Events.md). Optional containers normalize to empty collections; explicit N/A-capable selections normalize to the sentinel. WYWA comparisons preserve actual staged changes while ignoring equivalent no-op representations. Empty affected-need-bar character blocks remain invalid because that contract requires a real change.

Required roots and explicit no-operation response envelopes remain required: omitting an entire answer or actor/decision is different from omitting an optional field. Generic text validators accepting arbitrary strings are not evidence that a substantive field is semantically optional. Existing patch omission semantics and technique failure-cost inheritance remain intact. Native JSON tool schemas and pre-existing JSON-bearing prompt formats are not migrated as part of this XML parser audit.

## Verification evidence

Focused core verification passed 56 distinct cases across real extracted generation/inbound-relation parsers, attachment/starting-technique/faction contracts and correction retries. One stale test fixture needed an explicit editor origin and passed on its targeted rerun. The affected staged/turn batch passed 52 cases across optional TinyBrain fields, attack checks, resolution plans and Events, with additional targeted passes for staged no-op equivalence versus numeric drift, optional exit vehicle type and area-attack secondary selectors. Altered JavaScript and test files passed syntax checks. Runs used the required systemd memory/no-swap limits; no live model calls, game mutation or restart occurred.
