# TechniqueService

`TechniqueService.js` owns saved-world disciplines, catalogue definitions, immutable action receipts, actor acquisition/improvement, source selection, and authoritative technique execution. It is a focused service for damage, healing, buffs, and debuffs; it does not provide a scripting language or another combat die system.

World APIs are `reset()`, `hydrate(state)`, `toJSON()`, `validateState(state, { actors, things })`, and `validateReferences({ actors, things })`. State is `{ version: 1, disciplines: [], definitions: [], receipts: [] }`. Missing legacy state means empty; present malformed state, dangling active references, duplicate IDs, invalid formulas, and malformed nested receipts throw. Hydration registers compact technique/discipline IDs. `Utils.serializeGameState`, disk `techniques.json` writing/reading, and `hydrateGameState` include this state. Incoming owner/item/status references are validated before clearing live registries, definitions install before actor hydration, and references are checked again afterward. Historical receipt actors and targets may legitimately have been removed after corpse cleanup; active learned/item/status references remain strict. Receipts are retained without pruning.

Catalogue APIs are `resolveDiscipline`, `addDiscipline`, `getDisciplines`, `addDefinition`, `getDefinition`, `getDefinitions`, `reviseDefinition(id, mechanics)`, and `findMatches(intent, { actor? })`. Common definitions cannot duplicate a discipline/semantic-key identity. Catalogue edits append numbered base revisions; they never modify learned personal mechanics or existing equipment grants. Matching uses saved identities, names, and aliases; semantic intent classification belongs to the structured prompt boundary.

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

`getCompactPromptContext(actors)` applies the prompt-only
[TechniquePromptContext](TechniquePromptContext.md) projection to those records.
The shared base context uses it to keep one recipe/improvement schema per policy
and one canonical variable schema, with actor-specific value maps. Full managed
snapshots, UI fields and repeated formula metadata are omitted. Original
service/client DTOs and saved mechanics remain complete.

`resolveSource(actor, techniqueId, sourceId?)` applies the shared source policy. Explicit selection wins; otherwise the learned version wins even when blocked. With no learned version, one equipment source is selected, or identical versions choose the lowest stable grant ID. Different equipment mechanics require explicit selection. Requirements are never bypassed by silently switching sources. Learned source IDs are `learned:<techniqueId>`; equipment source IDs are grant IDs.

Acquisition APIs:

- `learn({ operationId, actor, techniqueId?, definitionRevision?, provenance, candidate?, candidateDiscipline? })` validates access and acquisition requirements, then durably learns a complete personal revision. Optional novel candidates are staged and installed only after successful validation and the actor write. Trainer sources must identify an available character who knows the technique; item sources require a matching owned teaching grant. Existing learned knowledge is retained.
- `grantDiscipline({ operationId, actor, disciplineId, provenance })` records explicit setting/story/editor access.
- `recordEvidence({ operationId, actor, techniqueId, evidence })` adds a distinct meaningful-use/story/training record; evidence is not a currency and does not automatically increase power.
- `improve({ operationId, actor, techniqueId, mechanics, evidenceIds, provenance })` installs exactly the next personal revision and retains previous complete mechanics. Non-editor improvements require distinct unused evidence, consumed once by operation ID. All amount formulas are validated against the actor before mutation. Another actor and the shared base are untouched.

Every operation uses a stable server-owned `operationId`; replay returns its stored receipt. Reusing an ID with a different original request rejects. `getReceipt(id)` returns the committed receipt or `null`; `getReceiptsForTurn(turnId)` returns committed action attempts for current-opportunity/NPC accounting, including failed and non-damaging attempts. Independent learning and passive equipment access are not active action receipts.

`prepareLearningBatch(groups)` and `commitLearningBatch(prepared)` provide the
focused initial-character authoring boundary described in
[StartingTechniques](StartingTechniques.md). Preparation stages every candidate,
prerequisite, formula and resource identity before any actor/catalogue mutation.
Starting acquisition bypasses the discipline's access gate and each revision's
acquisition requirements for its own initial techniques. Ordinary learning and
use-time requirements retain their gates; uniqueness and mechanics/reference
validation remain enforced. It
stages one explicit generation-provenance `disciplineAccess` record per newly
learned discipline. Commit installs those actor access records with learned
entries in the same stale-checked transaction and rolls both back on an actor
write failure; catalogue records and durable `initialization` receipts follow,
including empty repertoires, synchronously. Class and race prerequisites use the
actor's exact actual `class`/`race` identity through `{ kind, name }` requirements;
they do not infer world-specific names or make every discipline public.

