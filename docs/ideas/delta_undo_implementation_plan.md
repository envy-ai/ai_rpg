# Delta Undo and Redo Implementation Plan

## Status

Proposed. No delta undo or redo behavior is implemented yet.

## Goal

Add reliable player-turn undo and redo without rerunning prompts or depending on
autosave directory reloads. A successful undo must restore the canonical game
state that existed immediately before the selected player request, including its
chat history, world mutations, elapsed time, generated entity references,
summaries, and persistent runtime counters.

The initial implementation targets completed `POST /api/chat` turns. Later slices
can bring crafting, barter, checked containers, fast travel, Story Tools edits,
and other mutation endpoints into the same transaction journal.

This plan measures scope through affected systems, invariants, and verification
passes rather than human wall-clock estimates.

## Core Decision

Use reversible deltas between canonical serialized game-state snapshots.

Do not implement undo by calling inverse gameplay methods such as “give the item
back,” “move the player to the prior location,” or “subtract the awarded XP.” A
single turn can create or delete entities, split item stacks, rewire exits,
advance time, resolve scheduled events, alter summaries, change multiple
registries, and update mod-owned persisted fields. Maintaining hand-authored
inverse commands for every mutation path would be incomplete and brittle.

Do not apply JSON patches directly to live class instances. That would bypass
model setters, static indexes, ownership rules, and graph reconciliation. Apply a
delta to a detached serialized snapshot, validate it, then restore that snapshot
through a shared hydration path.

```text
live state
    │ capture
    ▼
canonical serialized before-state
    │ run one settled turn
    ▼
canonical serialized after-state
    │ compare in both directions
    ▼
forward patch + reverse patch + state hashes
    │
    ├── undo: after-state + reverse patch → before-state → hydrate
    └── redo: before-state + forward patch → after-state → hydrate
```

## Existing Foundations

- `Utils.serializeGameState(...)` already serializes the persistent world into
  plain save-shaped data: locations, exits, regions, players, things, factions,
  skills, chat history, generated-image records, mysteries, scheduled events,
  trackers, summaries, time, setting data, config overrides, and ID counters.
- `Utils.hydrateGameState(...)` already clears and reconstructs the corresponding
  registries.
- `performGameLoad(...)` already performs the additional runtime work needed
  after hydration: current-player selection, setting restoration, runtime counter
  restoration, queue clearing, party/location reconciliation, faction-reference
  reconciliation, image checks, and client refresh preparation.
- `/api/chat` already creates a request ID, collects turn-local chat entries, and
  runs a pre-turn autosave.
- Parent-linked `event-summary` and `status-summary` entries already provide a
  useful player-facing description of many consequences.

The turn-diff summaries are presentation metadata, not an authoritative undo
source. They do not cover every mutation and frequently lack exact before-values.

## Initial Scope

The first complete slice supports:

- Undoing the latest settled `/api/chat` turn.
- Redoing an undone turn without rerunning any LLM prompt or random roll.
- A bounded in-memory undo stack and redo stack.
- The full persistent state represented by the canonical snapshot contract.
- Turn-owned asynchronous work that is registered with the transaction.
- Explicit rejection when the current state no longer matches the journal.
- Full client refresh after undo or redo.
- Normal autosave after a successful undo or redo when autosaves are enabled.

## Initial Non-Goals

- Deleting generated image files, logs, or old autosave directories during undo.
- Reversing external provider requests that have already been sent.
- Persisting the journal across a server restart in the first slice.
- Undoing manual save creation or removing save-notice entries from other saves.
- Supporting arbitrary admin, Story Tools, crafting, barter, or slash-command
  edits before those paths are wrapped as transactions.
- Branch visualization or a full save-timeline manager.
- Deriving inverse behavior from event-summary prose.

## Player-Visible Semantics

One Undo action means “restore the game to immediately before the latest settled
player request began.” It therefore includes:

