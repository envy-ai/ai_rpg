# TechniqueService

`TechniqueService.js` owns saved-world disciplines, catalogue definitions, immutable action receipts, actor acquisition/improvement, source selection, and authoritative technique execution. It supports authored and weapon-based damage, healing, buffs/debuffs, teleportation, summons and resurrection through the existing combat and world systems.

World APIs are `reset()`, `hydrate(state)`, `toJSON()`, `validateState(state, { actors, things })`, and `validateReferences({ actors, things })`. State is `{ version: 1, disciplines: [], definitions: [], receipts: [] }`. Missing legacy state means empty; present malformed state, dangling active references, duplicate IDs, invalid formulas, and malformed nested receipts throw. Hydration registers compact technique/discipline IDs. `Utils.serializeGameState`, disk `techniques.json` writing/reading, and `hydrateGameState` include this state. Incoming owner/item/status references are validated before clearing live registries, definitions install before actor hydration, and references are checked again afterward. Historical receipt actors and targets may legitimately have been removed after corpse cleanup; active learned/item/status references remain strict. Receipts are retained without pruning.

Catalogue APIs are `resolveDiscipline`, `addDiscipline`, `getDisciplines`, `addDefinition`, `getDefinition`, `getDefinitions`, `reviseDefinition(id, mechanics)`, and `findMatches(intent, { actor? })`. New definitions reuse an existing discipline/semantic-key identity instead of creating a duplicate. Legacy saved definitions with distinct IDs but the same semantic identity remain loadable; candidate-based matching against an ambiguous identity fails with the exact saved IDs and requests an explicit `techniqueId`. Catalogue edits append numbered base revisions; they never modify learned personal mechanics or existing equipment grants. Matching uses saved identities, names, and aliases; semantic intent classification belongs to the structured prompt boundary.

`setDefinitionShortDescription(id, text)` updates only the canonical definition's
validated presentation metadata; returned catalogue/availability DTOs and normal
save serialization include it. `toJSON({ includePresentation: false })` omits
short descriptions as well as icons. Preparation fingerprints and catalogue
overwrite comparisons use the presentation-free projection, so concise-summary
updates do not invalidate mechanical preparation or rewrite immutable revisions/receipts.
The existing canonical object remains in prepared learning maps, preserving its
new summary if that preparation later commits.

`getDisciplineEditContext(actor)` returns `{worldId,disciplines,disciplineAccess}`
for the combined editor. `worldId` is a process-unique runtime identity renewed on
reset/hydration, deliberately excluded from saves; disciplines contain only
`{id,name,description}` and access retains full provenance.
`editDisciplines({actor,edits,accessIds,accessReason?,expected})` synchronously
commits shared names/descriptions and the actor's full explicit-access set. It
rejects a changed world, changed edited metadata or changed actor access before
mutation. Edits cannot alter IDs, public access, prerequisites or provenance;
unchanged access records retain their saved provenance. Only newly granted IDs
require a nonblank reason, recorded with trusted editor provenance. All IDs,
duplicates and required strings validate before mutation. An actor write failure
restores any partial access write before shared metadata is installed; an
incomplete rollback raises an aggregate error forbidding retry. The result is
`{disciplinesChanged,accessChanged}`. Definitions, mechanics, learned revisions,
item grants and receipts retain their exact identities and contents.

`getAvailable(actor, { includeBlocked: true })` groups one identity with all available learned/equipment sources. Groups include discipline/name/description, learned badge, `sources`, `selectedSourceId`, `available`, and textual `blockers`. Sources contain `sourceId`, `sourceKind`, item identity when relevant, pinned definition/personal revisions, complete mechanics, resolved normal/failure costs, availability, and blockers. `getPromptContext(actors)` projects only the explicitly supplied actors' accessible disciplines and owned/equipped techniques, with a `formulaVariables` catalogue of current canonical identifiers/source labels/values for each actor, without private provenance, the full technique catalogue, or historical receipts.

`getTechniqueSummaries(actors)` returns per-actor `{name, shortDescription, techniqueId?}` lists
using the same learned/equipment/status identity union as `getAvailable`, without
evaluating costs or availability. Blocked identities remain listed. The base
context renders these under each character as Markdown; legacy blank summaries
omit the description. `techniqueId` is present only when that row's canonical name
matches multiple owned/granted identities through trimmed, case-insensitive
names/aliases, matching selection name resolution. A per-actor name index counts
distinct identities, so repeated aliases and names shared only across actors do
not add IDs. Ambiguous rows render `* Name [technique_id] - summary`; all other rows
retain their existing format. IDs and saved definitions are unchanged, and full
mechanics remain excluded.

