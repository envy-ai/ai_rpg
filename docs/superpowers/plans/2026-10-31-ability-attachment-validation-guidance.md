# Ability attachment validation guidance

## Scope and acceptance

Audit the actual `ability_attachments` response path, from nested XML parsing through automatic technique validation and detached actor-aware preview. Rejections should identify the offending field/rule and briefly explain a valid correction. Preserve accepted inputs, omission semantics, recipe choices, correction retry/logging behavior, catalogue atomicity, and original error details. Do not add general prompt warnings, error-message classifiers, guessed repairs, or unrelated runtime/lifecycle changes.

This is a moderate shared-validator change: the main risk is accidentally narrowing accepted mechanics or suggesting an invalid alternative. Shared technique errors may improve other authoring flows. Tests should exercise representative complex branches and valid alternatives, including standard/TinyBrain shared parsing and correction feedback.

## Sources and sequence

1. Read the repository/home instructions, developer overview, documentation index, and focused authoring/XML/technique/status/balance/service documentation.
2. Inventory `AbilityAttachmentAuthoring.parseAbilityAttachmentDraft` → `TechniqueXml` → `TechniquePrompt.parseAutomaticTechniqueCandidate`/discipline → `Technique`/`StatusEffect` → `TechniqueService.previewAbilityAttachmentBatch` → actor-aware recipe, formula, catalogue and resource validation.
3. Improve diagnostics at the rule source. Use only narrowly scoped operation wrappers when a lower-level parser needs a field path; retain its original message/cause. Earlier branch checks may replace inevitable later rejection, without introducing new criteria.
4. Add focused regression tests separately, syntax-check edited JavaScript, and update the focused documentation/index.

## Audit inventory

| Reachable rule group | Existing behavior / guidance work |
| --- | --- |
| XML envelope, child-only objects, scalar/amount/list/map shape, unknown/duplicate fields | Preserve strict decoding and optional-empty leaves; explain legal children, scalar/formula alternatives and duplicate removal. |
| Reference versus candidate; existing discipline versus sibling candidateDiscipline | Preserve exclusive reference/candidate branch; explain both legitimate discipline branches and placement. Earlier missing-discipline rejection replaces inevitable preview failure. |
| Server-owned IDs/provenance and fresh revision 1 | Preserve reserved identity policy; tell the author which fields to omit and where catalogue references belong. |
| Permanent outer owner status versus activated/nested status | Preserve duration `-1`, no outer need deltas; direct temporary/activated changes to a granted technique's effect status. No semantic prose classifier. |
| Modifier coherence, duplicate identities, effect/grant IDs | Explain fixed/percentage coexistence and missing magnitudes; combine duplicate nested modifier entries and distinguish effect IDs. Outer StatusEffect modifier duplicates and description-only outer statuses are currently accepted and remain accepted; only nested technique statuses require mechanics. |
| Requirement/check/effect/target discriminators and conditional fields | Enumerated choices are already explicit; improve kind-specific extra/missing fields and use supported shapes without inventing mechanics. Harmful effective-check inheritance guidance is already actionable and retained. |
| Formula syntax, allowed functions, canonical and explicit binding variables | Preserve evaluator grammar, legacy binding support and actor fact resolution; add field-specific syntax/evaluation context and actual available keys/names. |
| Recipes, selector ambiguity/absence, healing/custom damage alternatives | Preserve semantic healing/damage, singleton resolution, target/check limits, numeric-mechanics exclusion, current-policy/snapshot rules; identify eligible choices and valid corrections. |
| Actor catalogue/resource facts and reference revisions | Preserve exact pool ID/direction/capacity, actual skill/attribute names, reference existence and pinned revision checks; report actual supported choices. |
| Aggregate max-health feasibility | Preserve actor preview and its original failure; contextualize review of prospective modifiers. |
| Detached preview and application lifecycle | Existing freshness guidance is actionable. Actor registration, configuration bugs, transport/cancellation, commit/rollback and server lifecycle errors are outside response-repair guidance. |

## Verification

Representative invalid XML must reach the existing rule and return its specific explanation/fix through the existing retry feedback. Valid reference, new/existing discipline, fixed+percentage modifiers, recipe singleton and deliberate custom-damage alternatives remain accepted. No test-only legacy compatibility, server restart, or live LLM call is part of this implementation step.

The final affected seven-suite batch passed 108/108 tests (`tmp/ability-attachment-guidance-tests-final.log`), with 16 GB memory and no swap. Ten focused retry scenarios verify actionable feedback, retained rejected XML, correction budget, prompt logs, and detached actor/catalogue state. All eight changed production JavaScript files and both changed test files passed syntax checks. The separately authorized server/LLM restart and saved Exis new-game run follow these checks.

## Live acceptance

