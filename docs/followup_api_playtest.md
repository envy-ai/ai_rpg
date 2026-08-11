# Follow-Up API Playtest Harness

This is the implemented fast reproduce/fix/reverify loop for the scenarios in [ten_turn_api_playtest_followup_plan.md](ten_turn_api_playtest_followup_plan.md). It combines immutable save fixtures, minimal config profiles, strict logical-completion cassettes, declarative API scenarios, and focused triage artifacts.

This workflow was added after the follow-up API playtest was already underway. The original 71 backend cases with retained passing API assertion evidence remain complete; they do not need to be retrofitted into this harness. VEH-8 through VEH-10, REG-1 through REG-6, FAST-1 through FAST-7, NEED-1 through NEED-8, and HIDE-1 through HIDE-7 subsequently passed through the harness or its source-controlled deterministic test layer, bringing current progress to 102 of 148 backend cases with 46 remaining. Vehicle, cross-region, fast-travel, and need/status coverage are complete. Use the harness for those remaining cases and wherever an expensive or model-backed defect benefits from deterministic replay.

## Hard boundary: do not mechanically police generated prose

The harness must not use regular expressions, keyword searches, dialogue detection, prose classifiers, or ad hoc conditionals to decide whether narration obeyed an instruction. Automated assertions are limited to structured HTTP responses, authoritative game state, event/history metadata, prompt/retry metadata, cassette state, and persistence. Narrative fidelity remains an explicit human-review item in the scenario and triage report.

## Commands

Run focused harness/cassette tests:

```bash
npm run test:followup-harness
```

Prepare a temporary server override by merging an existing base override with a source-controlled test profile and cassette mode:

```bash
node scripts/followup_api_playtest.mjs prepare-config \
  --profile vehicle-mechanics \
  --base-override config.yaml.qwen-combo-router \
  --mode live-record \
  --cassette tmp/vehicle-live-record.json \
  --output tmp/vehicle-live-record.override.yaml
```

Start the server separately with that one generated override. The harness intentionally does not start, stop, or restart the game:

```bash
npm run start -- --config-override ./tmp/vehicle-live-record.override.yaml --port 7777
```

Run a scenario:

```bash
node scripts/followup_api_playtest.mjs scenario \
  --file tests/followup_api_playtest/scenarios/vehicle/VEH-7-off-route.json \
  --mode live-record \
  --cassette tmp/vehicle-live-record.json
```

`npm run followup:scenario -- ...` is the package-script equivalent. `AI_RPG_TEST_BASE_URL` and `AI_RPG_TEST_WS_URL` override the default `http://127.0.0.1:7777` and `ws://127.0.0.1:7777/ws` endpoints.

The legacy `chat`, `interactive-request`, `request`, and `snapshot` commands remain available. `promote-fixture` promotes a validated save, while `prepare-config` only writes YAML under `tmp/`.

## Explicit modes

- `live-record` requires one active recording destination and prohibits replay. It records every accepted logical completion, then marks the cassette complete only after the scenario request settles.
- `replay` requires a complete version 2 forced-output cassette and prohibits recording. Every entry must be consumed in exact global order.
- `live-verify` prohibits recording and forced output; use it for the final intended-model verification.
- `state-only` also prohibits cassette configuration and is for setup/persistence scenarios that invoke no LLM.

There is no implicit mode and replay never falls through to a provider. Use `vehicle-mechanics-replay` when starting a replay server: in addition to the vehicle isolation settings, it blanks the managed startup script/router preload and disables model-switch/image handoff so llama.cpp is neither started nor contacted.

## Scenario declarations

Scenario JSON lives under `tests/followup_api_playtest/scenarios/` and uses schema version 1. Required top-level fields are `version`, `scenario`, `case`, and a nonempty `steps` array. Optional fields are `description`, `fixture`, `configProfile`, `trackedPaths`, final `assertions`, and `humanReview`.

`fixture` may be a canonical fixture name or an existing-save object with `saveName`, optional `saveType`, and optional `entities`. Strings anywhere in the definition can reference manifest entities with `$fixture.<path>`; unresolved fixture variables fail before the realtime connection or fixture mutation.

`snapshot`, `request`, `chat`, `save`, and `reload` steps may have a unique alphanumeric/underscore/hyphen `name`. Named request-like steps retain their complete HTTP envelope under `responses.<name>`, while snapshots are retained under `snapshots.<name>`. Later routes, bodies, and assertions can use `$response.<name>.<path>` or `$snapshot.<name>.<path>`; an exact variable may resolve to an object or array, while interpolation inside a larger string requires a scalar. Runtime variables fail explicitly at the consuming step if the named value or path does not exist.

Supported step types are:

- `loadFixture`: optional explicit load information; canonical fixtures are already loaded at scenario setup and a matching step records that intent without a second mutation.
- `snapshot`: capture a named state snapshot.
- `request`: arbitrary method/route/body, optionally interactive.
- `chat`: `/api/chat` text plus optional travel metadata and interactive policy.
- `save` and `reload`: exercise normal persistence endpoints.
- `assert`: run one or more mechanical assertions immediately.
- `humanReviewNote`: add a narrative/visual review item without pretending to automate it.

Unknown top-level fields, step fields, step types, assertion fields/types, fixture variables, and malformed interactive policies fail schema validation. An interactive request must state how to handle its roll, confirmation, quest acceptance, and optional free-text answer; one persistent realtime client serves the full scenario without a client-side response deadline.

## Mechanical assertions

The version 1 vocabulary is deliberately small:

