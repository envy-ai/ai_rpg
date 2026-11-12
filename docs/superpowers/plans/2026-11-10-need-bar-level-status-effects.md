# Need-bar level status effects

Status: implemented on disk, with approved starter definitions and isolated
regression/browser verification. The running server has not been restarted.
See [NeedBarStatusEffects](../../classes/NeedBarStatusEffects.md) and
[Player](../../classes/Player.md) for the implemented contracts.

## Goal

Allow a need-bar level to declare optional mechanical status effects alongside
its existing name, prompt sentence and descriptive `effect` text in
`defs/need_bars.yaml`, including enabled mods' overlays. Normally author effects
for the two lowest and two highest levels; any level may declare them.

Effects are active only while the character occupies that level. Moving to
another level immediately replaces that bar's contribution. Effects from
different bars combine through the existing status-effect arithmetic.

There is no LLM call to create, apply or remove these effects during play.

## Confirmed decisions

The user confirmed:

1. Include ongoing Health/need changes as well as stat modifiers.
2. Propose starter effects and values, generally favoring percentage modifiers
   over fixed amounts. Fixed amounts remain supported where appropriate; the
   initial stat suggestions below use percentages.
3. Preserve the current percentage of health when maximum health changes. Health
   is a float internally: do not round either the ratio or resulting HP, including
   during application, serialization or loading.
4. Combine ongoing health regeneration and drain before applying health bounds
   each minute. At 100/100 HP, +1 regeneration and -1 drain produce 100 HP. The
   user explicitly expects this to update current behavior, including existing
   ongoing effects, rather than being limited to the new need-level feature.
5. A cross-bar rate component is conditional on its target bar being active and
   applicable for the actor. If the target is absent or inactive, only that
   component is inactive; the effect's other valid components still apply. It
   resumes prospectively when the target becomes active, without backfilling
   elapsed changes or creating a missing bar.
6. Ongoing percentage Health rates use the target's effective maximum HP per
   world minute, not its current value or baseline regeneration. At 20/100 HP,
   `+1%/min` contributes `+1 HP/min`. For non-Health need bars, the user's later
   capacity clarification below fixes the rate basis at the authored base range.
7. Fix ordinary and opposed skill checks to include all applicable existing
   status, equipment and location modifiers as well as new need-level modifiers,
   matching attack resolution. Apply each contribution once; do not change
   stored/base skill ranks or point-allocation costs.
8. Support ongoing percentage rates consistently across status effects,
   including effects applied by techniques. Application, refresh, stacking and
   stronger-effect comparison must account for both fixed and percentage
   components; the field is not restricted to need-level effects.
9. Approve the proposed Food starter values: Starving gives Constitution -10%
   and Health -0.04% of maximum per minute; Extremely hungry gives -5% and
   -0.02%/min; Full gives +5% and +0.005%/min; Stuffed gives +10% and +0.01%/min.
   These Health rates add to baseline regeneration. Only the current band applies.
10. Approve the proposed Stamina starter values: Breathless gives Strength and
    Dexterity -30%; Winded gives both -10%; Energized gives Strength +5%; Fully
    Energized gives Strength +10%. Stamina adds no ongoing Health rate initially.
11. Rest effects must also modify Strength and maximum Stamina, alongside the
    Intelligence/Wisdom and ongoing Health changes. Approve the expanded starter
    values: Exhausted gives Strength, Intelligence, Wisdom and maximum Stamina
    -10%, plus Health -0.01% of maximum per minute; Very Tired gives those four
    -5%, plus Health -0.005%/min; Well Rested gives Strength, Wisdom and maximum
    Stamina +5%, plus Health +0.005%/min; Fully Rested gives Strength,
    Intelligence, Wisdom and maximum Stamina +5%, plus Health +0.01%/min.
12. All need bars preserve their exact percentage when their maximum changes,
    without rounding. Ordinary costs, recovery, baseline drift and other need
    changes must not scale with capacity modifiers. An increased capacity must
    provide more usable units at the same unit costs, rather than proportionally
    increasing both capacity and spending/recovery.
13. Approve the proposed Mana starter values: Depleted gives Intelligence and
    Wisdom -10%, plus Health -0.005% of maximum per minute; Weak gives
    Intelligence -5% with no ongoing Health change; Very High gives Intelligence
    +5%, plus Health +0.0025%/min; Full Power gives Intelligence +10%, plus
    Health +0.005%/min. These Health rates add to baseline regeneration.
