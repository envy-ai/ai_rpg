# Remaining Benchmark Failure Audit Plan

## Purpose and baseline

Audit the failures still present in model-benchmark session `qwen36-35b-a3b-20260812-clean` after EVENT-4 attempt 5. The current aggregate is:

- 148 logical cases and 152 scenario variants executed;
- 131 passing logical cases;
- 134 passing variants;
- 18 failed variants across 17 logical cases;
- 0 infrastructure errors and 0 unrun variants.

This is not a plan to make every result green. It is a plan to use each failure as a diagnostic entry point, identify needless inherited prompt complexity, and simplify TinyBrain orchestration without losing functionality. A case may remain failed when the remaining responsibility genuinely belongs to the selected model.

## Governing principles

1. **Audit necessity before correctness.** At the first failing checkpoint, ask whether the model needed to perform that step at all. Do not begin by adding instructions that make it perform the same step more reliably.
2. **Audit the surrounding prompt, not only the rejected answer.** A failure may be caused by an unnecessary planning phase, duplicate commitment, self-review instruction, tool-call ceremony, or branch-selection burden several checkpoints earlier.
3. **Treat TinyBrain as an interactive program.** The original prompts were monolithic, self-guided prompts intended for frontier models. TinyBrain can use application control flow to ask one focused question, parse it, inspect state, and choose the next checkpoint.
4. **Keep only necessary model responsibilities.** Narrative judgment, ambiguity resolution, and genuinely semantic decisions may remain model-owned. Known facts, target resolution, timing, state transitions, branch selection from parsed values, and deterministic execution should be code-owned.
5. **Do not compromise functionality.** Removing an instruction is valid only when its capability is unnecessary or is explicitly reassigned to code, a parser, a narrower checkpoint, or an existing runtime helper.
6. **Do not overtune to one fixture or answer.** No test-name branches, fixture-specific prompt text, exact benchmark-authored prose, generated-prose regexes, keyword classifiers, or ad hoc dialogue/action detectors.
7. **Prefer fewer decisions over more warnings.** A smaller model benefits more from eliminating a redundant choice than from receiving another rule about choosing correctly.
8. **Validate structured semantics in parsers.** Syntax and mechanically knowable semantic errors should fail the local checkpoint and retry there. Do not ask later prose or tool stages to repair invalid structured state.
9. **Do not ask twice.** If a prior parsed commitment already supplies the needed value, build or execute the result directly. Do not request a final repetition merely to require equality with that commitment.
10. **Do not plan and then force the same tool call.** If an accepted plan contains validated targets, operations, and values, execute it server-side and return the actual results to the retained conversation.
11. **Preserve natural prose.** Human-review prose concerns go to `tmp/prose_issues_log.md`. They become production changes only when they expose a general material contradiction, missing mechanic, or synchronization defect.
12. **Keep diagnostics visible but correctly weighted.** Recovered parser/provider/tool errors remain evidence. Their presence alone is not a failed behavioral contract.
13. **Do not change model routing unilaterally.** Log a routing recommendation with frequency and latency tradeoffs for later discussion; do not use routing as the audit's default remedy.
14. **Allow honest residual failures.** Once a prompt has a necessary, focused responsibility and sound structured boundaries, a bad model judgment may remain an audited failure.

## Required audit record for every failure

Create one section per logical case in `tmp/remaining_benchmark_failure_audit.md`. For ALT-7, retain separate high/low evidence under one shared case section. Each section must contain:

1. Current selected attempt directory and failed assertions.
2. Player input, generated response, relevant tool/check rows, and authoritative before/after state.
3. The earliest point at which expected and actual behavior diverged. Later consequences must not be mistaken for root causes.
4. Every prompt/checkpoint involved between the initiating request and that divergence.
5. A compact control-flow map for those checkpoints:
   - information already known to code;
   - information already committed by an earlier parsed answer;
   - genuinely new model judgment requested;
   - parser output;
   - branch selected by code;
   - mutation or prose consumer.
6. A complexity ledger identifying any:
   - repeated question or repeated commitment;
   - model-generated change/necessity flag code can determine;
   - model-generated target identity code can resolve;
   - planning prose that no later consumer uses;
   - self-review or self-correction instructions better handled by checkpoint retry;
   - tool-call round duplicating a validated plan;
   - final response that merely restates accepted structured values;
   - monolithic conditional better represented by program control flow;
   - mixed mechanics/prose question that can be separated;
   - lookup or context request whose result is already available.
7. Classification of the current failure:
   - grader/fixture defect;
   - game/domain-code defect;
   - parser semantic gap;
   - unnecessary prompt complexity;
   - necessary but unclear prompt responsibility;
   - prose/bookkeeping synchronization defect;
   - retained model judgment failure;
   - mixed, with each contributing cause named.
