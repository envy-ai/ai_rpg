# PlayerTechniqueIntent

`PlayerTechniqueIntent.js` integrates natural technique identification and
preparation into the existing player-action conversation. It performs no LLM
request. Standard actions use the shared player-action native schema, including
`useTechnique` and its static authoring fields. Compatible base-context callers
share that wire schema while retaining their own execution permissions.
TinyBrain uses its existing ordered resolution-plan checkpoints and keeps native
tools lookup-only. Ordinary actions need no explicit technique-none answer.

`getPlayerTechniqueAuthoringContext(actors,{sharedTechniqueContext?})` projects
actual actor facts, compact resource values and relevant nonprivate accessible
catalogue definitions. Main actions pass the compact shared base context and
reference its technique sources, formula variables and balance options instead
of serializing them twice. Shared variable metadata is defined once in
`formulaVariableSchema`; actor value maps supply level, ranks and modifiers, so
the supplemental actor facts do not repeat those statistics. A supplemental `techniqueContext` contains only local
actors absent from that shared context; callers without shared context remain
self-contained. Need definitions, icon metadata, managed policy snapshots and
catalogue revision histories are not repeated. No actor or technique count is
silently truncated. See [TechniquePromptContext](TechniquePromptContext.md).
`getPlayerTechniqueAuthoringInstructions()`
composes the existing strict automatic-authoring contract without requesting the
standalone intent envelope or unsupported kind field. Known/catalogue operations
use canonical IDs; catalogue acquisition adds `discoveryIntent`. Novel operations
supply candidate JSON and optionally candidateDiscipline JSON, omitting new IDs.
The engine reserves identities once per distinct attempt, before parsing candidate
JSON, and reuses them through corrections. A new technique cannot be used twice
as two candidate definitions in one batch: follow-up uses wait for its returned
canonical receipt ID in a later tool round or plan. Full-batch preview is retained.

`createPlayerTechniqueSession({resolveActor,resolveAttackOperation?})` returns:

- `normalizeNative(raw,key)` converts the static native DTO into the same strict
  XML operation parser used by plans. Automatic candidate/discipline validation,
  placeholder rejection, managed recipes and exact target syntax are shared.
- `parseNode(node,key)` normalizes a technique XML element using stable per-attempt
  reservations. It locks recognized known identities or novel semantic identity
  before target/candidate validation. Bad JSON cannot escape by dropping a novel
  attempt afterward.
- `nativeKey(raw,operationId)` retains a pending native attempt across corrected
  provider call IDs. An unresolved attempt must be corrected before another actor
  can replace it. After commit, distinct new calls receive distinct slots.
- `parsePlan(response,{checkpointId,completedCount=0})` is the production TinyBrain
  parser adapter, returning `{value,normalizedResponse}`. It composes the existing
  plan parser, normalizes techniques and known-ability attack shims at their stable
  original ordinal, then enforces pending omissions.
- `beginPlan()` / `finishPlan(prefix)` prevent a corrected plan from omitting a
  recognized unresolved technique, including an empty plan. The API keys slots by
  checkpoint and original ordinal, offsetting pending suffixes by completed ledger
  entries so successful earlier effects are never repeated.
- `attackOperation(name,args)` invokes the optional API adapter for an ordinary
  attack tool/node naming a known technique ability. Main action adapters convert
  that representation to the same guarded technique operation, preserving receipt
  references and deliberate-repeat flags rather than adding weapon damage.
- `reject(key,error)`, `commit(key)` and `assertComplete()` retain correction state
  and forbid accepting prose in place of an unresolved recognized attempt.

Standard terminal omission errors are returned to the same main transcript with
field-level correction feedback and the configured finite retry budget. Tool
schema and successful authoritative results remain unchanged; no standalone
technique prompt is introduced. Exhaustion preserves the useful error. Actor
incapacity is checked after receipt replay but before source/target preview and
propagates with its original stack through fatal standard/TinyBrain boundaries.
After successful preflight, check-preparation/commit/cancellation failures are
fatal rather than model-correctable rerolls.

`api.js` sets `playerActionCombinedMechanics` only for main player actions. Both
main templates derive `useLegacyPlayerChecks` from that flag rather than changing
the global legacy option. The main native tool allowlist similarly enables its
mechanical tools irrespective of the NPC legacy setting. Explicit UI source/revision
pins remain deterministic early preparation; scheduled NPC standalone intent and
legacy prechecks retain their existing behavior. Current-turn saved service
receipts populate retry context and finalization even when a prior callback failed
to return a successful invocation.
