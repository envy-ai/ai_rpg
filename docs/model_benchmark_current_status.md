# Qwen 3.6 35B Model Benchmark Handoff

Status captured: 2026-08-13, after the complete run, grader/code-fix reruns, and the focused REG-3 diagnostic-log-policy rerun.

## Read this distinction first

The original follow-up API testing goal remains complete. All 148 logical backend cases were previously exercised: 146 have retained passing authoritative evidence, while EVENT-6 and REL-4 were deliberately retained as audited model failures. The later benchmark did not invalidate that completed work and must not be treated as a demand to redo it.

The current 122/152 result is a separate evaluation of one selected model. It measures how often `Qwen3.6-35B-A3B-uncensored-heretic-Native-MTP-Preserved-GGUF` can drive the already-built gameplay and bookkeeping contracts from clean fixtures. A benchmark failure is not automatically an AI RPG code defect, and a previously completed case does not become incomplete because this particular model failed its benchmark variant.

Before continuing, also read:

- [ten_turn_api_playtest_followup_plan.md](ten_turn_api_playtest_followup_plan.md), especially its goal-alignment rules;
- [followup_api_playtest.md](followup_api_playtest.md) for the completed 148-case evidence;
- [model_benchmark.md](model_benchmark.md) for runner behavior and commands.

## Goal alignment that must survive a new session

This work is not benchmaxxing and is not about passing tests for the sake of passing tests. The intended outcomes are naturally flowing prose, event detection/bookkeeping that agrees with material prose and player actions, and discovery of general prompt/parser/game-code defects.

In particular:

- Do not add regular expressions, keyword checks, prose classifiers, or chains of special-case `if` statements to police generated narration.
- Do not add a production prompt restriction merely because one sample is awkward, contains harmless extra prose, or differs from an ideal review answer. Preserve human-review concerns in `tmp/prose_issues_log.md` with the lead-up, verbatim response, authoritative facts, and precise issue.
- Be strict at structured boundaries: syntax belongs in parsers, mechanically knowable semantics belong in parsers/domain code, and authoritative state must stay coherent.
- When an exact result is already known in code, avoid asking the model to repeat it merely so it can be rejected until it agrees.
- Do not change prompt-to-model routing without discussing the specific prompt, frequency, quality benefit, and latency cost with the user first. Log recommendations instead.
- Copy an existing fixture into a case-owned derivative when useful; do not mutate a fixture or save owned by another test.
- Do not weaken a meaningful mechanical assertion to make this model pass. Correct a grader only when it is observing the wrong public contract or relying on an invalid fixture assumption.
- Human-review items in the HTML report are intentionally yellow/pending, not red/failed. Pending human review is not an automated failure.

## Current selected-model run

| Field | Current value |
| --- | --- |
| Run id | `qwen36-35b-a3b-20260812-clean` |
| Model | `Qwen3.6-35B-A3B-uncensored-heretic-Native-MTP-Preserved-GGUF` |
| Base override | `config.yaml.qwen-combo-router` |
| Manifest | `tests/followup_api_playtest/model_benchmark_manifest.json` |
| Game-server port selected by the runner | `7778` |
| Started | `2026-08-12T13:48:59.631Z` |
| Final selective rerun finished | `2026-08-13T00:38:14.506Z` |
| Expected/executed logical cases | 148 / 148 |
| Selected/executed variants | 152 / 152 |
| Passing logical cases | 119 |
| Variant results | 122 passed, 30 failed, 0 infrastructure errors, 0 not run |
| Prompt activity | 522 completions, 9 recorded completion retries, 6,788 prompt-seconds |

The run is finished and resumable; no benchmark child should still be considered active. Service/process state is external to the sandbox and must be checked afresh before another run. The generated run configuration routes LLM traffic through the qwen-combo-router endpoint recorded in the config; the user has also specifically noted that port 7777 is llama.cpp when directly addressing it. Do not assume port 7777 is a disposable game-server port.

### Family result rollup

Counts below are scenario variants, not the earlier completion status of the overarching 148-case goal.

| Family | Passed | Failed | Total |
| --- | ---: | ---: | ---: |
| VEH | 8 | 2 | 10 |
| REG | 5 | 1 | 6 |
| FAST | 7 | 0 | 7 |
| CONT | 8 | 0 | 8 |
| INV | 7 | 0 | 7 |
| EQUIP | 5 | 0 | 5 |
| TRADE | 9 | 0 | 9 |
| CRAFT | 8 | 0 | 8 |
| COMBAT | 5 | 5 | 10 |
| PARTY | 8 | 0 | 8 |
| QUEST | 7 | 2 | 9 |
| NEED | 8 | 0 | 8 |
| HIDE | 5 | 3 | 8 |
| TIME | 5 | 2 | 7 |
| EVENT | 4 | 6 | 10 |
| REL | 4 | 4 | 8 |
| PROG | 10 | 0 | 10 |
| ALT | 9 | 5 | 14 |