14. Approve Sexual Satisfaction's starter values when its mod is enabled:
    Desperate gives both Wisdom -10% and Charisma -10%; Frustrated gives
    Charisma -5%; Content gives Charisma +5%; Sated gives Charisma +10%.
    This bar adds no ongoing Health rate initially.

Use `newHealth = (previousHealth / previousMaxHealth) * newMaxHealth`. For example,
`37.25 / 100` becoming a maximum of `115` produces `42.8375` HP, not `43`.
Display formatting may retain existing conventions but must not write rounded
display values back into model state.

Technique grants remain outside the initial scope; supporting them
would add saved-catalogue reference validation and source availability handling.
The rate bases and all starter numbers below are confirmed and authored. The
canonical fields are `needBars[].percentDelta` and
`needBarMaximums[].percentModifier`; YAML uses `need_bars`/`percent_delta` and
`need_bar_maximums`/`percent_modifier`. Structured XML uses nested elements,
including `<needBarMaximums><needBarMaximum>...</needBarMaximum></needBarMaximums>`.

Other recommendations: keep authored cutoff positions within each bar; apply effects only from the
single current level; respect existing audience/applicability rules; use normal
native stacking across bars. None requires cumulative effects from every lower
threshold.

## Existing behavior and constraints

- `Player.#resolveNeedBarThreshold()` currently selects the greatest raw
  threshold less than or equal to the stored value. A threshold starts its level
  rather than ending it. Preserve authored lower-inclusive positions, including
  decimal values, while mapping them proportionally to modified capacity so a
  base `1000` full-only threshold still means full at an effective maximum of
  `900` or `1050`. Unmodified bars retain their existing cutoffs.
- `getNeedBars({ scope: 'active' })` already handles player/NPC audience flags
  and per-character applicability. Existing party semantics include former
  party members for party-history bars; this feature does not change that rule.
- `relative_to_level` and `related_attribute` are currently metadata. Do not
  introduce implicit scaling or make thresholds depend on modified attributes.
- Definition normalization and public cloning currently retain only threshold,
  name, sentence and descriptive effect. New nested templates must survive each
  definition, runtime, client and prompt boundary intentionally.
- `getStatusEffects()` already supplies mechanical attribute, skill and maximum
  health contributions from intrinsic, ability, equipment and mod sources.
  Intrinsic save lists are separate from these combined active effects.
- Skill consumption differs by resolver: `Player.getSkillModifiers()` can read
  active status modifiers and attack resolution adds them, but ordinary/opposed
  `server.resolveActionOutcome()` obtains raw skill ranks through
  `resolvePlayerSkillValue()`. Audit this boundary explicitly; a new derived
  source alone does not guarantee that need-level skill bonuses reach checks.
- Per-minute processing currently ticks intrinsic status effects separately
  from baseline need drift and health regeneration. Merely appending derived
  effects to `getStatusEffects()` would not apply their need deltas correctly.
- Need-bar maxima currently come from their definitions; ordinary status effects
  have no maximum-Stamina modifier. Rest's requested capacity modifier therefore
  requires a canonical need-maximum modifier and complete runtime, serialization,
  validation and presentation support, not an ongoing Stamina delta. Preserve
  percentages and proportional threshold positions when the maximum changes;
  raw full-only thresholds would otherwise become unreachable below the authored
  maximum or activate before full above it.
- `DefinitionLoader` recursively merges maps but concatenates lists. New YAML
  maps should use stable keys so mod overrides cannot double a base effect.
- Hydration restores saved need values/applicability against current merged
  definitions. This plan retains that policy rather than adding a separate
  versioned world rules snapshot.

## YAML contract

Add an optional `status_effects` map to an existing `effect_thresholds` entry.
Each map key is a stable definition key, independent of the displayed name.
Use maps for nested modifier identities too, then normalize them into the
existing canonical StatusEffect arrays.

Example of the implemented YAML structure:

```yaml
need_bars:
  food:
    effect_thresholds:
      0:
        name: Starving
        sentence: "%CHARACTER% is starving and urgently needs food."
        effect: Constitution penalty while starving
        status_effects:
          starving:
            name: Starving
            description: Hunger weakens the character's physical resilience.
            attributes:
              constitution:
                percent_modifier: -10
      1000:
        name: Stuffed
        status_effects:
          well_fed:
            name: Well Fed
            description: A substantial meal improves physical resilience.
            attributes:
              constitution:
                percent_modifier: 10
            # Optional supported fields:
            # skills:
            #   Perception:
            #     modifier: 1
            # max_health_percent: 5
            # need_bars:
            #   Health:
            #     percent_delta: 0.01  # 0.01% of maximum HP per world minute
```

