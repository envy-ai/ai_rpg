# NeedBarStatusEffects

Compiles optional YAML-authored conditional status templates for the native
Player need-bar runtime. Templates are detached, deeply frozen and keyed for
normal DefinitionLoader map overlays. No LLM request or catalogue allocation is
involved.

```yaml
need_bars:
  rest:
    effect_thresholds:
      700:
        name: Well Rested
        status_effects:
          condition:
            name: Well Rested
            description: Increased strength and Stamina capacity while rested.
            attributes:
              strength:
                percent_modifier: 5
            need_bar_maximums:
              stamina:
                percent_modifier: 5
            need_bars:
              Health:
                percent_delta: 0.005
```

`status_effects` is a map, not a list. Each stable key may define `enabled`
(boolean), `name`, `description`, `attributes`, `skills`, `need_bars`,
`need_bar_maximums`, and `max_health_percent`. Name/description are required for
an enabled template. An overlay can set `enabled: false` without recreating the
other fields. Keyed attribute/skill entries accept `modifier`,
`percent_modifier`, or both. Keyed ongoing need entries accept `delta`,
`percent_delta`, or both; a percentage-only entry has fixed delta zero.
`need_bar_maximums` entries require `percent_modifier`. Zero is valid. Numeric
formulas, technique grants, supplied runtime IDs/clocks/durations and unknown
fields are rejected with authoring paths and repair guidance.

`compile(source, { path })` produces canonical `statusEffects` template arrays
for runtime threshold objects, using native detached `StatusEffect` validation.
`validateReferences(definitions, { attributes, skills })` checks identities
against merged need/attribute definitions and the available skill catalogue.
Known inactive need targets remain valid; unknown targets fail. `Health` is an
ongoing-rate target, not a need-capacity target.

`project(actorId, bar, threshold, activeNeedNames)` creates a frozen read-only
projection with a deterministic actor/bar/threshold/key ID, `source: "need-bar"`,
`needBarSource: { barId, barName, threshold, key, levelName }`, and
`inactiveNeedBarTargets`. Player caches these projections by active-band
signature, so repeated mechanical reads allocate no IDs, scan no world registry
and mutate no Health, need value or clock.

Current-band selection, capacity arithmetic, ratio preservation, elapsed-time
integration, transaction rollback and save/load ownership live in
[Player](Player.md). Base YAML supplies the approved Food, Stamina, Rest and Mana
starter statuses. The optional [Lust mod](../mods/need-bar-lust.md) owns Sexual
Satisfaction starter statuses in its existing definition overlay.
