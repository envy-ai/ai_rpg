# Technique balance implementation plan

Date: 2026-10-25. Implemented: 2026-10-26. Status: **initial managed-healing scope implemented and verified**. The sequence below records the approved design; [TechniqueBalancePolicy](../../classes/TechniqueBalancePolicy.md) and the linked class/API documentation describe the delivered contracts. Area/mixed healing and balance profiles for damage/status effects remain future work.

This extends the [implemented technique system](2026-10-25-techniques.md). The immediate problem is that automatic authoring copied a schema example, `max(1, level)`, into Restorative Focus: Exis healed 3 HP at level 3 while paying 100 mana. Prompts alone cannot enforce useful or consistent balance. Add a configurable engine-owned recipe for ordinary healing and mana efficiency, then route every relevant authoring boundary through it.

## Scope and accepted behavior

- Techniques remain setting-appropriate actions under arbitrary disciplines, available to players, party NPCs and enemies through existing qualification, catalogue, learning and equipment rules. A discipline is not necessarily a skill. Nothing globally equates a discipline with Spellcasting, Intelligence or Mana.
- The model chooses the concept, semantic effect, appropriate actual proficiency/attribute/resource and justified learning or improvement. The engine owns the numeric coefficients, formula construction and validation. Existing checks, action opportunities, failure-cost rules and receipt replay continue unchanged.
- Ordinary self-healing and single-target healing use the same potency recipe. A useful standard heal should restore roughly **two typical same-level hits**, so healing under attack can create room to act. A one-hit heal merely offsets the next hit. It is not tuned to criticals, vulnerability multipliers or every possible enemy.
- At level 3 with Exis's other stats unchanged, the agreed illustrative healing targets are skill 3 → 24 HP, 5 → 26, 7 → 28, and 10 → 31. Do not cap healing at 30 or at a fraction of maximum health. Existing health setters still limit the actual applied restoration to missing health.
- Mana capacity is 1000 at every level. Increasing proficiency or level must never increase this recipe's mana cost. Accepted cost: `ceil(baseCost / (1 + 0.05 * skill + 0.02 * level))`, with default `baseCost = 100`. A justified personal efficiency improvement can reduce base cost from 100 to 90. A power improvement does not automatically increase cost.
- Preserve complete formulas in definitions and personal revisions; resolve current `level`, `skill_<name>` and `attribute_<name>_modifier` from authoritative actor facts at preview/use. Do not save today's resolved scalar as tomorrow's mechanics.
- This scope adds no cooldowns, action economy, progression currency, numeric clamping, combat rewrite or new configuration dashboard.

## Calibration and proposed defaults

**Proposed healing coefficient design**, chosen to reproduce the accepted examples:

```text
H = round(2 * B + 3 * L + S + 0.5 * A)
C = ceil(baseCost / (1 + 0.05 * S + 0.02 * L))

B = reference baseWeaponDamage captured when a recipe revision is authored
L = actor's current level
S = current rank of the recipe's selected relevant proficiency
A = current modifier of the recipe's selected relevant attribute
```

`B = 5` is the observed runtime reference, not a newly invented live formula variable. Capture its numeric value in the immutable policy snapshot and inline it in the compiled formula. All coefficients, reference selection and base cost are configurable. The exact healing coefficient design is a proposal in this plan; the examples and decreasing cost behavior above are the accepted targets. Proficiency contributes twice as much as the attribute modifier per point; level supplies the main progression scale. Skill still has a material independent contribution at a fixed level.

For Exis, `L = 3`, `A = 4`, `B = 5`:

| Relevant skill | Healing | Base-100 mana cost | Casts from 1000 mana, before regeneration |
| --- | ---: | ---: | ---: |
| 3 | 24 | 83 | 12 |
| 5 | 26 | 77 | 12 |
| 7 | 28 | 71 | 14 |
| 10 | 31 | 65 | 15 |