8. Proposed smallest general change, or an explicit `no change` decision.
9. Functionality-preservation map showing where every removed responsibility goes.
10. Focused tests and benchmark cases affected by the change.
11. Result after one intentional rerun, without sampling repeatedly until a pass appears.

## Audit method

### Phase 1: Establish trustworthy failures

For each selected attempt:

1. Re-evaluate the grader against the public API and current intentional behavior.
2. Replace exact generated-string expectations with semantic state checks only when wording is not authoritative.
3. Check container ownership, derived fields, hidden/private state, history projections, and normal incidental timestamps against their documented contracts.
4. Verify fixture preconditions before interpreting model behavior.
5. Identify assertions made obsolete by an intentional production change, as happened when EVENT-4 began regenerating `shortDescription`.
6. Do not weaken meaningful state, atomicity, actor attribution, timing, ownership, or structured-mechanics assertions.

Deliverable: a confirmed list of genuine failures. Fix and rerun grader defects before prompt audits so prompt work is not driven by false evidence.

### Phase 2: Reconstruct the first divergence

For every genuine failure:

1. Read the complete attempt artifacts rather than the dashboard summary alone.
2. Read each relevant prompt transcript through the first divergence, including failed checkpoint attempts.
3. Record what the model knew at each step and what code already knew.
4. Separate the primary failure from downstream event, need, quest, housekeeping, or persistence consequences.
5. Note whether rollback kept the failed turn atomic.

Deliverable: one evidence-backed root-cause statement per case.

### Phase 3: Perform the necessity and complexity audit

At the failing checkpoint and its surrounding program, ask in order:

1. Can the checkpoint be deleted because its answer is unused?
2. Is its answer already known from game state, configuration, the user request, or an earlier parsed commitment?
3. Can code select this branch from structured state instead of teaching the model all possible branches?
4. Can a broad question become one focused question with a narrow parser?
5. Can the prompt omit documentation for tools or event kinds unavailable in this branch?
6. Can an accepted plan be executed directly instead of being translated into another model tool call?
7. Can the final XML/result be built locally from already validated pieces?
8. Can parser feedback replace self-critique or repeated cautionary instructions?
9. Can mechanics collection be separated from prose generation so neither stage has to preserve both contracts simultaneously?
10. After those removals, is the remaining judgment genuinely semantic and necessary?

Deliverable: a before/after checkpoint graph and a responsibility table. Do not draft new prompt wording until this phase is complete.

### Phase 4: Select the appropriate remedy

Use this priority order:

1. Correct a broken assertion or fixture.
2. Delete an unnecessary checkpoint or unused output.
3. Reuse a prior parsed commitment and skip a duplicate final question.
4. Move deterministic branching, target resolution, or result assembly into code.
5. Execute an accepted structured plan directly.
6. Split a mixed or monolithic checkpoint into focused control-flow stages.
7. Strengthen syntax or semantic validation in the parser.
8. Reduce the surviving prompt instruction to one broadly applicable rule.
9. Fix a genuine domain/API mutation defect.
10. Retain and document a necessary model judgment failure.

A more detailed instruction is not the default response. It must be justified after the earlier remedies are ruled out.

### Phase 5: Prove functionality was retained

Before implementing a simplification, enumerate the supported branches affected by the removed instruction. For each branch, identify:

- its entry condition;
- the old model responsibility;
- the new code/parser/checkpoint owner;
- success output;
- invalid-output retry behavior;
- mutation and rollback behavior;
- standard-prompt parity where applicable;
- at least one positive and one negative deterministic test.

TinyBrain may implement behavior differently from standard prompts, but must broadly retain the same supported functionality. Do not alter non-TinyBrain behavior merely to simplify a TinyBrain path unless the audit proves a shared defect.

### Phase 6: Verify without benchmaxxing

For each justified change:

1. Run syntax and focused parser/runtime tests.
2. Run deterministic strict replay only when the prompt fingerprint remains compatible; an intentional prompt change should invalidate stale replay rather than silently reuse it.
3. Rerun only the affected case or tightly related cluster in `qwen36-35b-a3b-20260812-clean`.
4. Replace the selected result and regenerate the same uniquely named HTML dashboard.
5. Review the new complete evidence even if the case turns green.
6. Record prompt count, failed checkpoint attempts, and eliminated model decisions as diagnostic complexity measures—not as optimization targets that outweigh behavior.
7. Run one intentional live rerun per change set. Do not keep sampling until the model happens to pass.
8. If the case remains red, repeat the architectural audit only when new evidence reveals another unnecessary responsibility. Otherwise retain the failure.

## Work waves

### Wave 0: Grader and fixture contract audit