`getCompactPromptContext(actors)` applies the prompt-only
[TechniquePromptContext](TechniquePromptContext.md) projection to complete actor
records for targeted standalone consumers. Main actions and event authoring use
[TechniqueSelectionContext](TechniqueSelectionContext.md) to filter selected
techniques and share schemas once across selected actors. Full managed snapshots,
UI fields and repeated formula metadata are omitted. Original service/client DTOs
and saved mechanics remain complete.

`resolveSource(actor, techniqueId, sourceId?)` applies the shared source policy. Explicit selection wins; otherwise the learned version wins even when blocked. With no learned version, one equipment source is selected, or identical versions choose the lowest stable grant ID. Different equipment mechanics require explicit selection. Requirements are never bypassed by silently switching sources. Learned source IDs are `learned:<techniqueId>`; equipment source IDs are grant IDs.

Acquisition APIs:

- `learn({ operationId, actor, techniqueId?, definitionRevision?, provenance, candidate?, candidateDiscipline? })` validates access and acquisition requirements, then durably learns a complete personal revision. Optional novel candidates are staged and installed only after successful validation and the actor write. Trainer sources must identify an available character who knows the technique; item sources require a matching owned teaching grant. Existing learned knowledge is retained.
- `grantDiscipline({ operationId, actor, disciplineId, provenance })` records explicit setting/story/editor access.
- `recordEvidence({ operationId, actor, techniqueId, evidence })` adds a distinct meaningful-use/story/training record; evidence is not a currency and does not automatically increase power.
- `improve({ operationId, actor, techniqueId, mechanics, evidenceIds, provenance })` installs exactly the next personal revision and retains previous complete mechanics. Non-editor improvements require distinct unused evidence, consumed once by operation ID. All amount formulas are validated against the actor before mutation. Another actor and the shared base are untouched.

Trusted narrative learning calls `learn` with `establishDisciplineAccess: true`;
trusted first-use discovery carries the same boolean inside `acquisition`.
These native-only modes skip only the selected discipline's access gate, keeping
revision acquisition/use requirements and trainer/item/actor checks.
When a new learned entry commits, an absent explicit discipline-access record
commits alongside it with actual source provenance and operation ID
`<learning-or-use-operation>:discipline:<disciplineId>`. Neither a preview nor
rejected/cancelled preparation installs access. A committed first attempt that
misses still learns and grants access under the existing discovery semantics.
Ordinary `learn` defaults to the strict access gate, and discipline privacy/public
access settings remain unchanged. Existing access is preserved and not duplicated.

Direct-learning actor writes restore both learned entries and access on failure.
Prepared use signatures include access and the staged grant; the use transaction
restores access with its learned/catalogue/cost/effect state if commit fails.
Receipt replay remains authoritative and does not regrant removed access.
Staged definition/discipline ID registration finishes before mutable commit
state, so allocator failures cannot leave an access grant or paid attempt.
Aborted attempts may retain harmless ID reservations.

Every operation uses a stable server-owned `operationId`; replay returns its stored receipt. Reusing an ID with a different original request rejects. `getReceipt(id)` returns the committed receipt or `null`; `getReceiptsForTurn(turnId)` returns committed action attempts for current-opportunity/NPC accounting, including failed and non-damaging attempts. Independent learning and passive equipment access are not active action receipts.

`prepareLearningBatch(groups)` and `commitLearningBatch(prepared)` provide the
focused initial-character authoring boundary described in
[StartingTechniques](StartingTechniques.md). Preparation stages every candidate,
prerequisite, formula and resource identity before any actor/catalogue mutation.
Starting acquisition bypasses the discipline's access gate and each revision's
acquisition requirements for its own initial techniques. Ordinary learning and
use-time requirements retain their gates; mechanics/reference
validation remain enforced. It
stages one explicit generation-provenance `disciplineAccess` record per newly
learned discipline. Commit installs those actor access records with learned
entries in the same stale-checked transaction and rolls both back on an actor
write failure; catalogue records and durable `initialization` receipts follow,
including empty repertoires, synchronously. Class and race prerequisites use the
actor's exact actual `class`/`race` identity through `{ kind, name }` requirements;
they do not infer world-specific names or make every discipline public.

