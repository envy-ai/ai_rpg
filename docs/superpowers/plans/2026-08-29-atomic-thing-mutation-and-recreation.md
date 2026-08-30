# Atomic Thing Mutation And Recreation Implementation Plan

**Status:** Implemented

**Goal:** Make AI-directed Thing creation, alteration, direct field updates, and recreation validate a complete candidate before changing live world state. A malformed generated field, contradictory module configuration, nested prompt failure, or outer tool-loop retry must not leave partial mutations or duplicate Things behind.

**Primary incident:** During a generic-prompt request to recreate an item, the model attempted two `alterThing` calls, located the original, updated it directly, and then created a second Thing. The alteration calls failed while parsing `moduleSlots`; the direct update committed an invalid combination of `moduleSlots` and `moduleType`; `createThing` generated valid module fields and then overwrote them with conflicting caller-supplied extension fields; and the outer prompt later encountered a prompt-progress-group concurrency error. The original and duplicate both remained.

**Tech stack:** Node.js, in-memory `Thing` records and world indexes, Nunjucks XML prompts, chat tools, mod-registered entity fields, `LLMClient` prompt progress, and `node:test`.

---

## Required Outcomes

1. No live Thing or placement relationship changes before the complete proposed state validates.
2. `createThing`, `alterThing`, `updateObjectFields`, and the new `recreateThing` path use the same canonical field definitions and domain validators.
3. Invalid multi-field combinations, including a module item that also has module slots, fail before commit.
4. Explicit tool arguments are hard constraints merged into the candidate before validation. They are never reapplied after creation.
5. Structured values use their expected XML structure. `moduleSlots` uses nested XML elements; there is no legacy JSON-text compatibility branch.
6. Recreating a Thing is one atomic tool operation that preserves stable identity and placement by default.
7. A legal nested prompt sequence uses one progress group without reporting false concurrency.
8. Retried tool calls cannot replay an already-committed mutation.
9. Errors remain explicit. There are no silent repair, placeholder, or best-effort mutation paths.

## Non-Goals

- Do not implement an ACID-style transaction spanning an entire generic-prompt conversation. Some tools include prompt calls or other effects that cannot honestly be rolled back. Transactions are scoped to individual domain operations.
- Do not add automatic repair of invalid Things found in existing saves.
- Do not preserve or specially recognize JSON embedded in `<moduleSlots>`. Input either matches the registered nested XML structure or fails ordinary structural validation.
- Do not migrate every non-Thing entity to the new field architecture in this project. The design should permit later reuse, but the implementation scope is Things.
- Do not make XML or domain validation more forgiving after parsing. Tag-name normalization at the parser boundary does not relax the required shape or field invariants.

---

## Target Data Flow

```text
tool request
  -> resolve target and placement
  -> normalize canonical field names and values
  -> render/call/parse generation prompt when required
  -> build an isolated complete Thing candidate
  -> merge explicit hard constraints
  -> run field and whole-entity validators
  -> prepare a mutation receipt
  -> commit the Thing and placement changes once
  -> store the committed receipt under the tool-call operation id
  -> return the receipt
```

The generation and parsing portion must be side-effect free. The commit portion must not invoke an LLM.

---

## Task 1: Preserve The Incident As Regression Tests

**Likely files:**

- Modified: `tests/chat_tool_calls.test.js`
- Modified: `tests/chat_tool_create_thing_container.test.js`
- Modified: `tests/item_module_system.test.js`
- Modified or created: focused alter-Thing tests
- Created: a deterministic fixture derived from the audited generic-prompt response, if a shared fixture is useful

Add deterministic coverage before changing behavior:

1. Parse an item whose `moduleSlots` uses the required nested XML structure.
2. Reject malformed `moduleSlots` structure through the normal structural error path.
3. Reject a candidate with both a meaningful `moduleType` and nonempty `moduleSlots`.
4. Prove a failed multi-field update leaves every original field unchanged.
5. Prove conflicting explicit create constraints cannot overwrite an already-created Thing because creation has not happened yet.
6. Prove alteration failure leaves fields, inventory ownership, location membership, equipment state, and container membership unchanged.
7. Prove a retried mutating tool call with the same operation identity returns its prior result without creating another Thing.
8. Reproduce a generic prompt that launches a nested Thing prompt and then resumes without a prompt-progress concurrency error.