- Missing or empty `status_effects` in the final merged definition means no
  mechanical effect for that level.
- Multiple keyed effects may exist on one level. Display names are not keys and
  do not control deduplication or stacking.
- Each enabled entry requires a nonblank name and description. Lists/maps may
  legitimately be empty; numeric zero is a real value, not missing input.
- Supported YAML mechanics normalize to canonical `attributes`, `skills`,
  `needBars`, `maxHealthPercent` and a new need-maximum modifier. Both fixed and
  percentage modifier components may be present for an attribute or skill.
  Numbers are finite, not formulas.
- `need_bars` targets an actual bar ID or reserved `Health`. Use a
  `percent_delta` rate measured in percentage points per world minute: Health
  uses effective maximum HP; other bars use their authored base range, unaffected
  by capacity modifiers. Never use the current remaining value. Thus
  `0.01` means 0.01% per minute. An explicit `delta` retains native fixed
  HP/bar-units-per-minute semantics. Support positive and negative values and
  preserve explicit zero; when both are provided, add the components.
- Add a keyed need-maximum modifier map for Rest's Stamina capacity changes,
  normalized into the canonical shared `needBarMaximums` StatusEffect field. Sum percentage contributions against the
  authored base capacity, not against a previously modified maximum. Use actual
  bar IDs and the same known-but-unavailable target eligibility policy as rates.
  Carry it through all supported owners, XML codecs, standard/TinyBrain prompt
  contracts, saves, editors and tooltips. Reject invalid nonpositive/nonfinite
  effective ranges before commitment; do not clamp them into validity.
- Validate target IDs against the merged definitions: an unknown ID is still a
  configuration error. A known target that is absent/inactive for one actor is
  an explicit eligibility condition, not an error or a warning fallback. Recheck
  eligibility when applicability or audience changes. Do not create a bar,
  mutate stored-only values or replay skipped changes when it is re-enabled.
- Percentage rates are a deliberate small extension to the canonical need-delta
  shape, which currently supports only fixed `delta`. Normalize the new field to
  `percentDelta` and carry it through shared StatusEffect validation, owner
  serialization, XML/generation/repair codecs and tooltips. Do not introduce a
  parallel hidden effect payload that existing readers silently discard.
- A mod can override a component under the same keys, including setting it to
  zero, or disable an entire entry with `enabled: false`. Re-enabling uses
  `enabled: true`. Do not use null tombstones or append duplicate copies.
  An empty overlay map does not erase a base map under the existing merge rules;
  explicitly disable inherited entries instead.
- Do not accept authored status IDs, duration, applied-at clocks or technique
  provenance. Lifetime and source identity belong to the need-level system.
  Internally an active effect can use the existing indefinite status shape, but
  the UI must describe it as conditional rather than permanently acquired.
- Keep the old descriptive `effect` field. It remains narrative guidance and
  never independently applies numeric mechanics. Align starter descriptions
  with their real authored effects so old prose does not promise unsupported
  penalties or automatic fainting.

## Runtime architecture

### Compile definitions once

Extend need-bar definition normalization or extract a focused
`NeedBarStatusEffects` helper. Compile and validate templates when definitions
are loaded/reloaded, using detached native StatusEffect validation. Keep nested
templates immutable and deep-clone at public boundaries.

Perform structural validation before installing definition caches. Validate
attribute/skill/need references against the actual world definitions when they
are available, including after world creation/load. Reject unknown identities
with the exact YAML path and valid choices; never silently discard the field or
replace the definition set with empty defaults.

Definition reload must preflight the complete proposed set, then rebuild actor
need state and conditional contributions without partially installing bad YAML.
Validate resulting actor maxima as well as individual templates: individually
finite modifiers can combine into an invalid maximum. Stage all affected actors
before installing definitions. A rejected transition or reload must leave every
actor's bars, applicability, Health, clocks and contributions unchanged; existing
setters do not themselves provide a complete rollback transaction.

### Add a derived status source

Expose a focused getter for active need-level statuses and merge its results into
`Player.getStatusEffects()` alongside the existing derived sources.

- Read private stored bars and their already resolved current thresholds;
  avoid the public deep-copying getter on repeated mechanical reads.
- Require the bar to be active and applicable for that character.
- Use source-bound identities based on actor, bar, threshold and definition key,
  following the native equipped-status pattern. Do not allocate IDs or create
  new StatusEffect instances on every getter call.
