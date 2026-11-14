# PlayerTechniqueIntent

`PlayerTechniqueIntent.js` integrates natural technique identification and
preparation into the existing player-action conversation. It performs no LLM
request. Standard actions use the shared player-action native schema, including
`useTechnique` and its static authoring fields. Compatible base-context callers
share that wire schema while retaining their own execution permissions.
TinyBrain keeps its existing ordered resolution-plan execution and twelve native
lookups. A read-only technique-selection checkpoint precedes each main mechanics
plan; ordinary actions return an empty selection when no details are needed.

`getPlayerTechniqueAuthoringContext(actors,{sharedTechniqueContext?})` projects
actual actor facts, compact resource values and a grouped lookup of relevant
nonprivate accessible catalogue IDs, names and stored short descriptions for
targeted standalone callers. The lookup has no full descriptions, revisions or
mechanics; exact IDs resolve authoritative definitions on the server. Main actions no longer
eagerly build or serialize this full helper for all local actors; they use
[TechniqueSelectionContext](TechniqueSelectionContext.md) to retrieve selected
facts before planning. In the standalone compact projection, shared variable metadata is defined once in
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
supply one outer discipline XML group with exactly one child technique/candidate in text plans. Parent ID or new metadata is outside the child; child disciplineId and sibling candidateDiscipline are rejected. Native tools keep outer JSON fields and carry the identical group in one disciplineXml string, replacing the former candidate JSON-string fields. Known-ID operations remain compact.
The engine reserves the technique identity once per distinct attempt from the first readable, nonplaceholder candidate name before parsing candidate mechanics. New IDs use the shared first-three-word name allocator (`technique_field_mend`, then `_2` for collisions). Malformed native XML or a missing/unreadable name establishes no fabricated intent lock; after reservation, the ID remains stable through corrections. It lazily resolves/reserves a title-derived discipline identity when its name becomes readable, preserving an existing normalized-title canonical record. Both IDs remain stable through corrections; a recognized new discipline cannot switch title identity or be replaced by dropping its proposal and changing disciplineId. A new technique cannot be used twice
as two candidate definitions in one batch: follow-up uses wait for its returned
canonical receipt ID in a later tool round or plan. Full-batch preview is retained.

`createPlayerTechniqueSession({resolveActor,resolveAttackOperation?})` returns:

- `normalizeNative(raw,key)` converts the static native DTO into the same strict
  XML operation parser used by plans. Automatic candidate/discipline validation,
  placeholder rejection, managed recipes and exact target syntax are shared.
  Optional `weaponItemId` selects the exact equipped weapon. `utilitySelections`
  is an object keyed by saved effect ID, with typed `destinationId`, `actorId`
  or `templateId` choices. The adapter encodes these as nested XML selection
  elements, preserving the same validation as directly authored plans.
- `parseNode(node,key)` normalizes a technique XML element using stable per-attempt
  reservations. It locks existing canonical identities or novel semantic identity
  before target/candidate validation. Malformed candidate mechanics cannot escape by dropping a novel
  attempt afterward. Unknown reference IDs, including ability IDs supplied as
  technique IDs, fail with field-level correction guidance before establishing
  an intent lock. A corrected plan may replace that unrecognized entry with a
  valid canonical technique, an ordinary action, or no remaining action. This
  applies to both direct IDs and enclosing-discipline references; it does not
  reinterpret ability IDs as techniques.
- `nativeKey(raw,operationId)` retains a pending native attempt across corrected
  provider call IDs. An unresolved attempt must be corrected before another actor
  can replace it. After commit, distinct new calls receive distinct slots.
- `parsePlan(response,{checkpointId,completedCount=0})` is the production TinyBrain
  parser adapter, returning `{value,normalizedResponse}`. It composes the existing
  plan parser and normalizes techniques and known-ability attack shims in their
  shared encounter order, then enforces pending omissions. Checkpoint-local slots
  count only technique attempts, so inserting, removing or moving ordinary checks
  and attacks preserves pending technique and discipline reservations.
- `beginPlan()` / `finishPlan(prefix)` prevent a corrected plan from omitting a
  recognized unresolved technique, including an empty plan. Corrections consume
  existing unresolved slots in order, retaining actor and technique identity;
  distinct repeated attempts retain distinct slots. Committed slots are skipped
  when parsing a pending suffix, independently of how many ordinary actions have
  completed, so successful earlier effects are never repeated. Omission errors
  explain the missing attempt and preserve any prior preparation error as cause.
- `attackOperation(name,args)` invokes the optional API adapter for an ordinary
  attack tool/node naming a known technique ability. Main action adapters convert
  that representation to the same guarded technique operation, preserving receipt
  references and deliberate-repeat flags rather than adding weapon damage.
- `reject(key,error)`, `commit(key)` and `assertComplete()` retain correction state
  and forbid accepting prose in place of an unresolved recognized attempt.

Standard terminal omission errors are returned to the same main transcript with
field-level correction feedback and the configured finite retry budget. Successful authoritative result DTOs remain unchanged; no standalone
technique prompt is introduced. Exhaustion preserves the useful error. Actor
incapacity is checked after receipt replay but before source/target preview and
returns explicit ignored feedback to the LLM and settles the attempt without costs, rolls, learning, effects or a receipt. The prompt continues; committed receipt replay still wins.
After successful preflight, check-preparation/commit/cancellation failures are
fatal rather than model-correctable rerolls.

Narrative discovery and novel candidates receive the shared parser's trusted
discipline-access acquisition mode. A new learned entry and its absent explicit
discipline-access record commit together; preview, blocked/rejected attempts and
replay install no grant. Existing acquisition/use requirements still apply.
Standard tools and TinyBrain plans use this same service transaction; see
[TechniqueService](TechniqueService.md).

`api.js` sets `playerActionCombinedMechanics` only for main player actions. Both
main templates derive `useLegacyPlayerChecks` from that flag rather than changing
the global legacy option. The main native tool allowlist similarly enables its
mechanical tools irrespective of the NPC legacy setting. Explicit UI source/revision
pins remain deterministic early preparation; scheduled NPC standalone intent and
legacy prechecks retain their existing behavior. Current-turn saved service
receipts populate retry context and finalization even when a prior callback failed
to return a successful invocation.

Semantic recipe kind/selectors share the actor-aware healing and optional standard damage compiler. Reserved identities/provenance and fresh revision numbers are engine-owned; deliberate custom damage remains available. No target/check/difficulty choices are inferred by the damage recipe.
