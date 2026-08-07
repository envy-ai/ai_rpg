# Player-Action TinyBrain Non-XML Finalization Implementation Plan

**Goal:** Replace the non-attack repetition-buster branch's final LLM-authored `<turnResult>` / `<moveTurnResult>` response in `player-action.tinybrain.njk` with small, parsed, non-XML questions and deterministic server-side result assembly, while preserving existing normal-turn, travel, vehicle, hidden-note, time, slop, event, and scheduled-event behavior.

**Architecture:** Keep the existing draft, tool, revision, and final-audit stages. After the audit, use strict TinyBrain checkpoints to classify movement, resolve the conditional vehicle state, collect only the destination/timing/prose fields that apply, and collect hidden notes separately. End the program with a new no-LLM result-composer marker. A pure player-action result builder will validate the completed checkpoint state and create the canonical XML that the existing `/api/chat` pipeline already consumes.

**Tech stack:** Node.js CommonJS, Nunjucks TinyBrain prompt programs, strict plain-text parsers, XML DOM/serialization helpers, Node's built-in test runner, and the existing player-action travel/event pipeline.

---

## Scope

This plan changes the non-attack `config.repetition_buster` path near the end of `prompts/_includes/player-action.tinybrain.njk`.

It does not change:

- the one-shot `player-action.njk` prompt;
- question or generic-prompt handling;
- the earlier accept/reject checkpoint and its existing XML response;
- the attack-only TinyBrain branch, which does not choose between normal and travel results;
- creative-mode, NPC-action, random-event, or other TinyBrain families;
- downstream canonical `<turnResult>` / `<moveTurnResult>` parsing or travel mechanics, except for the narrow hidden-note compatibility described below.

The LLM will no longer write the final result XML in the scoped path. The server will still produce canonical XML internally because the rest of the turn pipeline uses it as a stable interchange format.

## Current Contracts That Must Be Preserved

The assembled result must remain acceptable to `parsePlayerActionProseFromXml()` and preserve these behaviors:

- A normal turn has non-empty prose and required elapsed-time reasoning plus a duration of at least one minute.
- A move turn has at least one non-empty origin, transit, or destination prose segment.
- Player destination metadata remains separate from vehicle destination metadata.
- The player's known exit-button destination and travel override remain authoritative when present.
- Vehicle travel uses the exact current vehicle name from game state rather than asking the model to reproduce it.
- A vehicle that is merely continuing its existing route while the player remains aboard produces a normal turn, not a move turn.
- Moving inside a vehicle or disembarking produces player movement metadata and omits `<vehicleInfo>`, matching the current prompt contract.
- Starting, stopping, or redirecting a vehicle while the player otherwise remains aboard may produce `<vehicleInfo>`.
- A normal turn's parsed time continues to drive need/status advancement and same-location scheduled-event interruption.
- A move turn continues through `runmoveTurnResultEventChecks()` and the existing origin/between/destination event ordering.
- Hidden notes remain stored in assistant history but remain stripped from player-facing payloads.
- Post-generation slop removal still sees the same combined visible prose.
- All new LLM questions and answers remain in the existing TinyBrain prompt log and cumulative prompt-progress group.

## Vehicle Decision Matrix

The template must ask the vehicle-specific question only when `currentVehicle` is present, and it must include the canonical `isUnderway`, `hasArrived`, destination, and ETA fields in that question.

| Player movement | Vehicle decision | Result kind | Player destination | Vehicle info |
| --- | --- | --- | --- | --- |
| `NONE` | `UNCHANGED` | Normal | Omitted | Omitted |
| `NONE` | `DEPART` | Move | Omitted | Exact vehicle name, destination, travel time |
| `NONE` | `STOP` | Move | Omitted | Exact vehicle name, `0 minutes`, no new destination |
| `NONE` | `REDIRECT` | Move | Omitted | Exact vehicle name, new destination, new travel time |
| `INSIDE_VEHICLE` | `UNCHANGED` | Move | Required | Omitted |
| `DISEMBARK` | `UNCHANGED` | Move | Required | Omitted |
| `DISEMBARK` | `STOP_FOR_EXIT` | Move | Required | Omitted, preserving the current explicit disembark rule |

Additional invariants:

- Without `currentVehicle`, only `NONE` and `DESTINATION` are valid player-movement choices.
- With `currentVehicle`, leaving for an outside location is `DISEMBARK`; `DESTINATION` is rejected to keep the decision unambiguous.
- `INSIDE_VEHICLE` cannot change the vehicle route.
- `DEPART` is offered only when the vehicle is not underway.
- `STOP` and `REDIRECT` are offered only when the vehicle is underway.
- `hasArrived` is canonical state, not a model choice. An already-recorded arrival alone does not make the player action a move turn.
- `STOP_FOR_EXIT` follows the current prompt's instruction to decide whether disembarkation requires a stop, but the current contract also says to omit `<vehicleInfo>` for disembarkation. This plan intentionally preserves that behavior instead of silently adding a new vehicle-state mutation. Mechanically stopping the vehicle during disembarkation would be a separate behavior change.

## Non-XML Checkpoint Formats

Use short, case-insensitive, exact formats that are easy to retry. Parsers may remove surrounding Markdown fences but must reject explanations, duplicate fields, unknown values, and extra non-whitespace content.

| Checkpoint | Accepted response | Parsed value |
| --- | --- | --- |
| Player movement | One exact keyword: `NONE`, `DESTINATION`, `INSIDE_VEHICLE`, or `DISEMBARK` | Canonical movement enum |
| Vehicle decision | One exact keyword from the state-dependent allowlist | Canonical vehicle enum |
| Prose scope | Comma-separated unique keywords from `ORIGIN`, `BETWEEN`, `DESTINATION` | Ordered unique segment list |
| Destination | Exactly `Location: ...` and `Region: ...`; either value may be `N/A`, but not both | `{ location, region }` |
| Duration | One supported exact duration and no commentary | `{ text, minutes }` |
| Required prose | Raw non-whitespace prose with no outer result tags | Trimmed prose |
| Hidden notes | Raw notes or exact `N/A` | String or `null` |
| Time reasoning | One non-empty plain-text explanation | Trimmed reasoning |

The destination parser should retain location and region separately. It should not collapse them to the legacy `region|location` representation until the canonical XML is parsed by the existing downstream code.

The duration parser should reuse `Utils.parseDurationToMinutes()` and validate rather than clamp:

- normal action time: integer minute result, minimum one minute;
- player travel: minimum one minute;
- moving vehicle travel: minimum one minute;
- stopped vehicle: exactly zero minutes, synthesized by the server rather than requested from the model.

## Target End-of-Prompt Flow

After the existing second-draft audit:

1. Ask what movement actually occurs in the second draft. This replaces the earlier `<travel>yes/no</travel>` decision as the authoritative result classification.
2. If the player is on a vehicle, ask the state-dependent vehicle question. Explicitly tell the model that ordinary continued vehicle motion is `UNCHANGED`, even if the action mentions waiting or riding.
3. Derive normal versus move control flow from the two parsed enums.
4. For a normal turn:
   - ask for final plain prose;
   - ask for new/changed hidden notes or `N/A`;
   - ask for the elapsed-time reasoning based on the final prose;
   - ask for the exact elapsed duration;
   - invoke the server-side result composer.
5. For a move turn:
   - use the canonical exit-button destination/travel override when one exists;
   - otherwise, ask for the player destination only when the player moves;
   - for vehicle departure or redirect, ask for the vehicle destination and travel time; use the exact current vehicle name from context;
   - for vehicle stop, synthesize `0 minutes` and do not ask for a destination;
   - ask which prose scopes are present;
   - conditionally ask for each selected prose segment, in origin/between/destination order;
   - ask for new/changed hidden notes or `N/A`;
   - invoke the server-side result composer.

Each prose prompt must repeat the combined prose-length limit, require continuity with previously generated segments, forbid adding material absent from the second draft, and retain all tool/check outcomes. The total output remains one story continuation even when it is collected in multiple checkpoints.

## Canonical Result Assembly

Create a pure `PlayerActionTinyBrainResult.js` module rather than embedding result construction in `api.js` or the generic runner.

The builder will:

- accept a named checkpoint-value map plus the immutable template context;
- reject missing, contradictory, or branch-inapplicable values;
- prefer known exit-button travel metadata over model-authored destination data;
- use `currentVehicle.name` for vehicle metadata and reject a vehicle branch if the current vehicle is missing;
- construct either one `<turnResult>` or one `<moveTurnResult>` document;
- use CDATA-safe serialization for prose and hidden-note text, including safe splitting of a literal `]]>` sequence;
- XML-escape destination names, reasoning, and duration fields;
- omit every inapplicable optional node instead of emitting empty placeholders;
- return only the canonical XML string.

Normal result shape assembled by the server:

```xml
<turnResult>
  <prose><![CDATA[...]]></prose>
  <hidden><![CDATA[...]]></hidden>
  <timePassed>
    <reasoning>...</reasoning>
    <duration>...</duration>
  </timePassed>
</turnResult>
```