The tests should assert both runtime maps and `Thing` static indexes so an apparently absent duplicate cannot survive in a secondary registry.

### Completion criteria

- The regression tests fail for the known current defects before production changes.
- Fixtures contain only the minimal prompt/tool data needed to reproduce the behavior.
- No test requires a live model.

---

## Task 2: Define One Canonical Thing Field Schema

**Likely files:**

- Created: `ThingFieldRegistry.js`
- Modified: `ModExtensionRegistry.js`
- Modified: `Thing.js`
- Modified: `chat_tool_calls.js`
- Modified: `server.js`
- Modified: prompt item rendering/parsing helpers

Create a canonical registry that combines built-in Thing fields with mod-registered extension fields. It may adapt the existing `ModExtensionRegistry` rather than replacing it, but callers must consume a single resolved descriptor format.

Each field descriptor should define:

- Canonical field name
- Accepted input aliases
- Storage strategy: direct Thing property, metadata mirror, flag, cause effect, container data, or extension field
- Data type
- Normalizer
- Default/omission semantics
- Create-tool exposure
- Update-tool exposure
- Generator-prompt exposure
- XML parser exposure
- Tool JSON schema
- XML codec or XML child schema
- Per-value validator
- Optional dependency notes for whole-entity validation

Initial canonical alias decisions:

- XML/tool `type` maps to canonical `itemTypeDetail`.
- `itemOrScenery` maps to canonical `thingType` at the boundary.
- Existing accepted effect names map to canonical target/equipper effect collections.
- Tag spelling normalization remains a parser-boundary concern; internal field names are canonical.

Generate or validate these model-facing surfaces from the registry:

1. `createThing` parameters
2. `updateObjectFields` allowed Thing fields
3. Item-generation XML instructions
4. XML value parsing
5. Seed rendering

Add registration-time assertions for impossible or incomplete configurations. For example, a field exposed to the generator and XML parser must have a usable XML definition.

### Completion criteria

- `type`, `weight`, `properties`, container data, effects, and registered extension fields no longer disagree merely because the caller chose creation versus direct update.
- The tool schemas and prompt schemas are derived from or checked against the same descriptors.
- Schema inconsistency fails during startup or test setup with an explicit error.

---

## Task 3: Add A Side-Effect-Free Thing Candidate

**Likely files:**

- Created: `ThingMutationService.js`
- Modified: `Thing.js`
- Modified: module registration/runtime setup
- Created: `tests/thing_mutation_service.test.js`

Introduce a plain candidate representation. Constructing a candidate must not allocate an id, register a `Thing`, change a runtime map, alter placement, or update an inventory.

Suggested service API:

```js
prepareCreate(input, context)
prepareUpdate(existingThing, patch, context)
prepareReplacement(existingThing, generatedState, constraints, context)
validateCandidate(candidate, context)
commitCreate(candidate, placement, context)
commitUpdate(existingThing, candidate, context)
commitReplacement(existingThing, candidate, context)
```

The exact method names may change, but preparation, validation, and commit must remain separate phases.

Validation order:

1. Required core fields
2. Canonical field normalization
3. Per-field validation
4. Core Thing invariants
5. Registered extension-field validation
6. Registered whole-entity validators
7. Placement/reference validation

Extend mod entity registration with a whole-entity validation hook or add a companion validator registry. The modules mod should register `ItemModuleSystem.validateItemModuleFields()` as a Thing candidate validator. It must inspect the final values of `thingType`, equipment `slot`, `moduleSlots`, `moduleType`, and installed module identifiers together.

Validation errors should identify:

- The failed invariant
- Relevant field names and values
- Candidate Thing name/id when available
- The source of the conflicting values, such as explicit tool arguments or generated XML

### Completion criteria

- Candidate construction has no observable world mutation.
- All registered whole-Thing validators run before every service commit.
- A module item with module slots cannot pass any service mutation path.

---

## Task 4: Split Thing Generation From Persistence

**Likely files:**