- `httpStatus`, `responseOk`;
- `exists`, `absent`, `equals`, `notEquals`, `count`, `includes`, `notIncludes` at explicit object paths;
- `stateUnchanged` and `exactDelta` across the default before/after state or explicit `beforeSource`/`afterSource` named states;
- `greaterThan`, `greaterThanOrEqual`, `lessThan`, and `lessThanOrEqual`, including comparisons against another source/path with `valueFrom`;
- `entityField` by canonical entity ID, `entityArrayObjectCount` for nested structured rows on that entity, and `uniqueBy` for structured collections;
- `arrayObjectCount` for an exact count of array objects containing a mechanically specified field/value subset;
- `attackResultCount` to flatten `resolveAttack` and every per-target `resolveAreaAttack` result into one shared mechanical shape before matching actor, canonical target, hit, roll, damage, or tool kind;
- `attackResultApplied` to require exactly one matching normalized attack result and prove that its recorded starting/ending health equals the canonical target entity's before/after state, with optional positive-health-loss enforcement;
- `historyAddedTypeCount` for new structured chat-history entry types, and `historyAddedNestedObjectCount` for exact subset-matching structured objects at a nested path within filtered newly added history rows;
- `noRealtimeErrors` and `noUnexpectedErrorLogs`; the latter may explicitly allow exact filenames or stable filename prefixes for recovered provider retries when separate response/state assertions prove the operation ultimately succeeded;
- `cassetteConsumed` for a completed strict replay.

`equalsFrom` can compare one explicit source/path to another. Assertion sources are paths into the runner context, including `before`, `after`, `response`, `responses.<name>`, `snapshots.<name>`, `realtime`, `changedLogs`, `cassetteStatus`, `steps`, and `fixture`. History-delta assertions also accept explicit before/after sources. Assertions stop the scenario at the first failed checkpoint, but safe after-state/log/realtime capture still runs.

## Artifacts and triage

Every run allocates a new directory under `tmp/followup_api_playtest/<scenario>/<case>/attempt-N/`; attempts are never overwritten. Depending on the path taken it contains:

- the validated scenario and run metadata;
- effective config-profile values;
- before/after and named snapshots;
- request/response and per-step timings;
- realtime events and cassette status;
- changed-log manifest without deleting or truncating logs;
- `triage.json` and a short `triage.md`.

Triage reports the failed invariant, response error/stack, selected state changes, structured history additions, prompt/checkpoint timeline and retry counts, changed error logs, cassette consumption, and human-review notes. It summarizes prompt metadata but does not copy prompt text or infer narrative compliance.

State snapshots include players, locations, live region summaries, things, history, calendar data, and detailed current-player/current-location payloads. Region-expansion scenarios use the live-region collection for canonical identity checks and the region-map endpoint for exact membership/uniqueness checks.

## Canonical fixtures

Promoted fixtures live under `tests/followup_api_playtest/fixtures/<name>/` with an immutable `save/` copy and `manifest.json`. The manifest records provenance `@@` setup, canonical IDs, required mods/profile, starting world time, invariants, validation evidence, and a recursive SHA-256 integrity hash.

Promotion refuses missing/failed validation evidence, empty invariants, hash drift, and replacement without an explicit flag:

```bash
node scripts/followup_api_playtest.mjs promote-fixture \
  --name vehicle-underway-eastbound \
  --source-save <save-directory> \
  --manifest-file tmp/vehicle-underway.manifest-input.json
```

At runtime the harness verifies integrity, copies the fixture to a uniquely named disposable autosave, adjusts only loader metadata in that copy, loads through `/api/load`, checks manifest invariants immediately, and removes only that recognized temporary fixture on exit. The source fixture is never mutated. `--keep-runtime-fixture true` retains the copy for diagnosis.

## Config profiles

Profiles live under `tests/followup_api_playtest/config_profiles/`, use version 1, store dotted config paths, and support single-parent `extends` inheritance with cycle detection.

- `isolated-base` disables image generation and unrelated foreground/background prompt families.
- `vehicle-mechanics` re-enables only event and plausibility checks needed for the vehicle case.
- `vehicle-mechanics-replay` additionally prevents local llama/router startup and lifecycle calls.
- `combat-friendly-only` enables the combat NPC scheduler with one friendly slot, no hostile slot, ordinary NPC turns off, legacy prompt checks off, and image generation inherited off.
- `combat-friendly-only-replay` retains those mechanics while preventing local llama/router startup and lifecycle calls.
- `need-bars-mechanics` enables only the event, plausibility, and TinyBrain need-bar checks required by need/status cases.
- `need-bars-mechanics-replay` retains those mechanics while preventing local llama/router startup and lifecycle calls.
- `full-live-verification` retains normal Qwen gameplay checks needed by broader final live testing while leaving image generation and unrelated turns off.

Before fixture load, the runner reads every required profile value from the running server through `/get`. Any mismatch fails before world-state mutation. `prepare-config --base-override` is the supported way to retain a router/model configuration while layering one test profile and its cassette paths into the single CLI override accepted by the server.

## Version 2 completion cassettes

`LLMCompletionCassette.js` records/replays at the accepted logical `LLMClient.chatCompletion(...)` boundary, not at the HTTP/SSE-chunk boundary. This means parser retries, repeated TinyBrain labels, and tool-loop rounds are separate ordered entries, while low-level failed transport attempts are not.

Each entry stores a normalized metadata label, semantic SHA-256 request fingerprint, compact non-secret summary, and normalized response including tool calls. Requests are canonicalized with sorted object keys and order-preserving arrays; data URLs are hashed. API keys, auth/custom headers, request/client IDs, timestamps, generated cachebusters, and generated seeds are excluded.

Recording writes valid JSON atomically after each accepted completion and remains `complete: false` until the runner settles the scenario and calls the completion endpoint. Cassette-backed `LLMClient` calls are globally serialized: an ordinary completion owns the cassette permit for one call, while a reserved TinyBrain program retains it across every checkpoint and yields it only alongside its model permits for a nested prompt-launching tool. This gives concurrently launched event and need-bar programs a deterministic whole-program order instead of allowing their stages to interleave. Finalization waits for stable idle and rejects active or queued cassette work.