The `<hidden>` child is omitted when the hidden-notes checkpoint returns `N/A`.

Move result shape assembled by the server:

```xml
<moveTurnResult>
  <vehicleInfo>...</vehicleInfo>
  <playerDestination>...</playerDestination>
  <originProse><![CDATA[...]]></originProse>
  <betweenProse><![CDATA[...]]></betweenProse>
  <destinationProse><![CDATA[...]]></destinationProse>
  <hidden><![CDATA[...]]></hidden>
</moveTurnResult>
```

Only applicable nodes are emitted. Direct move-result `<hidden>` support should be added to player-action parsing so hidden notes remain tagged in stored combined prose without contaminating any event-scoped prose segment.

## File Structure

- Create `PlayerActionTinyBrainResult.js`: pure invariant validation and canonical XML assembly.
- Create `tests/player_action_tinybrain_result.test.js`: builder and branch-matrix coverage.
- Modify `prompts/_includes/player-action.tinybrain.njk`: replace final XML instructions with parsed control flow and a terminal result-composer marker.
- Modify `TinyBrainPromptRunner.js`: add an explicit no-LLM terminal result tag and registered result builders.
- Modify `TinyBrainPromptParsers.js`: add the new strict non-XML player-action parsers.
- Modify `TinyBrainPromptFamilies.js` only if result-builder registration belongs at the allowlisted family boundary.
- Modify `api.js`: register the player-action result builder, pass authoritative travel metadata, accept direct move hidden notes, and retain the existing downstream parse path.
- Modify `LiveDeslop.js`: classify the new final-prose checkpoints as plain prose instead of treating a final LLM response as structured XML.
- Modify focused tests listed below.
- Update `docs/classes/TinyBrainPromptRunner.md`, `docs/classes/TinyBrainPromptParsers.md`, `docs/server_llm_notes.md`, `docs/api/chat.md`, and `docs/README.md` after implementation.
- Create `docs/classes/PlayerActionTinyBrainResult.md` for the new result-builder contract.

---

## Task 1: Lock Down Existing Player-Action and Vehicle Contracts

**Files:**

- Modify: `tests/tiny_brain_prompt_runner.test.js`
- Modify: `tests/api.travel_prose_destination.test.js`
- Modify: `tests/api.travel_prose_time.test.js`
- Modify: `tests/api.vehicle_travel_prose_timing.test.js`

- [ ] Add a baseline test proving an underway vehicle with no player movement and no route change is a normal turn.
- [ ] Add baseline coverage for moving inside a vehicle, disembarking, vehicle departure, vehicle stop, and redirect.
- [ ] Confirm existing destination precedence when `/api/chat` already has resolved exit-button travel metadata.
- [ ] Confirm normal action time still drives scheduled-event interruption, while move results do not use normal `<timePassed>`.
- [ ] Confirm hidden notes in normal and move results are retained in stored prose and removed from player-facing prose.
- [ ] Run the baseline tests before implementation and record any current contradictions rather than changing behavior implicitly.

## Task 2: Add Generic No-LLM TinyBrain Result Composition

**Files:**

- Modify: `TinyBrainPromptRunner.js`
- Modify: `tests/tiny_brain_prompt_runner.test.js`
- Modify: `docs/classes/TinyBrainPromptRunner.md`

- [ ] Add a Nunjucks tag such as `{% llmresult('player_action_result') %}` that emits a private terminal marker and does not create an LLM checkpoint.
- [ ] Add a `resultBuilders` runner option keyed by the allowlisted result-builder name.
- [ ] When all ordinary checkpoints are complete, detect the terminal marker, require it to be the only remaining non-whitespace content, and invoke the named builder instead of calling `complete()` again.
- [ ] Build a named assignment map from checkpoint targets and parsed values. Reject duplicate target names and missing completed values.
- [ ] Pass a read-only snapshot of assignments, checkpoint definitions, and template context to the builder.
- [ ] Require the builder to return a non-empty string. Return it as `aiResponse` while preserving conversation messages, tool invocations, log path, and progress completion.
- [ ] Append the locally assembled response to the same prompt log under an explicit `assembled final response` section. An append failure must warn and allow the turn to continue, matching existing TinyBrain logging policy.
- [ ] Keep the existing final-LLM-completion behavior unchanged for every program without an `llmresult` marker.
- [ ] Test successful composition, unknown builder, duplicate terminal marker, text after the terminal marker, builder failure, logging, no extra completion call, and unchanged legacy final completion.

## Task 3: Add Strict Non-XML Player-Action Parsers

**Files:**

