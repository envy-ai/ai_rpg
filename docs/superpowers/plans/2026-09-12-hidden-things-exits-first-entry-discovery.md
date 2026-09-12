# Hidden Things and Exits: First-Entry Discovery Plan

## Goal

Allow generated location items, scenery, and exits to start hidden. On the player's first entry into a location, resolve one automatic perception check for each hidden target. A success reveals the target; a failure leaves it hidden. Later prose can reveal a still-hidden Thing or exit through explicit XML events.

This plan supersedes the automatic-discovery and mutation details in the archived `2026-05-22-hidden-items-scenery-exits.md` draft. The current implementation baseline is NPC-only visibility, current `ThingMutationService` atomic mutation, staged TinyBrain event extraction, and formula-based DCs.

## Product Decisions

1. A hidden target stores a difficulty **label**, not a numeric DC:
   - `Trivial`
   - `Easy`
   - `Medium`
   - `Hard`
   - `Very Hard`
   - `Legendary`
2. The check resolves through the existing `resolveActionOutcome(...)` unopposed-check path. Its DC comes from `formulas.dc.<label>` with the owning location's persisted `baseLevel` as `level`.
3. The first-entry scan is code-owned and prompt-free. It uses the active setting's `perceptionAttribute` and optional `perceptionSkill`, with no stealth opponent and no invented circumstance modifiers.
4. Each hidden target gets its own roll. A failed target remains hidden and is not automatically rerolled on later visits.
5. A later reveal event is authoritative bookkeeping after prose establishes discovery. It clears hidden state without performing a second check.
6. `revealHiddenThing` covers both items and scenery. `revealHiddenExit` covers directed `LocationExit` records.
7. Hidden exits are optional secret routes. Generation and graph validation must not leave a newly entered location without at least one visible usable way out.
8. Hidden records remain in trusted location payloads and GM prompt context with explicit hidden markers, matching the NPC pattern. The ordinary browser UI omits them unless its spoiler-neutral `show hidden` control is active.
9. A hidden target has the invariant `{ hiddenFromPlayer: true, discoveryDifficulty: valid label }`. Revealing it atomically changes that pair to `{ false, null }`. Legacy saves default to visible/null.
10. This scope adds reveal events, not general LLM-driven hide events. Creation/edit surfaces can set initial hidden state; adding runtime `hideVisibleThing` or `hideVisibleExit` events can be a later feature.

## Known Gotchas and Pre-Implementation Decisions

1. `config.default.yaml` currently defines `medium` as `floor(15 + level * 1.1)` and `hard` as `floor(10 + level * 1.2)`. “Hard” is therefore easier than “Medium” at ordinary location levels. Do not silently change global formulas as part of this feature. Confirm whether to correct the formula separately before accepting monotonic-difficulty tests.
2. Location exits are directed even when a connection is conceptually bidirectional. Treat hidden state per directed edge. An explicitly generated hidden edge is hidden only from its source side; a synthetic reverse edge defaults visible. If both sides should be hidden, generation must explicitly mark both directed edges. This also prevents a failed discovery roll from trapping the player in a destination whose only return edge was synthesized.
3. The shared item template serves location contents, inventories, crafting output, container contents, and other generators. Only location-content generation should be invited to create hidden Things. Other scopes must emit visible/null unless an explicit trusted seed requests otherwise.
4. Thing stack identity must include hidden state. A hidden stack must not auto-merge into an otherwise identical visible stack and thereby leak or erase its visibility. After reveal, normal later merge operations may combine equivalent stacks; reveal itself should not silently rewrite quantities.
5. `Location.visited` is world-level state, not per-character state. The plan follows the current single-active-player arrival model. Supporting independent discovery per player would need separate per-player reveal state and is outside this change.

## State and Domain Model

### Shared discovery helper

Create `HiddenDiscovery.js` as the single source of truth for:

- canonical difficulty labels and case/spacing normalization;
- validation of the hidden/difficulty pair;
- construction of a `Plausible` unopposed perception-check payload;
- resolution metadata shared by automatic checks and check-result logging.

Do not duplicate label parsing in `Thing`, `LocationExit`, API routes, generators, and Events.

### `Thing`

Add private persisted fields and atomic access:

- `hiddenFromPlayer: boolean` (default `false`);
- `discoveryDifficulty: canonical label | null` (default `null`).