Strict replay requires `version: 2`, `strict: true`, `complete: true`, an exact next label/fingerprint, no unused entries, no active/queued cassette work, and no latched replay failure at the end. Tool calls still execute normally after their replayed assistant response, so downstream state and orchestration remain under test. Structured JSON tool results omit reconstruction-time metadata such as `createdAt` and `lastUpdated` from the fingerprint; semantic tool fields remain strict. Token-stream callbacks are intentionally inert during replay because the cassette records accepted logical responses rather than an SSE/token trace.

Cassette replay is not evidence for provider transport, streaming/SSE, live token deslop, XML stream-repetition interruption, router lifecycle, or narrative instruction following. Those require focused transport tests and/or the final live-model pass.

## VEH-7 vertical slice

The first converted regression is `scenarios/vehicle/VEH-7-off-route.json`, backed by `fixtures/vehicle-underway-eastbound`. It restores Baato and Mizore aboard an underway fixed-route QA Clockwork Tram, deterministically adds an explicit QA-only route-authority precondition to the copied player's description through the normal character update API, requests an off-route redirect, and asserts an explicit failed HTTP response, unchanged player/vehicle/time state, no committed `player-action` history entry, and no realtime harness error. The runtime-only description change removes the unrelated player-agency rejection branch without mutating the immutable source fixture or triggering level-up ability selection.

The application fix has two layers:

1. `Player.currentVehicle.allowedDestinations` resolves the route into canonical structured candidates, and `player_action_vehicle_destination` rejects/canonicalizes destination answers during the retryable TinyBrain checkpoint. Retry-local state anchors the first syntactically complete destination, so parser feedback cannot turn an off-route request into a different on-route request merely to satisfy validation.
2. The vehicle mutation boundary tags any remaining invalid-route domain error, and `/api/chat` rethrows that tag instead of swallowing it in the general event-check warning catch.

This is structured parser/domain validation. It does not inspect generated prose for phrases implying success.

The source-controlled replay trace is `cassettes/vehicle/VEH-7-off-route.json`. The final 2026-08-10 verification recorded a 35-completion live trace, consumed all 35 entries in a no-llama strict replay, and then passed a separate unrecorded live-Qwen run. Each pass returned the expected checkpoint-26 HTTP 500 after seven attempts and left player location, fixed-route vehicle state, world time, and committed player-action history unchanged.

## VEH-8 state-only arrival slice

`scenarios/vehicle/VEH-8-timed-arrival.json` uses the same immutable underway fixture without any LLM call. It advances the clock to minute 668, proves the ETA-669 tram is still underway with its external exit hidden, advances one more minute, and proves the arrival is finalized exactly once. A zero-minute follow-up proves the finalized vehicle and exit state are idempotent. Attempt 1 passed all 37 assertions with no realtime errors or changed error logs; Rika remained aboard and retained ownership of the QA Brass Travel Case throughout.

## VEH-9 live disembark slice

`scenarios/vehicle/VEH-9-disembark.json` restores the immutable underway fixture, advances exactly to arrival, then exercises the ordinary event-driven vehicle exit under the live Qwen router. `/api/chat` exposes the committed TinyBrain movement classification as optional structured `authoritativeMovementType`, allowing the harness to prove `disembark` without inspecting narration. The scenario separately fetches the detailed tram endpoint because the bulk locations projection intentionally omits full `vehicleInfo`. Live-verify attempt 2 passed all 31 assertions: the player moved to QA East Platform without additional time, one player action and one event summary were committed, the tram retained its canonical fixed route with cleared trip timing, and no realtime or changed error-log failures occurred.

## VEH-10 state-only persistence slice

`scenarios/vehicle/VEH-10-save-reload.json` saves the canonical fixture while the tram is underway, mutates only the disposable runtime clock, and reloads through the normal save API. It then advances across the restored ETA and performs a zero-minute duplicate check. State-only attempt 1 passed all 46 assertions: the exact active route, ETA, departure time, tracked exit, player vehicle context, companion location, and carried-item ownership survived hydration; the trip arrived once and remained stable afterward.

## REG-1 live pending-region entry slice

`scenarios/cross-region/REG-1-direct-region-entry.json` restores the immutable `cross-region-pending-frost-march` fixture, traverses its zero-minute pending-region doorway through `/api/player/move`, and then inspects the live region map, origin exit, and preserved child stub. Live-verify attempt 4 passed all 40 assertions: expansion created one canonical entrance under the pending region id, moved the player there, backfilled and rewired the origin exit to five minutes, retained QA Border Lantern as a non-region-entry child stub in QA Frost March, and produced unique region-map membership with one event summary and no unexpected errors.

## REG-2 live child-stub slice

`scenarios/cross-region/REG-2-child-stub.json` restores the derivative immutable `cross-region-expanded-frost-march` fixture. That fixture is the fully validated REG-1 post-state, so later child-expansion cases do not need to regenerate the target region while the original pending-region fixture remains available for REG-1. Live-verify attempt 1 passed all 44 assertions: moving through the existing two-minute exit expanded QA Border Lantern in place under its original `loc_38` id and QA Frost March region id, retained one canonical map member and the reciprocal entrance exits, moved the player and advanced time exactly once, added one event summary, and generated no realtime or changed error-log failures. Human review accepted the generated frozen-frontier lantern checkpoint as consistent with its saved blueprint.