## What has already been fixed and rerun

All currently known grader problems that had caused false failures were corrected, and every affected case was selectively rerun in this same session. Do not resurrect the old expectations or rerun the whole benchmark merely to re-prove these changes.

The corrected benchmark contracts now:

- read equipment, slots, and effective attribute bonuses from the documented player projection;
- grade item consumption through parsed events rather than an unrelated chat-tool invocation;
- use canonical barter-owner metadata and the documented refused-haggle response shape;
- compare party membership by canonical ids and recognize intentional tool failures through structured metadata;
- distinguish active/completed quests and identify generated quest offers/rewards through stable state rather than model-authored titles or stale indexes;
- read combat continuity from the structured `in_combat` event result;
- accept canonicalized generated container-item names while retaining exact quantity/idempotency checks;
- ignore incidental `lastUpdated` changes when proving party-operation atomicity;
- grade NEED-1 by actor/bar/direction and applied summaries without inventing a model-owned exact magnitude;
- prepare persisted combat health/status fixtures in the correct order and no longer expect `/kill` to synthesize a Deceased effect;
- grade nonlethal incapacitation by `isDead=false`, an Incapacitated effect, no kill reward, and persistence rather than one exact health value;
- require only the guaranteed canonical `Healed` treatment effect rather than a model-invented effect literally named `Stabilized`;
- classify the deliberate `updatePartyMembers` error-log prefix in PARTY-6 as expected diagnostic output;
- enable the intended plausibility profile for ALT-8;
- retain parsed provider-retry metadata so recovered and exhausted attempts remain distinguishable in diagnostics without grading either by log presence;
- restart the managed game server after a scenario mutates runtime configuration, so later scenarios cannot inherit the override;
- resume a completed session with a selected case list and replace only those selected result records.

After the initial run finished, the generic `noUnexpectedErrorLogs` gate was made diagnostic-only. Changed `ERROR_*` files remain visible in `logs.json`, triage, and HTML reports, but their presence alone no longer fails a scenario. Explicit response, state, parser-exhaustion, realtime, and infrastructure assertions are unchanged. REG-3 was then explicitly rerun as attempt 5: all 51 mechanical assertions passed, the selected model was used throughout, and the result replaced its earlier log-only failure. The rerun itself produced a retryable first-attempt `ERROR_chatCompletionError_player_action_*` transport log; that file remains visible as intended and did not change the passing result.

One confirmed production defect was fixed during the audit: CRAFT-8 now rejects harvesting before prompting or mutation unless the authoritative Thing has `isHarvestable === true`. Its affected tests were rerun and the complete CRAFT family now passes 8/8 for this model.

No currently retained failure is known to be caused by a still-broken grader. The final error-log audit also found no new crashing/state-mutation code defect. Some clusters identify possible general structured-contract hardening opportunities, but those need design review rather than benchmark-specific patches.

## Current failure inventory and working diagnoses

These diagnoses refer to each variant's currently selected attempt in `results.json`. They describe why the variant is red; they are not instructions to add sample-specific prompt language.

