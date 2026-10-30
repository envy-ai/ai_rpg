# Integrate player techniques into player_action

Status: implemented option A, explicitly confirmed by the user. Player actions
unify techniques, checks and attacks within player_action in both prompt modes.

## Intended result

Natural player actions no longer launch a separate `technique_intent` model
request before `player_action`. The main player-action conversation identifies,
prepares and executes a technique before narrating its outcome. Ordinary dialogue,
movement and weapon actions need no explicit technique-none response. Known
sources, public catalogue reuse and qualified novel first attempts retain their
current authoritative learning, balance, cost, check and effect rules.

Explicit UI Use metadata remains a deterministic early preparation/replay path;
it needs no model decision. Scheduled NPC turns retain their existing standalone
preparation and narration behavior because this change targets `player_action`.
NPC actions planned within a player beat continue through the shared main action
mechanics as they do today.

## Before this change: integration points

- `api.js` player preflight near 27866 invokes `resolveTechniqueBeforeNarration`
  before legacy attack/plausibility processing. Scheduled NPC preflight near 25903
  invokes the same helper and is outside the player-only removal.
- Standard player action uses `runChatCompletionWithToolLoop`. Its native
  `useTechnique` definition currently handles known techniques only and says
  novel first attempts have already been prepared. Step 1b performs mechanical
  checks before outcome brainstorming.
- TinyBrain already has initial/draft/revision `<resolutionPlan>` checkpoints.
  `PlayerActionResolutionPlan` parses `<technique>` including strict candidate
  discovery, validates plans, executes in order and retains completed outcomes
  when only an unexecuted suffix needs correction. The shared include currently
  describes new candidates as NPC-only and lacks the complete authoring facts.
- `TechniquePrompt` owns strict XML/automatic authoring validation, bounded
  qualification facts, creation instructions, technique identity locking,
  deterministic explicit metadata, preflight/commit separation and receipt
  adaptation. These responsibilities should be composed rather than copied.

## Legacy player mechanics decision

**A (selected):** route ordinary player mechanics through the
main standard tool loop or TinyBrain combined plan regardless of
`use_legacy_prompt_checks`. Preserve the flag's existing NPC and unrelated prompt
behavior. Remove the player's old pre-main attack/plausibility LLM path so it
cannot apply ordinary weapon damage or a second check before technique selection.
TinyBrain always reaches its pre-prose plan instead of entering its pre-resolved
`isAttack` shortcut for a natural player action. Document the changed scope of the
legacy option clearly.

**B:** retain the old player precheck ordering through a mandatory initial main
technique/none handshake, then invoke the old prechecks only after an accepted
none decision. This is larger: standard ordinary turns always require a tool
continuation, and TinyBrain must move the decision ahead of its old attack branch.
It must remain part of the same player-action transcript, never a renamed
standalone request. Do not silently select A by deleting legacy support.

## Ordered implementation

1. Factor shared strict action-technique normalization, bounded read-only
   authoring facts/instructions and an attempt guard from TechniquePrompt without
   changing scheduled-NPC or explicit-Use behavior. Automatic candidates retain
   placeholder rejection, qualification and managed balance compilation. Native
   and XML adapters feed the same normalized operation; neither may bypass these
   validators. Preserve canonical IDs: use engine-reserved IDs and stable
   request/checkpoint/call ownership rather than letting the model invent saved
   identities. Main authoring context/normalization must support separate novel
   attempts without reusing one reserved ID for unrelated techniques.
2. Extend the static standard `useTechnique` schema to support catalogue discovery
   and novel candidate/discipline proposals. Its wire schema is defined once,
   independent of actor, attempt, mode or current state. Add shared creation
   guidance and relevant nonprivate catalogue/actor facts to main action context,
   avoiding a second full base-context build or another classification completion.
   Update step 1b to resolve techniques before outcomes and to avoid ordinary
   attacks/checks for the same effects.