At level 3/skill 3, a base-cost improvement to 90 gives `ceil(90 / 1.21) = 75` mana and retains 24 healing. A power-only change preserves the 83-mana formula unless a separate, explicit efficiency change is justified. Do not let an authoring heuristic silently price stronger healing upward.

The observed ordinary damage was about 13–15 HP; the level-3 Coil's ordinary hit was 15 before vulnerability doubled it. Therefore 24 HP is approximately 1.6–1.85 observed hits, and 26–31 HP is closer to two. These accepted examples are an initial calibration, not proof that every same-level matchup heals exactly two hits. Validate a representative range before treating the defaults as final; report any conflict between the two-hit goal and the accepted numbers instead of claiming exact equivalence.

Use the existing `api.js` attack implementation as the reference during calibration, without copying it into healing execution. For an ordinary successful hit, its current calculation is equivalent to:

```text
weaponBase = B + weaponLevel * rarityDamageMultiplier
hitMultiplier = min(0.75 + margin / 20, 2)
ordinaryDamage = max(0, 1 + round(weaponBase * hitMultiplier
                       + damageAttributeModifier + ceil(level / 2)) - toughness)
```

Existing effectiveness multipliers (0, 0.5, 1, 2, 3) apply afterward; half damage has existing rounding rules. These existing bounds are reference behavior, not permission to add clamps. Skill affects hit rate/margin and therefore damage; it is not simply an extra flat damage term.

The default Mana definition already has `max: 1000`, `relative_to_level: false`, and `change_per_minute: 10` in `defs/need_bars.yaml`. Keep these semantics. In isolated calibration, record the *effective* definition, elapsed combat-turn time, status modifiers and actual regeneration ordering. At 10 mana/minute an 83-mana cast takes 8.3 minutes of passive regeneration to replace, and a 75-mana cast takes 7.5 minutes. Do not tune against a presumed encounter duration or silently alter need maxima, regeneration or world-time pacing to make the recipe look balanced.

## Contracts and saved ownership

Introduce `TechniqueBalancePolicy.js` as a focused pure policy/compiler module, with named exports equivalent to:

- `resolvePolicy(config)` and `validatePolicy(policy)`: read the ordinary merged configuration and validate the complete recipe and named resource profiles.
- `compileHealingRecipe({ proposal, actor, policy })`: validate the model's semantic selections, capture a policy snapshot, and produce canonical mechanics plus recipe metadata.
- `compilePersonalImprovement({ learned, proposal, actor })`: apply an allowed policy-defined improvement to the learned snapshot, retain unrelated mechanics, and return the next full personal revision.
- `validateManagedRevision(revision, actor?)`: validate metadata and require the stored formulas to equal the canonical result compiled from its saved snapshot and recipe parameters. It must not read current configuration to reinterpret an old revision.
- `getAuthoringContext({ actor, policy })`: provide allowed recipe/profile IDs, actual actor selections and server previews without exposing the complete config or asking the model to restate known values.

Use `techniques.balance` in `config.default.yaml` and the existing YAML override/reload path. Proposed fields are `version`, `healing.standard` (the four healing coefficients and reference source), `resourceProfiles` (explicit pool ID, direction, reference capacity, base cost and efficiency coefficients) and named allowed personal-improvement steps. Keep policy structure narrow; no arbitrary script strings, object access or second expression evaluator. The configured Mana profile explicitly maps the existing active mana need to capacity 1000. Other pools require their own deliberate profile in their own units; a health payment, stamina pool, reversed need or martial discipline must not inherit a 100-mana price.

Add optional validated `balance` metadata to each mechanical revision, conceptually:

```text
balance = {
  schemaVersion: 1,
  recipeId: "standard-healing",
  policy: { version, digest, snapshot },
  selections: { skillName, attributeName, resourceProfileId, needId },
  parameters: { baseCost, appliedImprovementIds }
}
```