`scenarios/cross-region/REG-3-dialogue-movement.json` restores `cross-region-alias-companion`, which adds living local `QA Quartermaster` with alias `Kuroha` to the validated expanded-region fixture. Live-verify attempt 3 passed all 51 assertions. The direct player-action travel prompt resolved `Kuroha` to the canonical companion, expanded the destination stub for destination prose while leaving both actors and the clock at the origin, and returned the canonical name in `accompanyingCharacters`. Passing that response unchanged to `/api/player/move` then moved both actors once, advanced exactly two minutes, retained the canonical exit and unique region membership, and emitted one event summary without another player-action entry. Human review accepted the single coherent departure/walk/arrival and found no duplicate character. The failed first attempt also identified an oversized sequential TinyBrain event transcript: each phase had retained another full base context until the request reached about 498 KB and llama.cpp returned HTTP 400. Section continuation now refreshes the one existing base-context snapshot in place while preserving earlier event prompts and accepted assistant replies; focused three-section regression coverage proves stale snapshots do not accumulate.

`scenarios/cross-region/REG-4-model-selected-destination.json` restores `cross-region-expanded-frost-march` and supplies no authoritative travel metadata beyond the ordinary travel flag. Live-verify attempt 3 passed all 41 assertions. Player-action selected QA Aurora Cairn in QA Frost March with a three-minute route; the server then generated and expanded exactly one destination, made canonical reciprocal three-minute exits, moved the player once, advanced the clock once, and retained unique region-map membership. One player-action and one event-summary row were added, and no realtime or changed error-log failure occurred. Human review accepted the single coherent trip and the generated cairn's regional/route consistency. Failed attempts exposed that the tool loop would execute any registered provider-emitted tool even when the active request omitted it. Explicit request schemas now serve as execution allowlists: undeclared calls return a retry-visible `tool_not_declared` result without reaching their executor, while the TinyBrain destination-lookup checkpoint preserves its `moreInfo`-only schema through base-context policy.

`scenarios/cross-region/REG-5-failure-isolation.json` restores `cross-region-ambiguous-destination` and sends authoritative fast-travel metadata whose canonical destination id does not exist. Live-verify attempt 4 passed all 23 assertions. The API rejected the request with HTTP 400 before any prompt or prose, retained the exact player location, time, locations, regions, and exits, added no player-action or event-summary history, preserved the two intentionally same-named stubs in their distinct regions, and produced no realtime harness error. A model-selected ambiguity input was deliberately replaced because the model could invent a region and make that action unambiguous; the invalid authoritative id makes the negative invariant deterministic.

`scenarios/cross-region/REG-6-persistence.json` restores the already expanded Frost March fixture, captures its map, cross-region origin, and child-stub projections, saves, deliberately advances time, then reloads. State-only attempt 3 passed all 57 assertions. The save restored the exact player, clock, global location, and live-region projections; retained one five-member QA Frost March map with unique ids and consistent region ownership; preserved the entrance, ordinary child stub, and all relevant one-, two-, and five-minute route topology; matched the complete pre/post map and stub payloads; and emitted no realtime or changed-log errors. Exit objects receive fresh audit timestamps during hydration, so the scenario asserts their authoritative route fields rather than misclassifying timestamp reconstruction as topology loss.

The immutable `fast-travel-visited-favorites` fixture supplies visited/favorited QA Fast Travel Grove and QA Fast Travel Tower on canonical four- and nine-minute two-way routes from March Start Marker, plus non-party QA Courier with alias Quickstep. Entity creation used the documented `@@` tool path for the courier and deterministic exit/visit/favorite APIs for route precision. `scenarios/fast-travel/FAST-1-preview.json` state-only attempt 1 passed all 43 assertions: both preview responses returned exact canonical endpoints, region names, and directed shortest-path minutes without changing player, NPC, location, clock, or history state and without emitting errors.

`scenarios/fast-travel/FAST-2-blank-confirmation.json` reproduces the blank map/Favorites confirmation sequence rather than treating it as a prose turn. Live-verify attempt 2 passed all 47 assertions: one travel-marked comment entry was stored without any model prompt or player-action row, the subsequent gameplay teleport moved once to the Grove and advanced exactly four graph minutes, one event-summary row captured travel, the aliased non-party courier remained at the origin, normal arrival processing completed without error, and the four-minute revisit correctly stayed below the WYWA threshold.

`scenarios/fast-travel/FAST-3-prompted-confirmation.json` covers the nonblank map/Favorites branch. Live-verify attempt 1 passed all 46 mechanical assertions: authoritative fast-travel metadata fixed the existing Tower as the destination, player-action generated prose and one history row without moving or advancing time, and the separate gameplay teleport performed the only movement, exact nine-minute graph advance, and one travel summary. No WYWA or runtime error occurred at the below-threshold revisit. Human review accepted the single Tower-bound trip and found no competing Grove destination or duplicate movement.

`scenarios/fast-travel/FAST-4-companion-alias.json` covers a non-party companion selected by alias. Live-verify attempt 1 passed all 48 mechanical assertions: `Quickstep` canonicalized to the one local `QA Courier`; neither actor moved during the prose step; the teleport moved both to the Grove exactly once with the exact four-minute graph advance; and alias, NPC identity, and non-party membership remained unchanged. Human review accepted the single generic courier as that character and found no party-join or second inter-location movement claim.

`scenarios/fast-travel/FAST-5-wywa.json` compares both above-threshold arrival contracts from the same saved baseline. Live-verify attempt 1 passed all 58 mechanical assertions. After 31 minutes away, a same-request event-driven TinyBrain move advanced the exact four-minute route, stored one hidden WYWA bookkeeping row, and added no visible WYWA row because its player-action already contained destination prose. Reloading the baseline and using the browser-equivalent blank comment plus normal teleport advanced the same four minutes and stored one hidden plus one visible WYWA row. Neither branch emitted realtime, arrival-processing, or changed-log errors. Human review accepted the first destination scene and the blank path's one reunion scene without duplicate travel or a conflicting destination.

`scenarios/fast-travel/FAST-6-story-tool-contrast.json` proves the story-tool shortcut is isolated from gameplay arrival processing. The scenario ages the destination past the WYWA threshold, marks existing Grove NPC Mina hidden, and deliberately supplies the courier alias to the teleport. State-only attempt 1 passed all 52 assertions: only Baato moved; time, complete history, courier location, Mina's hidden flag, and Mina's last-seen fields stayed unchanged; the response omitted arrival-processing data; no WYWA, player-action, or travel-summary row appeared; and no prompt, realtime error, or changed error log occurred.