3. Extend the existing initial TinyBrain resolution-plan instructions and parser
   adapter to accept player discovery with the same facts/normalizer. Keep native
   tools lookup-only and add no checkpoint. Existing plan ordering, validation,
   receipt injection and retry ledgers remain the execution boundary. Later
   draft/revision plans may add distinct mechanics but must reference committed
   attempts or explicitly declare another attempt.
4. Apply the approved legacy decision. Remove only natural player standalone
   preparation; retain explicit pins and existing receipt replay. Ensure all
   main action variants receive the technique context they require.
5. Carry strict retry state across main native/plan corrections. Once an intended
   technique is recognized, invalid syntax/preflight cannot turn it into none,
   another identity or prose-only mechanics. Direct dead/disabled errors preserve
   their original error and stack instead of being rewritten into correction or
   weapon attacks. Final main output must not be accepted with an unresolved
   recognized attempt. Commit/check preparation is outside parser-only retry;
   committed receipts replay without another roll, charge or learning mutation.
6. Update focused docs and root README; update tests to the new main-transcript
   contract rather than retaining standalone requests solely for old fixtures.

## Verification contract

- Standard and TinyBrain natural player turns make zero `technique_intent` calls;
  ordinary turns require no explicit none classifier response.
- Existing owned and newly discovered techniques commit before outcome prose;
  managed healing uses authoritative recipe costs/formulas and learns once.
- Invalid candidates and ambiguous/blocked sources get correction or original
  errors, never ordinary damage/healing or a swapped/omitted technique.
- Explicit UI pins/replays preserve source/revision/targets and reject stale pins.
- Retried/matching receipts do not reroll or recharge; deliberate extra attempts
  remain distinct. Partially executed combined plans retain completed outcomes.
- The selected legacy policy is covered for both main prompt modes, including
  attacks that could otherwise double-apply ordinary damage.
- Scheduled NPC behavior and current-turn opportunity exclusion remain intact.
- Static schema identity and tool allowlists remain consistent across corrections
  and TinyBrain checkpoints. Existing logging records the main conversation and
  server-owned authoritative results, with no separate player intent log.


## Concrete integration safeguards

Both main templates use a player-specific `playerActionCombinedMechanics` context
flag through `useLegacyPlayerChecks`; every legacy-dependent branch follows it,
while NPC callers keep the global setting. Recognized technique locks start before
candidate JSON/target validation. `PlayerTechniqueIntent` owns per-attempt slots,
server ID reservations, strict automatic-parser composition, pending-plan omission
checks and terminal `assertComplete`. Completed plan suffixes offset their slot
ordinals by the retained execution ledger's completed count.

Actor incapacity is checked after valid receipt replay and before source/target
preview, retaining the original error marked fatal across both standard tool-error
handling and TinyBrain's preflight pending-only wrapper. Main native discovery
fields are rejected explicitly when no main-player session exists; the static wire
schema remains unchanged across a run. Current-turn service receipts, not only
successful returned invocations, populate retry context and finalization.

## Verification and activation

The eight affected technique/TinyBrain test files passed 96/96 under a transient
systemd unit with `MemoryMax=16G` and `MemorySwapMax=0`. Focused tests also passed
for the real `LLMClient.applyBaseContextToolPolicy` boundary and the production
`session.parsePlan` adapter/API wiring. Changed JavaScript passed syntax checks.
These checks used mocked providers and real local mechanics, without live model
calls or loading a production save.

The broader `base_context_prompt_uses_caching.test.js` suite has a separate
event-summary VM-fixture failure: its mocked Player lacks `getById` when
`TechniqueService.getPromptContext` runs. The new tool-policy case passes; no
unrelated production behavior was changed to accommodate that fixture.

Saved the active game before restarting the game server (PID 1238672). Game and
Strata HTTP checks both returned 200; Strata PID 942987 was retained. No save was
loaded automatically. Save metadata is recorded in
`tmp/integrated-technique-intent-pre-restart-save.json`.