The snapshot includes resolved numeric coefficients, `B`, the resource profile and the configured improvement rules necessary to reconstruct this revision; `digest` identifies its canonical contents rather than relying on a mutable version label. Numeric actor ranks, actor level and actor attribute values are not snapshot inputs. Persist formulas and metadata together in catalogue revisions, learned mechanics, `revisionHistory` and receipt requests. Keep the original `costs`, `effects`, target/check and requirement structures as the executable representation, validated against metadata; do not add a parallel runtime executor.

For Exis's illustrative selection the compiled amount is `{formula: "round(10 + 3 * level + skill_spellcasting + 0.5 * attribute_intelligence_modifier)"}` and cost is `{formula: "ceil(100 / (1 + 0.05 * skill_spellcasting + 0.02 * level))"}`. These names are an example selected from actual facts, never global defaults. Use `TechniqueFormulaVariables.keyFor` and the existing restricted `FormulaEvaluator`; avoid manually constructing normalized names.

On configuration reload, validate the new policy before installing it. New authoring uses the new snapshot. Existing definitions, learned revisions, equipped grants and historical receipts retain their saved policy and formulas. A personal efficiency/power improvement defaults to its owner's saved policy; a later explicit rebalance is a separately reviewed new revision. A prepared new-authoring batch must reject if its captured effective policy/world/actor context changes before commit. An already saved technique does not become stale merely because the current authoring policy changes.

## Ordered implementation tasks

### 1. Add validated policy configuration and the pure compiler

Files: new `TechniqueBalancePolicy.js`; `config.default.yaml`; `server.js` merged-config validation/startup/reload boundaries (alongside existing difficulty/outcome/critical formula validation); existing config documentation.

1. Add the proposed healing and Mana-profile defaults through the normal merged config, not user-specific profiles. Validate unknown keys, finite coefficients and supported recipe versions at startup/reload. Validate resource existence, active applicability, payment direction and capacity assumptions when binding a selected profile to an actor. A configured Mana profile must not prevent a nonmagical setting or actor without Mana from loading or taking unrelated actions; expose only applicable profiles in authoring context, and reject an explicitly requested unavailable profile.
2. Validate domain constraints needed for cost monotonicity: positive base cost/denominator constant, nonnegative skill and level efficiency coefficients, valid rank/level inputs, finite positive evaluated denominators and nonnegative finite effects. Do not repair invalid values, clamp them or default to another pool. A required capacity mismatch reports the exact configured profile/pool conflict; it does not resize the bar.
3. Compile deterministic canonical formulas and immutable snapshot metadata using existing automatic variables and rounding. No new formula bindings or live `baseWeaponDamage` variable is necessary. Compare generated managed formulas against recompilation rather than accepting arbitrary model coefficients.
4. Allow the model to request named configured improvements, with evidence and a reason, rather than emitting new numbers. Configure the accepted efficiency step 100 → 90. Define power steps as explicit policy choices during implementation review/calibration; do not invent a universal percentage, multiplicative stack or power-to-cost surcharge in this plan.

Gate: pure compiler examples produce exactly 24/26/28/31 HP, 83/77/71/65 mana and the 75-mana efficiency example. Level/skill increases never raise cost, including ceiling plateaus. Fixed values/metadata remain serializable and independent of later config changes.

### 2. Enforce recipes at the domain/service boundary and preserve atomicity

Files: `Technique.js`, `TechniqueService.js`; existing formula-variable helper only if its public contract actually needs extending.

