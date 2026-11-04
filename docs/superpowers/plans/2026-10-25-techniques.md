# Generalized techniques implementation plan

Date: 2026-10-25. Status: **initial supported scope implemented**. This document retains the accepted design and delivery gates; the focused class/API documentation describes the shipped contracts. Item charges are an approved supporting extension, planned only. Utility effects and weapon-derived damage remain later extensions.

The follow-up [technique balance plan](2026-10-25-technique-balance.md) delivered engine-owned standard healing recipes, decreasing resource costs, saved policy snapshots and a targeted copied-save repair for weak generated healing. Consult its delivery record and the focused class/API documentation for the updated automatic-authoring contracts.

## Goal and agreed scope

Add persistent, mechanically defined techniques for players and NPCs, including enemies. Techniques are distinct from existing skills and level-up abilities. Skills remain broad proficiencies, abilities retain their current progression, and techniques describe particular actions a character can learn or obtain access to: a healing spell, a martial strike, or a psychic defense, for example.

The following decisions are already agreed and should not be reopened during routine implementation:

- Group techniques under arbitrary setting-appropriate disciplines, such as Magic, Martial Arts, and Psionics. Do not hardcode a magic-only system or require a discipline to correspond one-to-one with a skill.
- Maintain a common saved-world pool of nonunique techniques, with unique techniques also supported. A catalogue entry does not grant every character knowledge of it. Each character owns their learned state and personal upgrades; improving one character's technique never upgrades everyone else's copy.
- Acquisition and improvement can come from trainers, exploration/discovery, equipment, prerequisite milestones, meaningful use, and story events. Add no technique points, research currency, or mandatory new leveling system.
- A reasonable natural action may discover a technique and resolve its first attempt immediately. Validate plausibility, discipline access, and prerequisites first. A qualified failed roll can still establish learning; merely asking for an implausible power cannot.
- Match semantically equivalent intents against learned techniques and the world catalogue before generating another definition.
- Initial executable effects are damage, healing, buffs, and debuffs. Leave teleportation, summoning, and other utility effects for later extensions.
- Support fixed amounts and explicit saved scaling formulas. The engine calculates numeric results; the model does not improvise mechanics on each use.
- Reuse health and configured need bars for costs, through a resource interface that can accommodate future pools. Support multiple simultaneous costs. Pay once for a valid started attempt, including a failed roll; invalid actions, missing resources, and insufficient resources reject without charge. Definitions may override failure costs.
- Repeating a buff refreshes it rather than adding magnitude unless its definition explicitly allows stacking.
- Support natural chat use, a technique panel with a Use action, and editing through existing character/mechanics editing conventions.
- Existing saves initialize empty technique state. Do not infer learned techniques by scanning old narration or reinterpret existing abilities as techniques.
- Standard and TinyBrain modes must both support the feature. TinyBrain uses validated XML child elements and server execution, without new execution tools or changes to its fixed native schema/tool-choice contract. Repeated processing must reuse receipts rather than charge, roll, learn, upgrade, or apply effects twice.

The structures and API sketches below retain the design intent. Consult the linked class/API documentation for exact implemented field and method names.

## Current architecture and integration constraints

Read the focused docs before editing the named code. The relevant starting points are [Player](../../classes/Player.md), [StatusEffect](../../classes/StatusEffect.md), [Skill](../../classes/Skill.md), [PlayerActionResolutionPlan](../../classes/PlayerActionResolutionPlan.md), [Events](../../classes/Events.md), [ThingMutationService](../../classes/ThingMutationService.md), [chat API](../../api/chat.md), and [modal conventions](../../ui/modals_overlays.md).

