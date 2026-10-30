# Prompt domain validation inside correction retries

## Objective and acceptance

Response syntax and model-correctable domain errors must be rejected while the owning prompt still has its configured correction attempts. Accepted drafts must pass the same checks that previously failed immediately after completion. Correction replies include the precise error; rejected responses and accepted responses remain logged and audited. Terminal errors retain their cause, cancellation remains terminal, and transport/setup errors do not consume a separate parser budget.

Do not retry state races, missing dependencies, commit failures, image invalidation, notifications, persistence, or postcommit I/O. Pure draft preparation belongs inside validation; applying a prepared draft belongs outside. Existing successful tool receipts and TinyBrain checkpoint ownership remain intact. Use one owning validation budget rather than nesting XML and domain correction loops. Verification uses mocked model transport and no git actions. Activation uses the coordinator's authorized game-only save/restart procedure; Strata and Comfy remain untouched.

## Ownership and implementation sequence

1. Coordinator inventories `server.js` and `api.js`; the main implementation agent owns `server.js` and `Location.js`, starting with new-game inventory generation and other structured generation families.
2. The standalone/API implementation agent owns `api.js`, `StatusEffect.js` and `Events.js`, the focused API/class documentation for those changes, and this plan. Validate complete drafts before returning success, with no registration or world mutation in retry callbacks.
3. The test agent owns regression fixtures and test execution. Start with malformed-but-well-formed responses followed by valid corrections, then verify exhaustion, cancellation/transport propagation, logging, and mutation counts. Run tests under the prescribed 16 GB/no-swap systemd wrapper.
4. Coordinator integrates results, checks syntax on every modified JavaScript file, reviews the exclusions below, and updates the documentation index once.

## Audited standalone families

| Family | Existing seam | Decision |
| --- | --- | --- |
| `status_effect_generate` (`StatusEffect.generateFromDescriptions`) | XML completion ends before source-description, duplicate, required-description, numeric modifier, and duration validation | Move full response parsing into the existing completion's response validator. Validate with unregistered status candidates; allocate IDs only after the full accepted batch. |
| `mystery_thread_check` (`Events`) | `<resolvedMysteries>` completion ends before strict XML/domain parser | Validate and cache parsed resolution data inside completion; mark threads/boxes only afterward. Preserve existing omission/unknown-reference policy. |
| `alter_location` (`Events`) | Root validation ends before nullable location parser | Reject parser failure inside completion correction loop. Apply changes, status effect and image invalidation only after acceptance. Preserve optional alteration fields. |
| `alter_npc` (`Events`) | Root validation ends before nullable character parser | Reject parser failure inside completion correction loop. Apply actor changes and image invalidation only after acceptance. Do not retry application failures. |
| `need_bar_event_checks` (`Events`) | Standard `onResponse` already invoked the domain parser inside completion attempts; TinyBrain final parser validates its own stage | Move standard parsing to `responseValidator` with exact correction feedback and original terminal errors; no additional loop. |
| `event_checks` XML and housekeeping (`Events`) | Shared parse retry helper/TinyBrain checkpoint parser | Already inside a retry boundary; inspect application failures separately instead of broad catch-and-retry. |
| Quest creation (`Events`) | `responseValidator` prepares normalized quest rewards/references before mutation | Already covered. Quest reward presentation runs after rewards and must not reapply rewards on a prose error. |
| `technique_intent` (`TechniquePrompt`) | Shared parse callback validates the operation; authoritative actor-state rejection aborts from `onAttempt` | Already covered. Execution preparation/commit races remain outside. |
| `starting_techniques` (`StartingTechniques`) | Standard parser prepares whole learning batch; TinyBrain validates cumulative candidates before atomic commit | Already covered; preserve staged roster/expansion budgets. |
| Initial faction standings and hostile arrival | Parsers and commit contracts live in standalone modules; prompt orchestration lives in `server.js` | Route orchestration findings to the main implementation agent; runtime revalidation and atomic commits stay outside. |

The standalone rows above are implemented and pass JavaScript syntax checks. Focused regression execution is delegated. The server inventory generation change validates strict item root/kind/count, the whole Thing/mod batch, and scaled metadata candidates inside one outer parse loop, then commits/attaches/equips outside. The broader server inventory is owned and reported by the main implementation agent; unlisted families are not claimed as covered here.

## Audited server families

| Families | Validation before acceptance | Deliberately outside correction |
| --- | --- | --- |
| Character inventory, container contents, location items/scenery | Strict root/item parsing, required counts and seed/roster matches, whole-Thing/mod invariants, final scaled candidate preparation | Thing registration, attachment, container seed clearing, equipment and asset work |
| Location generation and stub expansion | Detached `Location.parseXMLSnippet`, authoritative stub facts, weather/danger fields, faction references/conflicts and new-exit decisions | `commitParsedSnippet`, stub promotion, indexes, region membership and child generation |
| Single/location/region/hostile NPC generation | Existing structured parser plus batch faction, need-bar and registered-field construction preflight | Actor construction, registration, inventory/abilities and learning |
| NPC skill/ability/alias assignments and generated skill lists | Prompt-only strict parsing and expected coverage | Applying assignments and installing skill definitions |
| Exit, entrance, arrival and travel-time selections | Existing parser, expected references and required durations/coverage | Applying travel times, selecting entrances and routing |
| Thing separation and equipment selection | Whole-Thing separation candidates; equipment assignment references | Splitting/replacing Things and equipping actors |
| Live NPC/item/location/region name regeneration | Whole-response mapping/coverage and allowed, collision-free replacement selection | Renaming entities and updating used-name state; existing bounded outer passes remain authoritative |
| Player ability options and NPC level-up | Strict response/actor/level parsing, unique additions and known progression targets inside existing budgets; exact feedback retained | Random progression and ability writes after acceptance; player partial cards remain local |