Execution is `await execute({ operationId, turnId, actor, techniqueId?, sourceId?, targetIds?, expectedDefinitionRevision?, expectedPersonalRevision?, intent?, prepareCheck?, assessDamageEffectiveness?, candidate?, candidateDiscipline?, acquisition? })`. Discovery acquisition is `{ provenance, definitionRevision? }`. A qualified first attempt stages catalogue and learned state until the accepted attempt commits; failed checks can still establish learning. Rejected preparation/resources never leave a candidate or learned entry.

`preview(options)` performs numeric/schema/source/resource/target preflight without a roll or world mutation. `prepare(options)` performs preflight, invokes the supplied existing engine check preparation callback, and returns an authentic prepared object. `prepareCheck({ actor, target, check, technique, source, effect })` must return a JSON-safe `{ success: boolean, ...checkReceipt }` without applying damage, effects, or costs. Automatic effects need no callback. Equal checks are shared across effects on the same target; area targets retain separate defense outcomes and share the attack die when the check is an attack. The normal cost vector wins when any planned effect passes its check on any target, including full-health healing and zero-damage hits; all misses use the failure vector. Both possible vectors must be affordable before any roll.

`getStartBlocker(actor)` returns the authoritative dead/disabled/zero-health reason. Production standard/TinyBrain tools, plans, explicit UI Use and scheduled NPC preparation check it after committed replay and before source/target preview. A blocked attempt returns explicit model-facing ignored feedback, completes its attempt bookkeeping, and continues without checks, costs, learning or effects; it creates no receipt. `assertCanStart(actor)` and internal preflight/commit remain strict defenses. Already committed attempts still replay when the actor is now disabled.

`commit(prepared)` is synchronous. It rechecks the exact source, actor/target eligibility, requirements, costs, resolved formulas, effective actor/target skill/attribute/gear/status facts, and world identity after asynchronous preparation. A changed or removed selected grant rejects; a committed retry returns the old receipt even after unequipping. Prepared outcomes cannot be edited before commit. All costs are combined by resource and validated as exact debits before calling existing health/need setters. Need availability uses the actor's active audience/applicability projection. Unknown/inactive pools and missing/conflicting payment directions reject; no pools are created automatically.

Commit applies the selected costs, optional acquisition, and successful effects once, then stores a fully validated receipt. Unexpected mutation/validation failure restores actor health, needs, intrinsic statuses, learned state, and staged catalogue additions from snapshots. An incomplete rollback raises an aggregate error explicitly forbidding retry. UI notification and prose happen after this boundary and cannot cause a second charge.

Action receipts contain `kind: "use"`, `committed: true`, operation/turn/actor/technique identities, `worldMinute`, nested `source` (source kind/ID, item ID, pinned definition/personal revision), `success`, `costOutcome`, exact `costs`, prepared `checks`, `effects`, `techniqueChanges`, and the original `request`. Effects include `effectId`, `targetId`, kind, success, and deterministic `mutationId: <operation>:effect:<target>:<effect>`. Health effects include authored resolved amount/inputs, previous/new health, and actual delta; statuses retain identity/provenance. Event extraction must suppress only exact already-committed receipt/effect/cost/acquisition references, preserving unrelated same-turn events.

New learning and use receipts also persist an optional `display` snapshot with
the actor/technique names, technique description, scene location, and (for uses)
target names and the prepared effect calculations. Each amount retains its
authored expression, exact input values and resolved result, including intended
effects whose checks failed. Successful health calculations additionally retain
`authored` beside their applied previous/new health and delta. Status snapshots
retain the requested duration/modifiers separately from the actual status returned
by refresh/stacking. Display code never recalculates historical formulas from
current character or catalogue state. Old receipts without display/authored
fields remain valid and expose only the values they originally recorded.

`setReceiptObserver(callback | null)` installs the gameplay presentation callback.
It receives cloned newly committed use/learn receipts; initial learning batches
publish their newly installed learning receipts after the whole batch commits.
Hydration, reset and successful operation replay do not publish historical learning,
and reset/hydration preserve the installed observer. Observer errors propagate with
the original cause and `committedOperationId` after the authoritative transaction,
so they cannot roll back costs or permit charging a replay again. The API observer
records visible results in the shared prompt-excluded `check-results` history;
hidden/offscreen NPC and unplaced initial-character learning stays in receipts
without announcing private activity to the player.