After restarting the game and managed Strata instance, the same saved Exis level-3 Luminex setup completed successfully in 16m43s (HTTP 200). Evidence: `tmp/new-game-schema-live-2026-11-01T02-12-08-688Z/response.json` and `receipt.json`. The completed turn audit is `logs/2026-11-01T02-12-08-749Z_turn_prompt_errors_e36a4276-e4d6-48d4-96fe-e60bc7b30008.log`: 84 prompts, 11 recovered validation occurrences (10 attachment, one inventory), no terminal prompt failures, 103 guarded dispatches, seven selected corrections and no guard failures. Actual attachment corrections included unknown discipline identity, unmanaged healing and an empty mechanical status; subsequent attempts succeeded.

The resulting player has five inventory items and one learned starting technique; Gate Plaza has six Things. Starting ability selections remain pending and the intro is deferred. This verifies generation to the player-choice boundary, not selection or intro execution. The later broad TinyBrain audit was staged separately during this run and applied only after it ended; it did not change the live test's code.

## Follow-up run with tooltip and broader TinyBrain changes

After the separately authorized restart, `new-game-schema-test-7` failed in 11m28s (HTTP 500). Evidence: `tmp/new-game-schema-live-2026-11-01T02-39-39-295Z/response.json` and the turn audit `logs/2026-11-01T02-39-39-383Z_turn_prompt_errors_f9520a65-baba-453d-a5fb-12492aae9baf.log`. All broader TinyBrain changes were active; no source changed during this run.

- The regional NPC pass returned planning prose ending in an empty XML roster, which was accepted. The separate starting-location pass created four NPCs.
- SkyDancer_Sia's Skyward Dive attachment failed seven attempts on the nonexistent `disc_458379201638`. The initial prompt had no existing disciplines and did not contain that ID. Attempts two through seven were identical despite the explicit alternative-discipline guidance and repeated-response reminder. This interrupted NPC attachment setup before that batch's starting-technique phase; player setup continued.
- Player ability option Overclock Pulse then failed seven attempts because it supplied both `candidateDiscipline` and `candidate.disciplineId` with literal value `existing_discipline_id_placeholder_or_none`. The response received the new branch explanation and reminder but did not remove the conflicting field. Game creation stopped during pending player-ability generation, before player starting techniques or intro.

The audit recorded 39 logical prompts, 74 guarded dispatches, 13 selected corrections and no XML guard failures. These results do not constitute a clean new-game pass. Tooltip behavior is separately verified by 17 isolated browser tests, including delayed catalogue hydration, canonical escaped names, and persistent errors for genuinely missing references. At this revision, new discipline allocation used `IdGenerator.next('discipline')`; the large unknown ID above was model output, not an allocated identity.

## Follow-up with title-derived discipline IDs

New disciplines now receive `discipline_<normalized_title>` IDs; equivalent normalized titles reuse a canonical existing record without changing its rules or saved identity. Missing-discipline errors list the actual live or detached staged IDs, including explicit `none`. The affected regression batch passed 116 tests; after a final standalone correction-lock fix, all 13 affected prompt tests passed (overlapping counts, not additive). Evidence: `tmp/named-discipline-id-verification.json`.

The authorized restart and same saved Exis setup (`new-game-schema-test-8`) failed after 6m56s (HTTP 500), before any discipline was installed. Ren's Oracle's Latency attachment exhausted seven attempts; attempts three through seven were identical and used `Holo-Sorcery` as `candidate.disciplineId` without a sibling `candidateDiscipline`. Feedback included `Available discipline IDs: none.`, the valid existing/new discipline alternatives, the rejected XML, and the requested repeated-response reminder. This is not a successful full-game pass or live proof of installing a named discipline.

Artifacts: `tmp/new-game-schema-live-2026-11-01T03-04-48-001Z/response.json`; final response/feedback `logs/2026-11-01T03-11-44-342Z_ability_attachments_ability_attachments.log`; turn audit `logs/2026-11-01T03-04-48-063Z_turn_prompt_errors_045321c8-e250-4921-b6cb-21e41621a427.log` (24 prompts, 41 guarded dispatches, five selected corrections, no guard failures). Regional NPC setup aborted during attachment authoring, before starting-location or player-technique setup. Both services were left running.

## Implementation record

- Updated the rule sources in `AbilityAttachmentAuthoring`, `TechniqueXml`, automatic `TechniquePrompt` parsing, `Technique`, `StatusEffect`, `TechniqueBalancePolicy`, `TechniqueService` and shared `technique-formula-variables`.
- Added explicit earlier missing-discipline and recipe/numeric-field diagnostics only for inputs already rejected later. No new accepted/rejected mechanic, actor identity, omission, affordability or retry rule was introduced.
- Retained original evaluator/domain messages and causes in narrow XML, candidate/discipline, status/entry and prospective-ability validation wrappers. Maximum-health advice is conditional because prospective normalization may reveal other existing data errors. Catalogue-wide checks distinguish authored correction from repair of existing catalogue state. Optional revision omission is described only for outer attachment entries, not nested grants.
- All eight changed JavaScript files passed `node --check`. Focused behavioral regression execution is owned separately by the testing agent/coordinator and is recorded with the final task verification.
