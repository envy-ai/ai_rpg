# Story Authoring

`story-authoring` lets the model choose the protagonist's dialogue and major decisions while the existing game resolves attempts, checks, travel, NPC reactions and world changes. The game's narrative history is the output; use its existing history export for text or HTML.

## Using the panel

On Play, open the **Story Authoring** disclosure above the narrative. Enter a scene or chapter goal and optional author notes. **Save notes and goal** persists edits on the current protagonist. **Start** begins a new scene and resets its completed-turn count; **Resume** continues an unfinished saved scene. A completed scene requires an explicit new Start.

**Pause after this turn**, or **Ctrl+Shift+P**, prevents further actions and lets submitted work finish. Pausing during decision generation prevents that decision from submitting an action. Notes are saved at the next decision boundary, or immediately with Save; the narrator receives the direction captured for the current action. **Stop & Undo** uses the existing cancellation and latest-autosave restoration action. If pause or cleanup also fails, the first operation error remains the rejected error and the visible stack includes the secondary failure; narrative input-response errors retain the server stack and code. Missing checkpoints and other failures appear through the game's existing stack-bearing error popup.

Keep Play open while writing. Closing or reloading the page sends a pause request and ends browser scheduling. A submitted server turn may still finish. Restored saves contain author data and progress with execution paused. The mod follows normal autosave configuration; editing notes does not force an independent disk save.

When a pending ability modal blocks the page, its **Use Story Authoring** button brings the same author panel into the modal so Start/Resume remains accessible without making human picks. The panel returns to the chat pane when the modal closes. During writing a registered ability UI controller claims the interaction while canonical API submissions resolve every level; pausing restores normal manual selection.

The [browser runner UI lifecycle](StoryAuthoringRunner.md) documents the shared native widgets, owned hook/listener cleanup and the separate cached/final departure boundaries.

## Reviewed Stories handoff

The [Stories workspace](StoryEditor.md) prepares human-approved sub-scene direction separately from the manual goal/notes workflow. Play URLs with `storyPacket` retrieve the frozen server packet; an already open Play page can receive the same packet through the named `airpg.story-authoring.handoff` BroadcastChannel without navigation. Packet goal AND notes are shown read-only, with an explicit **Start reviewed sub-scene** action. The manual draft is retained and **Return to manual goal writing** restores it. Opening Stories uses a separate tab so the writing owner stays open.

Packet starts include `packetId` alongside existing owner/client/resume fields. Resume uses the saved packet identity. Canonical browser decisions, choices, input and settlement remain unchanged. At completion, Play presents the actual-outcome review link and stays stopped until that outcome is accepted and a next reviewed packet is explicitly prepared/started. Synchronization errors block advancement. Missing-library saved stories require explicit copy in Stories before new packet preparation; copied settled evidence can recover a pending outcome review without manufacturing completion. Story library saves remain separate from existing game autosaves.

## Controller and persistence

`StoryAuthoringController.js` owns one transient server run. `Player.getModState('story-authoring')` / `setModState(...)` persist `goal`, `notes`, `sceneId`, `startLocationId`, `completedTurns`, `latestAction`, `completed`, `completionReason`, and `completionEvidenceId`. A missing namespace in an older save has empty goal/progress and the active world profile's `modSettings['story-authoring'].defaultNotes`. Invalid saved settings raise an explicit error.

The browser owns a unique page `ownerId`; it also supplies the existing chat `clientId`. Runs have a `runId`, captured runtime generation, player id, phase, heartbeat and one-use `decisionId`. Heartbeats run every ten seconds; the server lease expires after 45 seconds without a heartbeat. Expiry invalidates any unsubmitted decision. Submitted chat/choice work retains ownership until its completion boundary, so page disconnection cannot release it early.

Phases are `idle`, `deciding`, `ready`, `turn`, `choice`, `input`, `finalizing`, and `settling`. A pending quest or ability choice submits through its canonical API route with the one-use token; the existing offer update/broadcast and deferred game-intro behavior remain authoritative. Choices do not count as gameplay turns. Point allocations use canonical player attribute/skill methods, integer pool checks and configured maxima; they never use admin pool overrides. All offered names are validated before mutation.

The gameplay-request guard invalidates the run immediately when load, new game or Stop & Undo is requested, before lifecycle preparation can await a prompt. Runtime-reset hooks invalidate it again at the authoritative generation boundary. The guard enforces matching run, client, generation, player, one-use decision and exact action/choice payload immediately before API mutation. Other gameplay writes are blocked while the run owns the game; save, lifecycle and prompt cancellation endpoints remain available. Narrative text input and technical recovery responses retain their existing endpoint.