1. Extend `Technique.normalizeRevision`'s strict whitelist for `balance` and validate it, including nested histories and receipt requests. Missing metadata on existing custom mechanics remains valid; malformed present metadata rejects. Preserve legacy explicit formula bindings and fixed/custom formulas unchanged on load.
2. Route novel automatic healing candidates and automatic healing improvements through the compiler before `addDefinition`, `learn`, `prepareLearningBatch`, `improve`, or discovery `prepare/execute` can install them. Pass a server-owned authoring origin/capability through these callers; model-controlled provenance or an absent `balance` field cannot declare a healing request to be a trusted editor override. Direct catalogue revisions must use the same managed validation.
3. For recipe-managed healing, reject arbitrary formula changes and any unapproved changes to target count, effects, resource vector or failure vector. The first profile supports one healing effect on self or one target, with its configured cost vector and existing omitted-failure-cost semantics. Explicit free failure, additional healing effects, area healing, healing mixed with damage/buffs, extra resources and non-Mana profiles need deliberate supported recipes; their new automatic authoring must fail with a field-specific unsupported-profile error. Do not let a model bypass policy by labelling healing as freeform, renaming its semantic key or appending an unpriced effect.
4. Existing custom techniques, including damage/buff/debuff mechanics, retain existing execution and pinning semantics. This slice does not claim a balance formula for every nonhealing effect. Later area/mixed/status/damage recipe design extends this one boundary with reviewed budgets; it is not grounds to invent global coefficients now. Newly requested unsupported healing remains explicit rejection rather than prose-only success.
5. Keep learning, full starting batches, personal revision writes and candidate first-use commits atomic. Fully validate the proposed next revision, policy, resource identities and evidence before consuming evidence or writing actor/catalogue state. Snapshot/restore evidence and revision history if a later actor write fails; do not leave an evidence record marked used without its improvement. Reuse existing rollback/error contracts and report an indeterminate rollback as fatal to that operation.
6. Retain current `prepare`/`commit` state checks: actor level, skill, attributes, status, gear, source and pool changes during an asynchronous roll invalidate preparation. Recalculate formulas after ordinary later stat changes on a fresh use; do not freeze the actor's values or silently change an already prepared receipt.

Gate: no new automatic healing author can submit the old `max(1, level)` formula or unmanaged coefficients; no rejected candidate/improvement changes learned state, catalogue, evidence, health, needs or receipts. Unmanaged historic formulas continue to round-trip and execute as authored.

### 3. Integrate every model author and standard/TinyBrain correction path

Files: `TechniquePrompt.js`, `StartingTechniques.js`, `TechniqueEvents.js`, `prompts/_includes/technique-events.njk`; relevant prompt-family/parser/result builders only where they duplicate the acquisition/improvement contract; `GeneratedNpcTechniques.js` for caller audit.

1. Replace the weak numeric healing example in `getTechniqueCreationInstructions()` with the recipe proposal contract. Supply server-owned policy options, selected-actor formula catalogue and actual active resource profiles. The model may choose existing canonical catalogue IDs without repeating known mechanics; novel healing supplies concept/skill/attribute/profile selections, not a full invented numeric formula. The server adds the managed mechanics before existing domain preview.
2. Make `StartingTechniques` use that same contract for protagonists, NPC batches and hostile arrivals. Keep its complete-response staging, catalogue reuse, empty repertoire receipts, one correction budget and no-load-migration behavior. Reject a shared candidate whose selected proficiency/resource is invalid for one of its intended learners instead of guessing an alternative.
3. Extend independent `TechniqueEvents.parseChange/applyChange` improvement commands with a narrow semantic `improvement` proposal (configured step IDs, evidence and reason). Resolve against that actor's pinned learned revision and policy. Do not accept a model's arbitrary full managed revision merely because it is syntactically valid. Existing custom/editor authoring remains a deliberate separate contract.
4. Audit first-use discovery, standard attack/technique tools, ordered player plans, NPC pre-resolution, initial NPC catalogue selection, independent teaching and API catalogue/personal entry points. Each reaches the same service compilation/validation; none has a prompt-only policy bypass. Standard and TinyBrain support the same semantic choices and numeric results.
5. TinyBrain keeps its existing native tools and `tool_choice` stable. Use child-only XML/strict escaped JSON proposals and parser correction; unknown/duplicate fields, missing actual selections and unsupported profiles give actionable corrections. Do not ask it for actor level, current rank, known cost, computed healing or another already known value. Do not change a recognized failed healing attempt into `none`, an ordinary attack or narrative healing.
6. Log new/changed generation and correction prompts through `LLMClient.logPrompt()`, without `<maxTokens/>`. Preserve transport/cancellation behavior, parser retry limits, receipt identity and exact mutation suppression. Policy errors must be diagnosed before a roll/debit, not hidden in narration.