Audit these before changing production prompts:

- **EVENT-7:** The only current failure is an exact error-message substring (`failed tool invocation`). Confirm the actual HTTP/state/atomicity contract and remove wording dependence if the terminal failure is otherwise correct.
- **QUEST-3:** Determine whether placing the record inside the player's carried satchel is valid ownership or whether authoritative transfer actually failed. Grade the canonical ownership/container contract, not one representation assumption.
- **QUEST-6:** Expand the four changed paths behind the aggregate `stateUnchanged` failure. Determine whether the final wait correctly completed delayed quest bookkeeping, exposed an idempotency defect, or merely violated an overbroad unchanged-state selection.
- **REL-4:** Expand the single changed path. The selected evidence already shows the requested reputation increase, so distinguish a real unsupported extra mutation from an assertion that incorrectly rejects valid consequences.
- **COMBAT-6:** Confirm the intended nonlethal reward contract independently of the prose. The model produced an Incapacitated state, but code awarded defeat XP; determine whether this is domain behavior, fixture expectation, or a structured event-classification problem.

Exit criterion: every remaining red assertion observes an intentional public/mechanical contract.

### Wave 1: Shared player-action check and rejection control flow

Audit together:

- **ALT-7 high and low:** explicit unopposed check requests produced prose but no resolver call, check row, or tool-debug row;
- **ALT-8:** an explicit request to control an absent NPC passed the agency/plausibility gate and reached prose/state processing instead of returning its structured rejection;
- **ALT-9:** an explicit Legendary Strength attempt produced narrative resolution without structured mechanics;
- **ALT-11 pending-roll:** the explicit checked action completed instead of entering the player-input state.

Primary questions:

1. Once the player request or an earlier TinyBrain checkpoint commits to a check, why can the program still reach prose without a corresponding resolver result?
2. Is the prompt being asked both to decide whether a check exists and later to reproduce the already-known check specification?
3. Can control flow route explicit or parser-committed checks directly into focused actor/skill/difficulty questions and then server-owned resolution?
4. Can pending-roll behavior be selected by request/config state rather than left to prose-stage discretion?
5. Which absence, reachability, and actor-control facts can code resolve before the agency judgment, without trying to classify the generated prose?
6. Can the agency checkpoint ask one focused semantic question instead of carrying monolithic instructions for acceptance, rejection, checks, movement, and prose behavior?
7. Once a structured rejection is accepted, can control flow return it immediately without allowing the request into prose, slop, events, or time advancement?
8. Which genuinely ambiguous actions still require the model to decide whether a check or rejection is appropriate?

Preserve voluntary narrative actions that do not require checks, legitimate commands to present/controllable actors, and ambiguous requests that genuinely need a model judgment. Do not infer checks or agency violations by scanning generated prose.

Exit criterion: every structured check commitment either produces exactly one resolver lifecycle or fails/retries before prose; every accepted rejection short-circuits before mutation; and genuinely unchecked or permissible actions remain supported.

### Wave 2: Movement, transfer, consumption, and item-use commitments

Audit together:

- **VEH-2:** prose and events boarded the tram and picked up the case, but authoritative player/companion movement and ownership did not follow;
- **REG-4:** prose and event material described arrival at the new cairn, but player-action movement never committed it;
- **QUEST-3:** record pickup bookkeeping disagreed with the asserted ownership representation;
- **TIME-1:** the tonic turn drifted into travel/time advancement and omitted canonical consumption/application;
- **COMBAT-8:** the healing request derailed into unrelated travel prose with no consumption or healing.

Primary questions:

1. Which action commitments were known from the user request, and which were already parsed before prose?
2. Does player-action ask the model to decide the same movement/item-use fact more than once?
3. Are destination, companion, vehicle, container, item target, duration, and effect facts resolved before prose?
4. Can local result builders assemble movement/transfer/consumption XML from focused parsed answers?
5. Are irrelevant branch instructions or tools still present after a branch is selected?
6. Does a failed branch roll back all time and state, or can downstream event checking partially reinterpret prose?

Do not hard-code the five fixtures or classify prose. Preserve ambiguous travel, optional container placement, ordinary item use, and healing choices where the model actually must choose.

Exit criterion: a committed branch has one authoritative mechanics path, and prose cannot silently substitute a different branch.

### Wave 3: Scheduled-event control flow

Audit together:

- **EVENT-5:** the scheduled event fired after two minutes, but the interruption-rewrite checkpoint exhausted seven attempts and aborted the five-minute action;
- **EVENT-6:** the applicability judgment resolved an event whose named bell and runner had been removed;
- **EVENT-7:** after its grader audit, inspect the invalid-target plan only if the actual terminal behavior is still wrong.

