# Area Attack Tool Design Notes

## Summary

`resolveAreaAttack` is implemented in the regular prose chat-tool path. It is the health-mutating tool for one shared area effect that can affect multiple explicit defenders in a single operation: grenades, blasts, cones, sweeping magic, automatic fire, shockwaves, traps, gas clouds, vehicle impacts, falling rubble, and similar effects.

The single-target `resolveAttack` tool remains the ordinary one-attacker/one-defender path. `resolveAreaAttack` is intentionally not a loose batch wrapper around `resolveAttack`; it represents one area effect with a shared source, target list, shared roll, and per-target outcomes. This keeps ordinary attacks simple while giving the prose model a clear tool when one action can harm or impair several actors.

Secondary effect fields are suggested metadata only. The area tool does not directly create a new status effect from `secondaryEffect`, because that schema does not carry enough duration/level data for a fully validated status application. Per-target results can still include `appliedStatusEffects` from the normal damage application path.

## Current Tool Contract

The tool is available to regular `player_action` and `npc_action` prose prompts when legacy prompt checks are not enabled. It resolves one shared area effect and records a grouped `area-attack` check-results row.

```json
{
  "name": "resolveAreaAttack",
  "parameters": {
    "attacker": "Exact attacker name or player",
    "targets": [
      {
        "name": "Exact defender name or player",
        "position": "center|near|edge|behind cover|uncertain",
        "defenseInfo": {
          "evadeSkill": "N/A or exact skill",
          "deflectSkill": "N/A or exact skill",
          "toughnessAttribute": "N/A or exact attribute"
        },
        "circumstanceModifiers": [
          {
            "amount": 0,
            "reason": "Brief target-specific defense modifier reason"
          }
        ],
        "damageEffectiveness": 3
      }
    ],
    "attackerInfo": {
      "attackSkill": "Exact skill name used for placement/accuracy",
      "damageAttribute": "Exact attribute name used for damage"
    },
    "ability": "N/A or exact ability name",
    "weapon": "N/A, barehanded, or exact weapon/item/effect source",
    "areaShape": "blast|cone|line|cloud|burst|sweep|other",
    "effectDescription": "Short description of the shared area effect",
    "rollMode": "sharedAttackRoll",
    "circumstanceModifiers": [
      {
        "amount": 0,
        "reason": "Brief attacker/effect-wide modifier reason"
      }
    ],
    "secondaryEffect": {
      "name": "N/A or status effect name",
      "description": "Observed effect if applicable, or N/A",
      "appliesOn": "hit|damage|anyEffect|never"
    }
  }
}
```

The current implementation supports only `rollMode: "sharedAttackRoll"`. `damageEffectiveness` is required per target and must be an integer from 1 to 5, matching the single-target attack resolver's effectiveness scale.

## Resolution Model

The resolver validates everything before applying damage:

1. Resolve the attacker.
2. Reject unsupported roll modes, empty target lists, invalid positions, missing target names, and duplicate targets.
3. Resolve every target and reject the whole tool call if any target cannot be resolved.
4. Build one attack context per target while reusing one shared d20 roll.
5. Combine effect-wide modifiers, position modifiers, and target-specific modifiers.
6. Calculate hit/miss and damage through the existing attack resolver machinery.
7. Apply damage to hit targets only after all target outcomes are computable.
8. Reveal a living hidden attacker and request a location refresh when needed.
9. Return one grouped result object with per-target attack summaries.

This is all-or-nothing at validation time, but not mechanically all-or-nothing. After validation succeeds, each target can independently hit, miss, resist, take reduced damage, or be defeated.

## Position Scaling

The implementation uses symbolic positions rather than exact map geometry:

| Position | Defense adjustment | Damage multiplier | Meaning |
| --- | ---: | ---: | --- |
| `center` | +0 | x1 | At or near the main impact point. |
| `near` | +2 | x1 | In the main affected group. |
| `edge` | +4 | x0.5 | Barely caught by the effect. |
| `behind cover` | +6 | x0.5 | In the area but shielded. |
| `uncertain` | +2 | x1 | Position is unclear but plausibly exposed. |

