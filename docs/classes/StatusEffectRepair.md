# StatusEffectRepair

`StatusEffectRepair.js` implements the explicit
[`/repair_status_effects`](../slashcommands/RepairStatusEffectsCommand.md)
maintenance operation. It edits canonical character-owned records rather than
reconstructing state from the tooltip's combined active-effect list.

## Selection and ownership

`collectCandidates(actors)` snapshots each character's intrinsic effects and
owned ability attachments once. Missing display fields and wholly
description-only effects are candidates for contextual review. A candidate is
not proof that numeric modifiers are required: valid narrative-only effects
can remain unchanged. Nonempty modifier lists, including explicit zero entries,
are valid data rather than missing fields. Equipped-item and mod-derived
effects remain owned by their existing providers and are not copied into the
character's intrinsic list.

A blank-name, permanent intrinsic effect with no mechanics or technique
provenance is removable as a duplicate only when its description and duration
match exactly one owned ability attachment. Ambiguous matches and independent
mechanics are retained. The owning ability effect is reviewed once, and removal
is staged with its accepted repair.

## Prompt execution

`run({ actors, promptEnv, parseXMLTemplate, prepareBasePromptContext, config,
clientId })` requires a loaded game; `actors` defaults to all registered
characters. It renders `base-context.xml.njk` with
`promptType: 'status-effect-repair'` and compact context for each owning
character: identity, descriptions, level, class/race, actual attributes and
modifiers, skill ranks, and owned ability descriptions. Existing effect XML
carries current mechanics and pinned references.

Standard mode requests at most ten candidates per completion. The response is
`<statusEffectRepairs>` with one `<repair><key>…</key><effect>…</effect></repair>`
per requested transient key. Missing, unknown or repeated keys reject before
mutation. Each validation attempt is logged through `LLMClient.logPrompt()`.

With the effective `status_effect_repair` TinyBrain family enabled, one native
program shares the base context, conversation, queue reservation and log for
the complete candidate list. Each checkpoint requests one `<effect>`; owner
identity and the target effect are already known. Parser failures correct that
checkpoint. A local builder verifies completion without another model request.
Both modes expose no native tools and use normal configured correction budgets;
neither adds an output-token override or falls back to another generation mode.

## Validation and application

[StatusEffectXml](StatusEffectXml.md) validates the complete nested fields.
New mechanic identities must match actual configured actor choices; unchanged
saved identities are retained rather than implicitly migrated.
Existing names, descriptions, durations, populated mechanics, grant identities,
applied-at clocks and provenance remain authoritative. Ability attachments must
be permanent and cannot acquire per-minute need deltas. A normalized
`maxHealthPercent: 0` can be completed only for a wholly description-only review
candidate when its context justifies a missing health mechanic; existing zero
components in populated modifier lists remain unchanged.

All accepted outputs are staged before applying any repair. Source characters,
intrinsic effects, abilities and health are checked for changes while prompts
were processing. Stale state rejects the command. Combined grant validation and
native owner setters preserve saved identities. Changed owners use the native
health-ratio-preserving wrapper; unchanged owners are not rewritten. A failed
commit restores the touched characters' abilities, intrinsic effects and health.
Rollback failures retain the original failure and restoration causes.

The result reports `inspected`, `repaired`, `unchanged`, `duplicatesRemoved` and
`characters`. Normal game saves persist the repaired owner records. The API
interaction stores a durable native count summary, including zero-work runs;
the slash command requests a client refresh and returns no duplicate success
message. Server slash failures use the native persistent error/prompt viewer
with the original backtrace.

Focused coverage is in `tests/status_effect_repair.test.js`,
`tests/status_effect_xml_roundtrip.test.js`,
`tests/repair_status_effects_command.test.js` and
`tests/chat_error_popup_ui.test.js`. The
[implementation plan](../superpowers/plans/2026-11-10-status-effect-repair.md)
records the requested scope and duplicate-removal decision.