`scenarios/fast-travel/FAST-7-invalid-target.json` sends one nonexistent canonical destination through both preview and gameplay teleport. State-only attempt 1 passed all 37 assertions. Both endpoints returned their documented HTTP 404 payloads before mutation; the exact player, character, location, clock, and history projections stayed unchanged; no player-action, WYWA, or event-summary row appeared; and no prompt, realtime error, or changed log occurred. Fast-travel coverage is now complete at 7/7 cases.

The immutable `need-bars-status-lifecycle` fixture supplies Baato, party member QA Tired Companion, non-party QA Courier, and one carried QA Restorative Meal whose ten-minute QA Well Fed status has a need modifier and attribute modifier. Entity creation used two `@@` tool calls, followed by deterministic API normalization of status mechanics, ownership, party membership, and raw need values. The manifest contains executable fixture invariants and the save tree has SHA-256 `4fd7386a4255970712445d30c58c6f7087eaa3bd9cb096c220ef2caf24878a13`.

`scenarios/need-bars/NEED-1-passive-decrease.json` uses the fixture under `need-bars-mechanics`. Live-verify attempt 2 passed all 50 assertions: one agreed strenuous minute gave Baato and QA Tired Companion exactly one structured small stamina decrease apiece, ordinary elapsed-time processing applied the expected passive tick, the non-party courier remained unchanged, and one event summary contained exactly two matching need-bar-change items plus one time-passed item. Accepted TinyBrain output also exposed the two canonical structured need changes and their nonempty reasons. No realtime or changed-log error occurred. Human review accepted one coherent shared haul/sprint with neither recovery, eating, nor spellcasting. The rejected first attempt was an invalid test instruction that directly controlled the NPC; plausibility correctly prevented mutation, and the corrected setup instead gave the companion a voluntary precommitment before the player supplied the signal.

`scenarios/need-bars/NEED-2-recovery.json` dismisses the fixture companion for the case and teleports both fixture NPCs to an existing empty location through normal APIs, leaving Baato alone at the baseline marker. This isolates recovery mechanically without trying to constrain or classify NPC prose. Live-verify attempt 4 passed all 59 assertions: one explicit one-minute short rest produced exactly Baato Rest +100 and a capped stamina fill after passive time rates; player stamina stopped at its configured 1000 maximum; remote actors received only ordinary elapsed-time drift; the restorative meal remained in inventory; QA Well Fed was not applied; Baato did not move; and one action plus one matching structured event summary were added without realtime or changed-log errors. Human review accepted one quiet stationary minute with no food, drink, meditation, magic, sleep, strenuous activity, or second player action. Earlier attempts exposed test isolation and trigger-wording variability, not production defects: nearby NPCs validly performed their own narrated activities, and generic quiet sitting did not always classify as the configured `short rest` trigger.

`scenarios/need-bars/NEED-3-threshold.json` exercises the direct need endpoint without an LLM. State-only attempt 2 passed all 50 assertions. Rest is first set exactly at threshold 150, yielding `Tired` and its configured effect metadata, then set to `149.99999999999997`, JavaScript's next representable number below 150. Exactly one unique Rest bar switches to threshold 10 `Very Tired` with `-5% to health and attributes`; the old threshold is absent; other player and NPC needs, statuses, inventory, location, time, and history stay unchanged. Reapplying the same crossed value leaves the complete tracked state unchanged and creates no duplicate bar. Threshold `effect` strings are authoritative descriptive metadata used in prompt/UI/summary context; they are not executable expressions and the test does not pretend that the runtime parses arbitrary prose into stat modifiers.

`scenarios/need-bars/NEED-4-consume-effect.json` mechanically isolates Baato and sets Food to 100 so the configured normal-meal magnitude is distinguishable from a fill. Live-verify attempt 2 passed all 64 assertions and human review. One minute of eating exactly one QA Restorative Meal produced one `item_ingest`, one quantity-one `consume_item`, one gained item-backed status, and an immediate Food `large` +700 after the baseline passive tick, ending at 799.3. The meal disappeared from both inventory and the global thing map. Exactly one QA Well Fed instance started at minute 664 with duration 10, Constitution +2, and the separate Food +5-per-minute modifier; that timed modifier correctly did not apply retroactively in its creation minute. The Constitution modifier raised current and maximum health by four through existing derived-stat behavior. History added one player action, one general event summary, and the dedicated one status-summary row, with no errors. The first source attempt's only failure was a scenario assumption that status changes used a second `event-summary`; authoritative history correctly uses `status-summary`.

`scenarios/need-bars/NEED-5-expiry.json` installs the same status directly at fixture minute 663 and uses the ordinary forward-time slash-command path. State-only attempt 2 passed all 57 assertions. At minute 672 the effect remained present with duration 1 and `appliedAt` advanced to 672; Constitution +2 still raised max/current health from 39 to 43, and nine +5 modifier ticks combined with Food's nine -0.7 baseline ticks to reach 638.7. At minute 673 the last modifier tick produced Food 643, duration reached zero, the status was removed, and max/current health returned to 39. Minute 674 applied only the -0.7 baseline drift, producing Food 642.3 with the effect still absent. No chat-history row, duplicate removal, or status-summary entry was created. The first attempt compared the whole history response wrapper across a clock change; the corrected assertion compares the immutable history-entry array because the wrapper intentionally includes current world-time metadata.