The model deliberately avoids exact distances, blast radii, shrapnel trajectories, facing, and tactical-map geometry. Target-specific `circumstanceModifiers` remain available for cover, surprise, cramped quarters, elevation, or other narrative factors that the position label does not capture.

## Result Shape

The tool content shown back to the model stays concise:

```text
Area attack results:
- Commander Razorclaw: hit, Damage: 14%, Remaining health: 62%
- Goblin Sapper: hit, Damage: 8%, Remaining health: 41%
- Shield Adept: miss, no damage
```

Structured metadata is richer for UI and event summaries:

```json
{
  "kind": "area-attack",
  "attacker": "Exis",
  "weapon": "Concussion Grenade",
  "ability": "N/A",
  "areaShape": "blast",
  "effectDescription": "Concussive grenade blast",
  "rollMode": "sharedAttackRoll",
  "sharedRoll": {
    "die": 13,
    "total": 31,
    "attackSkill": "Ranged Combat",
    "damageAttribute": "dexterity"
  },
  "results": [
    {
      "target": "Commander Razorclaw",
      "targetId": "npc_123",
      "hit": true,
      "damageApplied": 14,
      "healthLostPercent": 14,
      "remainingHealthPercent": 62,
      "position": "center",
      "secondaryEffectApplied": false,
      "secondaryEffect": "Concussed",
      "appliedStatusEffects": [],
      "attackSummary": {}
    }
  ]
}
```

`secondaryEffect` means "possible effect" unless `secondaryEffectApplied` is true. The current area-tool path sets `secondaryEffectApplied` to false for its own suggested secondary effect.

## Chat/UI Presentation

`resolveAreaAttack` creates one grouped `check-results` entry with `kind: "area-attack"`. Collapsed summaries use the area effect as one event:

- `💥 Exis hit 3 targets with Concussion Grenade`
- `💨 Exis caught no targets with Concussion Grenade`
- `💥 Exis hit 2/4 targets with Concussion Grenade`

Expanded details list each target's hit/miss, damage, remaining health, position, and possible secondary effect. When per-target `attackSummary` data is present, the expanded details reuse the same attack-breakdown renderer used by single-target attacks.

## Caching And Idempotency

Area attack tool results are cached for the current prose prompt round. The cache key includes:

- prompt round id
- attacker
- sorted target names
- weapon
- ability
- area shape
- effect description
- roll mode
- attack skill

Repeated calls with the same cache key return the original result without re-rolling or re-applying damage. Sorting target names prevents harmless target-order changes from applying the same blast twice. Cached tool content includes the same warning pattern used by other check tools, telling the prose model not to re-run checks from earlier drafts.

## Event Check Relationship

The XML `attackDamage` event remains single-target and does not directly apply health damage. Area-attack health mutation should come from `resolveAreaAttack`, not from a later event check that notices the prose. The event checker can still track/summarize attacks, reveal hidden attackers where relevant, and handle other narrative consequences.

There is no `areaAttackDamage` XML event in the current schema. If one is added later, it should be informational or carefully coordinated with tool metadata so it does not duplicate already-applied damage.

## Rationale Preserved From The Original Plan

Allowing a target list on `resolveAttack` would blur two different mechanics:

- A batch of ordinary attacks, such as three separate shots at three targets.
- One shared area effect, such as one grenade blast affecting everyone near the center.

Those should not always share dice behavior. An area effect commonly has one placement/attack quality and then per-target defenses, cover, distance, toughness, and damage effectiveness. A separate tool makes that distinction explicit and keeps the single-target tool easier for the prose model to use correctly.

The design also stays setting-agnostic. It can represent grenades, spells, breath weapons, psychic blasts, flamethrowers, falling rubble, and sci-fi weapons without adding setting-specific combat concepts to the schema.

## Deferred Ideas

These are proposals only, not current behavior:

1. Add direct secondary status application after the schema can carry status duration, level/intensity, source, and validation details.
2. Make position scaling configurable if combat tuning needs to vary by setting or difficulty.
3. Accept stable target IDs in addition to names, while preserving name-based calls for prose readability.
4. Add an explicit friendly-fire policy flag if the game needs warnings or rejections when allies appear in the target list.
5. Add an informational `areaAttackDamage` XML event only if event summaries need a schema-level area attack record separate from tool metadata.