The turn-completion hook starts an observed server finalization promise for ordinary HTTP-200 turns without skipped events, recovery/time-skip/post-prose halt, quest reward errors or postprocessing errors. Progress is recorded only after detached continuity work succeeds. A submitted turn still finalizes and records progress after Pause or browser close. Finalization errors release ownership, retain the original error/stack as transient `runFailure` for the current or next Play page, and do not count progress; reset or explicit Start clears that diagnostic. The browser waits for HTTP completion, strict rendering/world refresh, and `settle` before another decision. Images do not block the next decision. Failed or missing outcomes stop writing and surface the original error; they do not count as successful progress.

## Prompt contract and information boundaries

Public-passage projection applies the shared prompt-history diagnostic exclusions before its existing role/type/visibility allowlists and recent-history window. Legacy or retagged tool/check dumps cannot become protagonist context or execution evidence. Original canonical chat records remain unchanged.

`prompts/next-action.njk` renders one tool-free JSON decision prompt through `LLMClient.chatCompletion`, using the configured provider and model. It works with standard and TinyBrain game turns without changing game-turn routing. No max-token override is supplied. Every attempt, effective correction messages, transport error and rejected decision is logged through `LLMClient.logPrompt`. Invalid JSON, fields or choices receive the configured `ai.retryAttempts` correction opportunities; a remaining failure pauses.

The driver deliberately projects public fields instead of serializing the whole storyteller base context. It includes protagonist identity/personality, abilities, stats, inventory, active needs, known goals/quest objectives and party identities, public current scene entities and revealed exits, plus the latest 24 eligible visible story entries with hidden notes stripped, including random events and player-facing return narration. Hidden entities/exits, AI notes, mystery data, secret quest notes, plot analysis and hidden continuity are omitted. Author notes/goal are a separate creative-direction block, explicitly not character knowledge. Active run direction is XML-escaped into a mod base-context contribution for ordinary and TinyBrain narration; it cannot override resolved mechanics or justify the protagonist knowing secrets.

Strict variants:

- `{"kind":"action","action":"..."}`: nonblank attempted normal gameplay. `/`, `?`, `@`, `\\`, `#`, `!`, `>` command prefixes and forced-roll/prompt markers are rejected, including signed numeric tokens such as `<+3>`.
- `{"kind":"complete","reason":"...","evidenceId":"..."}`: completion reason references an actual visible recent assistant entry. Success, failure or established resolution can end a scene; mere intentions cannot.
- `{"kind":"quest","confirmationId":"...","accepted":true}`: exact current quest-offer id and boolean choice.
- `{"kind":"abilities","level":1,"selectedAbilityNames":["..."]}`: exact pending level, required number of distinct offered names.
- `{"kind":"allocation","pool":"attribute","name":"...","amount":1}`: pool is `attribute` or `skill`, exact offered name, positive integer within available points and maximum.
- `{"kind":"answer","answer":"..."}`: nonblank answer to a narrative input request during the submitted turn.

Pending quests, abilities and available point allocations are resolved before action/completion decisions. The parser refuses other kinds during these gates. Technical confirmations, integer rolls and vehicle recovery pause and use the existing game input UI; narrative text questions are answered by the model as the protagonist.

## Mod API and integration hooks

All routes return `{success:true,...}` or `{success:false,error,stack,code?}`:

| Route | Purpose |
| --- | --- |
| `GET /api/mods/story-authoring/state` | Loaded-game availability, persisted state, transient owner/phase and runtime generation. |
| `PUT /api/mods/story-authoring/settings` | Save `goal` and `notes`; reject edits by a competing page during a run. |
| `POST /api/mods/story-authoring/start` | Acquire a run with `ownerId`, `clientId`, optional `resume:true`. |
| `POST /api/mods/story-authoring/heartbeat` | Renew the owned run's lease. |
| `POST /api/mods/story-authoring/pause` | Prevent scheduling; invalidate ready decisions and retain submitted work until completion. |
| `POST /api/mods/story-authoring/decision` | Settle context, generate/validate next decision, apply allocation or return a one-use action/choice token. |
| `POST /api/mods/story-authoring/settle` | After submitted work, wait for continuity and return to idle. |
| `POST /api/mods/story-authoring/input` | Generate a protagonist answer to a narrative question during an owned turn. |

Run operations require `ownerId` and `runId`. Reusable hooks used are `registerGameplayRequestGuard`, `registerRuntimeResetContributor`, `registerTurnCompletionContributor`, `registerGameplayRequestSettlementContributor`, `getRuntimeGenerationId`, `isGameplayBusy`, `waitForTurnContextWork`, and the browser's `registerPlayerInputRequestHandler`, `registerPlayerAbilitySelectionHandler` and strict `dispatchAutomatedMessage`. The client sends `modRequest:{modName:'story-authoring',runId,decisionId}` with actions and canonical choices.

Enabled mods are fixed at server startup. Activating this new mod requires a server restart; obtain permission before restarting and do not load a save during that restart.