Failed notification delivery retains that operation ID in a runtime-only
undelivered set. `retryReceiptNotification(operationId)` retries only a known
undelivered receipt, never its mechanics; successful delivery removes the ID.
Ordinary service replays, prompt receipt invocation, attack receipt references,
event-learning replays and completed initial-learning retries invoke this explicit
repair boundary. Receipt getters and reference/preview validation remain read-only.
Initial batches mark every new learning receipt before delivery so a failed
notification cannot lose later sibling notices; retrying the initialization receipt
repairs its undelivered learning children. A repeated delivery failure still throws
with `committedOperationId`. Reset/hydration clears transient delivery failures;
loading a save does not reconstruct or announce past notifications. Stable history
record IDs prevent duplicate rows if a callback failed after storing part of its
display output.

Technique statuses use `Player.validateTechniqueStatusEffect` for pure preflight and `upsertTechniqueStatusEffect` for the owning health-reconciliation lifecycle. Refresh settles elapsed per-minute changes of the collided status before replacing/refreshing it, preserves authored duration/provenance, and leaves ordinary description-based statuses independent. Tick stamps and provenance round-trip through `StatusEffect`, shared normalizers, and actor saves. `StatusEffect({ register: false })` supports validation without consuming IDs; normal construction and hydration register IDs.

Area attack checks receive one shared `sharedAttackRoll` holder for each distinct
attack-check configuration. The existing attack callback records the first
authoritative attack die there and reuses it against each target's defense;
costs remain per attempt. Non-attack skill/opposed checks retain their authored
per-target semantics.

`technique` damage mode applies its authored amount with current-target effectiveness once through `modifyHealth`, without adding weapon toughness. `weapon` mode requires an exact equipped weapon and attack check. Preparation retains the ordinary hit/weapon calculation; commit applies authored multiplier and bonus to ordinary pre-defense damage, then toughness and effectiveness once. The selected weapon ID, stats and charge pool are rechecked at commit and recorded in the receipt. A charged weapon pays its native cost once per attempt; explicit same-item technique charge costs are the total payment and must meet that native minimum in both possible cost vectors.

Teleport, summon and resurrection use [TechniqueUtilityEffects](TechniqueUtilityEffects.md) prepared plans and rollback callbacks within the same cost/effect transaction. `utilitySelections` is keyed by effect ID; `weaponItemId` is an optional exact execution selector. A player and selected party members in one area teleport share one automatic or skill check result, including failure. Attack/opposed group teleport rejects before a roll with guidance to use separate single-target attempts. Party NPCs are processed before the owner, and a nonparty caster last; a single revision cannot contain multiple teleport effects. Resurrection requires an existing dead local target; ordinary effects still reject dead targets. Summon templates and leases persist through their utility state.

`cost.perTarget: true` resolves one full cost per selected target before either normal or failure affordability checks. Cost receipt calculations retain unit amount, target count and total. Availability shown without selected targets is a one-target estimate; `preview(options)` returns the actual selected-target costs.

Availability retains resolved cost amounts when affordability fails, so controls can display the actual amount alongside its blocker. Preparation/receipt equivalence compares object keys canonically; equivalent binding-map order does not create artificial source ambiguity.

New automatic healing and selected standard damage candidates are compiled through [TechniqueBalancePolicy](TechniqueBalancePolicy.md) in `learn`, discovery preview/prepare and `prepareLearningBatch`. `addDefinition(raw, { actor, origin, config })` and `reviseDefinition(id, mechanics, options)` use the same boundary. `origin` defaults to `automatic`; only trusted caller code can explicitly select `editor`. Model provenance cannot establish this authority. Existing stored catalogue identities still reuse their pinned historic mechanics. An unsupported recipe or unmanaged new automatic healing fails before learning, rolling or debiting.

`improve` additionally accepts `improvement: { stepId, reason? }` in place of `mechanics`. Managed automatic improvements require this proposal and use the owner's saved policy even after configuration reload. Evidence IDs are all validated before any are marked consumed. Actor-write failure restores evidence/history/mechanics, and failed rollback raises an aggregate error forbidding retry. Editor saves must retain managed metadata or explicitly pass `convertToCustom: true` with `origin: "editor"`. An editor-looking provenance alone grants no exemption.

