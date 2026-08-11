# Follow-Up API Playtest Acceleration Implementation Plan

## Status

Implemented on 2026-08-10. The operational guide is [followup_api_playtest.md](followup_api_playtest.md); this document remains the design rationale and rollout plan.

Implemented scope includes the strict version 2 logical-completion cassette, recording/replay API, declarative scenario runner, persistent realtime handling, mechanical assertion/triage library, immutable fixture promotion/runtime-copy flow, inherited config profiles, package commands, and the VEH-7 fixed-route vertical slice. The focused cassette/harness/parser/player/result/API tests and completed 35-entry VEH-7 cassette are source-controlled. Final live-record, strict no-llama replay, and independent live-Qwen evidence is recorded in the operational guide and `progress.md`.

This plan supplements [ten_turn_api_playtest_followup_plan.md](ten_turn_api_playtest_followup_plan.md). That document remains authoritative for scenario coverage and behavioral acceptance. This document changes how failures are reproduced, diagnosed, fixed, and reverified.

The harness was introduced mid-goal. Cases that already passed through the original backend API workflow remain complete and do not require retroactive scenario, fixture, or cassette conversion. Apply this workflow to remaining cases and to newly discovered defects when it reduces iteration cost.

## Non-negotiable testing rules

1. Do not add regular expressions, keyword searches, dialogue detection, prose classifiers, or ad hoc `if` statements to decide whether generated prose followed a narrative instruction.
2. Automated assertions may inspect structured responses, parser output, authoritative game state, HTTP behavior, event records, prompt/checkpoint metadata, and persistence. Narrative quality remains a human-review item.
3. A recorded completion replay is never final acceptance for model-dependent behavior. Every bug fixed through replay receives at least one final live run with the intended Qwen/router configuration.
4. Replay must be strict. A missing response, extra prompt, changed prompt fingerprint, exhausted cassette, or unused cassette entry fails explicitly; it must never fall through to a live provider request.
5. Live gameplay scenarios remain serial because they share singleton game state and GPU/model lifecycle. Only isolated Node tests and artifact analysis may run concurrently.
6. Do not resume a persisted gameplay turn in the middle of a prompt after a code/server restart. Recreate the whole turn from its pre-case fixture and replay its recorded logical completions.

## Why this should materially improve the loop

The 97 recorded vehicle-playtest attempts consumed roughly 80 minutes:

- 28 `/api/chat` calls consumed about 50 minutes and averaged about 107 seconds;
- other model-backed generation/setup calls consumed about 29 minutes, including several three-to-eight-minute fixture expansion calls;
- save loads averaged about 1.8 seconds;
- log-manifest collection was negligible.

The primary target is therefore model-backed work repeated after a failure has already been reproduced. Save restoration and ordinary artifact writing should remain intact unless later measurements show a regression.

The intended loop is:

```text
one isolated live reproduction and completion recording
    -> strict deterministic turn replay
    -> focused parser/domain/API regression test
    -> code/test iterations without a live model
    -> one isolated live Qwen verification
```

Most mechanical bugfix iterations should take seconds. The final live verification is expected to retain its existing latency.

## Existing foundations to reuse

The implementation should extend existing facilities rather than create a competing test stack:

- `LLMClient.chatCompletion(...)` already supports response-shaped `forceOutput` values, including tool calls, and strict `LLM_FORCE_OUTPUTS_FILE`/`ai.force_outputs_file` fixtures.
- Existing forced-output fixtures already fail on missing or exhausted label buckets and support ordered repeated labels.
- `LLMClient` already normalizes streamed, non-streamed, bridge, forced text, and forced tool-call responses into one OpenAI-compatible shape.
- `scripts/followup_api_playtest.mjs` already records requests, responses, before/after state, realtime events, and changed-log manifests without imposing a client response deadline.
- The gated Playwright playthrough regression already copies a known save, installs a forced-output fixture, disables unrelated systems, and runs deterministic turns.
- Focused parser, TinyBrain runner, event, player-action result, vehicle, and API tests already demonstrate dependency injection or temporary `LLMClient.chatCompletion` substitution.