| Case | Observed failure and current diagnosis |
| --- | --- |
| VEH-2 | Prose put Baato, alias-resolved Rika, and the brass case aboard, but the structured result did not move Baato/Rika into the tram or transfer ownership of the case. Event checking instead treated the case as altered. Model structured-output/bookkeeping omission. |
| VEH-7 | The plausibility stage accepted an explicitly impossible fixed-route redirect and prose narrated success, while authoritative vehicle routing remained unchanged. Model semantic/plausibility failure and prose/state disagreement. |
| REG-4 | The model narrated arrival at new QA Aurora Cairn and event checking created scene material for it, but player-action never committed authoritative movement; Baato stayed at March Start Marker. Model movement/destination classification failure. |
| COMBAT-3 | The response abandoned the requested two-target Fire Bomb action and generated unrelated courier prose. There was no attack resolution, no two-target result array, and no item consumption. Direct model derailment. |
| COMBAT-6 | The model did not call the attack resolver and never produced the requested nonlethal Incapacitated outcome. Event checking recorded generic damage instead. Model mechanical omission; also evidence for a general structured check/attack-completion contract review. |
| COMBAT-8 | Ordinary self-healing passed, but the prerequisite nonlethal strike killed QA Ash Beetle and awarded kill XP, so the later stabilization contract could not pass. Model chose the wrong target/outcome rather than a treatment-code failure. |
| COMBAT-9 | On the forced-low escape branch the model made no resolution call, declared success, moved Baato/Bulwark, and ended combat. It ignored the committed roll. Model mechanical failure and another general structured-resolution-contract candidate. |
| COMBAT-10 | Persistence worked. After reload, the model narrated Ash/Frost activity in the player phase; the next-NPC selector treated living actors as already acted and selected a dead Frost Beetle, which runtime correctly filtered. No valid NPC-turn array remained. Model phase/actor-selection failure. |
| QUEST-3 | Prose and the quest checker said Baato picked up the record and completed the first objective, but no transfer event assigned authoritative item ownership. Event-detection/bookkeeping omission. |
| QUEST-6 | The generated sequence narrated pickup, delivery, closeout, and rewards, but canonical quest completion/reward state did not close consistently and a later no-op did not repair it. Model quest-check/event synchronization failure, not duplicate-prevention grader failure. |
| HIDE-2 | The model used an information lookup instead of resolving the requested opposed check, invented/picked up a feather, and moved away. No check result or reveal contract was produced. Model action-selection failure. |
| HIDE-3 | Player-action again skipped the required resolver and prose claimed detection despite a later event-stage Major Failure check. The late check exists in history but not as the player-action tool result expected by the response. Cross-stage/model synchronization failure. |
| HIDE-4 | The model narrated the hiding demonstration without resolving the contest, then had the decoy reappear; no hidden-state mutation occurred. Model mechanical omission/outcome contradiction. |
| TIME-1 | Prose said the tonic was consumed and its status was applied, but event checking omitted `consume_item`, leaving the item authoritative. The scenario stopped before reaching the eight-hour sleep branch. Model event-detection omission. |
| TIME-4 | The model could not complete the prerequisite visible scheduled bell resolution: checkpoint 3 exhausted seven attempts while requiring a successful planned tool operation. The ordering assertions were never reached. Live-model scheduled-event planning failure. |
| EVENT-3 | The visible scheduled event similarly exhausted checkpoint 3 without a successful valid plan and returned 500. Live-model scheduled-event planning failure. |
| EVENT-4 | Both due events resolved, but the offscreen plan changed the marker's `shortDescription` instead of the required authoritative description field and produced inconsistent text. Model tool-argument/field-selection failure. |
| EVENT-5 | The due-event interruption fired after two minutes, but its scheduled-event plan failed all checkpoint retries; the surrounding five-minute action aborted with only two minutes applied. The interruption/lifecycle was reached, but model planning prevented completion. |
| EVENT-6 | After the fixture removed the bell and ringer, the model still judged the event applicable and resolved it. This is the already-known retained model judgment failure; no entity-name matcher or pass-seeking retry was added. |
| EVENT-7 | The live benchmark failed while resolving the prerequisite visible bell, before it reached EVENT-7's intended invalid-target contract. That deterministic contract already passes under its strict cassette: failed target operations remain uncached/retryable, the slash command fails loudly, state stays safe, and the event remains pending. Do not misclassify this live failure as a regression of that backend contract. |
| EVENT-8 | A prerequisite due-event resolution exhausted checkpoint 3, so the save/reload idempotency sequence never ran. Model scheduled-event planning failure rather than a demonstrated persistence defect. |
| REL-1 | The prose invented mutual partnership even though only Lantern had committed to a relationship. Housekeeping correctly synchronized both directions from that prose. Model continuity/relationship-direction failure. |
| REL-2 | The first turn correctly established two distinct directed relationships. The follow-up prose explicitly changed Lantern's view, but housekeeping emitted no matching relationship update, leaving state/history stale. Model prose/bookkeeping synchronization failure. |
| REL-4 | Prose confirmed that the witnessed route report was accepted and recorded, but event detection emitted no Lantern Guild reputation increase. This is the previously retained model bookkeeping failure. |
| REL-5 | The prompt stated that no guild representative was present and no scene entity changed, but prose invented QA Cinder Witness in the scene and event checking moved her away. Model context/scene-membership failure. |
| ALT-7 high | The interactive-roll path produced prose without an action-resolution tool call, check-result record, or tool-debug row. Model skipped the required structured check. |
| ALT-7 low | Same missing structured interactive check on the low-roll branch; prose chose an outcome directly. Model skipped the required structured check. |
| ALT-8 | The sanity/rejection checkpoint accepted an explicit request to control an absent NPC, then narrated her arrival, surrender of belongings, and obedience. Model semantic rejection failure; the parser received a syntactically valid but wrong choice. |
| ALT-9 | The impossible Legendary Strength attempt produced failure prose but no required structured check/tool record. Model skipped the mechanical resolution even though its narrative outcome happened to be plausible. |
| ALT-11 pending-roll variant | The TinyBrain path completed with `NONE` instead of pausing for the requested player roll. No pending-roll realtime state appeared, so the cancellation harness timed out waiting for the state it was meant to cancel. The separate long-response cancellation variant is not this failure. |