Update constructor/hydration, `toJSON()`, `copy(...)`, `replaceStateFrom(...)`, metadata compatibility, checksum behavior, and setters. Prefer a paired method such as `setHiddenDiscovery({ hiddenFromPlayer, discoveryDifficulty })` so temporary invalid states cannot occur.

Add both fields to `ThingFieldRegistry.BUILTIN_FIELDS`. Expose them to trusted create/update flows together, and make `ThingMutationService` validate the complete candidate before commit. Ensure registered mod fields cannot claim these new core names.

### `LocationExit`

Add the same two persisted fields to construction, `update(...)`, `getDetails()`/`toJSON()`, hydration through `Location.fromJSON`, and explicit exit-creation helpers.

Use an atomic paired setter/update validation. `createReverse(...)` and other synthetic reverse creation default to visible/null unless the caller explicitly provides hidden metadata for that directed edge.

### Persistence compatibility

- Missing fields in old saves hydrate as visible/null.
- Invalid saved combinations fail with an explicit target id/name in the error.
- Save/reload preserves failed hidden state and successful reveal state.
- No separate “attempted” flag is needed because the first-entry trigger uses the destination's pre-arrival visit snapshot.

## Generation and Creation Paths

### Location Things

Extend the shared Thing XML schema with:

```xml
<hiddenFromPlayer>true|false</hiddenFromPlayer>
<discoveryDifficulty>Trivial|Easy|Medium|Hard|Very Hard|Legendary, required only when hidden</discoveryDifficulty>
```

Pass an explicit `allowHiddenDiscovery` template variable:

- `true` for initial/location item-and-scenery generation;
- `false` for player/NPC inventory, barter stock, crafting, processing, salvage, harvest output, and container-content generation;
- explicit trusted seeds may still fix both fields when a caller intentionally creates a hidden location Thing.

Update `parseThingsXml(...)` to parse strictly and reject hidden entries with missing/invalid difficulty. Feed the parsed fields through every current candidate/batch validation path so a malformed member rejects the whole generated batch without partial registration.

Prompt guidance should make hidden content occasional, physically present, and discoverable. It must not hide required crafting stations, all generated scenery, or every portable item merely to make the scene mysterious.

### Exits

Add hidden/difficulty fields to all generated exit schemas that create directed edges:

- region location-blueprint `<exits>`;
- location expansion `<newExits>`;
- region-entry/connected-region exit definitions where appropriate.

Extend the corresponding strict parsers and retry feedback. Preserve the declaration on the source-directed edge through `ensureExitConnection(...)`; do not accidentally stamp an existing unrelated connection or its synthetic reverse.

Validation must reject a generated layout that makes hidden edges necessary for basic connectivity or leaves an entered location with no visible exit. `newExitDiscovered` continues to create a visible exit because the prose has already discovered it.

### Trusted create/edit surfaces

Add the paired fields to:

- `POST /api/things` and `PUT /api/things/:id`;
- Thing create/edit modals and canonical field schemas;
- `POST /api/locations/:id/exits` and a new/update exit route used by the editor;
- `createThing` and `createExit` only where those GM tools intentionally create world state before player discovery.

Invalid combinations return explicit 400/tool-visible validation errors. A UI hidden checkbox enables a required difficulty dropdown; clearing hidden also clears difficulty.

## Automatic First-Entry Discovery

Create a single orchestrator, for example:

```text
runAutomaticHiddenDiscoveryForFirstEntry({
  player,
  location,
  wasVisitedBeforeArrival,
  parentId,
  collector,
  requestId
})
```

Behavior:

1. Return without rolling unless `wasVisitedBeforeArrival === false`.
2. Snapshot the location's hidden direct Things and hidden outgoing exits before resolving any checks.
3. For each snapshot target, build an unopposed perception plausibility using its stored label.
4. Let `resolveActionOutcome(...)` calculate the DC from the destination `baseLevel` through existing formula configuration.
5. Atomically reveal successful targets; leave failures unchanged.
6. Record a normal structured check-results row with metadata `{ automaticHiddenDiscovery, targetType, targetId, targetName }`.
7. Apply the existing `hide_hide_checks` privacy behavior to failed rows so the failed check does not disclose a target's identity to the client.
8. Request one location refresh if any target became visible.