- The stored user message and assistant narration.
- Event/status/tool-debug/check entries parented to the turn.
- Turn-start need/status processing performed after the request arrived.
- Player, NPC, inventory, quest, faction, relationship, tracker, mystery, status,
  location, region, exit, vehicle, and scheduled-event changes.
- World-time advancement and every time-based consequence processed during that
  interval.
- NPC follow-up turns and turn-owned prompt results that settle before the
  transaction closes.
- Persistent summary and prompt-scheduler counters.
- Generated-image registry references created or changed by the transaction.

Undo does not delete generated files from disk. If the restored state no longer
references a generated file, it becomes an ordinary orphan eligible for a
separate cleanup workflow.

Redo reapplies the exact saved forward delta. It does not call Kimi or another
model, reroll checks, regenerate entities, or rerun event parsing.

A new foreground mutation after undo clears the redo stack.

## Canonical Snapshot Contract

Create one shared snapshot builder used by saves, undo capture, hash checks, and
restore tests. It must return detached JSON-compatible data; shallow copies of
`chatHistory`, generated-image records, or subsystem payloads are not sufficient.

Suggested envelope:

```js
{
  snapshotVersion: 1,
  persisted: {
    gameWorld,
    players,
    things,
    factions,
    skills,
    chatHistory,
    generatedImages,
    mysteryBoxes,
    mysteryThreads,
    scheduledEvents,
    trackers,
    pendingRegionStubs,
    worldTime,
    calendarDefinition,
    setting,
    gameConfigOverrideYaml,
    chatSummaries,
    sceneSummaries
  },
  runtime: {
    currentPlayerId,
    saveFileSaveVersion,
    plotSummaryTurnCounter,
    plotExpanderTurnCounter,
    improvementPromptTurnCounter,
    tonalScaleEvaluationTurnCounter,
    tonalScaleEvaluationResult,
    tonalScaleEvaluationResultTurnCounter,
    mysteryBoxCleanupTurnCounter,
    offscreenNpcActivityState,
    npcAliasesGenerated
  }
}
```

The implementation must audit `performGameSave(...)` and `performGameLoad(...)`
for every persistent runtime field rather than treating the example as exhaustive.
The same helper should populate save metadata and undo snapshot runtime fields so
the two paths cannot drift.

### Excluded And Special Fields

Exclude volatile or save-directory identity fields from patches and state hashes:

- Snapshot/save timestamps.
- `saveName` and save `source`.
- The active save directory/current-save handle.
- Derived total-count metadata.
- Active HTTP streams, request emitters, prompt processes, pending confirmations,
  in-flight image jobs, and other transient queues.

Treat ID counters specially:

- Do not include `metadata.idCounters` in ordinary patch/hash comparison.
- Record the observed counter high-water values separately.
- On undo or redo, restore each counter to the maximum of the current high-water
  value and the target snapshot value.
- Never lower an allocator counter merely because the entity that consumed an ID
  was undone. This prevents IDs referenced by old chat entries, redo records, or
  generated assets from being reused on a new branch.

### Canonicalization And Hashing

- Deep-clone through the same JSON boundary used by persistence.
- Recursively sort object keys before hashing.
- Preserve array order where order is meaningful, including chat history,
  inventory lists, party lists, quest objectives, and summary rows.
- Normalize or remove volatile metadata before diffing.
- Hash canonical JSON with SHA-256.
- Store `beforeHash` and `afterHash` on every journal entry.

An undo request must fail explicitly if the current canonical hash does not equal
the top record's `afterHash`. A redo request must likewise require `beforeHash`.
This detects unjournaled mutations instead of silently applying a patch to an
unexpected state.

## Delta Format

Use a well-tested RFC 6902 JSON Patch implementation rather than hand-writing
JSON Pointer parsing. Add the selected package as an ordinary locked runtime
dependency and enable operation validation plus prototype-modification
protection.