- Include explicit source metadata so tooltips and prompts can distinguish need
  effects from intrinsic conditions, abilities and equipment.
- Never call `addStatusEffect()` or insert these into intrinsic save arrays.
  They therefore cannot be copied by NPC alteration or repaired as malformed
  intrinsic/ability records by `/repair_status_effects`.
- No ordinary getter mutates health, time, need values or persisted status lists.

Cache only if necessary. Invalidate at actual mutation boundaries rather than
rescanning inventories or the whole world during attribute/tooltip reads.

### Reconcile every native mutation route

Refresh conditional contributions and apply the selected HP policy when needed
after construction/load, direct `setNeedBarValue`, event changes, slash-command
changes, passive drift, item/technique payments and recovery, applicability
changes, party/audience changes, level changes that affect maximum health, and
definition reload.

Before changing a source of ongoing rates, settle elapsed time through the
mutation's effective world minute under the old state. Then apply the mutation
and reconcile its new contributions. This includes refills, applicability and
audience changes, status application/removal/refresh, and definition reloads.
Otherwise a delayed tick could apply a new effect retroactively or erase an old
effect's elapsed drain. Internal time-step mutations must not recursively invoke
settlement. Reconcile only after the complete logical operation succeeds.

Reuse the native float-preserving health-ratio calculation; its current gear
helper already avoids integer rounding. Capture a finite positive previous
maximum and the health ratio immediately before the maximum-changing mutation,
then rescale once after the complete need-level change. Do not use the ordinary
intrinsic-status policy that adds the maximum-health difference as healing.
Rescaling changes absolute HP but is not a regeneration/healing tick and must
not fire an extra heal event.

For composite operations that also cause real damage or healing, preserve those
changes. Do not wrap a health-changing operation in a helper that restores a
ratio captured before the damage/heal and thereby erases it. In time processing,
settle that step's explicit Health delta under the old maximum, then preserve the
resulting ratio while applying the need-level/max-health transition.

Audit direct internal bar writes: elapsed-time processing currently uses
`#applyNeedBarValue` rather than the public setter. Updating only the public
setter would leave stale effects after travel or waiting.

Reconcile after the complete logical change, not between intermediate writes of
a multi-bar operation. Preserve native rollback and error reporting. Do not add
new numeric clamping; use existing value/health bounds and explicit validation.

Trace the computed modifiers into every authoritative resolver. Make the
approved focused shared skill-total integration so ordinary and opposed
checks, attacks and technique checks receive the same applicable fixed/percentage
bonuses exactly once. Keep stored/base ranks distinct for point allocation and
editing; do not change `getSkillValue()` globally as a shortcut. Preserve existing
named-attribute math and the level bonus for checks with no selected attribute.

### Keep capacity separate from costs and recovery

Track authored base bounds separately from each actor's effective bounds. Do
not rewrite the global definition's usual `max: 1000` when one actor receives a
capacity modifier. Preserve each need bar's fill ratio on a capacity transition:

`ratio = (oldValue - oldMin) / (oldMax - oldMin)`

`newValue = newMin + ratio * (newMax - newMin)`

For example, 500/1000 becomes 450/900 when maximum Stamina falls 10%; 500/1000
becomes 525/1050 when it rises 5%. A fixed 100-point expenditure remains 100
points, and baseline Stamina recovery remains its authored 50 points/minute in
both cases. Do not round or repeatedly rescale unchanged state. Preserve real
spending/recovery within a composite operation instead of overwriting it with
a ratio captured before that change.

Map each authored threshold by its base-range fraction into the effective
range, or compare the actor's fraction in base coordinates. Keep authored
threshold keys and source identities stable. Thus Energized's base 700/1000
cutoff stays at 70%, and Fully Energized remains full-only. Recompute cached
bands at mutation boundaries without recursive maximum/effect getters. Ratio
preservation alone must not change a band's identity or create an effect cycle.

Keep these change amounts independent of capacity modifiers:

- Configured small/medium/large magnitude amounts, baseline `change_per_minute`,
  direct/slash additions or subtractions, item/technique payment and recovery,
  and fixed status-effect deltas retain their authored units.
- Any existing range-derived magnitude calculation uses the authored base range,
  not the actor's modified range. Explicit percentage non-Health need rates also
  use that base range. Health percentage rates retain the approved effective-HP
  maximum basis. This refines the earlier generic percentage-rate proposal.