Replay will not test SSE framing, router loading, sampled-token live deslop, XML repetition stream interruption, prompt cache behavior, or provider-specific generation. Those retain focused transport tests and final live coverage. In particular, forced output is intentionally incompatible with `onStreamToken`, so live-deslop failures cannot be declared fixed from a cassette replay.

## Proposed components

### 1. Versioned logical-completion cassettes

Add a small cassette implementation, preferably in a dedicated `LLMCompletionCassette.js`, and integrate it at the logical `LLMClient.chatCompletion(...)` boundary.

Use the existing forced-output fixture path for playback. Add a test-only recording destination such as `LLM_RECORD_OUTPUTS_FILE`; configuring recording and forced playback simultaneously must throw before the first request.

Introduce a backward-compatible version 2 fixture shape:

```json
{
  "version": 2,
  "strict": true,
  "description": "VEH-7 off-route redirect live reproduction",
  "entries": [
    {
      "ordinal": 1,
      "metadataLabel": "player_action",
      "requestFingerprint": "sha256:...",
      "requestSummary": {
        "messageRoles": ["system", "user"],
        "toolNames": [],
        "model": "..."
      },
      "response": {
        "model": "...",
        "choices": [
          {
            "index": 0,
            "finish_reason": "stop",
            "message": {
              "role": "assistant",
              "content": "..."
            }
          }
        ]
      }
    }
  ]
}
```

Keep the current unversioned/by-label format working unchanged. Version 2 uses one ordered trace because a turn can invoke the same metadata label repeatedly across TinyBrain checkpoints, retries, and tool rounds.

#### Request fingerprint

Build a stable semantic fingerprint from:

- normalized metadata label;
- provider-visible conversation messages after internal section-boundary expansion but before cachebuster injection;
- assistant prefill;
- tool definitions and tool-choice policy;
- effective model/backend family and stable response-affecting settings;
- validation mode and required structured-output contract where it affects which logical result is returned.

Exclude secrets and intentionally unstable transport data: API keys, authorization headers, request/client IDs, timestamps, generated cachebusters, connection headers, and automatically generated seeds. Store only the hash plus a compact diagnostic summary in a promotable cassette. Full prompt text remains available in ordinary prompt logs and temporary live-run artifacts.

Use canonical JSON serialization with recursively sorted object keys while preserving array order. Hash data URLs rather than copying them into the summary.

#### Recording behavior

- Record each logical completion that returns to its caller, not every low-level SSE chunk or failed HTTP attempt.
- Preserve normalized assistant content, tool calls, finish reason, and model. Tool calls must execute normally during replay so downstream tool-loop and state behavior are exercised.
- Record every TinyBrain parser-level attempt because each is a separate logical completion call.
- Write after each completed logical call using a same-directory temporary file and atomic rename so a terminated live run retains all completed entries.
- Serialize writes and fail if concurrent recordable completions make ordering ambiguous. The isolated playtest configuration should disable unrelated background prompts before recording.
- Never record headers, API keys, or raw provider request objects containing secrets.
- Finish the recording with a completeness marker only after the scenario request settles. An incomplete cassette may be retained for diagnosis but cannot be promoted as a replay fixture.

#### Replay behavior

- Consume version 2 entries in global ordinal order.
- Before returning an entry, require the actual metadata label and semantic request fingerprint to match it exactly.
- Preserve the existing normalization, XML/regex validation, callbacks, prompt statistics behavior, and tool-call handling applied to ordinary forced outputs.
- Throw on an extra prompt, missing entry, exhausted trace, malformed response, or incomplete cassette.
- At scenario completion, assert that every entry was consumed. Expose a test helper or status method so the runner can enforce this explicitly.
- Do not permit a strict mismatch to use a legacy label bucket or contact a provider.

Transport-level bugs are outside this logical cassette. Reproduce those with focused `LLMClient` tests that mock Axios, SSE chunks, router responses, or bridge output.

### 2. Declarative scenario runner

Refactor reusable HTTP, state-capture, realtime, artifact, and attempt-directory functions out of `scripts/followup_api_playtest.mjs` into `scripts/lib/followup_api_playtest/`. Preserve the existing one-command operations while adding a `scenario` command.

Store source-controlled scenario definitions under `tests/followup_api_playtest/scenarios/`. Use versioned JSON and a deliberately small schema rather than arbitrary JavaScript evaluation. For example:

