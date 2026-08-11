# TinyBrain Player-Action Destination Revisit Implementation Plan

**Status:** Implemented on 2026-08-07.

**Goal:** When the staged TinyBrain player-action flow moves the player to an existing location, resolve that location while the prompt is still running, give the model canonical destination facts, avoid asking for travel time that the game can calculate, and let the model plan previously visited-location changes before it writes destination prose. Continue running the existing while-you-were-away (WYWA) bookkeeping after arrival, but suppress its separate player-facing prose when that TinyBrain turn already supplied destination prose.

**Primary constraint:** The one-shot player-action and one-shot WYWA paths must remain behaviorally unchanged. The reduced WYWA presentation is an explicit per-invocation mode used only by the staged TinyBrain arrival path; it is not a global change to WYWA.

---

## Desired Player Experience

For a staged TinyBrain movement turn:

1. The player destination is resolved to an existing canonical location as soon as the destination answer is accepted, when possible.
2. The prompt immediately gains that location's canonical name, region, and description.
3. If the game can determine the trip duration, the model is told the duration and is not asked to invent one.
4. If the destination was visited before and has a usable prior-visit time, the model sees:
   - how long the player will have been away at arrival;
   - a comma-separated list of NPCs currently at the destination; and
   - a short checkpoint asking what, if anything, changed during that interval.
5. The checkpoint accepts either no changes or a brief Markdown bullet list.
6. When changes are listed and destination prose is requested, those accepted bullets are shown directly to the destination-prose checkpoint with an explicit instruction to depict them.
7. Arrival bookkeeping still runs through WYWA. If the active WYWA family and the arrival invocation are in the new TinyBrain presentation mode, its normal visible `while-you-were-away-player` entry is not pushed because the destination prose already serves that purpose.

The player should see one coherent arrival scene rather than destination prose followed by a repetitive `What changed` narration.

## Scope

### In scope

- The non-attack staged `player-action.tinybrain.njk` movement branch.
- Both authoritative committed-route destinations and destinations selected by the TinyBrain model.
- Read-only resolution of an already existing destination during the prompt.
- Canonical destination description injection.
- Programmatic travel-time reuse.
- Previously visited destination context and one parsed changes checkpoint.
- Passing accepted changes into the final destination-prose prompt.
- An invocation-scoped WYWA presentation flag that suppresses only its visible prose push.
- Tests and documentation for all of the above.

### Out of scope

- Any change to `player-action.njk` or other one-shot prose prompts.
- Any global change to the one-shot WYWA template or parser.
- Replacing or substantially redesigning WYWA bookkeeping.
- Suppressing WYWA prose for map travel, Favorites travel, teleportation, or another arrival that did not already receive replacement TinyBrain destination prose.
- Creating a missing destination during prompt-time resolution.
- Asking event checks to infer player movement; player-action remains authoritative for movement.
- Persisting new destination-analysis state in saves. The accepted analysis is turn-local prompt state.
- Heuristic semantic comparison between the bullet list and destination prose. The prompt will require inclusion, but the parser will not guess whether two prose statements mean the same thing.

## Current Behavior to Preserve

- TinyBrain player-action still assembles canonical `<turnResult>` or `<moveTurnResult>` XML locally through `PlayerActionTinyBrainResult.js`.
- Authoritative exit-button travel metadata continues to override model-authored movement decisions.
- Vehicle-specific control flow remains unchanged: destination resolution must not bypass or reorder the existing questions about movement inside a vehicle, disembarkation, departure, stop, or redirect.
- Accompanying-character selection continues to accept exact canonical names or aliases and moves the canonical actors with the player.
- Origin, transit, and destination prose remain separate event-check scopes.
- WYWA continues to enforce its pre-arrival visit snapshot and configured age threshold before it runs.
- A qualifying WYWA run continues to parse and apply need values, NPC travel, item/scenery movement, hidden history, and scoped event checks in the existing order.
- The hidden `while-you-were-away` history entry remains stored even when visible prose is suppressed.
- Non-TinyBrain WYWA continues to run slop removal and push visible `while-you-were-away-player` prose exactly as it does now.
- Direct travel flows without replacement destination prose retain existing visible WYWA narration.

## Resolved Design Decisions and Gotchas

1. **Prompt-time destination resolution must be read-only.** The normal movement pipeline may later create or finish resolving an unknown destination, but this checkpoint must never create locations or regions. A missing or ambiguous existing location is treated as unresolved prompt context, not silently matched to a guess.