Generate the two directions independently:

```js
const forwardPatch = compare(before, after);
const reversePatch = compare(after, before);
```

Suggested journal record:

```js
{
  version: 1,
  id: "undo_<uuid>",
  kind: "chat-turn",
  requestId: "client-request-id",
  createdAt: "2026-07-31T00:00:00.000Z",
  label: "Travel to the old observatory",
  beforeHash: "sha256:...",
  afterHash: "sha256:...",
  forwardPatch: [],
  reversePatch: [],
  idCounterHighWater: {},
  chatEntryIds: [],
  affectedEntityRefs: [],
  backgroundTaskLabels: []
}
```

`chatEntryIds` and `affectedEntityRefs` are UI/audit metadata only. The patches
remain the source of truth.

## Transaction Lifecycle

Add a `TurnUndoManager` with one active foreground transaction and bounded undo
and redo stacks.

### Begin

At the start of `/api/chat`:

1. Acquire a server-side state-mutation lock.
2. Wait for the previous foreground transaction's registered mutating background
   work to settle.
3. Reject if another foreground mutation is active.
4. Capture the canonical before-state before turn-start need/status processing,
   region-secret work, chat insertion, or movement flags mutate persistent state.
5. Create the transaction using the request ID and a generated transaction ID.

Requests that fail validation before mutation discard the tentative transaction.

### Run

- Execute the existing turn pipeline normally.
- Register every asynchronous task that can mutate persistent state.
- Collect visible chat-entry IDs and turn-diff entity references for labeling.
- Keep the state lock logically owned by the transaction until its registered
  mutating tasks settle, even if the HTTP response has already been sent.

The server may return narration before background settlement, but Undo and the
next foreground mutation remain unavailable until the transaction finalizes.
The UI should show that the timeline is still settling rather than silently
accepting overlapping mutations.

### Commit

After the foreground handler and all registered mutating tasks settle:

1. Run completion-only mutations currently attached to response hooks, including
   corpse processing, before the final snapshot.
2. Capture the canonical after-state.
3. Generate forward and reverse patches.
4. Verify each patch against a detached clone:
   - before + forward equals after;
   - after + reverse equals before.
5. Store the journal entry if the state changed.
6. Clear redo because a new branch was committed.
7. Release the mutation lock.
8. Broadcast updated undo/redo availability.

### Failure

- A validation failure before persistent mutation discards the transaction.
- An error after mutation attempts to restore the captured before-state through
  the same safe restore function used by Undo.
- If restoring the before-state also fails, propagate a combined explicit error
  containing both failures. Do not continue with a placeholder state.
- Failed background prompts that made no persistent changes are recorded as
  settled failures and do not prevent commit.
- A background task that partially mutates before failing must be rolled back as
  part of the transaction failure or refactored to compute first and commit once.

## Background Work And State Epochs

The current turn path intentionally starts several promises without awaiting
them, including plot summaries, plot expansion, supplemental story information,
offscreen NPC activity, mystery cleanup, improvement suggestions, tonal-scale
evaluation, scene-summary work, and image generation.

Replace raw `void somePrompt(...)` scheduling for mutating work with an explicit
registration helper:

```js
transaction.trackTask("offscreen-npc-activity", () =>
  runOffscreenNpcActivityPrompt(...)
);
```

Requirements:

- Nested tasks inherit or receive the originating transaction ID.
- A tracked task cannot register new work after its transaction has finalized.
- Undo, redo, save load, and new-game reset increment a global state epoch.
- Async commits verify their captured epoch immediately before mutating state.
- Results from a stale epoch fail explicitly and are not applied.
- Image bytes that finish downloading after an epoch change may remain on disk,
  but their stale job must not update a restored entity or image registry.
- Pending quest/ability/player-input confirmations block undo until resolved or
  cancelled through an explicit existing cancellation path.

An audit must classify every fire-and-forget call in `/api/chat` as:

1. read-only and safe to ignore;
2. tracked mutating work;
3. moved into the synchronous foreground transaction; or
4. intentionally excluded with a documented reason.

## Runtime Restore Path

Factor the reusable parts of `performGameLoad(...)` into a helper such as
`restoreSerializedRuntimeState(snapshot, options)`.

The helper must:

- Validate the snapshot version and required top-level shapes.
- Increment the state epoch before clearing transient work.
- Clear image/job/NPC-generation/ability-selection queues that can hold stale
  object references.
- Hydrate through `Utils.hydrateGameState(...)`.
- Restore the active setting and persistent runtime counters.
- Resolve and set `currentPlayer`, `scope.currentPlayer`, and
  `Globals.currentPlayer` from the snapshot player ID.
- Reconcile party-member location state and faction references.
- Rebuild static registries and derived indexes through existing hydration APIs.
- Preserve the active save identity during undo/redo.
- Preserve ID-counter high-water marks.
- Avoid load-only migrations, setting-generation prompts, backfill persistence,
  and current-save directory changes unless explicitly requested by the caller.
- Return the same client-facing state fragments needed for a full UI refresh.

Undo patch application itself must be atomic:

1. Capture the current canonical snapshot.
2. Apply and validate the requested patch on a detached clone.
3. Attempt to restore the patched result.
4. If restore fails, restore the captured current snapshot.
5. Return success only after the target state and state hash are confirmed.

## Undo And Redo API

Add endpoints under a focused API namespace:

### `GET /api/undo/status`

Returns:

```js
{
  enabled: true,
  busy: false,
  busyReason: null,
  canUndo: true,
  canRedo: false,
  undoDepth: 3,
  redoDepth: 0,
  nextUndo: {
    id: "undo_...",
    label: "Travel to the old observatory",
    createdAt: "..."
  },
  nextRedo: null
}
```

### `POST /api/undo`

- Requires no active foreground mutation or unsettled tracked task.
- Verifies the current `afterHash`.
- Applies the top reverse patch and restores the resulting state.
- Moves the record from undo to redo.
- Runs the normal autosave path when enabled.
- Broadcasts a complete refresh and updated undo status.

### `POST /api/redo`

- Requires no active mutation.
- Verifies the current `beforeHash`.
- Applies the top forward patch.
- Moves the record from redo back to undo.
- Runs autosave and full refresh behavior matching Undo.

Use `409` for busy state or a state-hash conflict, `400` for malformed requests,
and `500` for patch/restore failures. Responses must include a concrete error and
diagnostic reason; do not silently clear the stack and claim success.

## Configuration

Add a validated section to `config.default.yaml`:

```yaml
undo:
  enabled: false
  max_entries: 20
```

- `enabled` must be boolean.
- `max_entries` must be a non-negative integer; `0` disables journal retention.
- Do not clamp invalid values. Reject them through normal configuration
  validation.
- The first rollout can remain opt-in until the focused and browser tests pass in
  regular development use.

Future persistence settings belong in a later schema revision rather than being
accepted and ignored in the first implementation.

## UI

Add Undo and Redo controls beside the chat-page Save/Load actions.

- Disable both while the timeline is settling, a prompt is active, a
  confirmation is pending, or the corresponding stack is empty.
- Show the next transaction label in the tooltip and confirmation dialog.
- Undo should require confirmation when the delta includes an important or
  critical turn-diff row, a location change, entity creation/deletion, or a
  completed quest.
- After success, replace client chat/player/location/sidebar state from the
  server response rather than trying to reverse DOM changes locally.
- Restore chat scroll near the new end of history.
- Surface hash conflicts and restore failures in the existing client error modal
  with the server backtrace.
- Update state through realtime notifications so multiple open tabs agree.

SCSS changes belong in `public/css/main.scss`; compile `public/css/main.css`
before finishing implementation.

## Out-Of-Band Mutations

