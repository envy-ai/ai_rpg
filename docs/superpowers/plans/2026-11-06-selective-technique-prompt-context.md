# Selective technique prompt context

Implementation follows the approved main-action and eligible event-authoring
flows below. Focused integration verification is owned by Terra; no live model
calls or game-state changes are part of this implementation check.

## Intended behavior

Character blocks list their owned/equipped/status-granted techniques as Markdown
inside `<techniques>`, using `* Name - shortDescription`. Legacy missing summaries
retain the name alone. Include blocked identities, without silently truncating
actors, techniques or sources. Keep full mechanics in authoritative services.

Remove the unconditional global technique JSON and main-action authoring JSON.
Do not substitute another global mechanics dump or change immutable receipts.

## Implementation sequence

1. Reuse the native learned/equipment/status identity union for lightweight
   actor summaries; embed a shared list partial under player, NPC and party.
2. Add a shared strict selection parser and authoritative readable XML detail
   renderer. Resolve exact names, aliases and IDs; reject ambiguities with
   concrete correction choices. Unknown `use` is an error. Only explicit
   `discover` permits an unrecognized proposed technique and authoring facts.
3. Add a no-tools selection checkpoint before each existing TinyBrain main-action
   resolution plan. Its post-parse hook retains server-generated facts before
   mechanical planning; the model never repeats known mechanics or statistics.
4. Add the equivalent read-only `getTechniqueDetails` native tool for standard
   main-action conversations. Preserve existing execution, target/source pins,
   resource checks, novel authoring, cancellation and receipt behavior.
5. Keep starting generation, attachment and targeted standalone NPC authoring
   self-contained. For event learning/improvement/evidence, TinyBrain selects
   before each stage permitting `techniqueChange`; standard XML and legacy paths
   make one preparation selection when authoring is eligible. Skip tracker,
   transit and ignored categories, and bind actors to the supplied section/origin
   context. Render only selected facts using the shared detail renderer.
6. Update focused documentation and test actual base placement/escaping, strict
   selection, ambiguity, discovery, source/blocker detail, standard tool transport,
   TinyBrain retained messages and event/starting/NPC parity.

## Boundaries

No save migration, prompt output caps, bulk generation, silent fallback summary,
new dice/mechanics engine, live game mutation or server restart. The existing
reviewed short-description backfill remains unchanged. New structured selections
use child-only XML and native prompt logging/retry ownership.

Selected detail must include canonical IDs, full description, all relevant sources
and pins, availability/blockers, exact costs/failure costs, formulas, checks and
effects. Selected actor authoring facts retain qualification, actual formula
variables, resource profiles, weapons and utility choices; public catalogue reuse
must remain possible without dumping every catalogue definition's full mechanics.

## Verification owner

Terra owns focused Node/browser regression tests; the coding agent runs syntax and
template/schema checks. The coordinator owns integration, consumer audit decisions,
acceptance and any later authorized runtime restart.