| Existing area | Verified behavior | Consequence for this change |
| --- | --- | --- |
| `Player.js` | Represents both players and NPCs; owns skills, abilities, health, need bars, intrinsic statuses, gear, and save serialization. | Add character technique state here once, rather than separate player/enemy models. |
| `api.js` attack helpers | `computeAttackOutcome` calculates hit and weapon-derived damage; `resolveAttackToolCall` immediately calls `applyAttackDamageToTarget`. NPC paths also resolve attacks before narration. | Separate reusable roll/outcome preparation from application where needed. Calling the current mutating attack resolver and then adding technique damage would double-apply mechanics. |
| `api.js` NPC turn exclusion | `collectSuccessfulNpcAttackActorIds` recognizes `resolveAttack` and `resolveAreaAttack` receipts; the later NPC scheduler excludes those actors. | Include committed technique attempts in the same current-turn opportunity accounting in both prompt modes. A new operation name must not grant an NPC another scheduled action. |
| `PlayerActionResolutionPlan.js` | Regular TinyBrain actions parse an ordered `<resolutionPlan>` of checks/attacks, validate the batch, execute with server identities, retain completed receipts, and retry only known unexecuted suffixes. | Extend this server-owned plan/execution boundary for techniques. Preserve distinct repeated actions and fatal handling of indeterminate mutations. |
| `TinyBrainPromptFamilies.js`, `TinyBrainPromptParsers.js`, `TinyBrainResultBuilders.js` | Staged parser correction, authoritative result feedback, local XML assembly; regular player and NPC prose use read-only native lookups. | Add technique selection/discovery fields and parser contracts, not model execution tools. |
| `StatusEffect.js`, `Player.js`, `status_effect_list.js` | Status duration/ticking uses world minutes. Existing intrinsic upsert matches descriptions, and serializers normalize a finite field set. | Add persisted technique provenance and a narrow identity-aware upsert for technique effects. Description matching alone cannot enforce refresh across renamed or upgraded techniques. Preserve unrelated status behavior. |
| `Player.js` resource methods | `modifyHealth` and need-bar setters already enforce their existing bounds. Need availability depends on audience and actor applicability. | Validate exact debits before calling setters; do not let their existing bounds turn an unaffordable cost into partial payment. Do not add new clamps or enable a missing/inactive pool automatically. |
| `public/js/formula-evaluator.js` | Existing restricted arithmetic parser is shared with server code; `utils/formula-utils.js` contains small formula helpers. | Reuse and validate this parser rather than JavaScript `eval`, `Function`, or another expression engine. |
| `Utils.js`, `api.js`, `Globals.js` | Save serialization, named JSON file write/read, hydration, current game/world maps, and new/load lifecycle are separate integration points. | A new actor field alone cannot persist a world catalogue or execution receipts. Cover every save/reset/load path and include relevant state in runtime fingerprints. |
| `Events.js`, event prompts, client summaries | Post-narration events already apply health/status/world changes. | Carry committed technique receipts into event extraction/application so narration does not cause a second health change, status gain, resource debit, or acquisition. |
| `views/player-stats.njk`, `public/js/player-stats.js`, `views/index.njk`, `public/js/chat.js` | Character views, NPC editors, chat submission, and shared modal shortcuts already exist. | Reuse character card/editor and action-submission patterns. Keep one actor-agnostic technique renderer/editor. |

Skills may exist at their initialized rank for every actor. In particular, the mere presence of a skill named Spellcasting is insufficient evidence that an arbitrary character can heal magically. Qualification must consider explicit access prerequisites and actual character/world evidence, using setting-defined discipline rules rather than hardcoded class names.

This is a substantial cross-cutting change. The difficult boundaries are first-attempt discovery, effects/cost atomicity, duplicate event prevention, and parity between two prompt flows. Implement a thin end-to-end slice before broadening content; do not build a general scripting language, a separate combat engine, or a universal transaction framework.

## Proposed domain and persistence

Start with `Technique.js` for strict definitions/serialization and `TechniqueService.js` for candidate preparation, acquisition, personal revision, validation, and authoritative execution. Extract a focused resource or formula helper only where it keeps these responsibilities clear. Use existing `Globals` accessors, ID generation, model conventions, and save infrastructure.

### Disciplines and shared definitions

A discipline has a stable ID, display name, description, and setting-defined access/acquisition rules. A definition has:

- Stable technique and discipline IDs; semantic identity/aliases; display name and description; unique/nonunique scope and provenance.
- Immutable numbered revisions containing prerequisites, target rules, check requirements, costs, initial supported effects, and refresh/stack policy. Save any referenced revision.
- Separate acquisition requirements and ongoing use requirements. Learning a sword form can be permanent while its use requires an equipped sword.
- Structured provenance for trainer/discovery/item/story sources, sufficient to explain why acquisition was allowed. Private source information must remain private in player-facing responses.

Keep the catalogue scoped to the saved world. It is the shared identity/definition pool, not a globally unlocked shop or a list every actor can use. Inject relevant known techniques and discoverable candidates into prompts; do not dump all secret world techniques or trainers' entire knowledge into player context. A trainer must have a believable teaching source and satisfy any world/character conditions.

### Character ownership and revisions

Persist a character's learned entries with `techniqueId`, pinned `definitionRevision`, personal revision/effective mechanics, acquisition provenance/world minute, and meaningful-use or story evidence needed for future improvement. Personal changes should store a complete validated effective mechanical revision, avoiding fragile merging against a mutable catalogue record. Preserve linkage to the common identity for matching and buff refresh.

Default editor behavior changes that character's technique only. Editing the common catalogue deliberately creates another base revision; it affects future grants but does not silently rewrite already learned/pinned copies. A later explicit rebase/reset operation can replace a character's personal revision; it must show the affected actor and mechanics. Avoid adding a global mass-migration editor in the initial delivery.

An item can grant **temporary access while equipped** without teaching the technique. Derive that availability from persisted item grants and current gear. An item that explicitly teaches a technique creates durable learned state. A learned technique can separately require a particular equipment category or item to use. Unequipping a temporary grant removes access; it does not delete an independently learned copy. If two equipped items grant the same common technique, show one usable identity with its available sources rather than duplicate cards.

Each equipment grant has a stable grant ID, source item ID, technique ID, and pinned immutable definition revision. Catalogue edits do not change existing grants. Equipment access uses that grant's revision; learned access uses the actor's pinned personal revision. A personal upgrade never rewrites an item's grant or silently substitutes its mechanics.

Resolve the executable source before showing final costs or starting an attempt. An explicitly selected source wins. Without one, select the learned source when present; if its requirements are unmet, show that blocker rather than silently changing to an equipment version. With no learned source, select the sole equipment source, or the lowest stable grant ID among grants with identical effective mechanics and use requirements. If equipment sources differ, require a source choice before execution. One grouped card can expose those source options with their own costs and blockers. Natural chat uses the same policy and can name a source explicitly; ambiguity is clarified before charging or rolling.