```json
{
  "version": 1,
  "scenario": "vehicle",
  "case": "VEH-7-off-route",
  "fixture": "vehicle-underway",
  "configProfile": "vehicle-mechanics",
  "trackedEntities": ["$fixture.playerId", "$fixture.tramId"],
  "steps": [
    { "type": "loadFixture" },
    {
      "type": "chat",
      "text": "Redirect the tram to the off-route destination.",
      "interactive": { "roll": null, "questAccepted": false }
    },
    {
      "type": "assert",
      "assertions": [
        { "type": "httpStatus", "equals": 400 },
        {
          "type": "stateUnchanged",
          "paths": [
            "player.locationId",
            "tracked.tram.vehicleInfo",
            "calendar.totalMinutes"
          ]
        }
      ]
    }
  ],
  "humanReview": [
    "No visible prose claims that an off-route redirect succeeded."
  ]
}
```

The exact expected status should follow the route's documented error contract when VEH-7 is converted; the example is not a decision to force HTTP 400 specifically.

Supported step types should initially be limited to:

- `loadFixture`;
- `snapshot`;
- ordinary `request`;
- `chat` with deterministic interactive-response policy;
- `save` and `reload` for persistence checks;
- `assert`;
- `humanReviewNote`.

Unknown step or assertion types, unknown fields, unresolved fixture variables, and missing response policies must throw during schema validation before the scenario mutates state.

Open one realtime WebSocket before the first interactive step and retain it for the scenario. Correlate events by generated request ID and keep the current behavior of answering forced rolls, confirmations, and quest confirmations explicitly. Do not add a client-side request deadline.

Modes:

- `live-record`: require a real model, create a version 2 cassette in the attempt directory, and mark it complete only when the scenario settles;
- `replay`: require a complete cassette, prohibit outbound model transport, and run all mechanical assertions;
- `live-verify`: prohibit forced output, use the production target model/configuration, and produce final evidence;
- `state-only`: execute API/setup/persistence steps that do not invoke an LLM.

There must be no implicit mode selection and no live fallback from `replay`.

### 3. Structured assertions and automatic triage

Add an assertion/diff library under the same harness library directory. It should produce both machine-readable `triage.json` and a short `triage.md` in every attempt directory.

#### Mechanical assertion vocabulary

Start with a compact set that covers the follow-up plan:

- HTTP status/success/error shape;
- equality, inequality, existence, absence, count, and membership at an explicit object path;
- before/after equality or exact numeric delta at an explicit path;
- entity location, ownership, containment, party membership, health, hostility, quest state, and vehicle state through canonical IDs;
- chat-entry/event-summary/check-result/tool-invocation counts and structured metadata;
- exact world-time delta and `timeProgress` agreement;
- save/reload persistence equality for selected paths;
- no duplicate entity IDs or event IDs;
- no realtime harness-response errors;
- no unexpected `ERROR_...` prompt logs.

Do not implement a general expression evaluator. Use validated assertion objects and a narrow path resolver. Numeric values must be compared as authored; this work is not authorization to clamp them.

Free-form prose may be preserved for human review, but the assertion engine must not search it for required or forbidden wording. It may mechanically assert that the expected visible entry type exists and is linked to the correct turn or event.

#### Triage report contents

Automatically summarize:

- scenario, case, attempt, mode, fixture, cassette, and effective configuration profile;
- per-step and total duration;
- response status and structured error/backtrace;
- failed assertions first, then passed assertions;
- changes to tracked player, location, thing, NPC, quest, vehicle, calendar, and history metadata;
- added/removed chat entry IDs grouped by entry type without judging prose wording;
- prompt labels, progress-group IDs, checkpoint attempts, retries, and elapsed prompt time from realtime events;
- changed log filenames and the path to the most relevant error log;
- cassette entries consumed, remaining, and first mismatch when applicable;
- a final human-review checklist copied from the scenario.

Keep the complete before/after snapshots currently written by the harness. The focused report is an index, not a replacement for evidence. Do not delete or truncate source logs.

### 4. Canonical fixture promotion and reuse

Stop paying model-generation costs on every replay.

For each scenario family:

1. Run the documented `@@ QA FIXTURE SETUP ONLY` command once through the live model.
2. Validate all tool invocations and resolve every canonical entity ID through the API.
3. Run explicit fixture invariants before promotion.
4. Save the fixture under a scenario-specific name.
5. Promote an immutable test copy plus a manifest under `tests/followup_api_playtest/fixtures/<fixture-name>/`.

Each manifest should contain:

- schema version and fixture name;
- source setup command and creation date;
- canonical player, location, region, NPC, thing, quest, and vehicle IDs used by scenarios;
- expected starting world time and selected invariant values;
- required mods and configuration profile;
- save format/source and integrity hash;
- fixture validation results.

Add a `promote-fixture` command that validates before copying and refuses to overwrite an existing fixture unless given an explicit replacement flag. The command should not silently repair setup drift.

At runtime, copy the canonical fixture to a uniquely named temporary autosave, adjust only the copied metadata required by the loader, and load it through the normal API. Every variant restores that temporary fixture. Keep `@@` creation itself as a separate live fixture-provenance test; behavior regressions should not rerun it.

### 5. Explicit minimal configuration profiles

Define source-controlled profile declarations under `tests/followup_api_playtest/config_profiles/`. Generate actual CLI override YAML files under `tmp/`, following repository policy.

Profiles should inherit from a common isolated base with at least:

- image generation disabled;
- random events disabled;
- ordinary and combat NPC turns disabled;
- unrelated supplemental/offscreen/plot-expander work disabled;
- no unrequested background prompt families.

Feature profiles then enable only what a scenario requires, such as event checks, need bars, quests, commerce, combat turns, WYWA, scheduled events, or relationship housekeeping.

Implementation steps:

1. Inventory the exact current configuration keys and distinguish prompt enablement from gameplay mechanics that must stay active.
2. Define the isolated base and named overlays.
3. Generate a temporary merged override rather than editing shared qwen-combo-router configuration.
4. Capture the effective runtime config or a selected normalized subset in every attempt.
5. Add a preflight that compares required profile values with the running server and fails before fixture load on a mismatch.

Do not let the scenario runner silently toggle unknown shared configuration values. Server lifecycle remains explicit and outside the sandbox; the runner may prepare and verify an override but should not unexpectedly start or restart the game.

### 6. Failure-to-regression conversion workflow

Every confirmed failure should be classified before fixing it:

| Failure boundary | Fast regression form | Final verification |
| --- | --- | --- |
| Pure parser/result builder | Direct Node test with captured model response and context | Live scenario if prompt behavior contributed |
| Domain mutation/validation | Unit test against canonical objects or a narrow API helper | Strict full-turn replay, then live scenario |
| `/api/chat` orchestration/transaction | Strict cassette replay from pre-turn fixture | Live Qwen scenario |
| `LLMClient` transport/streaming/retry | Mocked Axios/SSE/router/bridge test | Live transport smoke test |
| Realtime or browser-visible behavior | API replay plus focused Playwright case | Headed check when visual judgment matters |
| Narrative instruction following | Prompt/log review; no prose heuristic | Live model human review |

The smallest relevant regression test is added before or alongside the fix. After it passes, replay the complete recorded turn to catch orchestration effects. Restart the game/model only for the final live verification unless the changed code can only be exercised in a fresh process.

#### First vertical slice: VEH-7 off-route redirect

Use the paused vehicle case to prove the workflow:

1. Preserve the existing failing attempt artifacts and canonical underway fixture.
2. If the existing artifacts do not contain normalized completion payloads, perform one new isolated live recording of the exact off-route request.
3. Add a focused regression around the boundary that currently validates the off-route destination but swallows the exception and returns success prose/state.
4. Add a version 2 cassette scenario asserting the documented error response, unchanged vehicle route, unchanged location/time, and no committed success entry.
5. Iterate on the focused test and replay without llama.cpp.
6. Run the exact scenario once in `live-verify` mode with Qwen.
7. Only then resume VEH-8 and the remainder of the follow-up plan.

### 7. One-command fix-loop ergonomics

Add commands along these lines after the underlying pieces exist:

```bash
node scripts/followup_api_playtest.mjs scenario --file tests/followup_api_playtest/scenarios/vehicle/VEH-7-off-route.json --mode live-record
node scripts/followup_api_playtest.mjs scenario --file tests/followup_api_playtest/scenarios/vehicle/VEH-7-off-route.json --mode replay --cassette tmp/.../completion-cassette.json
node scripts/followup_api_playtest.mjs scenario --file tests/followup_api_playtest/scenarios/vehicle/VEH-7-off-route.json --mode live-verify
```

The command should:

- allocate the next attempt directory automatically;
- validate scenario, fixture, cassette, and config before mutation;
- restore the fixture;
- retain one realtime client;
- execute and time every step;
- stop on the first failed mechanical invariant;
- still capture after-state and diagnostics after a failure when safe;
- print the attempt directory and a one-screen failure summary;
- exit nonzero for any assertion, replay, harness, or request failure.

Do not make automatic source edits, server restarts, save repair, or provider fallback part of this command.

### 8. Secondary optimizations

Implement these only after cassette replay, scenario execution, triage, fixtures, and profiles are working:

- Keep one WebSocket for the full scenario. This is operationally cleaner but is expected to save much less time than replay.
- Run independent parser/unit tests and artifact diff generation concurrently where their global mocks do not conflict. Keep tests that replace singleton `LLMClient` state at `concurrency: false`.
- Add duration history to the triage index so new slow stages are visible rather than guessed.
- Optionally define a smaller-model smoke profile for early prompt/parser exploration. A result from that profile never substitutes for the intended Qwen live verification because model-specific behavior is part of the test surface.
- Do not implement cross-restart mid-turn checkpoint resume. Strict whole-turn replay provides most of the benefit without persisting partially mutated runtime state.

## Implementation phases

### Phase 0: Lock contracts and baseline timings

- Add tests for the current forced-output behavior before extending its schema.
- Capture representative timings for one ordinary vehicle turn, one TinyBrain retry, one tool-call turn, one fixture load, and one state diff.
- Define the v2 cassette and scenario JSON schemas in tests.
- Confirm which configuration keys must remain enabled for VEH-7.

Exit criteria: schemas and failure semantics are documented, and baseline numbers are stored with the test artifacts.

### Phase 1: Completion cassette vertical slice

- Implement request canonicalization/fingerprinting.
- Implement atomic recording and completeness markers.
- Implement v2 ordered strict replay through the existing forced-output path.
- Preserve legacy forced-output fixtures.
- Add exhaustive unit tests.

Exit criteria: text, TinyBrain repeated-label, parser-retry, and tool-call traces replay without any network call; mismatch, exhaustion, extra calls, incomplete files, and unused entries fail explicitly.

### Phase 2: Harness refactor, scenario schema, and triage

- Extract reusable harness modules.
- Add schema validation and persistent realtime handling.
- Add the first assertion types and focused state diff.
- Add `triage.json`/`triage.md` and duration reporting.
- Keep legacy single-request commands working.

Exit criteria: a synthetic no-LLM scenario and one existing forced-output playthrough run through the new runner with equivalent evidence.

### Phase 3: Fixture and configuration automation

- Implement fixture manifests, validation, promotion, and temporary runtime copies.
- Implement isolated configuration declarations, temporary YAML generation, and runtime preflight.
- Document how fixture provenance remains separately live-tested.

Exit criteria: three consecutive scenario replays start from identical selected state and require no `@@` generation or stub expansion.

### Phase 4: VEH-7 conversion and workflow proof

- Record or reconstruct the exact failing completion trace.
- Add the focused regression test.
- Add the declarative full-turn replay.
- Fix the underlying bug at both the retryable semantic parser boundary and the `/api/chat` mutation-error propagation boundary.
- Run one final live Qwen verification.

Exit criteria: the focused test and full-turn replay fail before the application fix, pass after it, and the final live attempt agrees mechanically.

### Phase 5: Roll out across the follow-up plan

For each genuinely untested remaining case, use as much of this workflow as materially helps:

1. promote or reuse its canonical fixture;
2. add its declarative scenario and mechanical assertions;
3. run live-record once when model output is required;
4. convert any failure to the smallest focused regression;
5. use strict replay during fixes;
6. finish with live verification and human prose review.

Do not recreate already-passing pre-harness cases merely to fit this workflow, and do not record every successful live turn permanently. Promote only cassettes that protect a meaningful regression or expensive fixture flow.