Prepared initial batches capture the effective authoring policy digest in addition to catalogue/world/actor signatures. Actor signatures include active need values/applicability/capacity, gear/status, attributes and skills. A changed policy invalidates a novel prepared candidate/batch, while saved learned/equipped revisions continue to use their own snapshots. Receipt replay occurs before current policy or actor revalidation.

`getPromptContext` includes `balanceAuthoring` options; selected numeric previews use the existing server preview API. Learned groups expose `balanceImprovements: { policyDigest, steps, appliedImprovementIds }` from the owner's saved snapshot, separately from current new-authoring options.

`rebalance({ operationId, actor, techniqueId, expectedDefinitionRevision, expectedPersonalRevision, expectedPolicyDigest, recipe, provenance })` is the narrow reviewed repair boundary. It requires editor provenance, an exact latest catalogue/personal revision and `TechniqueBalancePolicy.digest(resolvePolicy())`. It atomically appends a compiled catalogue revision and one owner personal revision, preserving prior history and pinning that owner to the new base. Other owners/equipment pins retain their saved revisions. A normal immutable improvement receipt records the reviewed request, and an identical operation replay returns it before current checks. This method does not itself authorize or perform live-save changes or server restarts.

`previewPersonalReset()` and `resetPersonal()` provide a reviewed per-owner reset/rebase. They require the exact current personal, pinned definition and catalogue latest revisions. Targeting the pinned definition resets personal edits; targeting a newer base rebases. Both copy complete base mechanics into the next personal revision, retain prior history/acquisition/evidence, and leave catalogue and other owners untouched. Apply uses a stable operation ID and an immutable improvement receipt; replay returns that receipt before current guards.

## Icon presentation metadata

World state optionally persists `icons: { [techniqueId]: { imageId, imagePrompt } }` separately from immutable definitions, actor revisions, and equipment pins. Old states without the map hydrate empty; malformed records and unknown target references reject. `getIcon(id)` returns a copied record with blank defaults; `setIcon(id, updates)` validates only those presentation fields. Availability groups expose the two image fields for shared icon rendering. `getRuntimeEpoch()` identifies the current service lifetime so asynchronous icon adapters reject a reset/hydrate even if an ID is reused.

`toJSON({ includePresentation: false })` omits icons for mechanical catalogue signatures; its default preserves icons in saves. Initial-learning preparation ignores image fields in ability signatures. The story runtime fingerprint uses the same mechanical-only catalogue projection. Generating or editing artwork therefore does not invalidate prepared mechanics or append a revision.

### Discipline icons

`disciplineIcons: { [disciplineId]: { imageId, imagePrompt } }` is a second optional presentation map in saved world state. It hydrates empty when absent and rejects malformed records or references to unknown disciplines. `getDiscipline(id)` returns a canonical copy or null. `getDisciplineIcon(id)` returns copied image metadata with blank defaults; `setDisciplineIcon(id, updates)` validates and changes only that metadata. `getDisciplines()` stays canonical and contains no image fields.

Both icon maps are omitted by `toJSON({ includePresentation: false })`, so artwork does not change the mechanical fingerprint, prepared-learning catalogue signature, discipline editor baseline, technique IDs, personal revisions, or equipment pins. Name/description edits retain the existing image and saved prompt until explicitly regenerated. The technique API supplies presentation separately as `disciplineIcons` keyed by discipline ID.

## Status sources and ability attachment authoring

`getAvailable`, `resolveSource`, preparation, commit revalidation and receipts recognize `sourceKind: "status"` alongside learned and ordinary equipped-item grants. A status source has stable `sourceId`, `statusId`, pinned `definitionRevision`, `statusName`, and optional `abilityId`/`abilityName` when derived from an owned ability. `statusName` and ability names are presentation facts; persisted source identity uses IDs and revision. Duration `0`, removal, ability removal, and unequipping revoke the source before a prepared use can commit. Acquired learned entries remain separate. Active status-grant references and duplicate source IDs are validated on save/load and after attachment application.

An active owned-ability status grant establishes effective access to its
technique's discipline. A shared low-level active-grant projection supplies both
`getEffectiveDisciplineAccess(actor)` and actual discipline prerequisite/learning
validation, so advertised ability-backed access is accepted by the service too.
It validates the bound status and canonical definition revision without invoking
availability, cost checks or recursive effective-context generation. Nested
discipline prerequisites share this projection, including a discipline whose
qualification depends on another ability-backed discipline.