2. **Resolution needs one canonical implementation.** Authoritative route travel already carries an id-backed destination, whereas the model supplies location and region text. Both paths should produce the same immutable prompt context shape so description, visit history, NPC presence, and travel time cannot disagree across branches.

3. **The destination description must appear immediately after resolution.** For a model-selected destination, inject the canonical facts directly after `player_action_destination` succeeds. For committed travel, inject them at the equivalent point after the authoritative destination is selected, while preserving the existing vehicle gates.

4. **Travel-time resolution uses nullability, not truthiness.** `Location.findShortestTravelTimeMinutes()` can validly return `0`. Any non-null integer is a resolved value. The prompt and result builder must share the same resolved value so one does not ask for a duration that the other later overrides.

5. **Elapsed absence is measured at expected arrival.** Compute canonical total world minutes at prompt time, add the resolved or model-parsed travel duration, then subtract `lastVisitedTime`. This makes “last X minutes/hours/days” describe the state when the destination prose occurs rather than when the player starts moving.

6. **Legacy visit data can be incomplete.** `visited: true` without a finite `lastVisitedTime` proves a revisit but cannot support an exact X-duration question. Show canonical destination facts, but skip the timed-change checkpoint rather than inventing an interval.

7. **NPC presence must not leak hidden state.** The displayed comma-separated list should contain canonical names for living, non-hidden NPCs physically present at the destination, sorted deterministically. Exclude the player and characters currently moving with the player because they are not present there before arrival. Render `None` when the list is empty.

8. **The changes checkpoint is advisory prose planning, not a second event engine.** It tells the destination writer what to depict. Existing event checks and WYWA remain responsible for structured mutations. The changes parser validates response shape, while subsequent event extraction handles state semantics.

9. **Do not add brittle prose-to-bullet semantic validation.** This is the same intentionally skipped class of heuristic described in the TinyBrain parser-hardening backlog: a parser cannot reliably prove that free prose semantically includes every bullet. The destination-prose instruction must be strong and explicit, but omission is not grounds for a string-overlap parser failure.

10. **WYWA suppression must be invocation-scoped.** Do not infer it merely from global `ai.tinybrain`. The caller must explicitly state that this arrival already has TinyBrain replacement destination prose, and the selected WYWA family must be TinyBrain. Mixed-family configurations leave the one-shot WYWA path untouched.

11. **Suppress only the visible WYWA prose push.** Keep the current WYWA prompt response, parsing, state application, hidden entry, and scoped event checking. In suppression mode, do not create the normal `while-you-were-away-player` chat entry and do not run visible-prose-only slop cleanup/attachment creation. The internal prose remains available to the existing WYWA bookkeeping/event-check path.

12. **Parent linking needs a deterministic substitute.** Code that currently prefers `whileYouWereAwayResult.visibleEntry` must use the already stored player-action arrival entry when WYWA visible prose is suppressed. This preserves turn grouping and the `What changed` drawer without fabricating an empty visible entry.

## Proposed Destination Context

Add a small read-only resolver module, tentatively `PlayerActionDestinationContext.js`, whose public result is JSON-safe and contains no mutable game objects:

```js
{
    resolved: true,
    locationId: "...",
    locationName: "Town Square",
    regionId: "...",
    regionName: "Old Town",
    description: "...",
    visitedBefore: true,
    lastVisitedTime: 12345,
    presentNpcNames: ["Ada", "Merek"],
    travelTimeMinutes: 15
}
```

When no existing destination can be resolved, return an explicit unresolved result with the accepted destination text and no fabricated facts. Resolution errors caused by ambiguous canonical data should remain explicit; a genuinely nonexistent model-selected destination is a valid unresolved case because downstream movement may create it.

Resolution precedence:

1. Exact authoritative destination id from committed travel.
2. Exact region plus exact location name from the parsed destination checkpoint.
3. Exact globally unique location name only when the model supplied no usable region.
4. Otherwise unresolved; never fuzzy-match or create.

Description rules:

- Use the canonical location description when present.
- Use the existing canonical stub-description representation if that is how the resolved location exposes its description.
- Render an explicit `No description recorded` fact if the existing location has no description; do not ask another LLM or silently omit the field.

## New Checkpoint Contract

Register a parser such as `player_action_destination_changes`.

Accepted answers:

- Exact `NONE` or `N/A`, normalized to an empty list.
- One or more Markdown bullet lines, each beginning with `- `, normalized to an ordered array of trimmed strings.

Rejected answers:

- Headings, preambles, conclusions, or paragraphs outside the bullet list.
- Empty bullets.
- XML wrappers or old result tags.
- Numbered lists.
- Mixed sentinel and bullet output.
- Duplicate bullets after case/whitespace normalization.

The prompt should say “briefly” and discourage paragraph-length bullets, but the parser should not enforce a character limit. The purpose is to steer concise planning, not reject a useful answer solely for length.

Example checkpoint prompt:

```text
At expected arrival, Rowan will have been away from Town Square for 3 hours.
NPCs currently present: Ada, Merek

Briefly list anything that might have changed there during that time.
Use Markdown bullets with one concrete change per line, or answer exactly NONE.
Do not narrate the arrival yet.
```

If the parser returns a nonempty list, the destination-prose checkpoint receives the canonical list and this instruction:

```text
The following destination changes were already accepted. Depict all of them
naturally in the destination prose; do not add a second recap or bullet list:
- ...
- ...
```

The existing instruction forbidding material absent from the second draft must be narrowed for destination prose: accepted canonical destination facts and accepted revisit-change bullets are additional authorized material.

## Target TinyBrain Player-Action Flow

The movement and vehicle decision tree remains in its current order. The destination-specific portion becomes:

1. Determine the authoritative player movement type using the existing route override or parsed movement checkpoint.
2. Preserve all current vehicle questions and branch restrictions.
3. Select the player destination:
   - use the committed route destination when present; or
   - ask and parse `player_action_destination` when the model must choose it.
4. Resolve the selected destination against existing game state without mutation.
5. Immediately append canonical destination name, region, and description to the live TinyBrain transcript when resolution succeeds.
6. Determine travel time:
   - prefer authoritative committed-route time;
   - otherwise calculate the shortest known route time from the origin to the resolved destination;
   - if either produces a non-null integer, assign it as the canonical travel duration and do not render a duration checkpoint;
   - otherwise ask the existing travel-duration checkpoint and parse it normally.
7. Ask for accompanying characters using the existing candidate/alias machinery. Keep their selection available when preparing the destination NPC list so arrivals are not described as already waiting there.
8. Ask for prose scopes using the existing parser.
9. If `DESTINATION` is selected and the destination is an existing, previously visited location with a finite prior visit time:
   - calculate absence through expected arrival;
   - render canonical present-NPC names;
   - run `player_action_destination_changes`.
10. Ask for selected prose sections in origin/between/destination order. The destination question includes the canonical description and, when nonempty, the accepted change bullets.
11. Assemble the canonical move result locally with exactly the same destination, travel duration, companion names, and prose sections that the prompt used.
12. Continue through existing movement, time, event-check, and arrival processing.

If the destination is unresolved, the prompt follows its existing path: no canonical description, no programmatic route lookup against a guessed entity, and no revisit checkpoint.

## Travel-Time Contract

Extend `PlayerActionTinyBrainResult` so a move can receive exactly one effective source of player travel time:

- the authoritative committed-travel context;
- the newly resolved programmatic time; or
- the parsed model duration.

The builder must validate semantic consistency:

- A supplied programmatic duration must be a non-negative integer and must refer to the same canonical destination used in the result.
- A parsed duration must be absent when the program supplied one.
- A parsed duration remains required when neither authoritative nor programmatic time exists.
- No clamping is introduced.
- Vehicle travel-duration rules remain separate and unchanged.

This validation belongs in the result builder/parser boundary so malformed or contradictory checkpoint state fails before the XML reaches downstream movement code.

## WYWA Integration

Add an explicit option to `runWhileYouWereAwayPrompt`, tentatively:

```js
{
    suppressVisibleProse: true,
    replacementArrivalEntry: playerActionEntry
}
```

Set it only when all of the following are true:

1. The arrival originated from the staged TinyBrain player-action family.
2. The accepted move result contains nonempty destination prose.
3. The invoked WYWA family is also TinyBrain.
4. The caller has the replacement player-action arrival entry available for parent linking.

Behavior with the option enabled:

- Render and run the existing TinyBrain WYWA program.
- Parse the same response fields.
- Apply the same need, NPC, thing, scenery, history, and scoped event-check behavior.
- Store the same hidden `while-you-were-away` entry.
- Do not run the visible prose through player-facing slop removal.
- Do not create or push a `while-you-were-away-player` entry.
- Return `visibleEntry: null` and the replacement arrival entry as the preferred parent-link target.

Behavior with the option absent or false is byte-for-byte compatible at the API contract level with the current path.

### Invocation matrix