Gate: isolated standard/TinyBrain player and NPC initial/discovery/improvement flows produce identical compiled mechanics and receipts for identical actor facts; malformed proposals correct or fail without mutation. Existing native tool-schema/cache invariants still pass.

### 4. Keep authoring APIs and the existing editor honest

Files: `TechniqueApi.js`, `public/js/techniques.js`, relevant existing panel/template only if necessary.

1. Route preview, catalogue creation and personal revision saves through shared compilation/validation. Expose authoring recipe options and resolved previews from the server. Return formulas plus resolved preview data without turning the preview's numeric response into the saved formula source.
2. Preserve managed metadata on unrelated edits, name/description editing and personal revisions. Offer a small explicit choice in the existing editor to keep the managed recipe or convert that personal draft to custom authoring; stripping metadata incidentally is invalid. A deliberate custom conversion records editor provenance and an ordinary revision/history entry, never changes other owners, and is unavailable as an automatic model escape hatch.
3. Keep the current source selector, formula-reference popup, shared error modal/backtrace, ordinary chat Use path and server authority. Show accurate selected-source costs and effect preview. No direct heal endpoint or full policy dashboard is needed; YAML is sufficient for coefficients.
4. If presentation changes are needed, read the UI registry, reuse shared widgets and modal lifecycle, existing font/theme/contrast and keyboard conventions. Edit SCSS and compile the matching CSS. Verify only affected interaction/presentation, without redesigning character panels.

Gate: editing and saving a managed personal technique preserves its snapshot and formulas; intentional conversion is visible and scoped. A forged managed formula or automatic-origin custom request returns `{error, stack}` and changes nothing.

### 5. Persist snapshots, preserve replay and plan the narrow repair

Files: `TechniqueRuntimeState.js`; `Utils.js`/`api.js` save lifecycle and `Player.js` only where round-trip validation requires change; existing saved state remains owned by `TechniqueService`.

1. Confirm metadata survives catalogue revisions, learned pins/history, item-granted pins, receipt requests and save/load/full rewind. Prefer the existing per-revision serialization over a new global mutable policy registry. Add a service-state version only if genuinely required, with explicit old-version handling; missing metadata alone does not require rewriting old saves.
2. Ensure runtime fingerprints include managed metadata/formulas through the existing catalogue/actor projection. Keep historical receipts excluded from availability fingerprints. A new-authoring candidate must include its effective authoring-policy digest in its freshness guard; an existing technique's saved formula execution remains independent of that live authoring policy.
3. Replaying a saved use or improvement must return its original receipt, costs, resolved inputs and effects even after configuration changes, stat changes, unequipping or restart. Do not recompile historical requests against today's policy before recognizing a committed replay.
4. Prepare a **separate explicit repair operation**, after implementation and review, for Restorative Focus. Identify it by exact technique/actor IDs and expected old revisions/formulas, never a broad name match. Preview the proposed catalogue append and Exis personal revision with a before/after diff; preserve technique ID, discipline, provenance, acquisition/evidence history and prior revision.
5. The repair should append a corrected catalogue revision so default *new* learning uses the corrected latest revision, and separately append Exis's corrected personal mechanics so his existing learned pin benefits. Verify the current `learn` default selection first and make that latest-revision behavior explicit if needed; an explicitly requested old revision remains explicit. Do not mass-update other owners, equipped item pins or historic receipts. Do not overwrite existing catalogue revisions or fabricate training evidence: this is a recorded editor rebalance, not earned improvement.
6. Stage/validate both repair edits before committing either, preserve exact-once operation IDs, and provide rollback on installation failure. A dry-run/preview is read-only. Do not apply it on startup/load or execute it while carrying out this planning task. Approval to implement this plan includes the narrowly specified repair after its before/after result is concrete and the expected actor, technique and revisions still match; changed or ambiguous identities require clarification. Honor the user's existing authorization to restart the game when needed, preserve the independent LLM server, and never auto-load a save on restart. If deployment leaves no game loaded, finish the repair through the reviewed saved-data path or after the user normally loads the intended game; do not silently load a game to perform it.

