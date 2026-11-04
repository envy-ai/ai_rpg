# Discipline-first technique authoring

## Scope and contract

Replace model-authored sibling `candidateDiscipline` proposals with a shared outer
`discipline` group. An existing parent supplies `disciplineId`; a new parent
supplies `name`, `description`, `accessRequirements` and optional `publicAccess`.
Its `techniques/technique` children contain a catalogue `techniqueId` (optional
attachment revision pin) or a complete `candidate`, without repeated parent ID.
Ability statuses and starting actors contain `disciplines/discipline` groups.
First-use operations contain exactly one group with exactly one child when
authoring; ordinary known-ID operations remain compact.

Decode authoring XML into existing internal candidate/candidateDiscipline DTOs.
Saved games, pending ability drafts, the manual attachment editor and HTTP JSON
contracts remain unchanged. No legacy model-response compatibility branch.

## Ordered work

1. Add shared typed parent/group contracts, strict branch validation and DTO
   translation in `TechniqueXml`; share schemas and complete XML examples.
2. Route attachment and standard starting generation through the shared groups.
   Preserve detached preview and atomic whole-batch preparation/application.
3. Group the TinyBrain starting roster by parent, approve new parent metadata
   once, then expand one child per checkpoint without repeating parent facts.
   Inject that approved parent around the child before shared validation.
4. Route first-use standalone intent, native tool normalization and ordered plans
   through the shared group parser. Native tools retain JSON outer arguments and
   use one `disciplineXml` string for the shared authored XML group.
5. Update focused schemas, templates and documentation. Run syntax checks;
   delegated testing covers shared XML, attachments, starting standard/TinyBrain,
   first-use native/plans and retry identity regressions.

## Acceptance and risks

- Reuse normalized-title canonical disciplines and preserve existing IDs/rules.
- Reject unknown IDs with available canonical alternatives and mismatched parent
  catalogue references; reject sibling authoring and repeated candidate parent IDs.
- Preserve optional-empty scalar handling, explicit false/zero, formula and
  recipe/custom mechanics, failure-cost empty-list semantics and strict fields.
- Recognize/lock first-use attempts before parsing malformed authored parents;
  retain identity and semantic locks, exact correction history and retry budgets.
- First-use executes one child; attachment/starting groups may contain several.
- TinyBrain accepts parents once and validates each child cumulatively; no
  partial catalogue/actor writes or extra model finalization request.
- Implementation/testing agents perform no live runtime calls, save/load operations, process restarts or git actions. The coordinator handles the separately authorized restart and saved-start test afterward.

Implementation status: shared codec, schemas, attachment/starting/first-use routes and event XML adapters implemented. Old model-format fixtures were migrated, without compatibility branches. The final affected test batch passed 130 tests under a transient 16 GB/no-swap systemd scope; all seven changed test files passed syntax checks. Coverage includes repeated parents and staged ID references, canonical metadata, standard/TinyBrain authoring, native/planned first use, and authored-event identity before application and after hydration/rename. Evidence receipt: `tmp/discipline-outer-authoring-verification.json`.

Narrative learning events use the same single-child group. Their native internal command DTO remains unchanged; an engine-owned provenance.operationId carries a deterministic authored-payload fingerprint computed before identity allocation/parent resolution. Re-extraction uses its saved receipt even after a parent rename. Model-supplied operationId is rejected. Known/internal command hashes remain unchanged.

Repeated parent blocks are explicitly allowed: append children in source order using a detached response-scoped parent catalogue, retain canonical metadata and existing technique-level business rules. No legacy model-response branches are added.

Syntax/parse validation: 9 altered JavaScript sources passed node --check; 5 changed Nunjucks templates compiled with the existing TinyBrain extension; 7 authored XML schemas parsed strictly. Nested requirement/effect/grant/improvement-step IDs remain in the candidate mechanics schema; only outer candidate identity/provenance/parent fields are excluded.

## Live acceptance

After the authorized restart, the saved Exis level-3 Luminex setup completed successfully in 22m9s (HTTP 200). The game is at Gate Plaza awaiting starting ability selections; intro execution remains deferred. The response contains four player inventory items, two learned player techniques, five local NPCs and seven local Things. The live catalogue contains seven named disciplines and 34 technique definitions, including `discipline_holo_sorcery` and `discipline_data_analysis`.

Evidence: `tmp/new-game-schema-live-2026-11-01T03-44-50-638Z/response.json` and `receipt.json`; audit `logs/2026-11-01T03-44-50-712Z_turn_prompt_errors_836cfbfb-b924-46dc-a92a-fb92e0130f00.log` (91 logical prompts, 19 logged error occurrences, 168 guarded dispatches, 51 selected corrections, zero guard failures). The progress log contains zero terminal prompt failures. No source changed while the run was active. This verifies startup through the player-choice boundary, not ability selection, intro execution or subsequent event/first-use gameplay; those adapters have focused automated coverage.

After the live run ended, parent `name` and `description` were changed to optional-empty leaves. Missing/empty/whitespace values now behave identically on existing-ID or repeated-name headers, while genuinely new parents still require their metadata. The full focused group suite passed 8/8 after this follow-up, with syntax passing; these counts overlap the earlier 130-test workflow batch and are not additive. Both services were left running to preserve the generated game; only this final empty-header tolerance change awaits the next server restart. The verification receipt records this distinction.
