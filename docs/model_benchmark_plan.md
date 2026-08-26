# One-Command Model Benchmark Plan

Implementation status: complete. The runner now discovers 148 logical cases as 152 variants, including all 69 retained pre-harness conversions, validates their immutable fixtures, pins one selected model, manages the isolated server lifecycle, and writes incremental machine/human reports. A post-run audit corrected test-only projection/fixture assumptions, added restart isolation after runtime config mutation, and added resumable sessions with selected-case result replacement. Operational usage is in [model_benchmark.md](model_benchmark.md).

## Objective

Build a one-command backend benchmark that runs the source-controlled follow-up API scenarios against one selected live model, automatically grades mechanically knowable behavior, and produces a self-contained report for human review of prose and other judgment-based outcomes.

The benchmark is an evaluation tool, not a new gameplay test definition. Existing scenarios, fixtures, profiles, and cassettes remain immutable. It runs each scenario from a disposable fixture restore, uses the scenario's existing mechanical assertions, and aggregates the resulting evidence without adding prose matching or test-specific production behavior.

## Starting inventory and completed conversion target

The completed follow-up audit contains 148 logical backend cases, but the declarative harness was introduced after testing began. At the start of this implementation the repository had:

- 83 runnable behavioral scenario files representing 79 logical cases;
- multiple independent variants for some logical cases, including ALT-7 and EVENT-2;
- eight fixture-construction scenarios, which prepare canonical assets and are not benchmark cases;
- 69 logical cases with retained historical evidence but no declarative scenario.

This implementation also converts those 69 retained cases. Each conversion copies its historical source save into a new immutable canonical fixture (or reuses an already-canonical fixture), translates the retained request sequence, and carries the old mechanical contract into declarative assertions. It does not mutate a save, fixture, scenario, or cassette owned by an earlier test. The completed benchmark target is therefore all 148 logical cases, represented by 152 or more independent scenario variants.

The report still treats any future inventory gap explicitly. A case with no runnable scenario is `not automated`, never a model pass, model failure, or skipped success. Adding a new scenario later increases executable coverage automatically without changing benchmark orchestration code.

## Command contract

The primary command will be:

```bash
npm run benchmark:model -- \
  --model "<model-id>" \
  --base-override config.yaml.qwen-combo-router
```

Defaults:

- manifest: `tests/followup_api_playtest/model_benchmark_manifest.json`;
- base override: `config.yaml.qwen-combo-router`;
- port: `7777`;
- output: a timestamped directory under `benchmarks/model/`;
- image generation disabled;
- live verification only, with no completion recording or forced-output cassette;
- managed game-server lifecycle, with no startup save;
- stop the managed server at completion or interruption.

Optional filters will support a family or exact logical case for smoke testing without changing the manifest. A list-only mode will validate and display coverage without starting the server or model.

Implemented continuation semantics use `--resume <run-id>`. An unfiltered resume executes only variants without a saved result; a filtered resume reruns those exact current-manifest variants and atomically replaces their result records without erasing unaffected results or changing the report/localStorage identity.

## Manifest and discovery

Add one source-controlled versioned manifest that declares:

- the scenario directories to discover;
- the complete expected logical case ranges from the 148-case plan;
- case-id extraction rules;
- optional known audited model failures for report context;
- setup-case exclusion through the absence of a canonical `PREFIX-N` case id.

At startup the runner will:

1. Recursively discover JSON scenarios in the declared directories.
2. Validate each scenario with the existing scenario validator.
3. Extract its logical case id from the scenario's case name.
4. Reject duplicate scenario paths and unknown logical case ids.
5. Group runnable scenarios by config profile to reduce server restarts while keeping each fixture restore independent.
6. Compute expected logical cases without a runnable scenario and carry them into the report.

Discovery is preferable to copying the full 83-file inventory into a second list that can silently go stale. The expected-case ranges provide the independent completeness check.

## Model and configuration isolation

For every config-profile group, create a temporary YAML override under the benchmark output directory by merging:

1. the selected base override;
2. the scenario's existing config profile;
3. benchmark-only values.

Benchmark-only values will:

- set `ai.model` to the selected model;
- set the router preload model to the selected model unless explicitly disabled by CLI;
- rewrite the model field of every named `ai_model_overrides` profile found in the normal config or selected base override so prompt-specific routing cannot escape the benchmark model;
- optionally rewrite the base and prompt-specific endpoint when `--endpoint` is provided;
- clear `ai.local_startup_script_path` so the benchmark does not launch a second router;
- disable image generation;
- clear completion recording/replay paths.

The report will independently inspect every prompt-progress record and flag the scenario as an invalid benchmark result if any live prompt reports a model other than the requested model. State-only scenarios may legitimately contain zero prompts.

No checked-in runtime configuration or production model-routing rule will be edited.

## Server orchestration

The runner will manage one child game server per distinct effective scenario profile:

1. Fail clearly if the requested port is already occupied; do not kill an unknown server.
2. Write the group's temporary override.
3. Start `server.js --config-override <file> --port <port>` without loading a save.
4. Capture stdout/stderr to a group-specific log.
5. Wait for the HTTP server to become ready or fail with the child exit/log path.
6. Run all scenarios in that profile sequentially through `runScenario(..., mode: "live-verify")`.
7. Stop the child gracefully before switching profiles.

If a scenario mutates `/api/game-config-override`, the runner stops that child immediately after recording the scenario and starts a clean process before the next case, even when both cases use the same profile.

Each scenario continues to restore and remove its own disposable fixture. A scenario failure is recorded and the suite continues. If the server exits, the current scenario is an infrastructure failure and the group server is restarted before later scenarios.

SIGINT/SIGTERM handling must stop the managed child and still write the latest partial JSON/HTML report.

## Mechanical grading

The existing scenario runner remains the source of truth for:

- HTTP response contracts;
- state deltas and no-mutation guarantees;
- entity identities and fields;
- history entry types and sequencing;
- tool/check cardinality and attribution;
- realtime errors and prompt cleanup;
- persistence and reload behavior;
- changed error logs as conspicuous diagnostic evidence, without using their mere presence as a pass/fail signal.

Per-scenario mechanical states:

- `passed`: every declared assertion passed and the requested model was used by every live prompt;
- `failed`: one or more declared mechanical assertions failed;
- `infrastructure error`: server/config/transport/setup failure prevented a valid evaluation;
- `not automated`: expected logical case has no runnable scenario;
- `not run`: runnable scenario omitted by a filter or interrupted before execution.

Known historical model failures remain annotations only. A new run is graded from its actual result.

## Human-review evidence

For every executed scenario, collect:

- the scenario's `humanReview` checklist and inline `humanReviewNote` entries;
- user-facing chat/history entries added during the scenario, found by comparing before/after history ids;
- relevant direct response prose not already represented in added history;
- player inputs from chat steps;
- prompt labels, actual model, duration, retries, and failure state;
- links to the full scenario artifact directory and server log.

Do not automatically score prose. The HTML report will provide persistent browser-local checkboxes for each checklist item, with `approve`, `issue`, and `unreviewed` states plus an optional reviewer note. Review state will be exportable as JSON without modifying saves, scenarios, or configuration.

The report must escape all generated content and render long prose in readable pre-wrapped blocks. Diagnostic/tool rows can be collapsed by default while visible narrative rows remain prominent.

## Reports and interruption safety

Write into `benchmarks/model/<run-id>/`:

- `manifest.json`: resolved suite/model/options/coverage;
- `progress.json`: atomically updated after each scenario;
- `results.json`: final machine-readable aggregate;
- `airpgbench-<model>.html`: self-contained human-review dashboard with a filesystem-safe selected-model name;
- `configs/`: generated temporary overrides;
- `server-logs/`: one log per profile launch.

Regenerate `progress.json` and the model-named HTML report after each case so an interrupted multi-hour run remains useful.

The HTML dashboard will include:

- selected model and run metadata;
- overall mechanical and executable-coverage progress bars;
- aggregate prompt count, retries, prompt time, and wall time;
- filters for family, mechanical state, and human-review state;
- one section per family and one expandable card per scenario;
- a separate list of logical cases not yet automated;
- human-review controls saved in `localStorage` under the run id;
- a button to export human decisions and notes as JSON.

## Implementation layout

- `scripts/model_benchmark.mjs`: CLI and high-level orchestration.
- `scripts/lib/model_benchmark/manifest.mjs`: manifest loading, scenario discovery, validation, filtering, and coverage.
- `scripts/lib/model_benchmark/config.mjs`: benchmark-only config generation and model override enforcement.
- `scripts/lib/model_benchmark/server.mjs`: child lifecycle, readiness, logging, and signal-safe shutdown.
- `scripts/lib/model_benchmark/report.mjs`: artifact extraction, aggregation, HTML escaping/rendering, and atomic report writes.
- `tests/followup_api_playtest/model_benchmark_manifest.json`: expected-case ranges and discovery roots.
- `tests/followup_api_playtest/model_benchmark_legacy_scenarios.mjs`: declarative conversions of the 69 retained pre-harness logical cases, with related shared helpers and no cross-case mutable state.
- `tests/model_benchmark.test.js`: deterministic manifest/config/report/server-helper coverage without contacting a model.

## Verification

Before completion:

1. Syntax-check every new module.
2. Validate the real manifest against every discovered behavioral scenario.
3. Assert the converted inventory resolves to all 148 executable logical cases with zero non-automated cases; retain the original 79/69 split in this plan as historical implementation context.
4. Unit-test model override rewriting, HTML escaping, result aggregation, model-mismatch invalidation, filters, and partial-report generation.
5. Run list-only and a report-only synthetic smoke test without starting the game or llama.cpp.
6. Validate every promoted fixture and every scenario definition without starting a model.
7. Run the existing follow-up harness suite to ensure orchestration additions do not alter scenario behavior.

A full 148-case live benchmark is intentionally not part of implementation verification because it is the expensive operation this tool is being built to launch on demand.
