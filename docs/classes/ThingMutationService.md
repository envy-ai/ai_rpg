# ThingMutationService

## Purpose

`ThingMutationService.js` is the validation and commit boundary for AI-directed Thing creation, direct field updates, alteration, and recreation. It separates candidate preparation from persistence so malformed XML, conflicting hard constraints, or a whole-Thing invariant cannot partially change live world state.

`ThingFieldRegistry.js` supplies the canonical built-in field descriptors and aliases. `itemOrScenery` normalizes to `thingType`, and `type` normalizes to `itemTypeDetail`. Registered mod Thing fields are merged into the same registry for create/update filtering and patch application.

## Candidate Boundary

`Thing.fromJSON(data, { register: false })` creates an isolated candidate. It does not allocate or register an id and does not enter Thing id/name indexes or a runtime map. Candidate preparation clones input data, applies explicit constraints, constructs the unregistered Thing, and runs all whole-entity validators.

The service exposes:

- `prepareCreate(data, { constraints })`
- `prepareCreateBatch(entries)`
- `prepareUpdate(existingThing, patch, options)`
- `prepareReplacement(existingThing, generatedData, constraints, options)`
- `validateCandidate(candidate, context)`
- `commitCreate(prepared, { runtimeRegistry })`
- `commitCreateBatch(preparedEntries, { runtimeRegistry })`
- `commitUpdate(existingThing, prepared, options)`
- `commitReplacement(existingThing, prepared)`
- `audit(things, { warn })`

Batch preparation validates every member before registration. Batch commit validates the complete prepared list again and removes already-registered batch members if materialization unexpectedly fails.

## Validation And Commit

Core validation requires a nonblank name and description, an `item` or `scenery` Thing type, and consistent container state. `ModExtensionRegistry.validateEntity('thing', candidate, context)` then runs every registered whole-Thing validator. The modules mod uses this hook to reject invalid combinations such as module items with their own module slots, slots on scenery, slots on nonequippable items, and unknown module types.

`commitUpdate` and `commitReplacement` call `Thing.replaceStateFrom(...)`, preserving the registered object's id and JavaScript identity while replacing its validated private state and updating the name index once. Receipts include before/after checksums, changed fields, placement metadata, affected ids, commit time, and `committed: true`.

## Generation And Hydration

Single-Thing generation validates parsed XML plus explicit tool constraints inside the configured retry loop. Inventory, container-content, and location-Thing batches prepare every candidate before any member is registered. Callers must not reapply explicit fields after creation.

Character inventory generation also runs its final computed-level, scaled-bonus,
metadata and mod-field `prepareCreate` calls inside the same bounded correction
loop as strict `<items>` parsing and barter-stock counts. Thus an invariant such
as module slots on a nonequippable item returns its exact error to the model,
instead of losing the complete batch after the last completion. Registration,
inventory attachment and other postprocessing occur only after that loop accepts
all prepared entries; corrections never repeat a commit.

Container-content generation similarly validates strict XML, pending seed
coverage/counts, mod invariants and final scaled candidates inside one correction
conversation. Commit, attachment and pending-seed clearing stay outside it.
Location Things perform final scaled candidate preparation in the active standard
parser or TinyBrain final stage, preserving the approved roster during correction.

After save hydration, the API runs `audit(...)`. Audit failures are printed with Thing id/name and the validator error. Audit is read-only: it does not repair or normalize legacy state.