Gate: legacy custom saves remain unchanged, malformed present metadata fails before live-world replacement, snapshots and pins survive reload, and a targeted isolated repair changes exactly the intended latest catalogue revision and Exis entry.

### 6. Focused verification and documentation

Use existing focused test owners (`tests/technique_service.test.js`, `technique_prompt.test.js`, `technique_events.test.js`, `initial_technique_generation.test.js`, `technique_api.test.js`, `technique_native_tool_runtime.test.js`) and a small new policy/compiler test file. Add meaningful contract cases, not tests that merely mirror helper internals:

- Exact calibration table and 100 → 90 efficiency result; several increasing level/skill sequences prove nonincreasing costs, including rounding plateaus. Larger skill still reaches 31 HP; no 30 cap. Attribute contribution uses its modifier and the selected actual skill, including a non-Spellcasting example.
- Missing/inactive/reversed/mismatched-capacity pools, unknown skill/attribute, normalized-name collision, invalid denominator/nonfinite output and forged snapshot/formula combinations fail explicitly. A non-Mana discipline is not assigned Mana or an automatic 100-unit cost. Existing health bounds reduce actual healing, not authored potency or debit.
- Standard/TinyBrain and player/NPC initial authoring, discovery, independent teaching and personal improvement share policy. Unsupported area/mixed healing and malicious unmanaged healing cannot bypass it. Failed correction causes no world mutation; tool schemas remain unchanged.
- Separate actors using the same catalogue retain independent personal improvements; power alone keeps its cost, efficiency preserves its healing. Evidence is consumed once and restored on failed installation. Shared catalogue append leaves other learned/item pins unchanged.
- Formula references recalculate on later stat changes. A stat/source/pool change during asynchronous preparation rejects with no debit; genuine new attempts use fresh inputs. Existing failure-cost/check-success semantics and replay do not acquire a second calculation path.
- Save/reload/rewind preserve snapshot, metadata, history and receipt inputs; configuration changes affect only new authoring. Committed replay returns original effects/costs after config/stat/source changes. Explicit custom legacy formulas remain intact; malformed present metadata does not partially replace the live world.
- Targeted repair fixture proves exact expected-revision guards, atomic catalogue-plus-personal installation, identity/history preservation and untouched other owners/grants/receipts. No user's save is loaded for testing.
- If editor behavior changes, extend the existing `tests/e2e/techniques-panel-editor.spec.js` with managed-save preservation, explicit custom conversion, truthful preview and persistent errors/focus. Use representative mocked transport/isolated actors; add a service/API integration case for real numeric authority rather than relying solely on UI mocks.

Run tests with the required 16 GB/no-swap outer systemd boundary. For example:

```bash
systemd-run --wait --collect --pipe -p MemoryMax=16G -p MemorySwapMax=0 -p "WorkingDirectory=$PWD" node --test tests/technique_balance_policy.test.js tests/technique_service.test.js
systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 npm run test:e2e:headless -- tests/e2e/techniques-panel-editor.spec.js
```

Start with compiler/service cases, then affected authoring/API/save tests. Broaden only where shared changes invalidate existing evidence. Syntax-check altered JavaScript and parse changed templates/YAML; compile affected SCSS if any. Store test artifacts/temporary overrides in `tmp`, Playwright scripts in `playwright_scripts`. Follow the applicable agent delegation instructions at execution time; if the requested Terra testing model is unavailable, report that constraint rather than inventing a model identifier. No tests or server changes are part of creating this plan.