The prepared action and receipt retain source kind, source/grant ID, item ID when relevant, definition revision, and personal revision when relevant. Revalidate that exact source after asynchronous boundaries and at commit. Unequipping or changing the selected grant invalidates an uncommitted action; do not automatically switch sources. A retry of an already committed action returns its receipt even if its source has since been unequipped. Explicitly choosing another source for a new attempt resolves its own mechanics normally.

Initial item grants need explicit saved `Thing` fields or the established extension field mechanism, included in its field registry/generation/editing/serialization contracts. Do not hide gameplay-critical grants in unvalidated descriptive text. No starting gear or historic item should acquire grants automatically on old-save load.

### Saved world lifecycle

Proposed world state includes catalogue disciplines/definitions/revisions and committed execution receipts. Extend `Utils.serializeGameState`, save JSON writing/reading, `hydrateGameState`, game reset/new-game/load paths, compact-ID counter seeding, relevant runtime mechanics fingerprints, and filtered client serialization together. Hydrate definitions before validating character references and status provenance.

Missing legacy technique files/fields mean empty state. Present-but-malformed data, missing referenced revisions, and duplicate IDs are explicit errors with the original stack; never substitute invented powers or silently drop an owner's mechanics. Validate an incoming saved candidate before installing it into the live runtime wherever the existing load path permits. New-game/load clears prior-world catalogue, available-item projections, pending candidates, and transient execution state.

Receipts are gameplay state, not just debug logs. Persist them with stable turn/action identities so save/load and event reprocessing can identify completed actions. Keep references from statuses, learned revisions, and pending/replayed outcomes coherent. Start with straightforward retained receipts; do not add pruning until a safe retention boundary is defined and tested.

## Mechanics and execution contract

### Values and scaling

Each cost or effect amount is either a finite fixed value or a formula referencing automatically supplied character variables. The shared variable catalogue supplies `level`, `skill_<normalized_name>` ranks, and `attribute_<normalized_name>_modifier` values. For example, `5 + skill_spellcasting * 2` reads the caster's Spellcasting rank directly. The editor provides an Available variables table with current values and insertion controls; users and models do not create binding rows or supply stat values.

Validate syntax, referenced variables, supported operations/functions, binding identities, and finite evaluated output before commitment. Reject unknown variables, divide-by-zero/nonfinite results, invalid amounts, unsupported effect kinds, and malformed revisions with precise context. No arbitrary code, property access, dynamic callbacks, guessed missing values, or automatic formula repair. Do not introduce implicit clamping or rounding. Preserve finite decimals where the owning mechanic supports them; integer duration rules remain those of `StatusEffect`.

Store formula references in the definition/personal revision. Existing saved alias bindings retain their meaning; editing converts them to the appropriate canonical identifiers. Evaluate against authoritative state at use time and include resolved inputs and amounts in the receipt. Editing/scaling previews are advisory; execution always recalculates and validates. Permit only an explicit documented function set; do not automatically expose the evaluator's existing `clamp` function or insert clamps into generated mechanics.

### Damage and checks

Reuse current skill/opposed/attack checks, forced-roll controls, concealment consequences, check-result presentation, and actor/target validation. Techniques must not create a second die system.

Give damage effects an explicit mode:

- **Technique amount:** saved fixed/formula damage is the authored amount. An applicable existing attack roll determines hit; the normal weapon damage formula is not also added. Explicit mechanical fields determine any toughness/effectiveness processing, with that processing applied once.
- **Weapon-based technique:** deliberately uses the existing weapon-damage calculation, optionally with an authored additive/scaling component at a documented point. Its receipt must expose the calculation order and each contribution. Do not enable a model to choose this mode implicitly from prose.

Implement technique-amount damage first; support a weapon-based technique only after the extraction can prove ordinary attacks retain their current results. Sharing checks does not require every technique to cause an attack: a self-buff or friendly healing can be automatic when its saved requirements allow it. Harmful effects use the defined attack/opposed check. Effects and costs can scale independently; damage must not receive level/attribute bonuses twice because the formula already included them.

Healing uses authoritative health mutation and reports actual change, including full-health outcomes. Technique use does not silently resurrect or remove incapacitation; those must be explicit supported effects/prerequisites in a later expansion if desired. Existing health and need-bar bounds remain authoritative; no new bounds are added by this feature.

### Resources and failure costs