`Player.prepareNeedBarState` shares the runtime initializer's pure need-state preparation rather than constructing a temporary actor. Older commented-out duplicate NPC-name implementations are not production call sites and were left untouched. Existing region blueprint, initial faction standings, single-Thing generation, alteration and staged technique paths already had response validation boundaries; their commit-time revalidation remains authoritative.

## Audited API families

`completeWithValidatedResponse` is an API-local adapter over one existing `LLMClient.chatCompletion` budget. It composes an existing response validator when supplied, caches the accepted parsed value, and distinguishes successful parsing of a valid empty/null value from a missing validation callback. It enables correction feedback and original terminal errors, without a second parser budget or external transport retry. Rejected responses retain completion-client error logs; accepted responses retain existing family logs.

| Families | Validation before completion acceptance | Deliberately outside correction |
| --- | --- | --- |
| While You Were Away, standard and TinyBrain final result | Character/update parser, required visible arrival prose, response-authored destination references | Missing live candidate identity, invalid authoritative need-bar ranges, mutation, item relocation and history |
| Scheduled interruption rewrite | Action XML and rewritten outcome against original XML | Time advancement and scheduled-event execution |
| Offscreen daily/weekly activity | Activity parser and normalized unique-entry count | Movement, history and metadata |
| Tonal evaluation, mystery cleanup, supplemental story info, game intro | Existing family parser before metadata/history/resolution writes | Persistence, notifications, slop cleanup and application |
| Random-event seeds, summary batches | Nonempty seed set; expected summary count/index parser | Queue/history writes and seed installation |
| NPC queue, disposition, plausibility, memories | Existing parsers; malformed XML propagates; memory/goals/dispositions prepared together | Actor decisions and state writes; existing optional/null results remain valid |
| Region secrets | Strict XML and existing nonblank secret extraction | Assigning secrets; valid empty secrets stay valid |
| Faction inbound relations and autofill | Exact relation mapping; generated merge, normalization and missing-field completeness | Faction construction and persistence |
| Calendar, seasonal image descriptions, setting hide/perception, setting autofill | Existing parsers and normalized hide/perception selection | Installing/persisting settings; existing calendar failure policy |
| Location modification plausibility and degree | Plausibility, base success result, requested degree, strict time parsing, consumed-input multiset, received names and required alteration | Outcome roll, enrichment, consumption/generation, time/history; degree correction retains resolved outcome |
| Craft/location modification narrative | Existing narrative XML parser | Already committed effects and presentation failure policy |
| AI item search/combiner | Search parser; proposed-group eligible references and merge compatibility | Actual merge endpoint; search unmatched-name reporting unchanged |
| Refreshed barter prices | Merchant currency required inside existing outer parser loop | Missing setter is setup; currency/stock application |
| Standard random/NPC/player/creative structured prose | Strict prose/travel/time parser with repair disabled; main player action uses captured turn time | Native calls/receipts, rolls and mutations; callback applies only to tool-free final responses; TinyBrain retains final parser |

These listed API seams are implemented and pass syntax checks; behavioral regression execution is delegated. Root also inspected plain-prose plot summary/expander/improvement, tolerant attack precheck, existing attack-check parser retries, generic questions/freeform and quest-check format calls. They have no identified new postcompletion domain-error seam; no stricter response semantics were invented. Commit-time races, notifications and unlisted families are not claimed as covered.

## Verification

Use deterministic mocked completion responses; no real LLM calls. Check that a domain-invalid but well-formed first response receives correction feedback and the second valid response succeeds, with exactly one final mutation/registration batch. Exhaustion must preserve the last validation cause and produce the existing terminal failure notification/audit. Transport and explicit cancellation must propagate without another parser attempt. Preserve successful sibling/tool work where existing contracts permit it.

Each owner reports the exact files changed, syntax checks, focused test evidence, and any remaining family that needs a separate decision. This inventory records inspected seams and does not claim every downstream mutation method is pure or retryable.

### Completed verification, 2026-10-27

All six changed production JavaScript files pass `node --check`. Every test run below used one outer transient systemd unit with a 16 GB host-memory limit and no swap. Tests use deterministic mocked completions/transport; no live model generation was used.

| Unit | Checks | Result |
| --- | --- | --- |
| `run-u23673.service` | Inventory correction and existing single-Thing generation | 9/9 passed |
| `run-u23750.service` | Domain retry integration, detached Location, Events alterations/status and location persistence/exterior | 17/17 passed |
| `run-u23765.service` | Region arrival selection and calendar setup | 17/17 passed |
| `run-u23777.service` | Craft consumption/container inputs, location modification helpers and XML-event retries | 13/13 passed |
| `run-u23783.service` | Updated domain integration suite, including missing required location weather | 6/6 passed |
| `run-u23840.service` | NPC construction preflight, player ability partial-card correction and NPC progression/ability correction | 3/3 passed |

The final need-bar/progression batch (`run-u23835.service`) retained 3/3 Player need-bar applicability and 7/7 NPC progression passes. Its remaining case-sensitive test matcher was corrected and the affected three-case suite passed in `run-u23840.service`. Other stale VM mocks were updated to invoke the production response-validator contract; calendar assertions now inspect the actual runtime-reset helper. These are overlapping focused batches, not an aggregate distinct-test count.

The bounded read-only review found no concrete correctness defect in the inspected validation/mutation boundaries, including the final ability and shared need-state preparation changes. The audit does not claim live-model behavior or exhaustive coverage of every possible commit-time failure.