The initial journal covers `/api/chat`, but the game has many other mutation
surfaces. Until each is transaction-aware:

- A non-journaled mutating endpoint should call
  `TurnUndoManager.invalidateHistory(reason)` before applying its mutation.
- Undo and redo hash checks remain the final guard against missed invalidation.
- Read-only routes must not invalidate history.
- Manual save does not invalidate history because it does not change canonical
  world state apart from its visible save-notice entry; the save-notice behavior
  needs an explicit product decision and test.
- Loading a save, starting a new game, or reloading state always clears undo and
  redo stacks and increments the state epoch.

Later slices should wrap complete crafting, barter, checked-container, travel,
and Story Tools transactions instead of invalidating the journal.

## Mod Support

Registered Player and Thing extension fields already serialized by `toJSON()`
participate automatically.

Add optional mod hooks only for persistent mod state that lives outside the
normal save snapshot:

```js
registerUndoStateProvider({
  id,
  capture,
  restore,
  validate
});
```

- Provider IDs must be unique and stable.
- Captured state must be JSON-compatible.
- Restore failures abort the whole undo and trigger restoration of the original
  current snapshot.
- A mod that mutates persistent external state without a registered provider or
  normal serializer must invalidate undo history explicitly.

## File Impact

Expected additions:

- `StateDelta.js`: canonicalization, hashing, patch generation/application, and
  round-trip validation.
- `TurnUndoManager.js`: transaction lifecycle, background-task tracking, stacks,
  busy state, epoch handling, and API-facing status.
- `tests/state_delta.test.js`.
- `tests/turn_undo_manager.test.js`.
- `tests/api.undo.test.js`.
- `docs/classes/StateDelta.md`.
- `docs/classes/TurnUndoManager.md`.
- `docs/api/undo.md`.

Expected modifications:

- `Utils.js`: shared detached runtime snapshot and restore support.
- `api.js`: transaction boundary, tracked background work, undo/redo routes,
  autosave integration, invalidation calls, and full-refresh response.
- `server.js`: manager construction/dependency wiring and startup validation.
- `Globals.js`: state epoch accessors if the epoch is globally owned.
- `ModExtensionRegistry.js`: optional undo-state providers in the mod-support
  slice.
- `config.default.yaml` and configuration validation/docs.
- `views/index.njk`: Undo/Redo controls and script loading.
- `public/js/chat.js` or a focused `public/js/undo.js`: status, confirmation,
  requests, refresh, and error handling.
- `public/css/main.scss` and compiled `public/css/main.css`.
- `docs/api/chat.md`, `docs/api/serialization.md`, `docs/ui/chat_interface.md`,
  `docs/config.md`, and `docs/README.md`.
- `package.json` and `package-lock.json` for the selected RFC 6902 dependency.

## Implementation Tasks

### Task 1: Characterize Current State Boundaries

- [ ] Add a focused test helper that captures the current serialized runtime
  state without writing a save directory.
- [ ] Enumerate every field added to save metadata outside
  `Utils.serializeGameState(...)`.
- [ ] Enumerate every transient queue cleared by `performGameLoad(...)`.
- [ ] Enumerate fire-and-forget work started from `/api/chat` and classify it as
  read-only, mutating, or unknown.
- [ ] Add characterization tests for the current pre-turn autosave ordering,
  turn-start need/status mutation, response-finish corpse processing, and
  background chat-entry mutation.

Exit condition: the plan's snapshot and transaction boundaries are backed by
tests of current behavior rather than assumptions.

### Task 2: Build Canonical Snapshot And Delta Primitives

- [ ] Add the RFC 6902 dependency.
- [ ] Implement detached snapshot normalization.
- [ ] Implement volatile-field exclusion and ID-counter extraction.
- [ ] Implement stable canonical JSON and SHA-256 hashes.
- [ ] Implement forward/reverse patch creation.
- [ ] Implement validated, prototype-safe patch application to clones.
- [ ] Add tests for object creation/deletion, nested field changes, arrays, chat
  appends, stack splits, entity deletion, summaries, and mod extension fields.