Execution is `await execute({ operationId, turnId, actor, techniqueId?, sourceId?, targetIds?, expectedDefinitionRevision?, expectedPersonalRevision?, intent?, prepareCheck?, candidate?, candidateDiscipline?, acquisition? })`. Discovery acquisition is `{ provenance, definitionRevision? }`. A qualified first attempt stages catalogue and learned state until the accepted attempt commits; failed checks can still establish learning. Rejected preparation/resources never leave a candidate or learned entry.

`preview(options)` performs numeric/schema/source/resource/target preflight without a roll or world mutation. `prepare(options)` performs preflight, invokes the supplied existing engine check preparation callback, and returns an authentic prepared object. `prepareCheck({ actor, target, check, technique, source, effect })` must return a JSON-safe `{ success: boolean, ...checkReceipt }` without applying damage, effects, or costs. Automatic effects need no callback. Equal checks are shared across effects on the same target; area targets retain separate defense outcomes and share the attack die when the check is an attack. The normal cost vector wins when any planned effect passes its check on any target, including full-health healing and zero-damage hits; all misses use the failure vector. Both possible vectors must be affordable before any roll.

`assertCanStart(actor)` exposes the same authoritative registered-actor and dead/disabled/zero-health gate used internally by preflight. The technique-intent prompt boundary calls it after recognizing a new operation and checking committed references, so actor incapacity propagates directly after logging rather than becoming model correction feedback. It does not change execution eligibility or prevent replay of an already committed receipt.

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

Initial damage mode is explicit `technique`: apply the saved amount once through `modifyHealth`, with no additional weapon formula, toughness pass, or level/attribute bonuses. Existing health bounds remain authoritative. Weapon-based mode and future utility effects reject until a dedicated supported calculation contract exists.

Availability retains resolved cost amounts when affordability fails, so controls can display the actual amount alongside its blocker. Preparation/receipt equivalence compares object keys canonically; equivalent binding-map order does not create artificial source ambiguity.

New automatic healing and selected standard damage candidates are compiled through [TechniqueBalancePolicy](TechniqueBalancePolicy.md) in `learn`, discovery preview/prepare and `prepareLearningBatch`. `addDefinition(raw, { actor, origin, config })` and `reviseDefinition(id, mechanics, options)` use the same boundary. `origin` defaults to `automatic`; only trusted caller code can explicitly select `editor`. Model provenance cannot establish this authority. Existing stored catalogue identities still reuse their pinned historic mechanics. An unsupported recipe or unmanaged new automatic healing fails before learning, rolling or debiting.

`improve` additionally accepts `improvement: { stepId, reason? }` in place of `mechanics`. Managed automatic improvements require this proposal and use the owner's saved policy even after configuration reload. Evidence IDs are all validated before any are marked consumed. Actor-write failure restores evidence/history/mechanics, and failed rollback raises an aggregate error forbidding retry. Editor saves must retain managed metadata or explicitly pass `convertToCustom: true` with `origin: "editor"`. An editor-looking provenance alone grants no exemption.

Prepared initial batches capture the effective authoring policy digest in addition to catalogue/world/actor signatures. Actor signatures include active need values/applicability/capacity, gear/status, attributes and skills. A changed policy invalidates a novel prepared candidate/batch, while saved learned/equipped revisions continue to use their own snapshots. Receipt replay occurs before current policy or actor revalidation.

`getPromptContext` includes `balanceAuthoring` options; selected numeric previews use the existing server preview API. Learned groups expose `balanceImprovements: { policyDigest, steps, appliedImprovementIds }` from the owner's saved snapshot, separately from current new-authoring options.