Primary questions:

1. What information does the interruption rewrite need that is not already present in pre-interruption prose, event result, remaining duration, and post-interruption prose scope?
2. Can the rewrite be assembled or constrained through control flow rather than a monolithic instruction asking the model to manage the whole lifecycle?
3. Does applicability ask for planning, current-state recitation, or final explanation that no consumer needs?
4. Can code supply a focused canonical scene/entity snapshot while leaving the semantic applicability decision to the model?
5. Can accepted scheduled plans continue to execute server-side without a redundant tool round?
6. Are retry errors local and state-neutral across partial time advancement?

Do not implement an event-text entity-name matcher or retry until an affirmative answer appears. EVENT-6 may remain a model judgment failure after the prompt is minimal and properly grounded.

Exit criterion: scheduled-event prompts ask only for necessary semantic judgments or prose; lifecycle, timing, execution, and assembly remain code-owned.

### Wave 4: Relationship, faction, and quest bookkeeping

Audit together:

- **REL-1:** prose committed both directed relationships where the scenario intended only one;
- **REL-2:** prose expressed distinct directed views but housekeeping recorded neither;
- **REL-4:** witnessed faction work produced reputation plus possible additional consequences;
- **QUEST-6:** multi-turn quest completion occurred later than the explicit closeout request.

Primary questions:

1. Does housekeeping still inherit monolithic self-guidance for finding changes, deciding directionality, planning calls, and then making calls?
2. Can relationship/faction/quest candidates be collected separately from character-specific updates?
3. Once the model supplies a structured relationship direction/value/reason, can code perform the mutation without asking for a tool call?
4. Is the prompt required to restate already-known current values, actor IDs, or exact target names?
5. Can each character or bookkeeping category be handled in a focused stage with parser-enforced semantics?
6. Are late quest updates caused by missing context, unnecessary deferral, duplicate final questions, or a genuinely ambiguous completion judgment?

Preserve asymmetric relationships, NPC agency, multiple simultaneous changes, valid faction consequences, and delayed quest completion when the story genuinely has not established completion.

Exit criterion: bookkeeping follows material prose and player actions without forcing mutuality, dropping directed updates, or adding benchmark-specific outcome rules.

### Wave 5: Combat outcome ownership

Audit:

- **COMBAT-6:** nonlethal incapacitation and defeat XP diverged;
- **COMBAT-8:** healing never reached its mechanics branch.

Primary questions:

1. Which facts are produced by `resolveAttack` or item/status code and should never be re-decided by event prose?
2. Is `incapacitated`, `dead`, reward eligibility, consumption, and healing application represented once in authoritative structured state?
3. Are event checks being asked to infer a second outcome from prose after mechanics already know it?
4. Does the TinyBrain prompt carry irrelevant combat/scene branches after a nonlethal or healing commitment?

Exit criterion: code owns mechanical outcome/reward eligibility, while the model narrates and detects only facts not already committed.

### Wave 6: Residual model-failure review

After Waves 0–5:

1. Re-list all still-failed variants from the updated aggregate.
2. Confirm each surviving model responsibility is necessary, focused, grounded, and parser-validated.
3. Confirm no surrounding unused complexity remains.
4. Record prose-only concerns in the prose issue log.
5. Mark genuine model judgment failures explicitly rather than adding prompt weight or weakening tests.
6. Log—but do not apply—any slower-model routing recommendation with evidence, frequency, and expected latency cost.

## Implementation discipline after the audit

This document authorizes an audit plan, not automatic implementation of every proposed remedy. For each wave:

1. Present the evidence, proposed responsibility transfer, and functionality-preservation map.
2. Group changes that share one architectural cause.
3. Implement the smallest approved general change.
4. Add parser/runtime tests before live reruns.
5. Update relevant class/API docs and this audit record.
6. Resume only affected benchmark cases so the existing HTML remains authoritative.

Do not combine unrelated prompt rewrites merely because they are in the same benchmark family.

## Completion criteria

The audit is complete when:

- all 18 currently failed variants have a complete audit record;
- every grader/fixture defect is corrected and selectively rerun;
- every production change is justified by a general responsibility or invariant;
- every removed prompt responsibility is mapped to a new owner or shown to be unnecessary;
- supported TinyBrain functionality is enumerated and regression-covered;
- no generated-prose policing or fixture-specific production behavior was added;
- affected results have been selectively rerun and the model-specific HTML regenerated;
- remaining failures are explicitly classified and retained without pass-seeking changes;
- any model-routing recommendations are logged for discussion rather than applied.

The success measure is not zero failures. It is that remaining failures expose necessary model responsibilities or genuine unresolved defects—not avoidable complexity inherited from monolithic frontier-model prompts.