## Test plan for the acceleration infrastructure

### Cassette unit tests

- legacy by-label fixtures still resolve exactly as before;
- v2 text response records and replays;
- response-shaped tool calls retain IDs, names, JSON arguments, finish reason, and normal execution;
- repeated identical metadata labels consume globally ordered entries;
- TinyBrain invalid response followed by corrected response replays the parser retry;
- changed message, prefill, tool schema, model, or structured-output contract causes a fingerprint mismatch;
- unstable cachebuster/request IDs do not change the fingerprint;
- API keys/headers never appear in the cassette;
- missing, malformed, incomplete, exhausted, extra, and unused entries fail;
- record-plus-replay configuration fails before transport;
- forced replay cannot invoke Axios or a bridge;
- atomic recording retains valid JSON after each completed entry.

### Scenario/harness tests

- schema validation rejects unknown steps, assertions, variables, and fields;
- a persistent WebSocket correlates multiple request IDs correctly;
- forced roll, confirmation, cancellation, and quest-confirmation replies are recorded;
- fixture/config preflight fails before state mutation;
- a failed request still produces response, after-state, log manifest, realtime trace, and triage when capture remains possible;
- exit status is nonzero on HTTP, assertion, cassette, realtime, or harness failure;
- legacy `chat`, `interactive-request`, `request`, and `snapshot` commands retain behavior;
- artifact directories never overwrite earlier attempts.

### Diff/assertion tests

- tracked entity additions, removals, moves, ownership, vehicle fields, calendar changes, event entries, and persistence differences are stable and readable;
- arrays with canonical entity IDs do not produce ordering-only noise where order is not semantically relevant;
- ordered structures remain order-sensitive where order matters;
- exact numeric deltas are preserved;
- prose is never used as an automated semantic assertion;
- prompt/checkpoint retries are summarized as retries rather than mistaken for duplicate independent turns.

### End-to-end proof

- use a copied autosave and strict cassette to replay a complete `/api/chat` turn;
- verify no LLM transport request occurs;
- run it three times from clean fixture restores and compare selected after-state plus response structure;
- introduce an intentional prompt change and prove replay fails before it can silently consume the old output;
- remove the intentional change and perform one live Qwen verification.

## Performance reporting and success criteria

Collect timings but do not make wall-clock targets hard CI assertions because machine load varies.

The initial success targets are:

- strict replay of a normal mechanical player-action case completes in under roughly ten seconds on the development machine, excluding server startup;
- a focused parser/domain regression completes in under one second where no API server is required;
- fixture restoration remains a small fraction of total replay time;
- one failure can be replayed repeatedly without llama.cpp or ComfyUI running;
- the generated triage report identifies the failed invariant and relevant error log without manually searching full snapshots;
- only the initial reproduction and final verification pay live-model latency.

## Expected files

Likely additions or changes include:

- `LLMClient.js` and a new `LLMCompletionCassette.js`;
- `scripts/followup_api_playtest.mjs`;
- new modules under `scripts/lib/followup_api_playtest/`;
- scenarios, fixtures, manifests, and config declarations under `tests/followup_api_playtest/`;
- focused tests such as `tests/llmclient.completion_cassette.test.js` and `tests/followup_api_playtest_harness.test.js`;
- one VEH-7 regression in the narrowest appropriate player-action/vehicle/API test file;
- `package.json` only if concise opt-in scripts materially improve discoverability;
- `docs/classes/LLMClient.md`, `docs/playwright.md`, `docs/ten_turn_api_playtest_followup_plan.md`, and this README index after implementation.

All modified JavaScript files must receive applicable syntax checks and focused Node tests. Playwright should be used only for scenarios whose visible browser behavior is part of the contract.

## Recommended implementation order

1. Version 2 completion recording/replay with strict fingerprints.
2. VEH-7 focused regression and cassette proof.
3. Harness refactor plus one-command scenario execution.
4. Focused triage and assertion reports.
5. Canonical fixture promotion and configuration profiles.
6. Rollout across the remaining follow-up scenarios.
7. Optional smaller-model smoke profile and safe parallel test execution.

This order validates the highest-leverage assumption early: that a real failed turn can be captured once and then reproduced faithfully without paying live-model latency on every code edit.