- Technique resource-profile eligibility and balance/reference-capacity checks
  use the authored base capacity. Runtime affordability uses current value and
  effective bounds. Do not invalidate saved techniques or recalculate their
  numeric costs merely because an actor's capacity is modified. Preserve existing
  authored level/skill/attribute formulas; prevent an extra capacity multiplier,
  rather than freezing unrelated native efficiency mechanics.
  Keep payment receipts' fixed debit separate from any subsequent capacity/ratio
  adjustment in the same operation; existing receipt validation expects the
  recorded debit to equal its authored amount under its recorded bounds. Do not
  rewrite old receipts or saved costs to disguise rescaling as spending.
- Explicit fill/empty operations retain their native meaning: set to the current
  effective maximum/minimum. They are complete fills/empties, not ordinary fixed
  recovery amounts. Never substitute a hardcoded 1000 for a full bar.
- Absolute percentage assignments such as while-you-were-away's `valuePercent`
  still mean that fraction of the effective range. They specify a resulting
  state, not a percentage-scaled recovery delta. Resolve multi-bar assignments
  together so Rest-driven capacity changes cannot invalidate the final requested
  Stamina percentage. Starting-need percentage input follows the same distinction.
  NPC creation currently converts percentages against the base definition before
  actor construction; finalize this conversion after effective capacities are
  available, using the shared nonzero-minimum-aware formula.

Use effective bounds and actual current values for UI/prompt percentages,
availability checks and transition receipts; show base and modified capacity
distinctly where needed. Preserve enough previous effective-bound information
in saves to restore the old percentage before deriving new bounds after full
world load or definition reload. Old raw values must not be capped to the new
base maximum before their saved ratio can be recovered. The same transactional
and legacy-reference validation rules as Health apply to all affected needs.
Keep `initialValue` as its historical original baseline; do not rescale that
metadata on each capacity change. Explicitly extend whitelist-based context/API
serializers for any new base/reference fields while keeping public `max` equal
to the effective maximum.

### Integrate per-minute effects correctly

Ongoing deltas are included in the requested feature, not a silent follow-up.
Use one coherent elapsed-time boundary for baseline drift, threshold
effects, existing intrinsic deltas, timed-status expiry and normal regeneration.

Specify minute-step reference semantics:

1. Take the active bands and statuses at the start of a world-minute step.
2. Compute that step's rates from the same snapshot, including cross-bar or
   self-bar deltas; do not recursively reapply an effect because it changes its
   own source bar.
3. Resolve percentage rates against the proper basis at the start of the step:
   `amount = delta + rateBasis * percentDelta / 100`, using effective maximum HP
   for Health and authored base capacity for other needs. Read Health's maximum
   only after collecting stat contributions, outside a status getter, to avoid
   recursion through `maxHealth -> getStatusEffects -> maxHealth`.
4. Sum baseline health regeneration and all applicable ongoing Health gains and
   losses, then apply native Health bounds once to that net change. Settle that
   change before applying need values through native
   rules, preserve exact Health/need percentages if maxima change, and recompute bands
   for the next step.
5. Preserve existing application clocks and avoid replay after save/load or
   repeated processing at the same world minute.

Use start-of-interval membership for timed effects: an effect with one full
minute remaining contributes for that final minute, then expires at its end.
Reconcile any expiry-driven maximum-health change after settling that minute's
Health change. Keep duration expiration independent of whether an optional rate
target is active. Align the existing separate regeneration, need-rate and
per-effect clocks without replaying intervals already settled by any source;
newly applied effects never earn ticks from before their application.

Audit every percentage-rate consumer, including technique-status refresh's
elapsed settlement and native stronger-effect comparison. Compare mixed fixed
and percentage rates using the same applicable rate basis used by the operation; preserve
the native comparison policy for opposing or multi-component effects rather
than silently dropping the new component. Shared XML, generation and repair
contracts must support the field in standard and TinyBrain paths.

Long time skips must agree with repeated minute advancement. They must not apply
the final band's rate retroactively to the entire elapsed interval. Start with
a clear reference implementation and batch constant-rate spans only where
equivalence to the new net-per-minute behavior is demonstrable. This deliberately
corrects the current batching/order inconsistency for existing ongoing effects
as well; do not preserve a legacy fast path that produces different Health
results merely because no new need-level effects are configured. Benchmark long
travel across many NPCs. Do not introduce a silent time cap or truncate elapsed
minutes to contain work.

Ongoing health loss follows native health rules: reaching zero HP disables the
character, but does not itself set `isDead` or create a corpse; death remains in
the existing explicit event/death flow. Do not add a special HP floor or infer
death solely from a need threshold. Use the approved ongoing starter values
below and verify their combination with baseline regeneration in regressions.