## Verification

Mod-local tests live in `../tests`; browser scripts/specs live in `../playwright_scripts`. From the repository root, run the focused controller and browser-runner tests:

```bash
systemd-run --wait --collect --pipe \
  -p MemoryMax=16G -p MemorySwapMax=0 -p "WorkingDirectory=$PWD" \
  node --test mods/story-authoring/tests/*.test.js \
  tests/llmclient.scoped_cancellation.test.js tests/pagefeedback.owned_jobs.test.js \
  tests/runtime_protagonist_setup.test.js
```

Run all three isolated browser flows through the current user's systemd manager:

```bash
systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 \
  env PLAYWRIGHT_BROWSERS_PATH=/home/bart/.cache/ms-playwright \
  STORY_AUTHORING_ARTIFACT_ROOT=tmp/story-authoring-browser-verification \
node mods/story-authoring/playwright_scripts/verify_isolated_flow.js standard tinybrain choices
```

The focused missing-field editor fixture renders the real Stories template and JavaScript with mocked API transport. It needs no server and no model provider:

```bash
systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 \
  env PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4174 \
  PLAYWRIGHT_BROWSERS_PATH=/home/bart/.cache/ms-playwright \
  PLAYWRIGHT_HTML_OUTPUT_DIR=tmp/story-form-fill-report \
  ./node_modules/.bin/playwright test --project=chromium --workers=1 \
  --output=tmp/story-form-fill-results tests/e2e/story-form-fill.spec.js
```

The pre-creation form-fill fixture renders the complete `mod-page.njk` shell, shared header, real Story Editor assets, and shared Page Feedback with mocked API transport. It checks responsive native-dialog layering, focus and Escape behavior, retained seed/concurrent edits, cancellation and provider errors, and that story creation waits for the explicit Create action:

```bash
systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 \
  env PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4175 \
  PLAYWRIGHT_BROWSERS_PATH=/home/bart/.cache/ms-playwright \
  PLAYWRIGHT_HTML_OUTPUT_DIR=tmp/story-new-story-fill-report \
  ./node_modules/.bin/playwright test --project=chromium --workers=1 \
  --output=tmp/story-new-story-fill-results tests/e2e/story-new-story-fill.spec.js
```

The browser harness creates disposable runtime copies with separate logs and saves. Deterministic model responses exercise the real standard/TinyBrain parsers, gameplay routes, settlement, scene completion and paused save restoration; the choices flow checks canonical quest decisions and ability selections. The standard flow also checks competing tabs, visible errors, manual play after pause, history export, Stop & Undo, and desktop/mobile layouts. These checks validate integration and UI behavior; live-provider literary quality remains untested. They do not restart the production server or call a live model provider.

Compile styles with `./node_modules/.bin/sass mods/story-authoring/public/scss/story-authoring.scss mods/story-authoring/public/css/story-authoring.css`. The compiled CSS is injected automatically with the mod's browser script.

## Reviewed story packets

The optional executionBridge handles /start packetId before the existing controller run starts. Actor goal and actor notes are frozen separately from narrator direction. Decision/input context uses the frozen actor packet; narrator guidance uses selected private direction, still subject to canonical checks/agency. Exact settled turns checkpoint the packet; completion invokes evidence-backed receipt/outcome generation before marking the scene complete. Plain goal-only state/API remains compatible. Loaded bindings validate their present snapshot and restore paused without writing the library. See [StoryExecutionBridge](StoryExecutionBridge.md) and [StoryBindingService](StoryBindingService.md).

`projectVisibleHistory(scope)` is the shared public-passage projection used by decision context and the execution bridge. It applies the same narrative type allowlist, omits hidden/excluded entries and strips hidden notes before removing blank text. Actor context uses the latest 24 projected entries; execution receipts use the whole actual packet interval. Null/blank auxiliary canonical history records remain in the game but cannot be completion citations. Negative actual prose remains eligible.

Scoped Play approval recovery has focused Node coverage in `mods/story-authoring/tests/StoryPlayApprovalRecovery.test.js`, included in the mod-local wildcard command above. It verifies exact branch approvals, approval-only pinned synchronization, scene-queue ancestry and strict context/timeline rejection without mutation.

The full-shell mocked browser fixture `tests/e2e/story-approval-recovery.spec.js` covers the recovery dialog, Cancel/confirmation and captured continuation, pinned approval-only differences, real-content conflict and scene-queue control availability. It needs no game server or model provider:

```bash
systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 \
  env PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4174 \
  PLAYWRIGHT_BROWSERS_PATH=/home/bart/.cache/ms-playwright \
  npm run test:e2e:headless -- \
  --output=tmp/story-approval-recovery-results tests/e2e/story-approval-recovery.spec.js
```