- Modify: `TinyBrainPromptParsers.js`
- Modify: `TinyBrainPromptRunner.js`
- Modify: `tests/tiny_brain_prompt_parsers.test.js`
- Modify: `docs/classes/TinyBrainPromptParsers.md`

- [ ] Add and export parsers for player movement, vehicle decision, prose scope, destination, exact duration, required prose, optional hidden notes, and time reasoning.
- [ ] Register the parsers in the runner's built-in parser map or in the player-action runner options; prefer built-ins only for genuinely reusable parsers.
- [ ] Pass vehicle presence and canonical trip-state booleans as parser arguments so invalid state-dependent choices fail during the checkpoint rather than at final assembly.
- [ ] Reject outer `<turnResult>` and `<moveTurnResult>` tags from all prose answers. The LLM must not be able to bypass the new control flow by returning the old format.
- [ ] Reject unknown enum values, duplicate prose scopes, duplicate destination labels, both destination fields being `N/A`, commentary around exact choices, malformed durations, zero-minute movement, and non-integer normal action time.
- [ ] Preserve arbitrary punctuation, paragraphs, Markdown, and dialogue in prose and hidden-note answers.
- [ ] Test every valid enum and boundary plus malformed/ambiguous responses and retry-compatible error messages.

## Task 4: Implement the Pure Player-Action Result Builder

**Files:**

- Create: `PlayerActionTinyBrainResult.js`
- Create: `tests/player_action_tinybrain_result.test.js`
- Create: `docs/classes/PlayerActionTinyBrainResult.md`

- [ ] Define constants for movement, vehicle, and prose-scope enum values so the prompt, parsers, and builder share one vocabulary.
- [ ] Implement safe XML text and CDATA helpers without importing route-local functions from `api.js`.
- [ ] Implement normal-turn validation and assembly.
- [ ] Implement ordinary non-vehicle travel validation and assembly.
- [ ] Implement all rows in the vehicle decision matrix.
- [ ] Use authoritative travel metadata supplied by the route when available; reject disagreement instead of silently preferring a model value after it has already been requested.
- [ ] Do not ask for or accept vehicle name output. Copy the exact canonical name from `currentVehicle`.
- [ ] Omit empty optional nodes and require at least one selected/non-empty travel prose segment.
- [ ] Put hidden notes in a direct `<hidden>` child for both result roots.
- [ ] Validate the builder's output with strict XML parsing in tests and pass it through the same player-action parser used by the route.
- [ ] Cover XML metacharacters, literal `]]>`, multiline Markdown, hidden notes, location-only destinations, region-only destinations, combined destinations, exact durations, and every invalid cross-field combination.

## Task 5: Replace the Template's Final XML Branches

**Files:**

- Modify: `prompts/_includes/player-action.tinybrain.njk`
- Modify: `tests/tiny_brain_prompt_runner.test.js`
- Modify: `tests/player_action_tinybrain_target_location.test.js`

- [ ] Remove the early `<travel>yes/no</travel>` checkpoint as the authoritative final branch selector.
- [ ] Add the post-audit player-movement checkpoint using the exact enum vocabulary.
- [ ] Under `{% if currentVehicle %}`, add the vehicle-decision checkpoint with prompts tailored to `isUnderway`, `hasArrived`, destination, and ETA.
- [ ] Make the prompt explicitly classify ordinary continued onboard travel as `NONE` + `UNCHANGED`.
- [ ] Derive the result branch from parsed movement and vehicle decisions.
- [ ] Add normal-turn prose, hidden-note, reasoning, and duration checkpoints.
- [ ] Add move-turn destination, duration, prose-scope, conditional prose-segment, and hidden-note checkpoints.
- [ ] Do not render vehicle questions or vehicle metadata checkpoints when `currentVehicle` is absent.
- [ ] Do not render player-destination questions for vehicle-only departure/stop/redirect.
- [ ] Do not render vehicle-destination or vehicle-time questions for inside-vehicle movement or disembarkation.
- [ ] Use known exit-button destination metadata without asking the model to restate it.
- [ ] End both branches with the same `{% llmresult('player_action_result') %}` terminal marker.
- [ ] Keep mod prompt steps, tool-result continuity, prose-length instructions, and existing draft/audit prompts in their current relative order.
- [ ] Add render/runner tests for every conditional branch and assert that no scoped final prompt asks for `<turnResult>` or `<moveTurnResult>`.

## Task 6: Wire Assembly Into `/api/chat` and Preserve Downstream XML

**Files:**

- Modify: `api.js`
- Modify if needed: `TinyBrainPromptFamilies.js`
- Modify: relevant API integration tests