- Modified: `server.js`
- Modified: Thing XML parsing/generation helpers
- Modified: `prompts/_includes/item.njk`
- Modified: generation call sites that currently instantiate during parsing

Refactor the shared item generator into two conceptual APIs:

1. Generate and validate Thing candidate data.
2. Materialize validated candidates into the world.

For a generated batch, parse and validate every candidate before materializing any member of the batch. A rejected response must not partially persist the valid prefix.

Explicit seed/tool values are hard constraints:

- The LLM fills fields that were not explicitly supplied.
- Explicit constraints are merged into the isolated candidate before whole-entity validation.
- If generated content contradicts a hard constraint in a way that cannot produce a valid candidate, retry the complete generation prompt with the precise validation error.
- Retry exhaustion propagates the final error and creates nothing.
- No caller reapplies seed or extension values to a live generated Thing.

Preserve prompt logging through `LLMClient.logPrompt()` for every generation and retry attempt.

### Completion criteria

- No `Thing` exists before the complete generated response validates.
- A rejected batch creates zero Things.
- The `createThing` post-generation extension-field overwrite loop is removed.

---

## Task 5: Migrate Existing Mutation Paths

### 5A. `createThing`

**Primary file:** `chat_tool_calls.js`

1. Normalize tool inputs through the canonical field registry.
2. Preserve all explicit values as candidate constraints.
3. Generate a candidate through the side-effect-free generator.
4. Merge constraints and validate the complete candidate.
5. Commit creation and placement once.
6. Return a mutation receipt.

Remove the post-generation `setExtensionField()` loop. Any `clearThingSlotWhenPresent` behavior must be part of candidate normalization and validation, not a later mutation.

### 5B. `updateObjectFields`

**Primary file:** `chat_tool_calls.js`

Replace sequential live operations with:

1. Resolve the target.
2. Normalize all requested fields.
3. Clone its complete state into a candidate.
4. Apply all requested values to the candidate.
5. Generate dependent data such as a concise description before commit.
6. Validate the complete candidate.
7. Commit all fields once.

If any field fails, none of the preceding fields may change. `applyReplacement()` and metadata mirroring should happen during the single commit, not once per field.

### 5C. `alterThing`

**Primary file:** `server.js`

1. Snapshot the existing Thing and placement.
2. Generate replacement candidate data without mutation.
3. Normalize and enrich effects on the candidate.
4. Merge required preservation constraints.
5. Validate the complete candidate.
6. Commit fields and placement once.

Do not remove the Thing from an owner or location before validation. Unique-name enforcement must either validate/resolve before commit or fail explicitly; it must not be a warning-only post-commit step.

### Completion criteria

- All three paths use `ThingMutationService`.
- Invalid updates and alterations preserve byte-equivalent `toJSON()` state and unchanged placement relationships.
- Successful paths still update runtime indexes, metadata mirrors, and timestamps correctly.

---

## Task 6: Give Structured Fields Structured XML

**Likely files:**

- Modified: `ModExtensionRegistry.js`
- Modified: `mods/modules/index.js` or the module field-registration file
- Modified: `prompts/_includes/item.njk`
- Modified: Thing XML parsing helpers
- Modified: `tests/mod_entity_field_xml_prompt.test.js`

Extend registered fields with typed XML rendering/parsing support. A structured field should declare its expected element and child structure instead of serializing arbitrary JSON into element text.

Canonical module-slot representation:

```xml
<moduleSlots>
  <moduleSlot>
    <type>mod</type>
    <label>Optional label</label>
  </moduleSlot>
</moduleSlots>
```

The parser returns the canonical array form:

```json
[
  {
    "type": "mod",
    "label": "Optional label"
  }
]
```

Rules:

- `<type>` is required and nonblank for every `<moduleSlot>`.
- `<label>` is optional.
- An empty `<moduleSlots>` represents an empty array.
- Unexpected child structure fails normal XML structural validation.
- There is no JSON-specific detection, error, parser, or compatibility behavior.
- Prompt examples and tests emit only canonical nested XML.

### Completion criteria