- [ ] Add round-trip property tests proving forward and reverse equality.
- [ ] Add immutability tests proving later live mutations cannot alter a captured
  snapshot or stored patch.

Exit condition: arbitrary supported serialized snapshots can round-trip in both
directions without touching live state.

### Task 3: Extract Safe Runtime Restore

- [ ] Factor hydration/reconciliation shared by save load and undo into one
  internal helper.
- [ ] Preserve the existing `/api/load` behavior and response contract.
- [ ] Add an undo mode that preserves current save identity and skips load-only
  prompts/backfills.
- [ ] Restore all persistent runtime counters from the snapshot envelope.
- [ ] Preserve monotonic ID high-water values.
- [ ] Increment the state epoch and clear stale queues before hydration.
- [ ] Add rollback-on-restore-failure behavior.
- [ ] Add before → mutate → restore tests covering every save subsystem.

Exit condition: a detached snapshot can replace live runtime state atomically and
all existing save/load tests still pass.

### Task 4: Implement `TurnUndoManager`

- [ ] Implement active transaction state and the shared mutation lock.
- [ ] Implement begin, task tracking, settle, commit, abort, undo, redo, clear,
  invalidate, and status methods.
- [ ] Validate `max_entries` without clamping.
- [ ] Bound the undo stack and discard oldest entries intentionally.
- [ ] Clear redo on a new committed branch.
- [ ] Enforce before/after hash preconditions.
- [ ] Add epoch checks for stale async commits.
- [ ] Add focused concurrency tests for overlapping begins, unsettled tasks,
  nested task registration, task failure, undo while busy, and load/new-game
  clearing.

Exit condition: the manager's lifecycle and stack semantics work against an
in-memory fake snapshot adapter.

### Task 5: Integrate `/api/chat`

- [ ] Begin capture before the first persistent turn-start mutation.
- [ ] Wrap the complete foreground handler in transaction commit/abort handling.
- [ ] Replace mutating fire-and-forget calls with tracked tasks.
- [ ] Move or register response-finish corpse processing before settlement.
- [ ] Ensure turn-local chat entry collectors remain valid until tracked tasks
  settle.
- [ ] Prevent the next foreground mutation from overlapping an unsettled prior
  transaction.
- [ ] Build labels and affected-entity metadata from the stored user entry and
  turn-diff summaries.
- [ ] Verify rejected/no-op/read-only prompt modes do not create meaningless undo
  entries unless canonical state actually changed.

Exit condition: one deterministic chat turn produces one verified journal record
containing all its synchronous and tracked asynchronous mutations.

### Task 6: Add Undo/Redo API And Refresh

- [ ] Add status, undo, and redo routes.
- [ ] Return explicit busy and hash-conflict responses.
- [ ] Reuse the normal autosave helper after successful restore.
- [ ] Broadcast chat, player, location, world-time, sidebar, and undo-status
  refreshes.
- [ ] Clear journal state on save load and new-game reset.
- [ ] Add API tests for empty stacks, successful undo/redo, busy state, branch
  clearing, hash conflicts, hydration errors, and autosave-disabled behavior.

Exit condition: API clients can safely undo and redo a settled deterministic
turn without invoking an LLM.

### Task 7: Add Chat UI Controls

- [ ] Add accessible Undo and Redo buttons near Save/Load.
- [ ] Load initial status and listen for realtime status changes.
- [ ] Disable actions while busy or unavailable.
- [ ] Add confirmation language based on the transaction label/severity.
- [ ] Replace client state from the successful server response.
- [ ] Route errors into the existing error modal with backtrace details.
- [ ] Add SCSS and compile the corresponding CSS.
- [ ] Add source-level UI tests and a browser test for turn → undo → redo.