Use a small resource adapter contract: resolve availability and identity, read current value, validate exact debit, and apply/restore a validated value through the existing owning model. The implemented initial resource kinds are `health` and named active/applicable need bars; [item charges](#item-charges-planned-supporting-feature) are the next approved extension. Reject unsupported resource kinds clearly. Do not create stamina, mana, or psi bars just because a definition references them. Need bars that represent accumulating harm must not be treated as spendable by guessing their direction: resource configuration must explicitly say how payment changes that bar.

Normalize multiple entries for the same resource before affordability checks. Validate all costs, targets, prerequisites, and effect/formula references before any debit or roll. Use authoritative actor eligibility, including disabled/dead state and NPC audience/applicability. Health-cost availability must not rely on the setter's floor to pay more health than exists. Apply existing death/disabled rules coherently if an authored health cost consumes the remaining health; do not invent a protected one-health minimum.

The default failed-roll cost vector equals the normal cost vector. A definition can specify a different explicit failure vector, including zero. Show both when they differ. Preflight affordability of every declared possible cost vector before starting; once the roll is prepared, commit the correct vector exactly once. This avoids a failed roll demanding resources the actor never had. Cover this behavior explicitly rather than silently ignoring an excess failure cost.

Choose the cost vector from an attempt-level outcome: success means at least one planned effect on at least one eligible target passes its required check (an attack hits, a skill/opposed check succeeds, or a valid automatic effect requires no roll). Otherwise the valid attempt is a failure. Thus an area technique with both hits and misses pays its normal vector once; all misses pay its failure vector once. Use resolver success rather than a positive numerical state change: healing a full-health eligible target or a successful attack reduced to zero damage does not become a failed attempt. Record each check/target outcome, aggregate success/failure, the selected vector, and actual payment in the receipt. Initial definitions cannot invent an alternative aggregate rule; later extensions would need an explicit validated contract.

### Item charges (planned supporting feature)

Agreed 2026-11-01; **planning only, not implemented**. Add an optional persisted charge pool to an individual `Thing`, initially one pool per item. Record its mode (`discrete` integers or `continuous` decimals), current amount, capacity, and display label/unit such as rounds, energy, uses or fuel. Values must be finite and nonnegative, with current amount no greater than capacity. Discrete pools reject fractional amounts, including fractional payments; do not silently round or clamp invalid values. Items without a charge pool have no charge resource.

Charge is separate from physical stack quantity:

| Example | Item quantity | Charge pool |
| --- | ---: | --- |
| Loose ammunition | 20 | None; quantity counts rounds |
| Loaded magazine | 1 | 12/15 rounds, discrete |
| Battery | 1 | 34.75/100 energy, continuous |

Initially keep charged items as individual records (`count: 1`) rather than stacks. All stack merge/split paths, including the explicit AI item combiner, must honor that policy rather than duplicate, discard or implicitly refill charge. Moving, editing, copying/replacing and saving items must retain the appropriate charge state. Depletion leaves the item intact and blocks only actions requiring charge; destruction or disposal is a separate operation.

Extend technique costs through the existing resource preparation and execution boundary. An equipment-granted technique normally binds its charge cost to its granting item; other techniques must resolve a concrete eligible owned item. Shared catalogue definitions should describe that binding rather than hardcode an arbitrary equipment instance. Resolve ambiguity before execution, record the actual item identity in the prepared action and receipt, and never silently switch to another item because the selected one is empty or unavailable.

Preflight and aggregate charge costs alongside health/need costs, including normal and failure vectors, before any roll or mutation. Revalidate the selected item's ownership/equipment eligibility and charge after asynchronous boundaries. Commit charge and actor changes together, include item state in rollback, and replay an existing operation receipt without charging again. Event extraction must recognize committed charge payments rather than deduct them a second time.

Expose charge state through Thing serialization, field/generation contracts, shared XML schemas, relevant prompt context, and existing item details/editor surfaces. Standard and TinyBrain paths must share the same validation and payment semantics. Preserve meaningful zero values and the established optional-field/error-message rules.

A checked charge-adjustment/refill operation is supporting infrastructure. Physical ammunition loading, timed recharging, charge transfer, fuel conversion and multiple pools per item require separate gameplay rules and are not part of this initial charge feature. Do not introduce automatic regeneration, inventory consumption or item destruction merely because a pool exists.

Acceptance checks should cover integer and continuous save round trips; invalid/fractional/over-capacity operations without clamping; individual-item stack/combiner behavior; exact selected-item payment; insufficient charge without mutation; normal/failure costs; rollback across item and actor state; and replay/save-load/event processing without duplicate payment or item substitution.

### One authoritative attempt

Use the same service from chat, panel Use, NPC turns, and event-directed acquisition/improvement:

1. Resolve the actor, intent or explicit technique, canonical targets, the exact learned/equipment source under the shared selection policy, and its effective revision. For an unknown reasonable action, run the discovery preparation described below first.
2. Prepare an isolated execution candidate: validate plausibility, access/prerequisites, target eligibility, formula bindings/results, costs and all effects. A validation failure rejects without creating learned state, charging, or consuming a roll.
3. Complete any asynchronous forced-roll interaction or candidate-generation prompts before mutation. Revalidate relevant state/revision after each asynchronous boundary. Protect the short actor/target commit section with the existing turn serialization where sufficient, or a narrowly scoped guard; do not hold locks across model generation.
4. Prepare the authoritative check result using shared resolvers without applying ordinary weapon damage. Aggregate the per-effect/target outcomes using the attempt-level success rule and select one cost vector. Generate the final cost/effect deltas and learning changes. The attempt's start/commit boundary records a failed roll as an attempt, with its specified cost and eligible learning.
5. Commit costs, effects, any acquisition/personal revision, and a completion receipt as one validated state transition before outcome prose. There is no asynchronous narration call between debit and the stored authoritative receipt. Use targeted snapshots/restore for an exception during the uncommitted transition. An unknown mutation state is fatal and must never be retried as a fresh action.
6. Publish existing-compatible check/event summaries and narrate from the receipt. Receipt persistence precedes notification callbacks. A later prose, UI, or post-event failure retains the committed result and costs; retry reuses that result. Do not refund a completed attempt because narration failed. A full turn rewind restores the matching prior save, including receipt and resource state.

Assign server-owned operation IDs from the canonical turn plus action ordinal, as current TinyBrain planning does. They must distinguish two deliberate identical uses from a retry of one use. Discovery/acquisition, resource debits, roll results, personal upgrades, each target/effect application, and event notifications derive IDs from that operation. Do not deduplicate all attacks merely by matching arguments. Persist the accepted intent/technique revision and receipt so recovery cannot silently execute a different candidate under the same ID.

Downstream plans can reference a committed same-turn `operationId`; this is a
receipt lookup, never permission to invent an execution ID. A matching completed
attempt otherwise requires explicit `newAttempt: true` and intent before a new
server ordinal is assigned. Reference and new-attempt fields are mutually
exclusive. Standard attack wrappers naming techniques enforce the same distinction
with their typed reference/new-attempt fields and attempt-aware caches. Retry of
one tool call remains cached; separate deliberate new calls execute independently.

An area technique pays its actor cost once for the attempt, then applies validated per-target results; it does not pay once per target. Preflight the complete target list and reject duplicates/invalid targets before mutation. Start with the current supported attack-area semantics rather than inventing arbitrary targeting geometry.

### Buffs, debuffs, duration, and refresh

Represent supported temporary attribute/skill/need-rate modifiers with existing intrinsic `StatusEffect` mechanics. Persist provenance including technique identity, semantic effect slot/family, applied personal revision, source actor, and operation ID through `StatusEffect`, owner normalization, client serialization, and saves. A descriptive name is presentation, never the only mechanical identity.

Default nonstack key: target + common technique identity + semantic effect slot/family. Different personal variants and different casters of the same technique therefore refresh the same effect rather than multiplying magnitude. A unique technique has its own identity. Preserve that family identity across renaming and personal upgrades. Independent techniques stack under current modifier aggregation unless an explicit shared family rule says otherwise; do not build a universal buff exclusion taxonomy now.

Repeated equivalent applications refresh remaining duration from the new application world minute and retain one magnitude. An explicit upgrade can replace that actor's effect with its authored stronger mechanics. A weaker cross-caster application must not silently downgrade an active stronger buff; retain the stronger mechanical payload and refresh its duration. Define strength comparisons only for mechanically comparable effect slots. If incomparable personal variants collide, reject or require an explicit authored replacement/stack policy rather than guessing an order from prose. Explicit allowed stacking needs a saved policy and distinct instance identities.

Process elapsed ticks before replacing/refreshing an effect so accrued need/health-rate changes are not lost. Stamp new/renewed effects at canonical current world minutes, reuse the existing elapsed-minute ticking and persistence, and remove expired intrinsic effects through the normal cleanup. A saved buff should survive reload and expire once, without replaying prior need-rate ticks. Do not implement another turn-count timer. Replacing/removing attribute buffs must retain existing max-health reconciliation behavior.

## Discovery, acquisition, and personal improvement

For an action such as “I try to heal her with Spellcasting,” perform one integrated preparation before drafting its result:

1. Match the actor's learned and currently granted techniques by identity, aliases, intent, discipline, and target/effect meaning. Known equivalent mechanics win over creating a renamed duplicate.
2. Search the relevant saved-world catalogue, including plausible source and acquisition requirements. Semantic matching is an LLM-assisted identity decision over concrete candidates, with canonical IDs checked server-side; a name-only hash is insufficient. The service rechecks duplicates when committing a generated candidate.
3. Validate setting plausibility and the actor's actual access, skills/abilities, equipment, source/story evidence, and acquisition prerequisites. A skill initialized for everyone does not establish magical access. An unqualified request produces a clear rejection, no technique, no resource charge, and no invented mechanics.
4. For a qualified novel action, prepare a complete candidate definition and learned revision with concrete cost/check/effect/formula fields. Validate it through the same schema and retry-feedback boundary as authored definitions. Reuse an equivalent catalogue definition if another source committed it meanwhile. Unique declarations require actual character/story justification, not a random name difference.
5. Resolve the first attempt through the ordinary technique service. Persist learning and the shared candidate as part of that accepted attempt before prose. Success applies its effects; an eligible failed check can still leave the learned technique while charging the specified failure cost. A preparation error or unaffordable first use does not leave a half-created catalogue entry or accidental learned grant.

Independent learning events, such as a completed lesson or reading a teaching item, can grant knowledge without forcing immediate use. Use the same validation, semantic matching, owner revision, and idempotent acquisition receipts. NPC/enemy generation and later turns can use this path too, with sparse relevant techniques and plausible prerequisites rather than granting the whole discipline.

Record meaningful uses/story milestones as evidence, not a new spendable currency. Avoid “+1 power per cast” or unbounded automatic upgrades. A justified improvement proposal produces a validated new personal mechanical revision, uses the same evidence once, and explains the changed cost/effect/prerequisite. Two actors who learned the common healing technique can then develop different personal versions without changing its shared identity or each other.

## Prompt, event, and API integration

### Standard and TinyBrain

Add compact discipline access, known technique summaries, relevant catalogue matches, equipment grants, and explicit mechanical revision context to shared base-context rendering. Reuse canonical actor/skill/attribute/resource values already present. Do not ask TinyBrain to repeat known stats, costs, ownership, check outcomes, or engine-computed amounts.

For standard prose, use the existing authoritative check/tool orchestration with a narrow technique operation routed to `TechniqueService`; ensure pre-action detection and ordinary attack tooling cannot resolve the same technique as an additional weapon attack. Its discovery candidate must be validated and first-attempt receipt available before the model writes outcome prose.

For regular TinyBrain player actions, extend `<resolutionPlan>` with a technique operation and optional discovery intent/candidate selection. Use child elements only; reject XML attributes, unknown/duplicate fields, unsupported effect kinds, invalid IDs, and inconsistent targets. Supply relevant candidates before asking questions. Server code performs generation/validation/execution and feeds back complete receipts, rather than requesting native execution calls. Keep the existing read-only tool definitions and `tool_choice` unchanged for the entire run, including corrections, deslop, lookup exhaustion, and continuations.

For TinyBrain NPC turns, extend the existing attack pre-resolution stage to recognize technique intentions and call the same service before lookup-only narration. Do not let a healing/buff/debuff or technique attack disappear into prose-only “automatic success.” Retain current NPC scheduling and defeated-actor rules. Other standard/TinyBrain event or generation families that can teach/improve techniques receive matching structured acquisition/improvement support.

Extend the current `collectSuccessfulNpcAttackActorIds` exclusion mechanism, or its narrow shared replacement, to read committed technique receipts as well as ordinary attack receipts. A committed NPC technique attempt during player-action resolution consumes that NPC's current action opportunity, including a miss or failed check with zero failure cost; it must not receive an additional scheduled turn merely because its operation is named differently. Apply this to active healing/buff/debuff techniques as well as damaging techniques. Preflight rejection, cancelled preparation, passive equipment access, and learning without an action do not consume an opportunity. Scope the record to actor ID, canonical turn/opportunity, and operation ID; receipt replay does not consume a later turn or count twice. Standard and TinyBrain scheduler paths must apply the same rule.

Every new structured prompt logs through `LLMClient.logPrompt()` and omits `<maxTokens/>`. Parser errors return actionable field-level correction feedback within the configured retry budget. Invalid candidates never mutate world state. No silent legacy retry, guessed mechanics, or placeholder successful result.

### Events and duplicate prevention

Provide committed technique results to `Events.runEventChecks` and both event-prompt variants. Mark the exact actor/target/effect/cost/acquisition mutations already applied. Event parsers/applicators should accept receipt-linked technique notifications and skip reapplication only for those committed mutations, preserving unrelated same-turn damage, healing, statuses, or learning.

Use structured receipt references and operation/effect IDs, not substring matching against narrative health or status descriptions. A normal environmental damage event remains actionable even if another technique affected the same target. Direct teaching/improvement events that have no prior receipt must pass through the service and receive one. Keep actual death/incapacitation decisions consistent with the existing attack receipt/event division so duplicate prevention does not suppress a legitimately needed defeat status.

Return structured `techniqueChanges` and `techniqueUses` alongside existing health/need/check/status summary payloads. Refresh affected player/NPC panels, gear-granted availability, and locations using the existing refresh conventions. Do not reverse-parse display prose to update cards or summaries.

### UI and editing

Add a grouped Techniques section in character views, with discipline headings, learned/equipment-granted badges, description, concrete mechanics, costs, prerequisites, personal revision, and availability reason. Use a shared renderer for the current player and inspected NPCs; enemy knowledge remains filtered according to existing player-visible character policy.

Use opens the existing actor/target/intention interaction pattern, resolves the learned/equipment source with the shared policy, and submits an ordinary authoritative turn with explicit technique ID, source identity, revision and targets. Display that source's costs and requirements; expose a source selector when different versions are available. It must share natural chat's gates, time/NPC-turn processing, costs, receipts, and error behavior; do not create a direct UI-only heal endpoint. The server revalidates targets, the exact source, revision and resources when submitting; a removed or changed source reports an error instead of using another version. NPC/enemy Use remains governed by the existing character-control/admin conventions rather than implicitly granting the player control of enemies.

Extend existing character editing with one reusable technique mechanics editor: above-control labels, fixed/formula selector, shared variable-reference table, effect/check/cost rows, prerequisite source, and a calculated preview. Default scope is that character's personal revision, clearly labelled. Distinguish equipment-granted access from learned knowledge. Use existing edit buttons/context-menu conventions, error modal with stack trace, focus restoration, Escape dismissal, keyboard-accessible Use, and Ctrl/Cmd+Enter for the explicit edit/target form submit. Do not copy another modal implementation or add global shortcut conflicts.

UI implementation uses the [UI registry](../../ui/README.md), existing shared controls, and a reviewed generated mockup. Edit authoritative SCSS and compile corresponding CSS before delivery.

UI reuse and visual consistency are acceptance requirements. Inspect and compose existing cards, lists, forms, dropdowns, buttons, modal shells, tooltips, and feedback components before introducing another widget. Extend an existing component when its interaction and lifecycle match; if a new interaction needs a widget, implement it as a reusable shared component and document its contract and usage. Keep technique-specific content and mechanics separate from shared widget behavior. Use the existing theme variables/mixins and semantic colors, with the established font family and typography; form controls must inherit the correct font too. Verify rendered text, controls, badges, selected/hover/focus states, and error messages have readable contrast against their actual backgrounds. Convey availability and errors in text as well as color.

## Delivery phases and verification gates

The phases below record the implementation sequence and acceptance gates. The initial supported execution and UI are delivered; verification is recorded below.

### 1. Domain, references, and saved state

Implement strict definitions/disciplines, owner revisions, item grant fields, catalogue lookup, empty legacy initialization, lifecycle reset, and full save round trip. Include persisted receipts/provenance shape now, even before all effect types exist.

Acceptance: two characters can reference one definition with different personal mechanics; catalogue revision edits leave learned versions and existing equipment grants pinned; learned-plus-equipped access defaults to the personal version; differing equipment versions require explicit selection; equivalent grants resolve deterministically; temporary gear access disappears on unequip while learned knowledge survives; a new world cannot see the previous world's techniques; old saves get empty state; malformed present data fails explicitly.

### 2. Authoritative service and one healing slice

Implement fixed/formula evaluation, health/need resource adapters, candidate preflight, check preparation, exact-once cost/effect/receipt commitment, and one known self/target healing technique through an internal server invocation. Extract only the necessary attack/check boundaries. Test exceptions before/inside/after commit and reload/replay.

Acceptance: all costs are paid together once; missing/inactive/insufficient pools reject with no changes; a valid failure pays its authored cost; distinct intentional identical attempts both run; retry reuses the first receipt. Formula values come from saved mechanics and authoritative state. No generated cost is silently clipped by a setter.

### 3. Natural first attempts and parity

Add shared prompt context, semantic reuse, discipline qualification, discovery/learning candidate validation, standard action integration, TinyBrain XML plan/parsers/result feedback, and matching NPC pre-resolution. Start with qualified healing discovery and one damage technique. Integrate receipt-aware events in the same phase, before relying on narrated mechanical outcomes.

Acceptance: a qualified actor's first healing attempt learns, charges and heals in the same turn; a failed qualified attempt can learn without healing; an unqualified actor does neither. Equivalent wording uses the same technique/revision. Player, party NPC, and enemy mechanics are equivalent in both modes; TinyBrain retains its original lookup schema/tool choice and emits no new native execution call. An NPC's committed technique attempt, including a failed attack, excludes an additional scheduled action in that turn; rejected preflight does not. Replayed event extraction causes no second effects or acquisition, and replayed receipts do not consume a later NPC turn.

### 4. Damage, buffs/debuffs, acquisition, improvement

Complete supported initial effects, explicit damage calculation modes, timed effect provenance/refresh, trainer/discovery/teaching-item grants, equipment availability, meaningful-use/story personal revisions, and area behavior where supported by current attack paths. Keep utility-effect types rejected until implemented.

Acceptance: technique damage applies once and ordinary attacks retain existing calculations; a mixed-hit area attempt pays normal costs once and an all-miss attempt pays failure costs once, including zero overrides; full-health healing and zero-damage hits use check success rather than actual delta for cost selection. Same-technique buff repetition refreshes one effect across personal variants/casters without weakening it; explicit stacks remain explicit; expiry and need-rate ticks survive save/load exactly once; a personal upgrade affects one owner; removing a required weapon blocks use without forgetting the learned technique.

### 5. Player/NPC UI, documentation, and final integration

Implement the shared panel/editor/Use flow and structured notifications; compile SCSS. Update `docs/classes/Technique.md`, `docs/classes/TechniqueService.md`, affected model/prompt/API/UI docs, `docs/README.md`, and save/config documentation. Add focused API and browser scenarios, using isolated fixtures rather than the user's live world.

Acceptance: chat and Use select the same executable source and produce the same authoritative mechanics; controls show that version's accurate costs, grant source and blockers; unequipping a selected source before commit rejects without charge or substitution, while retry after commit returns the original receipt. Edits change exactly the selected character/revision; failed requests show original error/backtrace; keyboard and mobile interaction work with existing modal patterns. No new progression currency, mandatory level gate, auto-invented old-save knowledge, or unsupported utility execution is introduced.

UI acceptance also requires reuse of established widgets and shared styles, reusable/documented additions where needed, the project's correct font, consistent semantic/theme colors, and readable contrast across normal and interactive states. Verify these against existing production character views rather than only an isolated mockup.

### Test matrix and execution constraints

Use focused `node --test` coverage for the domain/service, save lifecycle, resource vectors, formula validation, damage preparation/application, status provenance/expiry, acquisition/upgrade deduplication, standard/TinyBrain action integration, and event suppression. Extend existing `tests/player_action_resolution_plan.test.js`, TinyBrain runner/family tests, and relevant attack/status/save tests where they own the changed contract. New focused service test files are appropriate; do not retain compatibility behavior solely to keep outdated tests passing.

Include formula fixed/scaling parity; invalid/undeclared/nonfinite expression rejection; differing resource audience/applicability; duplicate same-resource costs; per-definition failure cost; no-charge rejection; post-commit narration failure; notification failure; forced-roll cancellation; two identical deliberate actions; partial ordered-plan completion; fresh save/load and full rewind; stronger/weaker refresh; and unrelated event damage after technique damage.

Add standard/TinyBrain scheduler regressions for committed NPC technique hits, misses, and non-damaging attempts versus preflight rejection; assert no extra same-turn action and no later-turn exclusion from receipt replay. Cover mixed-hit/all-miss areas with differing normal/failure vectors, full-health healing, and zero-damage hits. Cover learned plus equipment versions, two equipment grants with different pinned revisions, equivalent-source ordering, selected-source removal during preparation, catalogue edits after grant, and save/load/retry preserving the selected source and cost outcome.

Use representative isolated browser coverage for grouped panel rendering, target selection, Use, personal mechanics edits, missing-resource errors, acquisition/use notifications, save/reload, keyboard focus/submission, and mobile scrolling. Verify both standard and TinyBrain flows at a representative supported viewport, then focused presentation checks for narrow layouts. Keep scripts in `playwright_scripts` and artifacts/config overrides in `tmp`.

Every future test-running command must use the home instructions' transient systemd memory limit. Non-browser example:

```bash
systemd-run --wait --collect --pipe -p MemoryMax=16G -p MemorySwapMax=0 -p "WorkingDirectory=$PWD" node --test tests/technique_service.test.js
```

Browser example:

```bash
systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 npm run test:e2e:headless -- tests/e2e/techniques.spec.js
```

Run syntax checks for altered JavaScript and template/parser checks appropriate to the changed files. Run `npm run scss:build:main` if main SCSS changes. Start small; broaden only for shared boundary changes or actual failures. The user has authorized restarting the game server whenever needed; restart only that server, do not load a save, and leave the LLM server running. Prefer isolated test fixtures/processes during development.

### Implementation verification (2026-10-25)

- The affected model, status, Thing mutation/grant, service and NPC-generation regression group passed 75 tests; an additional focused nonempty save-file round trip passed after it was added. That round trip preserves personal upgrades, buff provenance, equipped grants, resource state and receipts, proves replay does not charge again, and checks malformed present and absent legacy state.
- The affected HTTP API, prompt, event, scheduler, ordered plan, native tool/cache and TinyBrain runner group passed 118 tests. Focused prompt-boundary checks passed again after enforcing a tool-free request with one parser correction budget. These use isolated actors, actual services/routes and mocked model completions, without loading a user's world or claiming a live-model playthrough.
- Three browser cases passed for the production shared panel/editor with mocked transport. Focused final mobile checks verified source-specific costs and turn metadata, inherited app fonts, rendered text/heading contrast, original error stacks and narrow layout. Existing successful interaction evidence was retained across presentation-only fixes.
- Production JavaScript syntax checks and changed Nunjucks template parsing passed. Main SCSS was compiled to CSS. The game restarted successfully with its existing profile; the root page and technique API responded successfully, no save was loaded, and the independent LLM process was preserved and healthy.

## Remaining implementation risks

These are technical verification tasks, not unanswered scope questions or reasons to re-ask accepted defaults.

1. **Atomicity and recovery:** current attack paths combine roll calculation, damage mutation, status effects, chat records and callbacks. Extract the smallest clean boundary; prove completed mutations cannot be rerolled on parser/prose/event recovery. Ensure receipt state and resource state are saved together.
2. **Definition identity:** semantic equivalence is contextual. Give the model bounded real candidates and validate canonical references; serialize competing commits and recheck identity rather than creating a content-generation subsystem. Do not collapse genuinely different intentional actions.
3. **Failure-cost timing:** enforce preflight of every declared outcome cost in the executable contract and UI. Cost overrides, health payment that disables an actor, and needs with reversed payment direction need explicit validation tests; no implicit pool direction or protected minimum. A technique that requires survival must declare that prerequisite.
4. **Scaling and combat:** current weapon damage already includes weapon level/rarity, hit degree, level/damage-attribute contribution, toughness and effectiveness. Authored technique amounts need a clearly located application stage to prevent double scaling and accidental weapon bonuses.
5. **Status round trips:** `StatusEffect` and owner normalizers preserve different fields. All technique provenance must survive the player/NPC route without changing unrelated item/location/region effects. Refresh must preserve elapsed ticking and max-health reconciliation.
6. **Buff comparison:** weaker/stronger ordering is reliable only for compatible mechanical slots. Avoid numeric guesses for mixed attribute tradeoffs or different durations; require explicit revision policy for incomparable colliding variants.
7. **Prompt consistency:** standard tools, TinyBrain plans, NPC attack pre-resolution, and post-prose event checks all touch mechanics. Complete parity and receipt suppression in each initial slice rather than treating TinyBrain or enemies as later work.
8. **Save installation:** the catalogue, actor pins, item grants, statuses, receipts and runtime fingerprints must represent one coherent saved world. Audit actual loader ordering and all save/restore callers before implementation; empty missing legacy state is the only migration convenience intended here.