`scenarios/need-bars/NEED-6-audience.json` first compares all three need endpoints before changing party/location state. Live-verify attempt 1 passed all 75 assertions. Baato reports exact audience `{player:true, party:false, nonParty:false}` and four unique Food/Rest/Stamina/Mana bars. QA Tired Companion reports party audience and exactly Food/Rest/Stamina, with its per-actor Mana applicability disabled. QA Courier reports non-party audience and exactly Stamina/Mana, with player/party-only Food and Rest absent. The scenario then dismisses/relocates both NPCs and caps player stamina before one explicit minor spell. The need prompt log shows empty `Characters at location` and `Characters in party` lists; Baato remains the implicit player actor through `playerAction`/`textToCheck` and the base player context. Planning and final XML contain exactly Baato's applicable small Mana decrease. Authoritative Mana moves from 600 through passive +10 to 510 after -100; no NPC need entry appears, and their only changes are passive elapsed-time rates. Human review accepted one spell, no NPC action, and no second player action.

`tests/fixtures/need_bar_tinybrain_invalid_outputs.json` and `tests/events_need_bar_tinybrain.test.js` cover NEED-7 without a model or server. The strict forced-output sequence drives the real `LLMClient` fixture path through one planning completion, six invalid character-phase completions, and one valid completion. The parser rejects an unknown bar, case-insensitive duplicate character, case-insensitive duplicate bar, invalid direction, invalid magnitude, and unexpected XML child with specific diagnostics. The staged runner retains the accepted planning response exactly once, removes each rejected assistant response before retrying, consumes all eight fixture outputs, and retries only the characters checkpoint. `tests/tiny_brain_prompt_parsers.test.js` independently verifies the same semantic rejection boundary.

`scenarios/need-bars/NEED-8-save-reload.json` covers full persistence after partial status elapse. State-only attempt 3 passed all 87 assertions. It sets distinctive raw Food/Rest/Stamina/Mana values, installs QA Well Fed, and advances three minutes to exact values 312.9/198.2/400/380 with duration 7, `appliedAt: 666`, Constitution +2, Food +5/minute, and derived health 43. After a normal save it deliberately overwrites every need, clears the status, and advances the clock before reloading. Reload restores the exact saved current values, their independent `initialValue` baselines, status/timestamps/modifiers, clock, inventory, derived health, and the persisted save notice. One subsequent minute produces 317.2/197.6/450/390, duration 6, and `appliedAt: 667` with no error. Attempt 1 corrected an overbroad assumption that save adds no history—the documented save notice is expected. Attempt 2 exposed a production hydration defect where `initialValue` was replaced by the current value; `Player.#initializeNeedBars` now preserves a serialized initial baseline separately from the current reading, with focused round-trip coverage.

## HIDE-1 automatic concealment failure

The immutable `stealth-hidden-npcs` fixture was produced by the required elevated generic setup path: one `@@` call created QA Veiled Scout and another created QA Loud Decoy, after which authoritative NPC updates fixed Scout's alias `Whisper`, hidden flag, and Dexterity/Stealth 20/20 and Decoy's visible flag and 1/0 hiding stats. The setup's only failed assertion used the wrong capture-projection field name (`currentLocation` instead of `locationId`); a state-only continuation retained the successful generated entities, passed 24/24 validation assertions, saved the state, and supplied the promotion evidence. The manifest verifies 17 runtime invariants and a recursive save-tree integrity hash.

`scenarios/stealth-hidden/HIDE-1-automatic-failure.json` uses the `stealth-hidden-mechanics` profile with `hide_hide_checks: true`. It lowers Baato to Wisdom/Perception 1/0, separates him with a story-tool teleport that intentionally bypasses arrival processing, then performs an ordinary zero-time return to the concealed Scout. State-only attempt 1 passed all 39 assertions: the first-shared-location machinery recorded exactly one automatic opposed major failure, retained `hiddenFromPlayer: true`, left last-seen fields unset, and added only one `check-results` entry carrying the canonical scout id/name plus `hiddenFromClient: true`. No player action, event summary, prompt, time change, realtime error, or changed error log occurred. This route emits no assistant prose, so narrative identity leakage is not mechanically guessed or scanned.

## HIDE-2 explicit search success

`scenarios/stealth-hidden/HIDE-2-explicit-search-success.json` restores the same fixture, isolates the visible decoy and unrelated courier, makes the player search mathematically favorable, and uses `<f>` with an injected 20 while targeting Scout by alias. The scenario asserts one `resolveOpposedSkillCheck`, one check-results row, canonical target id/name, reveal state, location refresh, one player-action row, one event-summary row, unchanged player location, and clean realtime/error logs. Search duration is deliberately not fixed because the model may validly resolve the brief search as one or several minutes and HIDE-2 has no duration contract.

The first live attempts exposed that `api.js` collected the structured player-action check but the XML path in `Events.runEventChecks()` dropped it while delegating to `_runXmlEventChecks()`. After that handoff was fixed, further live variants showed valid tool results with omitted attributes and with Intelligence paired to Perception instead of the setting's default Wisdom. Hidden-event reuse now requires an exact actor, canonical opponent id/name or alias, supported opposed-check tool, and configured skill on each skill-configured side; the chosen attribute may be omitted or differ because generic checked actions permit valid skill/attribute pairing. Attribute-only setting sides still require the configured attribute. The result is consumed once across the XML before/move/after sections and never added to `hiddenNpcChecks`, preventing a duplicate roll and history row without inspecting prose.

Live-record attempt 7 passed 41/41 assertions and finalized the 38-entry strict v2 cassette at `cassettes/stealth-hidden/HIDE-2-explicit-search-success.json` (SHA-256 `0492b356b177f4acdec52498fc3d0f70f7ebce6a47d7432ff9d05fe169a7b0bc`). No-llama replay attempt 8 passed 41/41, consumed 38/38 entries with zero failures, and emitted no provider traffic. Independent live-Qwen attempt 9 also passed 41/41, recorded one forced critical-success Perception-vs-Stealth check, revealed the Scout once, refreshed the location, and passed human review for one search/reveal without movement, combat, item use, or a second action.