Exit condition: the player can see availability, confirm the action, and observe
the complete UI return to the expected state.

### Task 8: Expand Mutation Coverage

- [ ] Audit and wrap crafting/processing/salvage/harvest transactions.
- [ ] Audit barter commit and haggle mutations.
- [ ] Audit checked-container opening.
- [ ] Audit map/Favorites fast travel and direct travel endpoints outside chat.
- [ ] Audit quest, faction, inventory, character, and world Story Tools editors.
- [ ] Audit mutating slash commands.
- [ ] Add invalidation calls for every remaining unsupported mutation route.
- [ ] Add mod undo-state providers if an enabled mod owns state outside normal
  serialization.

Exit condition: every known mutation surface is either transactional or
explicitly invalidates undo history.

### Task 9: Optional Journal Persistence

- [ ] Define `undoJournal.json` with a versioned schema.
- [ ] Persist only verified committed records, not active transactions.
- [ ] Load the journal only when its top hash matches the hydrated save state.
- [ ] Reject or discard incompatible journal versions with an explicit warning.
- [ ] Include enabled-mod identity and snapshot version in compatibility checks.
- [ ] Ensure autosave pruning does not orphan a journal referenced by another
  save.
- [ ] Add save/load/restart tests for undo and redo continuity.

Exit condition: persistence is deterministic and cannot apply a journal to the
wrong save branch.

## Verification Matrix

At minimum, deterministic integration coverage must include:

| Scenario | Undo assertion | Redo assertion |
| --- | --- | --- |
| Plain narration | User/assistant entries removed | Exact entries restored |
| Time passage | Time and derived ticks restored | Exact time/ticks reapplied |
| Travel | Player, party, visits, exits, time restored | Destination state restored |
| Item transfer/stack split | Ownership/count/IDs restored | Exact split/move restored |
| Item or NPC creation | Entity and references removed | Same IDs and references restored |
| Entity deletion/consumption | Entity/container contents restored | Deletion reapplied |
| Quest/reward | Objectives, XP, currency restored | Exact reward state restored |
| Status/needs/disposition | Exact values and effects restored | Exact values reapplied |
| Scheduled event | Queue, resolution, prose, time restored | Resolution reapplied |
| Tracker/mystery/summary | Records and counters restored | Records and counters reapplied |
| Generated image completion | Registry reference restored safely | Reference reapplied; file untouched |
| Mod extension field | Serialized mod field restored | Field reapplied |
| Background prompt | Undo unavailable until settlement | Completed result reapplied |
| New action after undo | Redo stack cleared | Not applicable |
| Unjournaled mutation | Explicit hash conflict | No partial patch |

Required verification commands should include focused unit/integration tests,
the existing save/load suite, the turn state-diff test, and the default headless
browser suite:

```bash
node --test tests/state_delta.test.js
node --test tests/turn_undo_manager.test.js
node --test tests/api.undo.test.js
node --test tests/turn_state_diff_drawer_ui.test.js
npm run test:e2e:headless
```

Store test artifacts under `./tmp`. If SCSS changes, run the corresponding SCSS
build before final verification.

## Definition Of Done

- Undo restores canonical state equality with the captured before-state, except
  for explicitly documented monotonic ID-counter high-water values and excluded
  operational files/logs.
- Redo restores canonical equality with the original after-state without running
  prompts, rolls, or generators.
- Every patch is hash-guarded and validated before live hydration.
- Failed restore attempts return the original live state or raise an explicit
  combined failure.
- No stale background task can mutate state after undo, redo, load, or new game.
- The latest supported turn can be undone from every open client tab with a full
  consistent refresh.
- Unsupported mutation paths invalidate the journal explicitly.
- Existing save/load, chat, event, turn-diff, mod-field, and browser tests remain
  green.
- Configuration, API, class, serialization, and UI documentation are updated and
  indexed in `docs/README.md`.