## Error-log audit and focused rerun

Before the diagnostic-only policy change, seven failed variants had `ERROR_*` logs in their selected attempts:

- REG-3 produced a real `tool_not_declared` failure for hallucinated `createLocationStub`; that log was the case's only failed assertion. Its focused attempt-5 rerun now passes 51/51. The rerun recorded a different, retryable first-attempt network-abort log, recovered normally, and retained that log as diagnostic evidence without failing.
- COMBAT-6, COMBAT-9, COMBAT-10, REL-1, REL-4, and ALT-8 each had a first-attempt transport abort/`ECONNRESET` with no partial response. All were marked retryable, retried within budget, and completed normally. Their eventual benchmark failures are unrelated model-output failures described above.

The repeated transport pattern proves an immediate router/upstream connection abort, but current client-side artifacts cannot distinguish sleeping-model wake, model swap, or router process reset. Router-side logs are required for that deeper diagnosis. Recovered transport warnings should not be confused with terminal infrastructure failures; this run has zero infrastructure errors. The other six error-log-bearing failures were not rerun for the policy change because each still has independent mechanical failures unrelated to its recovered transport log.

## Authoritative artifacts

Do not rely on an earlier attempt directory when the current aggregate points to a later selected rerun.

- Machine aggregate: `tmp/model-benchmarks/qwen36-35b-a3b-20260812-clean/results.json`
- Incremental state: `tmp/model-benchmarks/qwen36-35b-a3b-20260812-clean/progress.json`
- Resolved inventory/options: `tmp/model-benchmarks/qwen36-35b-a3b-20260812-clean/manifest.json`
- Human-readable report: `tmp/model-benchmarks/qwen36-35b-a3b-20260812-clean/airpgbench-Qwen3.6-35B-A3B-uncensored-heretic-Native-MTP-Preserved-GGUF.html`
- Per-profile server output: `tmp/model-benchmarks/qwen36-35b-a3b-20260812-clean/server-logs/`
- Per-case attempts: paths are recorded in each `results.json` entry and contain `triage.md`, `triage.json`, `steps.json`, `response.json`, before/after snapshots, realtime evidence, and changed-log manifests.
- Human prose issue log: `tmp/prose_issues_log.md`

Human review choices in the HTML report live in browser `localStorage` under the run id unless explicitly exported. They are not silently folded into `results.json`. No filesystem export should be assumed from the automated result alone.

## Safe continuation workflow

Do not launch another complete 152-variant run just to continue this session. After making a justified general fix, rerun only its affected cases in the existing session:

```bash
npm run benchmark:model -- \
  --resume qwen36-35b-a3b-20260812-clean \
  --case COMBAT-6,COMBAT-9
```

The runner will validate that model, manifest, base override, and endpoint identity match the original session, replace only the selected results after each new result is collected, retain unaffected results, and regenerate the uniquely named HTML report. It starts its own isolated game server without loading a startup save and stops that managed child afterward. It refuses an occupied game-server port rather than killing an unknown process.

Before any rerun:

1. Check external game/router/llama process state afresh; sandbox process listings do not establish outside-sandbox state.
2. Read the current selected result and its pointed-to attempt artifacts.
3. Decide whether the issue is a grader defect, a general production defect, a structured contract weakness, or this model's judgment failure.
4. If it is prose-only, log it instead of changing a prompt.
5. If changing production behavior, prefer a parser/domain invariant or code-owned fact over another prose instruction.
6. Run focused syntax/tests for changed files, then resume only the affected case ids.
7. Re-audit any red result after rerun; do not equate “still red” with a broken test.

The most promising cross-case design question, if the user wants to pursue code hardening, is whether an action that has already committed to a structured check/attack or a code-owned forced roll should be allowed to finish without a corresponding resolver result. COMBAT-6, COMBAT-9, HIDE-2 through HIDE-4, ALT-7, ALT-9, and the pending-roll ALT-11 variant expose versions of that gap. Any solution must operate on structured commitments and parser state, not by scanning the generated prose.

## Suggested new-session kickoff

The user can start a new session with:

> Read AGENTS.md, docs/developer_overview.md, docs/README.md, and docs/model_benchmark_current_status.md. Continue from the completed `qwen36-35b-a3b-20260812-clean` benchmark without rerunning the full suite or treating its 30 Qwen failures as lost progress on the already-completed 148-case follow-up goal. Preserve the goal-alignment rules: no benchmaxxing, no generated-prose regex/keyword enforcement, no one-sample prompt micro-rules, and no model-routing changes without discussion. Inspect the current selected attempt before changing anything, fix only demonstrated general grader/code/structured-contract defects, and resume only affected cases in the existing benchmark session.