## HIDE-3 explicit search failure

`scenarios/stealth-hidden/HIDE-3-explicit-search-failure.json` restores the Scout's high Dexterity/Stealth values, lowers Baato's Wisdom/Perception, isolates unrelated NPCs, and submits one alias-targeted `<f>` search with die 1. Live-verify attempt 1 passed 43/43 assertions: the only tool result was a canonical critical-failure Perception-vs-Stealth check, only one check-results row was added, Scout remained hidden in place with null last-seen fields, and `locationRefreshRequested` stayed absent. The ordinary action and time summary were stored without realtime or changed-log errors. Human review accepted prose that finds nothing and neither locates nor interacts with the concealed Scout. No production defect was found, so no defect cassette was needed.

## HIDE-4 visible NPC hides

`scenarios/stealth-hidden/HIDE-4-visible-npc-hides.json` restores the stealth fixture, isolates Scout, and asks QA Loud Decoy to perform one promised hiding demonstration while Baato watches. Its `<f>` marker supplies Decoy's exact die 20. Live-record attempt 6 and independent live-Qwen attempt 8 each passed 43/43 assertions and human review. Strict no-llama replay attempt 7 consumed all 39 cassette completions with zero failures or provider traffic. Both live runs produced one canonical QA Loud Decoy-vs-Baato Stealth/Perception check, one check-results row, one location refresh, one action/summary pair, and a living Decoy hidden at the unchanged location. The accepted narration leaves her concealed rather than narrating a second reveal.

The first live attempt exposed that an actorless player-action check tool silently defaulted to the player even when the prose action belonged to an NPC, producing a player-vs-player result before the hidden-event layer ran the intended NPC check. TinyBrain player-action now asks a structured checkpoint for every eligible actor who will perform a meaningful uncertain non-attack action. The parser accepts only exact allowlisted canonical names or aliases, canonicalizes them, and rejects unknown, partial, ambiguous, or duplicate selections. Skill-check schemas require `actor` for that TinyBrain path. If a provider still omits the field, the executor can supply it only when the parsed checkpoint selected exactly one actor; explicit actors outside the selected set fail without rolling. The opposed-check domain boundary also rejects resolving an actor against itself. Non-TinyBrain and NPC-action defaults are unchanged, and no free-form prose is inspected. The strict v2 source cassette is `cassettes/stealth-hidden/HIDE-4-visible-npc-hides.json` with SHA-256 `f4785f137ff4bbbf7b3f709b9e50c4d9c57460d78d04d7107ca54e4d9dc58bbf`.

## HIDE-5 attack reveal

`scenarios/stealth-hidden/HIDE-5-attack-reveal.json` restores Scout as a living hidden actor, isolates the other fixture NPCs, and gives Scout a precommitted one-attack demonstration. Its `<1>` control and low attack stats guarantee a miss. Live-record attempt 5 and independent live-Qwen attempt 7 each passed 42/42 assertions and human review. Strict no-llama replay attempt 6 passed the same assertions and consumed all 39 cassette entries with zero failures. The one `resolveAttack` result carries canonical Scout/Baato identity, die 1, and `hit:false`; Baato remains at 39 health, Scout becomes visible without moving, and one location refresh plus one check/action/summary set is emitted without realtime or changed-log errors. Both accepted live narratives show one no-contact miss and leave Scout plainly visible at the marker.

Attempt 1 exposed a post-resolution defect when the model selected an attack that hit for zero damage. The domain resolver returned the authoritative target health, but the tool-result formatter looked only for a positive-damage application or incomplete summary percentages. It threw after reveal, so the model retried an otherwise resolved action. Hit formatting now also reads the authoritative `attackOutcome.target`, allowing `Damage: 0%` and the actual remaining-health percentage without another resolution. Single-target attack summaries also retain `defender.id` and `target.maxHealth`; miss normalization uses that canonical id instead of weakening assertions to name-only. Attempt 2 then proved the desired gameplay behavior while exposing the missing id. Attempt 4 mechanically passed after both fixes but failed human review because prose described light contact despite `hit:false`; its cassette is preserved under that attempt, and only prompt guidance was tightened before recording again. No prose matcher, classifier, or wording assertion was added. The accepted source cassette is `cassettes/stealth-hidden/HIDE-5-attack-reveal.json` with SHA-256 `827b157ccb7fbc30278527312a40ca3c5a815b3b2c350414a36687dfcb361e78`.

## HIDE-6 corpse visibility

`scenarios/stealth-hidden/HIDE-6-corpse-visibility.json` restores the living hidden Scout and tests the death/visibility invariant without involving prose generation. In one authoritative NPC update it requests both `isDead=true` and `hiddenFromPlayer=true`; state-only attempt 1 passed all 59 fixture and scenario assertions. The domain model made the Scout dead at zero health, cleared concealment, started the ordinary five-turn corpse countdown, retained location membership, and exposed exactly one `hiddenFromPlayer:false` corpse through the location client payload. A second update requesting concealment could not re-hide the corpse, and a full NPC-status read confirmed the same state. World time, last-seen fields, history, realtime errors, and changed error logs remained untouched. This state-only case found no production defect and requires no cassette.

## HIDE-7 hidden NPC movement

`scenarios/stealth-hidden/HIDE-7-hidden-movement.json` moves the same hidden Scout from March Start Marker to the existing Stairwell through `npcDeparture`, then back through `npcArrival`. Live-record attempt 10 and independent live-Qwen attempt 12 passed all 76 assertions. Strict replay attempt 11 consumed the source cassette's 19/19 completions in global order with no prompt-progress or provider traffic. Both legs preserve the actor id, hidden flag, location membership, and null last-seen fields while reporting the canonical actor name. The scenario then uses a story-tool separation plus normal player return so ordinary arrival processing records exactly one failed automatic reveal check with `hiddenFromClient:true`; Scout remains hidden.

