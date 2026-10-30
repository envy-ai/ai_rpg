# PlayerActionResolutionPlan

The TinyBrain API hook declares authoritative completed-resolution notes through section-local keyed `retainedMessages` (`player-action-resolutions`). A partial-success retry error supplies the same key via `tinyBrainRetainedMessages`; the final complete ledger note replaces that partial note after acceptance. Successful execution ledgers remain authoritative while failed plans and correction text are removed from later section context. See [TinyBrainRetryContext](TinyBrainRetryContext.md).

`PlayerActionResolutionPlan.js` parses and executes mechanical plans for regular
TinyBrain `player_action` runs. The model proposes checks, attacks and techniques in one
ordered XML batch; the server runs the existing authoritative resolvers and
supplies their results before prose continues. Native model tools on this path
are limited to read-only information lookups.

## XML contract

The root is `<resolutionPlan>`. It contains zero or more ordered `<check>`,
`<attack>` and `<technique>` entries. Checks/attacks have a child `<type>`: `unopposed` or `opposed` for
checks, `single` or `area` for attacks. XML attributes are rejected throughout.
`<resolutionPlan/>` explicitly requests no additional resolutions.

Surrounding commentary and Markdown fences are accepted through
[TinyBrainXmlResponse](TinyBrainXmlResponse.md). The final expected envelope,
including a self-closing empty plan, is selected before strict validation.
Malformed content inside that envelope still fails; an earlier valid plan or
valid nested child cannot hide a malformed final envelope. The parser returns
the extracted plan as `normalizedResponse`, while the runner logs the original
model response.

Multiple checks and attacks are permitted, including repeated actors and
separate actions with identical mechanical parameters. A single area effect is
one attack with multiple `<target>` children; separate attacks are separate
entries. The model must not list hypothetical branches, duplicate a completed
action, invent a die roll or outcome, or repeat an already-resolved hidden-NPC
contest.

Checks provide an actor, intent, skill/attribute choices, and circumstance
modifiers. Unopposed checks provide a difficulty. Opposed checks provide one
opponent with its own skill/attribute choices. Attacks provide an attacker,
weapon/ability choices, attack skill and damage attribute, and explicit targets
with their applicable defense and effectiveness details. The server supplies
the area resolver's fixed shared-roll mode rather than asking the model to
repeat it. Techniques reference engine-provided canonical IDs. No invented execution IDs, numeric character stats, rolls, or damage
results are required.

Integer fields accept one optional leading `+` or `-`, so `<amount>+3</amount>`
is the same numeric modifier as `<amount>3</amount>`. Safe-integer validation
and attack-specific ranges still apply; repeated signs, decimals, and numeric
text with trailing content are rejected. Reference IDs retain their exact syntax.

Strict XML, field, type, and reference validation occurs before a batch can
mutate the game. Invalid plans receive parser correction feedback at the same
TinyBrain checkpoint. Existing resolver input contracts remain authoritative;
the plan does not introduce a second dice or damage implementation.

`validatePlayerActionResolutionReferences(...)` uses the API's existing actor,
skill-definition, attribute-key, and attack-readiness helpers. Acting and opposed
checks require at least one valid skill or attribute. Attacks require both a
known attack skill and a known damage attribute; their defense selectors retain
the existing `N/A` rules. Canonical actor identities also reject self-opposition
and area targets repeated under different names.

## Execution and retries

`createResolutionPlanExecutionState(runId)` owns one transient execution ledger
for the staged run. `executePlayerActionResolutionPlan(...)` validates a complete
batch before execution and rechecks each action against the state produced by
earlier actions. It delegates the four supported operations to the existing
chat-tool runtime. Ordinary die overrides, interactive forced rolls, attack
damage and defeat semantics, check-results records, and debug events remain
server-owned.

Each accepted action receives a server-owned run/checkpoint/ordinal identity and
its own result-cache namespace. Two distinct attacks with identical arguments
can therefore execute separately, while completed actions cannot be rerolled or
apply damage a second time on retry.

If a known pre-execution validation failure occurs after earlier actions have
completed, their receipts stay authoritative. The correction requests only the
remaining unexecuted suffix; the server retains the completed prefix. An error
whose mutation status is indeterminate is fatal for that run and is propagated
without retrying the action. Completed receipts are recorded before downstream
notification callbacks so a notification failure cannot erase a committed
result.

`formatPlayerActionResolutionResults(...)` supplies the authoritative receipts
to the retained conversation using descriptive operation labels: unopposed
check, opposed check, single-target attack, or area attack. Receipts retain the
intent, resolution inputs, and authoritative outcome without advertising the
internal resolver names as available native tools. Planning and execution
diagnostics share the existing TinyBrain prompt log through
`LLMClient.logPrompt()`.

## Scope

The regular TinyBrain player-action program plans committed actions before
outcome selection and requests supplemental unresolved actions around later
drafts. Every planning checkpoint offers all four variants together. Final
prose must honor completed results and must not invent new unresolved actions.
Standard player actions, other prompt families, and legacy checks retain their
existing resolution paths.

## Verification

`tests/player_action_resolution_plan.test.js` covers mixed XML variants,
strict parsing and reference validation, multiple actions, whole-batch
preflight, per-action execution identities, pending-only retry, and fatal
no-replay behavior. Runner integration and real-template rendering are covered
by `tests/tiny_brain_prompt_runner.test.js` and
`tests/player_action_tinybrain_target_location.test.js`, including legacy
branching, lookup-only native schemas, forced rolls, and authoritative receipt
propagation. These use isolated state and mocked providers rather than a live
game or model.

## Technique operations

Plans also accept ordered `<technique>` entries with text-only `actor`, `intent`, canonical `techniqueId`, optional pinned `sourceId`, and `targets` containing canonical `targetId` children. Discovery can include XML-escaped JSON `candidate` and optional `candidateDiscipline`; the shared Technique schema rejects unsupported mechanics before mutation. Technique entries do not contain a `type` field or repeat engine-known costs, ownership, stats, rolls or amounts.

API validation previews all technique references, sources, resources and targets before executing the ordered batch. Execution calls `TechniqueService` with stable turn/checkpoint/ordinal operation IDs and the existing nonmutating skill/opposed/attack-check boundary. The saved receipt is authoritative before prose. A technique effect must not also appear as an ordinary attack/check in the plan. TinyBrain's twelve read-only native tools and tool choice remain unchanged; technique execution is an engine operation, not a new TinyBrain native tool.

A qualified first attempt of an existing catalogue technique can provide `discoveryIntent` without repeating its known definition. Acquisition remains staged with the accepted attempt.

A `<technique>` may contain `<operationId>` to reference an existing matching committed receipt in the current turn, or `<newAttempt>true</newAttempt>` plus intent to declare another matching attempt. These fields are mutually exclusive. Matching prior attempts require one of them; an omitted field never silently merges or duplicates the primary pre-narration attempt. Model IDs only select receipts; new attempts receive server ordinal IDs. Multiple deliberate identical new attempts remain distinct operations.