Document the implemented class in `docs/classes/TechniqueBalancePolicy.md`, then update `Technique.md`, `TechniqueService.md`, `StartingTechniques.md`, `TechniquePrompt.md`, `TechniqueEvents.md`, `TechniqueRuntimeState.md`, `TechniquesPanel.md` and `docs/api/techniques.md` only where contracts change. Add coefficient/profile/snapshot/reload behavior to `docs/config.md`, and update `docs/README.md`. Record proposed-versus-validated calibration and actual verification evidence; do not label this plan implemented before its gates pass.

## Completion criteria and bounded decisions

The initial slice is complete when every automatic source of ordinary healing uses the engine recipe, the exact agreed calibration/efficiency examples pass, current actor stats remain dynamic, costs never rise with level/proficiency, saved pins stay immutable across config reload, and the editor/receipts/save lifecycle preserve those guarantees. Existing custom mechanics continue explicitly as custom; new generated healing cannot use them to bypass policy.

Before implementing additional area/mixed healing, damage or status balance recipes, choose their effect budget, targeting, failure-cost and resource profile explicitly. No such global numbers were agreed here. Continue gameplay calibration before treating the initial coefficients as final across all matchups. These remain bounded future design tasks; the separately approved Restorative Focus repair is recorded below.

## Delivery and verification, 2026-10-26

- Implemented the pure policy compiler, saved snapshots and canonical formulas; trusted editor origin is server-owned, and automatic candidates cannot claim editor provenance or bypass recipes with unmanaged healing.
- Integrated initial generation, first-use discovery, standard/TinyBrain resolution plans, NPCs, event learning/improvement, advisory API previews and the existing shared editor. Default personal efficiency multiplies base cost by 0.9; the configurable power step adds 2 HP without changing cost.
- Preserved legacy custom mechanics and pinned sources. Asynchronous check preparation captures the complete actor/target signature before awaiting, so even state changes that leave rounded costs unchanged reject stale preparation. Evidence/history writes and targeted rebalancing retain rollback and replay guarantees.
- Focused backend suites passed **60/60**; the final affected policy/service run passed **36/36** after adding strict new receipt-metadata validation. Browser editor/panel checks passed **5/5**. Every test command used a 16 GB/no-swap systemd boundary. The user manager bus was unavailable, so browser tests used a system transient unit as UID/GID 1000; peak browser memory was 2.1 GB, with no swap.
- Syntax checks passed for all changed JavaScript; changed prompt includes compiled with Nunjucks; default YAML parsed and passed policy validation. No SCSS changed. Browser artifacts are under `tmp/technique-balance-browser-report`, `tmp/technique-balance-browser-results` and `tmp/techniques-ui-review`.
- The isolated repair fixture proved exact hash/revision guards, original-source preservation and changes limited to the selected catalogue/owner/receipt/save-name fields. The actual current game was saved through its ordinary API, then copied to a sibling save ending `-balanced-techniques`. Exis's `technique_1` now has catalogue/personal revision 2, **24 HP / 83 mana**, with revision 1 retained in history. Health, current mana, world time and prior receipts were preserved; no cast or refund occurred.
- Restarted only the game server, preserved the independent LLM PID, and verified both HTTP endpoints. No save was automatically loaded. The balanced copy is listed by the normal saves API and is ready for the player to select.

The default formula reproduces the accepted level-3 calibration exactly. Compared with the observed ordinary 13–15 damage hits, Exis's 24 HP heal represents about 1.6–1.85 hits at his modest skill, as discussed. Mana regeneration remains 10 points per world minute (8.3 minutes to replace an 83-mana cast); action durations remain story-dependent. This is initial gameplay tuning, rather than a claim that every matchup has an identical two-hit recovery.