The first live attempts exposed two production gaps. `SanitizedStringSet` stores normalized lowercase keys, and both event result builders returned those keys directly in `npcUpdates.added`/`departed`. They now resolve tracked values back to authoritative actor names, with a focused parser/result-builder regression. Separately, the character-presence checkpoint could return `<done/>` even when prose physically placed an actor absent from current membership into the scene. Its structured instruction now explicitly compares current membership with physical presence, requires `npcArrival` for visible or hidden arrivals, and excludes plans, memories, dialogue mentions, and offscreen activity. No application code scans narration. The strict v2 cassette is `cassettes/stealth-hidden/HIDE-7-hidden-movement.json` with SHA-256 `b8bc8ad5270ea9f65b73c70a64bbb1c0f34dc6d4d868a684c2a01a69130205b3`.

Earlier attempts exposed a production parser defect rather than a scenario defect. Malformed generated region XML had been normalized far enough to produce partial location definitions, so expansion reached later instantiation checks or returned a generic failure. Pending-region generation now strictly validates the complete `<region>` document and every consumed component before mutation, using the configured semantic retry budget. A first retry implementation retained the roughly 10 KB rejected document; live attempt 3 demonstrated that the local model copied the same malformed XML byte-for-byte seven times. `runPromptWithParseRetries()` now supports omitting rejected output from retry context. Region retries use that mode and regenerate from the original prompt plus the exact parser error, while smaller structured-generation callers retain their established correction context.

## COMBAT-1 vertical slice

`scenarios/combat/COMBAT-1-hostile-npc-attack.json` uses the immutable `combat-elemental-skirmish` fixture. It restores Baato with QA Ash Beetle, QA Frost Beetle, and QA Shieldhand at the isolated combat location, forces die 12 through the player action, and asserts the exact acting attacker, one `resolveAttack` invocation/summary, positive applied damage, surviving-player health loss, unchanged attacker health, one check-results entry, one player-action entry, no duplicate NPC turn, and no realtime harness error. Narrative attribution and single-attack fidelity remain explicit human-review items.

Live verification exposed a prose-contract gap: a single-target result originally prohibited attacks by other characters but did not clearly limit the same attacker to one attack action. The tool result and TinyBrain planning/draft/audit/revision/final instructions now define one single-target result as at most one approach plus one impact, miss, or damaging contact. An identified unsupported follow-up is to be deleted wholesale rather than paraphrased, relocated, or replaced. This is model guidance only; neither the application nor harness scans prose or classifies attack wording.

The source-controlled replay trace is `cassettes/combat/COMBAT-1-hostile-npc-attack.json` (SHA-256 `35301680ec858750eb6fbc0005973827a89180064e48178e09bbde741b96d683`). Final 2026-08-10 evidence is:

- live record `attempt-20`: 51/51 mechanical assertions and human-reviewed one-attack prose; 40 completed cassette entries;
- strict replay `attempt-21`: 51/51 assertions, 40/40 entries consumed, zero latched failures, empty cassette queue, and no llama.cpp process;
- independent live-Qwen `attempt-22`: 51/51 assertions plus one lunge/bite followed only by withdrawal/posture, with no absent character attacking.

## COMBAT-2 vertical slice

`scenarios/combat/COMBAT-2-friendly-npc-attack.json` reuses the immutable `combat-elemental-skirmish` fixture under `combat-friendly-only`. It isolates Frost Beetle, gives QA Shieldhand deterministic combat stats and intent through the normal NPC update API, then has Baato begin combat without taking an attack action. The turn must produce exactly two independently attributed mechanical attack results—QA Ash Beetle against Baato and QA Shieldhand against QA Ash Beetle—while legacy prompt checks are disabled. Both result applications must match canonical before/after health, Shieldhand must remain undamaged, and already-acted combatants must not receive a duplicate scheduled NPC turn. Prose attribution, one-impact fidelity, and survival wording remain human review only.

Independent verification exposed a harness assumption rather than a production defect: Qwen validly represented Shield Bash once as a one-target `resolveAreaAttack` while the scenario required two `resolveAttack` calls at fixed indexes. `attackResultCount` and `attackResultApplied` now normalize both supported attack tools by actor and per-target application. They compare only structured mechanics and authoritative state; they do not inspect prose. The focused `api.combat_npc_turns_config.test.js` regression separately proves that TinyBrain independent NPC turns pre-resolve their own attack mechanics even when legacy prompt checks are disabled.

The source-controlled replay trace is `cassettes/combat/COMBAT-2-friendly-npc-attack.json` (SHA-256 `d9cddf0e72f9c37f302b17d98607f1f1fac9c71873eef64c01e40eaf2cca68f0`). Final 2026-08-10 evidence is:

- live record `attempt-6`: 51/51 original mechanical assertions, human-reviewed separate bite/shield-strike prose, and 40 completed cassette entries;
- strict replay `attempt-10`: the current 43/43 normalized assertions, 40/40 entries consumed, zero latched failures, empty cassette queue, and no llama.cpp process;
- independent live-Qwen `attempt-9`: 43/43 normalized assertions plus one bite and one shield impact, no duplicate scheduled turn, and no character declared dead contrary to state.

## Fix loop

1. Restore/promote one pre-case fixture and run one isolated `live-record` reproduction.
2. Preserve the completed cassette and triage artifacts.
3. Add the smallest parser/domain/API regression for the identified boundary.
4. Start the server with the replay profile and iterate using strict whole-turn replay without llama.cpp or ComfyUI.
5. Confirm an intentional prompt/contract change produces a fingerprint mismatch rather than stale-output reuse.
6. Restart with the intended Qwen/router profile, run `live-verify`, and perform the listed human prose review.
7. Use focused Playwright only when the contract is browser-visible; API/state correctness remains in this harness.