`rebalance({ operationId, actor, techniqueId, expectedDefinitionRevision, expectedPersonalRevision, expectedPolicyDigest, recipe, provenance })` is the narrow reviewed repair boundary. It requires editor provenance, an exact latest catalogue/personal revision and `TechniqueBalancePolicy.digest(resolvePolicy())`. It atomically appends a compiled catalogue revision and one owner personal revision, preserving prior history and pinning that owner to the new base. Other owners/equipment pins retain their saved revisions. A normal immutable improvement receipt records the reviewed request, and an identical operation replay returns it before current checks. This method does not itself authorize or perform live-save changes or server restarts.

## Icon presentation metadata

World state optionally persists `icons: { [techniqueId]: { imageId, imagePrompt } }` separately from immutable definitions, actor revisions, and equipment pins. Old states without the map hydrate empty; malformed records and unknown target references reject. `getIcon(id)` returns a copied record with blank defaults; `setIcon(id, updates)` validates only those presentation fields. Availability groups expose the two image fields for shared icon rendering. `getRuntimeEpoch()` identifies the current service lifetime so asynchronous icon adapters reject a reset/hydrate even if an ID is reused.

`toJSON({ includePresentation: false })` omits icons for mechanical catalogue signatures; its default preserves icons in saves. Initial-learning preparation ignores image fields in ability signatures. The story runtime fingerprint uses the same mechanical-only catalogue projection. Generating or editing artwork therefore does not invalidate prepared mechanics or append a revision.

### Discipline icons

`disciplineIcons: { [disciplineId]: { imageId, imagePrompt } }` is a second optional presentation map in saved world state. It hydrates empty when absent and rejects malformed records or references to unknown disciplines. `getDiscipline(id)` returns a canonical copy or null. `getDisciplineIcon(id)` returns copied image metadata with blank defaults; `setDisciplineIcon(id, updates)` validates and changes only that metadata. `getDisciplines()` stays canonical and contains no image fields.

Both icon maps are omitted by `toJSON({ includePresentation: false })`, so artwork does not change the mechanical fingerprint, prepared-learning catalogue signature, discipline editor baseline, technique IDs, personal revisions, or equipment pins. Name/description edits retain the existing image and saved prompt until explicitly regenerated. The technique API supplies presentation separately as `disciplineIcons` keyed by discipline ID.

## Status sources and ability attachment authoring

`getAvailable`, `resolveSource`, preparation, commit revalidation and receipts recognize `sourceKind: "status"` alongside learned and ordinary equipped-item grants. A status source has stable `sourceId`, `statusId`, pinned `definitionRevision`, `statusName`, and optional `abilityId`/`abilityName` when derived from an owned ability. `statusName` and ability names are presentation facts; persisted source identity uses IDs and revision. Duration `0`, removal, ability removal, and unequipping revoke the source before a prepared use can commit. Acquired learned entries remain separate. Active status-grant references and duplicate source IDs are validated on save/load and after attachment application.

An active ability status grant also establishes effective access to its technique's discipline for that source. `getEffectiveDisciplineAccess(actor)` reports ordinary accessible disciplines plus ability-backed records with `sourceKind: "ability_status"`, `sourceId`, `statusId`, `abilityId`, and `abilityName`; `getPromptContext` uses this list. Removing the ability or its status removes that effective access. It does not add an explicit actor `disciplineAccess` record or make ordinary catalogue learning eligible. A granted technique still checks its revision's `useRequirements`, costs, actor state and current source at use and commit.