Effective context retains ordinary explicit/public records and ability-backed
records with `sourceKind: "ability_status"`, `sourceId`, `statusId`, `abilityId`
and `abilityName`. Removing/expiring the ability status removes derived access;
the projection adds no explicit actor `disciplineAccess` record and never makes
the discipline public. Ordinary equipment or intrinsic status grants without an
owned-ability source do not establish discipline-wide access. Learning still
checks all other acquisition/source requirements; learned knowledge remains
permanent under the existing policy. Narrative learning may separately establish
explicit access in its successful learning transaction as described above.
Granted uses retain revision `useRequirements`, costs, actor and source checks.

`getAbilityAttachmentExpected(actor, abilityIds)` returns a stale-review snapshot with the game epoch, actor ID, and requested ability records, excluding ability artwork. Ordinary resource, equipment, character-stat, and unrelated catalogue changes do not invalidate it; preview/apply still validate the attachments against current mechanics and references. `previewAbilityAttachmentBatch({ actor, entries, expected?, origin?, pendingAbility? })` validates without actor/catalogue mutation and returns canonical draft `entries`, `resolvedEntries`, new discipline/definition previews, and `expected`. The server-trusted `pendingAbility` allows one distinct unowned option to be validated prospectively while preserving the registered actor's actual abilities and catalogue. It is unavailable to `applyAbilityAttachmentBatch`. Each entry is `{ abilityId, statusEffects }`; a status may contain `techniqueEntries: [{ id?, techniqueId?, definitionRevision?, candidate?, candidateDiscipline?, provenance? }]`. Preview assigns missing draft IDs/provenance and resolves entries to pinned `techniqueGrants`; callers apply those returned draft entries to preserve IDs. `applyAbilityAttachmentBatch` revalidates and atomically installs the new catalogue records and owned ability statuses, rolling back catalogue, abilities and health on failure. Pending/declined offers do not install definitions. Explicit `statusEffects: []` removes attachments.
Missing preview IDs use the shared first-three-word name allocator for statuses, techniques and disciplines, with `_2`, `_3`, and later suffixes for collisions. Statuses use their name or, when unnamed, description. Supplied draft IDs are reserved first and preserved across later preview/apply, including catalogue renames. Preview still leaves actor and catalogue state untouched; discarded previews retain their name reservations. Saving and reloading pending drafts retains exact IDs through player draft registration and high-water reservations through `metadata.idNameCounters`; legacy numeric reservations remain in `metadata.idCounters`.

Semantic recipe authoring resolves eligible singleton selectors at actor-aware preparation. Attachment preview writes those resolved selections into returned canonical draft entries, so later actor/resource changes cannot reinterpret an omitted choice. Pending drafts still recompile/revalidate under current policy on application; no preview-policy snapshot or freshness gate is added. Installed managed revisions retain immutable saved coefficient snapshots. Deliberate custom damage remains supported independently of standard recipe availability.

Detached attachment validation retains status/technique-entry paths and original error causes. Owner modifier errors name actual owner facts; resource errors name active need IDs/payment directions; pinned revision errors list existing revisions. Prospective maximum-health errors identify the combined status modifiers to review. Preview continues to validate resource identity and mechanics without requiring current affordability. Catalogue-wide reference checks can expose existing invalid catalogue state; they do not authorize rewriting unrelated definitions.

## Discipline identities

`resolveDiscipline(raw, {disciplines?})` resolves against the live catalogue or the supplied detached map/array before definition compilation and common semantic matching. New IDs are `discipline_` plus the shared normalized first three source words, with `_2`, `_3`, and later collision suffixes. Canonical matching still uses the complete `IdGenerator.normalizeName(name)`: NFC lowercase, Unicode letters/numbers retained, runs of other characters compressed to `_`, and edge underscores removed. Distinct full titles sharing the same first three words receive distinct suffixed IDs. `Martial Arts`, `Martial--Arts` and `MARTIAL_ARTS` share one canonical discipline; `Fireball` and `Fire ball` remain distinct. Matching existing/staged records retain their original ID, name, description, access rules and provenance even when a proposal differs. Canonical reuse applies to editor creation, starting repertoires, ability attachments, learning and first-use discovery.