- The LLM is never instructed to place JSON inside `<moduleSlots>`.
- Valid nested slot XML round-trips through prompt rendering and parsing.
- Nonconforming content fails because it does not match the expected XML shape.

---

## Task 7: Add Atomic `recreateThing`

**Likely files:**

- Modified: `chat_tool_calls.js`
- Modified: generic-prompt tool definitions/instructions
- Modified: `server.js` only if generation dependencies must be exposed differently
- Created or modified: focused chat-tool tests

Suggested tool inputs:

- `thing`: exact target reference
- `instructions`: required replacement description
- Optional explicit replacement fields supported by the canonical schema

Default semantics:

- Preserve the Thing id.
- Preserve owner, location, container, equipment, and other identity-bearing references.
- Preserve creation/provenance metadata unless explicitly defined as replaceable.
- Replace descriptive and mechanical state from the validated candidate.
- Clear presentation state such as `imageId` only according to the existing alteration policy.

Execution:

1. Resolve exactly one target or return the normal ambiguity error.
2. Snapshot its full state and reference graph.
3. Generate replacement candidate data using the current Thing and instructions.
4. Merge explicit hard constraints.
5. Validate the complete candidate.
6. Commit the replacement atomically while preserving stable references.
7. Return a mutation receipt with original/final names and changed fields.

Prefer an in-place state replacement that preserves object identity. If a new `Thing` instance is unavoidable, prepare all registry/reference swaps first and apply them as one commit with rollback coverage for every side effect.

Generic-prompt guidance should direct recreation requests to `recreateThing`, not to a model-managed sequence of alteration, lookup, creation, and deletion calls.

### Completion criteria

- A successful recreation leaves exactly one Thing with the original stable id.
- Generation, parsing, or validation failure leaves the original unchanged.
- Inventory, location, container, and equipment references remain correct.

---

## Task 8: Make Prompt Progress Sequential By Construction

**Likely files:**

- Modified: `LLMClient.js`
- Modified: `chat_tool_calls.js`
- Modified: prompt-progress client code only if the existing event shape cannot represent stages
- Modified: `docs/classes/LLMClient.md`

Represent grouped progress as explicit sequential stages:

```text
outer generation
  -> tool waiting
  -> nested tool prompt
  -> tool waiting
  -> resumed outer generation
  -> complete
```

Add a stage-ownership API or equivalent state machine:

- A stream acquires the sole active stage token for its group.
- Ending the stream releases that token before tool execution begins.
- A nested prompt inherits the group and acquires the next stage.
- The outer prompt resumes only after the nested stage releases ownership.
- Waiting/tool execution retains the existing blue paused-bar presentation.
- Two genuinely overlapping requests for one group still fail explicitly.

Prompt queue reservation yielding and progress-stage ownership are separate concerns and should remain separately tested.

### Completion criteria

- Prompt-launching tools can run and return before the outer tool loop resumes.
- The legal sequence never throws `cannot run concurrent requests`.
- True concurrent ownership is still rejected.
- Cancellation and retry cleanly release stage ownership.

---

## Task 9: Add Tool Mutation Idempotency And Receipts

**Likely files:**

- Modified: `chat_tool_calls.js`
- Modified: request/tool-loop context creation
- Modified: API error/result serialization where committed operations must be surfaced

Use an operation key derived from the prompt request identity and tool-call id. Store the receipt for every committed mutating call for the duration of all retry paths that can replay that call.

On replay:

- Return the stored successful receipt.
- Do not invoke the mutation service again.
- Do not allocate another id or rerun a generation prompt.

Suggested receipt fields:

- Operation id
- Tool name
- Target Thing id
- Before and after checksums
- Changed fields
- Placement before and after
- Created/replaced/deleted ids
- Commit timestamp
- `committed: true`

If the final outer completion fails after one or more committed tools, propagate an explicit partial-completion error carrying the committed receipts. The client should be able to report what succeeded instead of presenting the whole request as if no state changed.

### Completion criteria

- Replaying the same successful tool-call id cannot duplicate a mutation.
- Distinct tool-call ids remain distinct operations even when their arguments match.
- Post-commit outer failure exposes the committed operation list.

---

## Task 10: Audit Existing Invalid Things Without Repairing Them