| Arrival source | Player-action family | WYWA family | Replacement destination prose | Visible WYWA prose |
| --- | --- | --- | --- | --- |
| Ordinary player action | TinyBrain | TinyBrain | Yes | Suppressed |
| Ordinary player action | TinyBrain | TinyBrain | No | Preserved |
| Ordinary player action | TinyBrain | One-shot | Any | Preserved |
| Ordinary player action | One-shot | Any | Any | Preserved |
| Map/Favorites/direct travel | Any | TinyBrain | No | Preserved |
| Teleport/other arrival | Any | TinyBrain | No | Preserved |

## Implementation Tasks

### Task 1: Add destination-resolution coverage before changing behavior

**Files:**

- Modify `tests/player_action_tinybrain_target_location.test.js`.
- Modify `tests/location.shortest_travel_time.test.js` only if the resolver exposes a shared route helper contract.
- Add `tests/player_action_destination_context.test.js`.

Coverage:

- authoritative id resolution;
- exact region/location resolution;
- globally unique location-only resolution;
- ambiguous and missing destinations;
- canonical and stub descriptions;
- `visited` plus finite/missing `lastVisitedTime`;
- deterministic visible NPC list with hidden, dead, player, and accompanying-character exclusions;
- non-null `0` travel duration.

### Task 2: Implement a pure destination-context resolver

**Files:**

- Add `PlayerActionDestinationContext.js`.
- Add `tests/player_action_destination_context.test.js`.
- Later add `docs/classes/PlayerActionDestinationContext.md` during implementation documentation.

Requirements:

- accept origin, parsed/authoritative destination identity, and companion exclusions;
- use `Globals`, `Location`, and `Region` canonical indexes rather than duplicating lookup logic;
- return an immutable JSON-safe snapshot;
- make no changes to locations, visits, exits, NPCs, or time;
- distinguish unresolved absence from invalid ambiguity explicitly.

### Task 3: Make resolved context available inside the live TinyBrain program

**Files:**

- Modify `TinyBrainPromptRunner.js` if a new allowlisted render-state helper/result assignment is needed.
- Modify `TinyBrainPromptFamilies.js` to register the player-action-only resolver boundary.
- Modify `api.js` to provide the immutable origin/destination inputs.
- Modify `tests/tiny_brain_prompt_runner.test.js`.
- Modify `tests/tiny_brain_prompt_families.test.js`.

Requirements:

- resolve authoritative destinations before their facts are rendered;
- resolve model-selected destinations immediately after `player_action_destination` parses;
- retain resolved context in turn-local runner assignments;
- ensure retries do not mutate state or duplicate facts in the transcript;
- log the injected destination facts through the existing prompt log.

### Task 4: Add and register the revisit-changes parser

**Files:**

- Modify `TinyBrainPromptParsers.js`.
- Modify `TinyBrainPromptFamilies.js` or the existing parser registry location.
- Modify `tests/tiny_brain_prompt_parsers.test.js`.

Requirements:

- accept exact `NONE`/`N/A` or strict Markdown bullets;
- return a JSON-safe array;
- normalize harmless outer whitespace only;
- reject mixed formats, duplicates, XML, and prose outside bullets;
- allow checkpoint-local retry with the parser error included in normal retry diagnostics;
- do not impose a character limit.

### Task 5: Update the TinyBrain player-action template

**Files:**

- Modify `prompts/_includes/player-action.tinybrain.njk`.
- Modify `tests/player_action_tinybrain_target_location.test.js`.
- Modify `tests/tiny_brain_prompt_runner.test.js`.

Requirements:

- preserve the vehicle decision tree;
- inject canonical description immediately after resolution;
- use a resolved travel duration without asking the LLM;
- run the change checkpoint only for a selected `DESTINATION` scope and a timestamped revisit;
- show the comma-separated canonical present-NPC list or `None`;
- use a readable exact interval derived from canonical minutes;
- pass nonempty accepted bullets to the destination-prose checkpoint;
- authorize canonical facts and accepted bullets as additions beyond the second draft;
- leave origin and between prose prompts unchanged except where shared duration/context variables require wiring.

### Task 6: Extend deterministic result assembly for programmatic duration

**Files:**

- Modify `PlayerActionTinyBrainResult.js`.
- Modify `tests/player_action_tinybrain_result.test.js`.

Requirements:

- accept the resolved canonical destination/time snapshot;
- validate destination identity and mutually exclusive time sources;
- serialize the resolved time through the existing canonical XML shape;
- reject contradictory or branch-inapplicable state before downstream XML parsing;
- retain every existing vehicle and accompanying-character invariant.