### Display and prompt behavior

- Show the same native status-effect cards, names and Stat/Change tables, with
  a source label such as `While Stamina is Winded` instead of `Permanent`.
- Include authoritative active need effects in normal and TinyBrain base
  context. State that their numeric modifiers are already applied by the
  engine; checks must not add the same penalty as a circumstance modifier.
- Keep existing threshold sentences for narrative behavior. Do not generate a
  second intrinsic effect merely because those sentences describe hunger,
  fatigue or other conditions.
- Reuse native `needBarChanges`/What changed metadata for meaningful transitions;
  avoid separate duplicate gain/loss cards or per-minute notification spam.
- Update definitions/client serialization deliberately so UI, prompts and actual
  mechanics agree after load, edits and reload.
- If a cross-bar rate component is inactive because its target is unavailable,
  expose that condition accurately in effect details. Do not present it as an
  applied rate, suppress the entire source effect, or emit repeated warnings.

## Approved starter content

All rows below are approved, including the revised Stamina and Sexual
Satisfaction penalties and expanded Rest effects. They are authored in the base
need definitions and the mod overlay respectively. Each row below describes one
selected level's contribution; a character never receives both high or both low
levels of the same bar at once. All bars can still combine with other bars.

| Bar | Lowest level | Second-lowest level | Second-highest level | Highest level |
| --- | --- | --- | --- | --- |
| Food | `0 Starving`: Constitution -10% | `25 Extremely hungry`: Constitution -5% | `950 Full`: Constitution +5% | `1000 Stuffed`: Constitution +10% |
| Stamina | `0 Breathless`: Strength and Dexterity -30% | `10 Winded`: Strength and Dexterity -10% | `700 Energized`: Strength +5% | `1000 Fully Energized`: Strength +10% |
| Rest | `0 Exhausted`: Strength, Intelligence, Wisdom and maximum Stamina -10% | `10 Very Tired`: Strength, Intelligence, Wisdom and maximum Stamina -5% | `700 Well Rested`: Strength, Wisdom and maximum Stamina +5% | `1000 Fully Rested`: Strength, Intelligence, Wisdom and maximum Stamina +5% |
| Mana | `0 Depleted`: Intelligence and Wisdom -10% | `10 Weak`: Intelligence -5% | `800 Very High`: Intelligence +5% | `1000 Full Power`: Intelligence +10% |
| Sexual Satisfaction, when mod enabled | `0 Desperate`: Wisdom and Charisma -10% | `10 Frustrated`: Charisma -5% | `600 Content`: Charisma +5% | `1000 Sated`: Charisma +10% |

Confirm the active world's canonical attribute names before authoring these.
Keep mod-bar definitions in their mod overlay. No automatic fainting, random
failure, cast prohibition, enemy aura or circumstance-only modifier is implied
by this table; those need separate supported mechanics rather than flavor text
masquerading as enforcement.

Ongoing Health rates, in **percentage points of maximum HP per world minute**,
to accompany the stat table (Food, Rest and Mana approved):

| Bar | Lowest level | Second-lowest level | Second-highest level | Highest level |
| --- | ---: | ---: | ---: | ---: |
| Food | -0.04%/min | -0.02%/min | +0.005%/min | +0.01%/min |
| Rest | -0.01%/min | -0.005%/min | +0.005%/min | +0.01%/min |
| Mana | -0.005%/min | 0 | +0.0025%/min | +0.005%/min |

Stamina and Sexual Satisfaction initially add no ongoing Health rate; their
percentage stat effects remain in the first table. No starter cross-bar or
self-bar rate is proposed, although the framework supports explicit YAML rates
for either. Existing baseline regeneration is about `0.01736111111%/min` (25% per
day), so these rates add to that baseline: a negative contribution can slow net
regeneration without necessarily becoming net damage. At 100 maximum HP,
`+0.01%/min` adds `0.01` HP/min; larger maxima scale proportionally. These values
are authored for Food, Rest and Mana. The running process keeps its existing
loaded definitions until a user-authorized restart or definition reload.

Verify aggregate starter arithmetic without changing the approved values. With
all bars at their highest level and the mod enabled, their summed contributions
are Strength +15%, Constitution +10%, Intelligence +15%, Wisdom +5%, Charisma
+10%, and maximum Stamina +5%. Their ongoing Health contribution is +0.025% of
maximum per minute, before baseline regeneration. At all lowest levels, Strength
is -40%, Dexterity -30%, Constitution -10%, Intelligence -20%, Wisdom -30%,
Charisma -10%, maximum Stamina -10%, and ongoing Health -0.055%/min before
baseline regeneration. These totals exclude unrelated native effects.
Constitution may already affect the world's maximum-health formula; do not
duplicate that health change with an additional maximum-health modifier.