**Likely files:**

- Modified: save hydration/startup validation path
- Modified: module initialization
- Created or modified: hydration validation tests

After hydration and mod registration, run a read-only validation audit over loaded Things. Report:

- Thing id and name
- Failed invariant
- Conflicting fields
- Validator/mod that reported it

Do not mutate or automatically repair loaded data. Existing invalid Things should remain inspectable. Any attempted mutation must either produce a fully valid candidate or fail explicitly.

Whether invalid loaded Things merely warn or prevent normal server startup should remain a separate policy decision; the audit itself must always provide precise diagnostics and never silently normalize the problem away.

### Completion criteria

- Invalid legacy state is visible in terminal diagnostics.
- Hydration performs no prompt calls and no repair mutations.
- New mutation paths cannot create another invalid Thing.

---

## Task 11: Verification Matrix

### Canonical schema

- Built-in and registered fields resolve through one descriptor shape.
- Aliases normalize to one internal name.
- Create/update/XML exposure cannot drift without a startup/test failure.
- `weight`, `properties`, effects, container data, and module fields have deliberate, matching tool behavior.

### XML

- Valid nested `moduleSlots` parses.
- Empty `moduleSlots` parses to `[]`.
- Missing slot type fails.
- Unexpected structure fails ordinary XML validation.
- CDATA contents remain unchanged.

### Domain validation

- Module item plus module slots fails.
- Slots on scenery fail.
- Slots on a nonequippable item fail.
- Unknown module type fails.
- Valid modular equipment and valid standalone modules pass.

### Atomicity

- Failed create leaves no static or runtime record.
- Failed update preserves every field.
- Failed alter preserves placement and state.
- Failed recreation preserves the original.
- Failed generated batch persists zero members.

### Recreation

- Stable id is preserved.
- Owner/location/container/equipment references are preserved.
- Successful recreation leaves one record in every index.
- Ambiguous target resolution causes no generation or mutation.

### Progress and retries

- Nested prompt stages turn the grouped bar blue while waiting and resume normally.
- Sequential prompt-launching tools share the group without false concurrency.
- Cancellation releases ownership.
- Retrying a committed tool call returns the original receipt.

### Save/load

- Valid module and structured fields survive round-trip.
- Invalid loaded state produces a detailed audit entry without repair.
- Mutation of invalid loaded state cannot commit unless the candidate is valid.

Run focused `node --test` targets throughout implementation, syntax-check every changed JavaScript file, then run the normal headless end-to-end suite. Store any generated artifacts under `./tmp` and Playwright scripts under `./playwright_scripts`.

---

## Task 12: Documentation And Final Rollout

**Docs to update:**

- `docs/classes/Thing.md`
- `docs/classes/LLMClient.md`
- `docs/mods/modules.md`
- `docs/api/chat.md`
- `docs/modding_hooks.md`
- `docs/README.md`
- New `docs/classes/ThingMutationService.md`

Document:

- Candidate-versus-live Thing boundaries
- Field descriptor and entity-validator contracts
- Canonical nested module-slot XML
- Atomic create/update/alter/recreate behavior
- `recreateThing` semantics
- Progress-stage ownership
- Idempotency and mutation receipts
- Legacy-state audit behavior

Implementation order:

1. Regression tests
2. Canonical schema adapter
3. Candidate and whole-entity validation
4. Side-effect-free generation
5. `createThing` migration
6. `updateObjectFields` migration
7. `alterThing` migration
8. Structured XML codecs
9. `recreateThing`
10. Prompt-progress stages
11. Idempotency and receipts
12. Legacy-state audit
13. Full tests and documentation

After verification, restart the game server without loading a save so the new runtime schema, tool definitions, and prompt context are rebuilt cleanly.

---

## Settled Design Decisions

1. `recreateThing` preserves the original id and placement by default.
2. Explicit tool arguments are hard constraints; contradictions retry generation and ultimately fail clearly.
3. Existing invalid save data is reported but never automatically repaired.
4. `moduleSlots` accepts only its expected nested XML structure. There is no compatibility window or format-specific JSON handling.
5. Transactions are per domain tool operation, not across the entire generic-prompt conversation.