### Task 7: Add invocation-scoped WYWA visible-prose suppression

**Files:**

- Modify `api.js`.
- Modify `tests/api.while_you_were_away_helpers.test.js`.
- Modify `tests/while_you_were_away_prompt.test.js` only if family selection/context rendering needs coverage.
- Modify parent-link tests such as `tests/realtime_visible_prose_refresh.test.js` and `tests/turn_state_diff_drawer_ui.test.js` if their contracts are affected.

Requirements:

- add an explicit option rather than reading a global inside WYWA;
- gate the option using the invocation matrix above;
- keep the hidden entry and all bookkeeping/event processing;
- skip only visible-prose slop cleanup, attachment creation, and chat-entry push;
- return a stable result shape with `visibleEntry: null` and an explicit parent-link target;
- never suppress one-shot WYWA or an arrival without replacement destination prose.

### Task 8: Thread the suppression flag from the player-action arrival path

**Files:**

- Modify the `/api/chat` player-action movement path in `api.js`.
- Modify `tests/api.travel_prose_destination.test.js`.
- Modify `tests/api.travel_prose_time.test.js`.
- Add or extend a focused TinyBrain arrival/WYWA integration test.

Requirements:

- derive the flag from the actual selected prompt families and accepted destination prose, not merely `ai.tinybrain`;
- pass the already stored player-action entry as the replacement parent;
- leave direct move and teleport call sites unchanged unless they explicitly provide replacement prose;
- preserve travel summaries, state-diff grouping, autosave sequencing, and client refresh ordering.

### Task 9: Regression verification

Run syntax checks for every altered JavaScript file, then run at minimum:

```text
node --test tests/player_action_destination_context.test.js
node --test tests/tiny_brain_prompt_parsers.test.js
node --test tests/tiny_brain_prompt_runner.test.js
node --test tests/tiny_brain_prompt_families.test.js
node --test tests/player_action_tinybrain_result.test.js
node --test tests/player_action_tinybrain_target_location.test.js
node --test tests/api.travel_prose_destination.test.js
node --test tests/api.travel_prose_time.test.js
node --test tests/api.while_you_were_away_helpers.test.js
node --test tests/while_you_were_away_prompt.test.js
```

Also run the focused event-check sequencing tests because destination prose remains the source for destination-scoped events.

Manual prompt-log verification should confirm:

- canonical destination facts appear immediately after resolution;
- programmatic duration removes the redundant duration checkpoint;
- prior accepted checkpoints remain in context;
- a malformed change list retries only that checkpoint;
- accepted bullets appear in the destination-prose request;
- the qualifying WYWA run is logged and applies bookkeeping but pushes no visible prose;
- a one-shot or direct-travel WYWA invocation still pushes its visible prose.

Do not restart the server unless separately requested.

### Task 10: Implementation documentation

After implementation, update:

- `docs/classes/PlayerActionDestinationContext.md` (new);
- `docs/classes/TinyBrainPromptRunner.md`;
- `docs/classes/TinyBrainPromptParsers.md`;
- `docs/classes/PlayerActionTinyBrainResult.md`;
- `docs/api/chat.md`;
- `docs/server_llm_notes.md`;
- `docs/README.md`.

Mark this plan implemented only after all relevant focused tests pass.

## Acceptance Criteria

- A resolvable existing destination is represented by canonical identity and description in the live TinyBrain prompt before destination prose is written.
- An unknown destination is not created or guessed during prompting.
- A known route duration is used without a travel-duration LLM checkpoint, including a valid duration of zero.
- A timestamped revisit with destination scope triggers exactly one retryable Markdown change-planning checkpoint.
- The checkpoint displays a deterministic, non-leaking comma-separated NPC list.
- `NONE` produces no extra destination instruction; accepted bullets are repeated in the destination-prose prompt.
- Canonical result assembly uses the same destination and duration shown to the model.
- Existing vehicle and companion behavior remains intact.
- A qualifying staged TinyBrain arrival runs normal WYWA bookkeeping but creates no `while-you-were-away-player` entry.
- The hidden WYWA entry and its applicable mutations/event checks still occur.
- One-shot WYWA and arrivals without replacement TinyBrain destination prose behave exactly as before.
- Parent linking and the turn-diff drawer remain coherent without an empty or duplicate arrival entry.
- Parser failures retry locally and no malformed checkpoint output reaches the final turn response.