## Save compatibility and rollout

Old definitions without `status_effects` gain no new need-derived bonuses or
penalties. The separately approved net-per-minute Health processing correction
also applies to their existing regeneration/drain effects, and ordinary/opposed
checks receive the approved fix for existing skill modifiers. These are explicit
behavior corrections rather than a blanket promise of unchanged old behavior.
Save normal need values, applicability and clocks; derive effects from the active
merged definitions on load. Source identities must be stable across save/load
and definition refresh without persisting duplicate intrinsic effects.

Preserve floating health and its reference maximum without rounding in saves.
Use the existing saved `maxHealth` snapshot when a load changes definitions and
requires a ratio reconciliation; do not rescale twice on an unchanged reload.
For a legacy save without a usable previous maximum, use a native pre-effect
reconstruction only when its inputs establish that maximum. If the prior ratio
cannot be established, reject the rescaling operation with an actionable save
field error and leave state unmodified rather than inventing a prior percentage.
Runtime definition reloads have the actual pre-change maximum available and must
preserve its exact ratio.

Defer load-time Health reconciliation until the complete world is restored,
including locations, location status effects and party/audience membership.
Retain saved Health and its reference maximum during actor hydration, then
finalize once all maximum-health dependencies are available. An invalid Health
reconciliation must reject the load transaction with its original error, not be
caught as an individual actor failure that silently removes that actor.

Existing unrelated intrinsic statuses remain intact. A preexisting status named
`Starving` is not proof that it duplicates a new need-derived effect; no unsafe
name-only cleanup or automatic migration should delete it. Review such legacy
cases before enabling broad starter buffs/penalties in an existing world.

## Implementation order

1. Use the confirmed ongoing/stat scope, percentage-first balance preference,
   separate Health/base-capacity rate bases, unrounded Health/need-ratio policy
   and approved starter values.
2. Add keyed YAML normalization, detached validation and deep-copy coverage.
3. Implement the derived need-status source and mutation-boundary reconciliation
   for stat effects, applicability, all need maxima, base/effective capacity,
   fixed costs/recovery, proportional thresholds, saves and reload.
4. Implement conditional elapsed-time rates; compare optimized
   stepping with the minute-step reference before enabling authored rates.
5. Connect native tooltips, base context, standard/TinyBrain guidance and existing
   need-change notifications.
6. Author approved starter definitions and update relevant docs, then perform
   isolated regressions and browser verification before any live-game rollout.

## Acceptance checks

- No need-level effects configured means no new conditional bonuses/penalties or
  additional LLM requests. Existing ongoing Health effects still receive the
  explicitly approved net-per-minute timing correction, and existing skill
  modifiers apply to ordinary/opposed checks as approved.
- Exact threshold edges and fractional values select the existing lower-inclusive
  band in authored base coordinates; full-only highest levels remain full-only
  at effective maxima both below and above 1000.
- Leaving a level removes its effects immediately. Other bars' effects survive
  and stack using the existing fixed/percentage arithmetic.
- Player, current/former party, non-party and per-actor applicability behave as
  before; inactive/stored-only bars contribute nothing.
- A known but unavailable cross-bar target disables only that rate component.
  Other components remain active; enabling/disabling or party audience changes
  take effect prospectively with no backfill or implicit bar creation. Unknown
  target IDs still fail definition validation.
- Event, direct API, slash, item, technique and passive-time updates use the same
  result. Standard and TinyBrain prompts cannot double-apply a numeric penalty.
- Fixed and percentage skill effects reach ordinary, opposed, attack and
  technique resolution exactly once, while base ranks/point costs stay unchanged.
  Include regression cases for existing intrinsic, ability, equipment and
  location sources even when no need-level effects are configured.
- Definition reload and mod overrides replace/disable keyed effects without
  duplicates. Malformed paths, unknown identities, invalid numbers and unsupported
  fields fail clearly before installation; zero and false remain valid.
- Rejecting a transition or a reload leaves all affected actors unchanged,
  including when a second actor fails after the first would have succeeded.
  Combined modifiers that produce an invalid maximum fail before commitment.
- Save/load restores active effects from need values without new intrinsic
  copies, duplicate grants, replayed ticks or changing source identity.