`getAbilityAttachmentExpected(actor, abilityIds)` returns a stale-review snapshot with the game epoch, actor ID, and requested ability records, excluding ability artwork. Ordinary resource, equipment, character-stat, and unrelated catalogue changes do not invalidate it; preview/apply still validate the attachments against current mechanics and references. `previewAbilityAttachmentBatch({ actor, entries, expected?, origin?, pendingAbility? })` validates without actor/catalogue mutation and returns canonical draft `entries`, `resolvedEntries`, new discipline/definition previews, and `expected`. The server-trusted `pendingAbility` allows one distinct unowned option to be validated prospectively while preserving the registered actor's actual abilities and catalogue. It is unavailable to `applyAbilityAttachmentBatch`. Each entry is `{ abilityId, statusEffects }`; a status may contain `techniqueEntries: [{ id?, techniqueId?, definitionRevision?, candidate?, candidateDiscipline?, provenance? }]`. Preview assigns missing draft IDs/provenance and resolves entries to pinned `techniqueGrants`; callers apply those returned draft entries to preserve IDs. `applyAbilityAttachmentBatch` revalidates and atomically installs the new catalogue records and owned ability statuses, rolling back catalogue, abilities and health on failure. Pending/declined offers do not install definitions. Explicit `statusEffects: []` removes attachments.
Missing preview IDs use the shared first-three-word name allocator for statuses, techniques and disciplines, with `_2`, `_3`, and later suffixes for collisions. Statuses use their name or, when unnamed, description. Supplied draft IDs are reserved first and preserved across later preview/apply, including catalogue renames. Preview still leaves actor and catalogue state untouched; discarded previews retain their name reservations. Saving and reloading pending drafts retains exact IDs through player draft registration and high-water reservations through `metadata.idNameCounters`; legacy numeric reservations remain in `metadata.idCounters`.

Semantic recipe authoring resolves eligible singleton selectors at actor-aware preparation. Attachment preview writes those resolved selections into returned canonical draft entries, so later actor/resource changes cannot reinterpret an omitted choice. Pending drafts still recompile/revalidate under current policy on application; no preview-policy snapshot or freshness gate is added. Installed managed revisions retain immutable saved coefficient snapshots. Deliberate custom damage remains supported independently of standard recipe availability.

Detached attachment validation retains status/technique-entry paths and original error causes. Owner modifier errors name actual owner facts; resource errors name active need IDs/payment directions; pinned revision errors list existing revisions. Prospective maximum-health errors identify the combined status modifiers to review. Preview continues to validate resource identity and mechanics without requiring current affordability. Catalogue-wide reference checks can expose existing invalid catalogue state; they do not authorize rewriting unrelated definitions.

## Discipline identities

`resolveDiscipline(raw, {disciplines?})` resolves against the live catalogue or the supplied detached map/array before definition compilation and common semantic matching. New IDs are `discipline_` plus the shared normalized first three source words, with `_2`, `_3`, and later collision suffixes. Canonical matching still uses the complete `IdGenerator.normalizeName(name)`: NFC lowercase, Unicode letters/numbers retained, runs of other characters compressed to `_`, and edge underscores removed. Distinct full titles sharing the same first three words receive distinct suffixed IDs. `Martial Arts`, `Martial--Arts` and `MARTIAL_ARTS` share one canonical discipline; `Fireball` and `Fire ball` remain distinct. Matching existing/staged records retain their original ID, name, description, access rules and provenance even when a proposal differs. Canonical reuse applies to editor creation, starting repertoires, ability attachments, learning and first-use discovery.

Existing IDs survive loading and renaming. An ID-bearing draft that still names an existing record resolves that canonical record, including after a rename. An unknown supplied draft ID conflicting with another canonical title rejects rather than rewriting the saved draft. New title ambiguity across multiple old IDs lists those conflicts and requires catalogue repair; an unrelated record occupying the derived stem receives a distinct suffix without overwrite. Unrelated punctuation-only legacy names remain loadable and do not match new proposals; a new punctuation-only title rejects clearly.

`availableDisciplineIds(disciplines?)` formats actual IDs, or explicit `none` for an empty catalogue. Missing-discipline validation uses the relevant live, loaded or staged catalogue, retaining original field/error context and correction guidance.

Detached ability-attachment preparation aggregates up to ten independent problems across statuses and technique entries, including actor facts, formula evaluation, resource costs and prerequisite references. Each issue retains its attachment entry/status/technique path. Candidate definitions and proposed disciplines enter detached lookup maps only after entry validation; a rejected status removes its detached additions before later statuses are checked. Any collected problem rejects before prospective ability validation or application. Existing ID reservations remain, while catalogue and actor installation remain outside rejected previews. Outer status construction and rules requiring an invalid prior object still fail at that dependent branch. See [ResponseValidation](ResponseValidation.md).
