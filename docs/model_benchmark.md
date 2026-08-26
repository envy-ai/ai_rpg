# Model Benchmark

The model benchmark runs the complete source-controlled follow-up API inventory against one selected model, checks mechanically knowable outcomes, and writes a readable report for human prose review. It covers all 148 logical cases as 152 scenario variants, including the 69 pre-harness cases converted from retained test evidence.

This is an evaluation and bug-finding tool, not a prose benchmark to optimize against. It never grades generated narration with regular expressions, keywords, prose classifiers, or test-specific branches. HTTP contracts, tool attribution, state, structured history, prompt metadata, persistence, and atomicity are mechanical; naturalness and narrative fidelity remain human decisions in the report.

## Commands

Validate and list the complete inventory without starting a server:

```bash
npm run benchmark:model -- --list
```

Run the complete benchmark against one model:

```bash
npm run benchmark:model -- \
  --model "<model-id>" \
  --base-override config.yaml.qwen-combo-router
```

Useful focused forms:

```bash
npm run benchmark:model -- --model "<model-id>" --family COMBAT
npm run benchmark:model -- --model "<model-id>" --case COMBAT-8
npm run benchmark:model -- --model "<model-id>" --case ALT-7-interactive-roll-low
```

Continue an interrupted session, or replace only selected results in a completed session:

```bash
npm run benchmark:model -- --resume <run-id>
npm run benchmark:model -- --resume <run-id> --case EQUIP-1,TRADE-3,QUEST-5
```

With `--resume` and no filters, only scenario variants that have no saved result are run. With `--case` or `--family`, exactly the selected current-manifest variants are rerun; their prior result records are replaced only after each new result is collected, while every unaffected result and the browser-local human review state remain attached to the same run id. The resumed model, manifest, endpoint, and base override must match the original session. A completed session with no unfinished variants requires an explicit filter.

`--family` and `--case` accept comma-separated values and can be repeated. Other options for new sessions are `--endpoint`, `--port`, `--output`, `--run-id`, `--manifest`, and `--no-router-preload`.

## Runtime behavior

The benchmark generates temporary overrides under its output directory. Every base and prompt-specific model route is pinned to the requested model, image generation is disabled, completion recording/replay is cleared, and the local startup script is blanked so the managed game server cannot launch another router. Prompt-progress evidence independently verifies that every prompt used the requested model; a mismatch fails that scenario.

The runner refuses an occupied port rather than stopping an unknown process. It starts the game server without a startup save, groups cases by effective config profile to reduce restarts, and stops the managed server when complete or interrupted. Each scenario restores a disposable copy of its immutable fixture, so one case cannot mutate another case's starting point. A scenario that writes `/api/game-config-override` forces a managed-server restart before the next scenario, preventing its in-memory override from contaminating another case that shares the profile.

Scenario failures do not abort the rest of the benchmark. If the server exits, the current case records an infrastructure error and the server is recreated at the next safe boundary. SIGINT and SIGTERM stop the managed child and preserve the partial report.

## Inventory

`tests/followup_api_playtest/model_benchmark_manifest.json` contains the independent 148-case expectation and discovery roots. Discovery loads both the normal declarative JSON scenarios and `model_benchmark_legacy_scenarios.mjs`, which holds the 69 retained pre-harness conversions. Setup-only scenarios are reported separately and are not benchmark cases.

Manifest loading validates:

- every scenario definition and logical case id;
- zero missing expected cases;
- all `$fixture.*` references;
- every canonical fixture manifest and recursive integrity hash.

NEED-7 and REL-7 are deterministic parser/lifecycle contracts. Their scenario definitions use the constrained `nodeTest` step to run the existing source-controlled Node tests rather than pretending that a live-model response is the correct way to verify deterministic parser behavior.

## Reports

The default output is `benchmarks/model/<run-id>/`:

- `manifest.json`: resolved model, options, expected inventory, selected variants, and fixture hashes;
- `progress.json`: atomically refreshed after every scenario;
- `results.json`: final machine-readable aggregate;
- `airpgbench-<model>.html`: self-contained review dashboard with a filesystem-safe selected-model name;
- `configs/`: generated profile overrides;
- `server-logs/`: managed-server output by profile.