Use the existing `Globals.getPlayerArrivalWasVisitedBeforeMove(...)` snapshot rather than the post-move `location.visited` value. Wire the helper into every real player-arrival path that currently runs automatic hidden-NPC checks:

- `/api/chat` travel, including TinyBrain movement;
- `/api/player/move` and non-story-tool teleport/fast travel;
- vehicle arrival/disembarkation paths that commit a player location change;
- initial new-game placement after the starting location's exits and Things have been generated.

Do not run it for story-tool teleports that intentionally bypass normal arrival processing, NPC movement, crafting/location modification while the player stays in place, or ordinary revisits.

Keep NPC discovery's newly-shared-NPC logic unchanged. The two systems can share plausibility/result helpers, but their triggers differ.

## Later Reveal Events

Add two core event tags and keys:

- XML `revealHiddenThing` -> `reveal_hidden_thing`;
- XML `revealHiddenExit` -> `reveal_hidden_exit`.

Suggested strict shapes:

```xml
<revealHiddenThing>
  <thingId>Exact id from current hidden Thing context</thingId>
  <thingName>Exact current name</thingName>
  <description>How the prose established discovery</description>
</revealHiddenThing>

<revealHiddenExit>
  <exitId>Exact id from current hidden exit context</exitId>
  <destinationName>Exact displayed destination name</destinationName>
  <description>How the prose established discovery</description>
</revealHiddenExit>
```

Require ids and validate the accompanying names. This avoids ambiguity from duplicate Thing names and multiple routes to the same destination.

Wire the tags through:

- `TINY_BRAIN_EVENT_TAG_TO_KEY`, required fields, scene-stage allowlist, and event prompt order;
- the shared XML schema template and standard XML parser mapping;
- TinyBrain authoritative hidden-target lists and semantic validation;
- grouped/legacy parsing only if that compatibility mode still accepts core additions;
- event handlers, structured results, event summaries, and `locationRefreshRequested`.

Handler rules:

- resolve only a currently hidden target directly owned by the event's current location context;
- ignore an idempotent repeat for an already-visible target, but reject an id/name mismatch or a target from another location;
- clear hidden state and difficulty atomically;
- do not roll: the event records that the checked prose already made the reveal true;
- order Thing reveal before pickup/container/harvest handlers, and exit reveal before movement validation, so “find and take/use/travel through it” can work in one chronological turn;
- do not reinterpret `itemAppear`, `sceneryAppear`, or `newExitDiscovered` as reveals when they refer to an existing hidden id. Prompt instructions must choose the reveal tag instead of creating a duplicate.

## Prompt Context and Leakage Prevention

Keep hidden Things/exits in GM context so prose and event extraction can reveal them later, but mark them structurally:

- hidden Things: id, exact name, type, description, difficulty, and `<hidden>true</hidden>`;
- hidden exits: id, source direction, destination name, description, difficulty, and `<hidden>true</hidden>`.

Add shared instructions that hidden records are GM-only facts: do not mention, imply, use, target, route through, or count them in player-visible prose until an automatic success or explicit reveal event establishes discovery.

For compact short-description mode, render hidden rows in an unambiguous structured block instead of losing the hidden/id markers in plain compact text. Supply the same authoritative lists directly to TinyBrain scene-event stages, similar to hidden NPC name handling.

Ensure action suggestions, destination context, lookup tools, shortest-path calculation, and player-facing summaries do not present hidden targets as available. Internal GM/admin callers may opt into hidden graph/entity data explicitly.

## API, Travel, and Interaction Gates

Trusted location responses may include hidden records with markers, matching NPC payload behavior. All ordinary player interaction must still be rejected server-side:

- movement through a hidden exit;
- pathfinding or route suggestions that use hidden exits;
- pickup, give, split, combine, consume, salvage, harvest, open-container, crafting/processing selection, module operations, or other world interaction with a hidden location Thing.

Centralize this in helpers such as `assertThingVisibleToPlayerForInteraction(...)` and `assertExitVisibleToPlayerForTravel(...)`; do not scatter slightly different checks across routes. Admin edit/delete/teleport operations can remain available, but must be clearly treated as trusted story-tool operations.