Existing IDs survive loading and renaming. An ID-bearing draft that still names an existing record resolves that canonical record, including after a rename. An unknown supplied draft ID conflicting with another canonical title rejects rather than rewriting the saved draft. New title ambiguity across multiple old IDs lists those conflicts and requires catalogue repair; an unrelated record occupying the derived stem receives a distinct suffix without overwrite. Unrelated punctuation-only legacy names remain loadable and do not match new proposals; a new punctuation-only title rejects clearly.

`availableDisciplineIds(disciplines?)` formats actual IDs, or explicit `none` for an empty catalogue. Missing-discipline validation uses the relevant live, loaded or staged catalogue, retaining original field/error context and correction guidance.

Detached ability-attachment preparation aggregates up to ten independent problems across statuses and technique entries, including actor facts, formula evaluation, resource costs and prerequisite references. Each issue retains its attachment entry/status/technique path. Candidate definitions and proposed disciplines enter detached lookup maps only after entry validation; a rejected status removes its detached additions before later statuses are checked. Any collected problem rejects before prospective ability validation or application. Existing ID reservations remain, while catalogue and actor installation remain outside rejected previews. Outer status construction and rules requiring an invalid prior object still fail at that dependent branch. See [ResponseValidation](ResponseValidation.md).

## Item charge payments

Charge costs resolve to `charge:<itemId>` and aggregate by exact item identity using shared decimal arithmetic. Both normal and failure vectors validate before any check. `grantingItem` binds to the selected equipped item grant; `ownedItem` requires its concrete item ID. Multiple otherwise identical charged item grants require sourceId. Availability retains mode, unit, itemId, current value, capacity and resolved amount. Prompt actors include `chargeItems` with owned item identities, current pools and equipment state.

Preparation snapshots each selected full charge pool and equipment state; ownership/source checks rerun after asynchronous boundaries. Commit changes item pools inside the existing actor/effect transaction, restores them together with actor snapshots on failure, and writes only the owning durable technique receipt. Charge receipts retain exact itemId/mode/unit and previous/new/delta values; replay never debits a second time. Existing health/need costs and old saves without charge costs retain their behavior.

## Current-target damage effectiveness

Before any check or mutation, `prepare` batches every damage effect/target pair through required `assessDamageEffectiveness({ actor, technique, source, weapon, assessments })`. Each assessment includes its effective inherited or overridden check. The callback returns one ordered integer rating 1–5 per pair. Ratings remain separate from shared check outcomes, so effects sharing one roll can have different attack natures. [TechniqueDamageEffectiveness](TechniqueDamageEffectiveness.md) shares ordinary attack guidance and correction retries. No saved catalogue rating or neutral default substitutes for this assessment.

`DamageEffectiveness.js` shares ordinary multipliers 0, 0.5, 1, 2 and 3; half effectiveness rounds up as ordinary attacks do. Weapon damage uses its unmitigated ordinary calculation, authored bonus/multiplier and toughness before this single runtime multiplier. The assessed actor/target descriptions, class/race, weakness/resistance text, active status text, selected weapon facts and existing mechanics/stat snapshots are rechecked after assessment before the first roll and again at commit. Changes reject without rerolling. Nonfinite scaled damage rejects before mutation.

Successful damage effects persist `damageEffectiveness` and `damageCalculation: { preEffectiveness, effectivenessMultiplier, finalDamage }`; historical receipts without these fields remain readable. Exact amounts, deltas, formulas and applied health are saved. [TechniqueReport](TechniqueReport.md) rounds only presentation copies and summaries.

### Fixed debits and capacity transitions

Real preparation settles elapsed time for the actor and explicit targets before
capturing mechanics/resources; asynchronous assessment/check completion and commit
settle them again before the existing stale-snapshot comparison. Pure `preview`
remains read-only. Committed replay returns before settlement or payment.

A normalized payment vector is one `actor.withNeedBarMutation` operation. Health
is debited first, followed by other resources, so all fixed payments use the
prepayment effective bounds even when spending Rest changes Stamina capacity or
Health's governing attribute. Each pool's value/bounds must still match preflight,
and the native setter's actual resulting value must equal its exact debit. Cost
receipts retain authored units and prepayment bounds in their original vector
order. Only after all debit receipts are captured does the native boundary
reconcile capacity and rescale remaining fill percentages. The resulting ratio
adjustment is separate from spending and does not rewrite old or new cost
receipts. Later technique effects use their ordinary mutation boundaries.