The HTML report shows overall and per-family progress, mechanical failures, prompt models/timing/retries, player inputs, generated narrative evidence, and links to full attempt artifacts. Human checklist items support `approve`, `issue`, and `unreviewed` plus notes. Those choices are stored in browser `localStorage` under the run id and can be exported as JSON.

Logical cases with variants pass only when every selected variant ran and passed. An interrupted logical case with only some variants executed remains `not run`, even if its completed variant passed.

## Post-run assertion audit

The first full-model run exposed several benchmark-definition errors that were distinct from model or production failures. The corrected contracts now:

- inspect gear and effective attribute bonuses through the detailed player-status projection (`inventory[].isEquipped`, `gear`, and `attributeInfo.*.modifiedValue`) instead of expecting derived state on canonical Thing rows or raw base attributes, and accept an unequipped slot as either omitted or explicitly null;
- inspect consumption through structured parsed events rather than requiring an unrelated chat tool call;
- use `metadata.barterOwnerId` for merchant barter stock and the documented omitted `session` on refused haggles;
- match expanded party-member objects by canonical id and recognize tool failures through `metadata.error`;
- distinguish active from completed quest counts, select fixture quests by canonical id and generated offers by stable giver/state rather than a stale outer-array index or model-authored title, and account for level-scaled experience rewards;
- inspect combat continuity through the structured `in_combat` event result because the public player projection intentionally omits private combat state;
- accept canonicalized generated container-content names while still proving exact stack counts and repeat-fetch idempotency;
- compare party atomicity through canonical membership ids and unchanged time instead of expanded actor objects whose incidental `lastUpdated` field can change;
- grade NEED-1 against the mechanically important actor/bar/direction and applied summary rows without hard-coding a model-judged magnitude or rejecting additional need effects permitted by the configured trigger lists;
- establish a health-modifying persisted combat status before setting the exact damaged health, and do not expect the documented `/kill` setup command to synthesize a Deceased status effect;
- grade nonlethal incapacitation by its mechanical contract (`isDead=false`, an `Incapacitated` effect, no kill reward, and persistence) rather than an exact health value, because the event deliberately preserves the health produced by the preceding combat resolution; similarly, do not require a model-invented status literally named `Stabilized` when the configured treatment item guarantees only its canonical `Healed` effect;
- classify the exact `updatePartyMembers` tool-error log prefix in PARTY-6 as deliberate diagnostic output, where four invalid calls are the behavior under test;
- enable plausibility checks in ALT-8's case-owned rejection profile.

Changed `ERROR_*` logs are retained as diagnostic evidence but do not affect benchmark status merely by existing. The compatibility-named `noUnexpectedErrorLogs` assertion always passes and records the complete changed-error-log set plus legacy allowance classifications in triage. A yellow diagnostic section names every changed `ERROR_*` file on the affected HTML report card. The log manifest still reads the complete serialized details line even when an Axios error embeds more than 16 KiB of request configuration, then retains only `attemptNumber`, `maxAttempts`, and `willRetry` rather than copying request data into artifacts. Surrounding response, state, parser-exhaustion, realtime, and infrastructure assertions continue to determine pass/fail, so a terminal failure remains red for its observable contract even though its log file is diagnostic-only.

These changes repair test observability and fixture assumptions; they do not weaken genuine state, synchronization, atomicity, or model-behavior failures. The production defect originally exposed by CRAFT-8 is now fixed: `/api/craft` rejects a harvest request before prompting or mutation unless the selected Thing's authoritative `isHarvestable` value is exactly `true`.

## Adding coverage

Prefer a normal JSON scenario and an immutable copied fixture. Add a JS definition to the legacy module only when shared helpers materially improve a related family. In either form, retain the original mechanical contract and put prose judgments in `humanReview` or `humanReviewNote`.

The `nodeTest` step is intentionally narrow: it accepts only explicit `tests/*.test.js` paths, invokes Node's test runner without a shell, and exposes the result as a named response. It is for deterministic source-controlled contracts, not a fallback for unimplemented live scenarios.