- Maximum-health transitions preserve the unrounded health ratio, including
  attribute-driven changes, live reloads and fractional HP. Repeated transitions
  return to the original ratio within normal floating-point precision, with no
  integer quantization or extra regeneration. Real damage/healing in the same
  logical operation remains intact.
  Zero HP stays zero, and tiny positive fractional HP is not rounded to zero.
- Every need preserves its exact fill percentage across capacity changes, save/
  load and definition reload, including fractional values and nonzero minima.
  Unchanged maxima do not trigger rescaling. Rest's capacity modifier changes
  available Stamina units without multiplying costs, recovery or passive drift.
- With effective Stamina capacities of 900, 1000 and 1050, the same fixed cost
  spends the same units and baseline recovery adds 50 units/minute before native
  bounds. Configured magnitude changes and base-percentage need rates remain
  identical in units. Full/empty operations reach the actual effective bounds.
- A modified-capacity actor retains compatible technique resource profiles and
  saved technique costs. Affordability and increase-direction payment headroom
  use effective bounds; capacity modifiers do not rewrite balance snapshots.
  Fixed-debit receipts remain replayable when that operation also changes
  capacity, with the ratio adjustment accounted for independently.
- UI percentages, starting-need inputs and while-you-were-away absolute percent
  assignments use effective bounds correctly, including a single update to Rest
  and Stamina together. Saved current values above base maximum survive hydration
  until the prior ratio and final effective bounds have been restored.
- Long skips match repeated minute advancement across multiple crossed bands,
  fractional rates, timed intrinsic effects, self/cross-bar deltas and rate
  direction changes. Reprocessing the same minute applies nothing twice.
- Delayed settlement followed by a refill, audience/applicability change or
  definition reload agrees with settling the same elapsed time before mutation.
  Timed effects contribute through their final full minute and then expire;
  mismatched saved clocks do not replay previously settled changes.
- Percentage rates use effective maximum HP for Health and authored base range
  for other needs, not remaining value or modified non-Health capacity, and
  combine with fixed rates and baseline regeneration without rounding the
  resulting Health/need values. Percent and fixed rate fields survive every
  canonical serializer/parser and native tooltip.
- Technique-applied percentage rates survive application, elapsed settlement on
  refresh, stacking and stronger-effect comparison, including mixed fixed and
  percentage rates. Both standard and TinyBrain structured paths support them.
- Load-time ratio reconciliation includes location and party-derived modifiers,
  is independent of actor restoration order, and occurs once after world restore.
  A failed finalization does not silently skip an actor or partially load a world.
- Native tooltip/source labels and transition notifications are accurate and
  accessible; all focused browser fixtures avoid mutating the user's live game.
- Recurring mechanical reads allocate no IDs, perform no world-wide scan and
  make no health mutations. Long-travel performance is measured under the normal
  configuration. Tests run under the required 16 GB/no-swap systemd wrapper.

## Verification and deployment

Focused regressions cover detached definitions, source bands, stacking,
applicability, exact ratios, base/effective capacity, net Health changes,
minute-step equivalence, save references, transactional reload/load, XML,
percentage technique refresh and fixed-debit receipts. The final focused group
passed 52 cases; existing neighboring suites passed 127 checks. Four isolated
browser cases passed for shared editors
and native tooltip/character-view presentation; generated NPC and actual
base-context rendering checks also passed. All test commands used the required
16 GB/no-swap systemd wrappers.

A normal-definition benchmark settled 20 NPCs across 30 days in about 25 ms,
without truncating time; a separate three-day skip matched 4,320 minute steps.
No debug tracing or polling was added. No live save was loaded or modified for
verification. Restart remains subject to user permission, and must not load a
save automatically.

## Relevant sources

- `defs/need_bars.yaml`, mod `defs/need_bars.yaml` overlays.
- `DefinitionLoader.js`: map/list overlay behavior.
- `Player.js`: definition normalization/cloning, threshold selection, active bars,
  native mutations, combined statuses, health and elapsed-time processing.
- `TechniqueBalancePolicy.js`: resource-profile base-capacity checks;
  `TechniqueService.js`: fixed costs, effective affordability and receipt
  validation; `modding/ActorActivatableSystem.js`: native fixed spell costs.
- `Events.js`, `server.js`, `api.js`: need changes, definition reload, prompt/UI
  serialization and native API mutation paths.
- [Player](../../classes/Player.md), [StatusEffect](../../classes/StatusEffect.md),
  [NeedBarsCommand](../../slashcommands/NeedBarsCommand.md),
  [Need Bar: Lust](../../mods/need-bar-lust.md).