- [ ] Supply the result builder only for the `player_action` TinyBrain family and reject an attempt to invoke it from another family.
- [ ] Extend the immutable player-action template context with canonical resolved destination/travel data needed by the builder; do not expose mutable game objects to it.
- [ ] Remove the scoped TinyBrain final XML parser callback because the terminal builder now validates and produces the XML.
- [ ] Leave `playerActionXmlPayload`, `parsePlayerActionProseFromXml()`, move processing, scheduled-event interruption, slop removal, event checks, history storage, and client payload construction on their existing code paths.
- [ ] Extend move-result parsing to collect a direct child `<hidden>` and append it as tagged hidden context to combined stored prose, without adding it to origin/between/destination event prose.
- [ ] Strictly parse the assembled result before any mutation. Builder or parse failures must abort the turn with the normal visible error flow rather than fall back to the one-shot prompt or XML repair.
- [ ] Verify rejection handling remains unchanged because rejection still terminates at the earlier accept/reject checkpoint.

## Task 7: Adapt Live Deslop, XML-Repetition Handling, and Logging

**Files:**

- Modify: `LiveDeslop.js`
- Modify: `api.js`
- Modify: `tests/live_deslop.test.js`
- Modify: `docs/slop_and_repetition.md`

- [ ] Let stage resolution inspect the TinyBrain checkpoint/parser identity, not only `isFinal` and prompt-leading text.
- [ ] Mark each final story-prose checkpoint as `plain` live-deslop prose.
- [ ] Leave movement, vehicle, destination, duration, hidden-note, and time-reasoning checkpoints uninspected.
- [ ] Stop treating the scoped player-action terminal as structured live prose; it is locally assembled and makes no LLM request.
- [ ] Keep the ordinary post-generation slop pass on the combined parsed prose.
- [ ] Confirm `ai.xml_repetition_fix` still applies to actual LLM checkpoints but does not inspect the locally assembled XML.
- [ ] Verify the assembled-result log entry and all checkpoint parse retries use the single existing TinyBrain log.

## Task 8: Focused Regression and Documentation Pass

**Files:**

- Modify: `docs/server_llm_notes.md`
- Modify: `docs/api/chat.md`
- Modify: `docs/README.md`
- Modify: `progress.md`

- [ ] Run syntax checks:

```bash
node --check TinyBrainPromptRunner.js
node --check TinyBrainPromptParsers.js
node --check PlayerActionTinyBrainResult.js
node --check LiveDeslop.js
node --check api.js
```

- [ ] Run focused unit and integration tests:

```bash
node --test \
  tests/tiny_brain_prompt_runner.test.js \
  tests/tiny_brain_prompt_parsers.test.js \
  tests/player_action_tinybrain_result.test.js \
  tests/player_action_tinybrain_target_location.test.js \
  tests/live_deslop.test.js \
  tests/api.travel_prose_destination.test.js \
  tests/api.travel_prose_time.test.js \
  tests/api.vehicle_travel_prose_timing.test.js \
  tests/scheduled_event_api_integration.test.js
```

- [ ] Add a deterministic API-level forced-output test that exercises the complete staged normal path and confirms no final XML completion is requested.
- [ ] Add deterministic API-level cases for ordinary travel, ongoing onboard normal action, inside-vehicle movement, disembarkation, vehicle departure, vehicle stop, and redirect.
- [ ] Verify every LLM request appears in the TinyBrain log and the final assembled XML appears once as a local result section.
- [ ] Update the class, API, server-flow, slop/repetition, and index documentation to distinguish LLM-authored checkpoint answers from server-authored canonical XML.
- [ ] Run the standard non-mutating browser-game smoke check after implementation to catch unrelated runtime/client regressions. No persistent game or llama.cpp restart is required for the documentation-only planning task or should be performed without a later explicit request.

## Acceptance Criteria

- The scoped `player-action.tinybrain.njk` path never asks the LLM to produce `<turnResult>` or `<moveTurnResult>`.
- Normal versus move result selection comes from parsed control flow, including the vehicle-specific branch.
- The vehicle decision matrix above is covered by deterministic tests.
- Ordinary travel, destination metadata, vehicle state changes, prose segmentation, hidden notes, and normal action time all survive round-tripping through the existing player-action parser.
- `/api/chat` receives canonical XML and continues using the established travel, event, scheduled-event, slop, history, and client-response paths.
- Malformed or contradictory checkpoint answers retry their exact stage and ultimately fail clearly; there is no one-shot or XML-repair fallback.
- The terminal composer performs no LLM call, is logged, and does not alter other TinyBrain families.
- Documentation describes both the new non-XML LLM contract and the retained internal XML interchange contract.