If an event reveals and immediately interacts with a target, the reveal handler must execute first. Normal transfer into player/NPC inventory should require the target already visible, ensuring inventories never acquire an unrevealed hidden Thing through gameplay paths.

## UI

Mirror the existing hidden-NPC debugging experience without leaking counts:

- add one spoiler-neutral eye control to `Items & Scenery` and one to `Exits`;
- keep controls enabled even when no hidden target exists;
- omit hidden targets and exclude them from visible counts by default;
- when `show hidden` is active, render hidden cards/exit rows translucent with a clear hidden badge;
- keep hidden Things' gameplay actions disabled and hidden exits' travel buttons disabled until authoritative reveal;
- expose hidden state and difficulty in the existing Thing and exit editors for trusted manual editing.

Implement styles in `public/css/main.scss` and compile `public/css/main.css` with `npm run scss:build:main`.

## Test Plan

### Domain and persistence

- Thing/LocationExit constructor, atomic mutation, copy/reverse, checksum/stack merge, JSON round-trip, legacy defaults, and invalid-pair tests.
- Save/reload after failed automatic checks and after event/automatic success.
- Synthetic reverse visibility and explicit two-sided hidden edge tests.

### Generation and parsing

- Location Thing prompt/parser accepts valid hidden item/scenery entries and rejects missing/unknown labels atomically.
- Non-location generation prompts cannot spontaneously create hidden inventory/container/crafting output.
- Region/location exit generation preserves per-direction hidden state and rejects hidden-only essential connectivity.
- API/chat-tool create and edit paths validate paired fields.

### Automatic checks

- First entry success reveals; first entry failure stays hidden.
- Each hidden item, scenery object, and exit gets exactly one independent check.
- DC/`locationLevel` comes from the destination `baseLevel` and configured formula.
- Revisit does not reroll; staying in place does not roll; story-tool teleport does not roll.
- Starting-location first entry is covered.
- Failed rows obey `hide_hide_checks`; success requests a location refresh.
- Existing automatic hidden-NPC tests remain unchanged and passing.

### Events

- Standard and TinyBrain parsers accept both new tags, reject missing fields/id-name mismatch, and enforce current-location hidden-target allowlists.
- Reveal is idempotent, direct, and does not call `resolveActionOutcome` again.
- Hidden Thing “reveal then pickup” and hidden exit “reveal then travel” work in one turn without duplicate creation or duplicate rolls.
- Origin/destination event sections reveal only targets in their own location context.

### API/UI/security

- Location payloads retain hidden markers; normal UI filters rows/counts.
- Show-hidden mode styles but cannot interact/travel.
- Direct HTTP attempts to use a hidden Thing or exit fail explicitly.
- Map, action suggestions, and shortest known route omit hidden exits.
- Playwright smoke test covers first-entry failure, later reveal refresh, and successful interaction after reveal.

### Verification commands

Run focused Node tests first, then affected suites and UI checks:

```bash
node --check HiddenDiscovery.js
node --check Thing.js
node --check ThingFieldRegistry.js
node --check ThingMutationService.js
node --check LocationExit.js
node --check Events.js
node --check server.js
node --check api.js
node --check chat_tool_calls.js
node --test tests/hidden_discovery_models.test.js tests/hidden_discovery_generation.test.js tests/hidden_discovery_events.test.js tests/hidden_discovery_arrival.test.js tests/hidden_discovery_api.test.js tests/ui.hidden_things_exits.test.js tests/ui.hidden_npcs.test.js
npm run scss:build:main
npm run test:e2e:headless -- --grep "hidden things and exits"
```

Do not restart the game server without explicit permission.

## Documentation Updates During Implementation

Update durable behavior in:

- `docs/classes/Thing.md`
- `docs/classes/LocationExit.md`
- `docs/classes/Events.md`
- `docs/classes/EventsEventTypes.md`
- `docs/classes/EventsXmlEventSchema.md`
- `docs/classes/Globals.md`
- `docs/api/chat.md`
- `docs/api/common.md`
- `docs/api/things.md`
- `docs/api/locations.md`
- `docs/server_llm_notes.md`
- `docs/ui/chat_interface.md`
- `docs/README.md`

The final implementation notes should state that difficulty labels are persisted, numeric DCs are formula-derived from the owning location level, the first-entry trigger is visit-snapshot-based, and later reveal events are authoritative rather than additional checks.
