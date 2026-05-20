# Area Attack Tool Plan

## Summary

Add a first-class `resolveAreaAttack` chat tool for attacks that affect multiple targets at once: grenades, blasts, cones, sweeping magic, automatic fire, shockwaves, traps, gas clouds, vehicle impacts, and similar effects.

The existing `resolveAttack` tool should remain the single-target path. `resolveAreaAttack` should not be a loose batch wrapper around `resolveAttack`; it should model one area effect with a shared source, target list, and per-target outcomes. This keeps ordinary attacks simple while giving the LLM a clear tool for cases where one action can harm or impair several actors.

## Goals

- Let the LLM resolve one area attack against several targets with one tool call.
- Apply damage/status outcomes to each resolved target in one validated operation.
- Return structured per-target results that the LLM can narrate accurately.
- Record one grouped check-results entry or grouped attack summary instead of several unrelated single-target summaries.
- Preserve existing single-target `resolveAttack` behavior.
- Keep the tool setting-agnostic: grenades, spells, breath weapons, psychic blasts, flamethrowers, falling rubble, and sci-fi weapons should all fit.

## Non-Goals For V1

- Do not build a full tactical map or precise blast-radius geometry.
- Do not require exact distances.
- Do not model shrapnel trajectories, facing, or friendly-fire physics in detail.
- Do not replace `environmental_status_damage`; ongoing hazards can still use that event path.
- Do not let the LLM apply raw damage directly without server validation.

## Why Not Just Allow A Target List In `resolveAttack`?

Passing a list to `resolveAttack` is workable, but it blurs two different mechanics:

- A batch of ordinary attacks, such as three shots at three targets.
- One shared area effect, such as one grenade blast affecting everyone near the center.

Those should not always share the same dice behavior. AOE often has one placement/attack quality and then per-target defenses, cover, distance, toughness, and damage effectiveness. A separate tool makes that distinction explicit and keeps the single-target tool easier for the LLM to use correctly.

## Proposed Tool

```json
{
  "name": "resolveAreaAttack",
  "description": "Resolve one attack or effect that can affect multiple defenders, apply per-target damage and status results, and return structured outcomes for each target.",
  "parameters": {
    "attacker": "Exact attacker name or player",
    "targets": [
      {
        "name": "Exact defender name",
        "position": "center|near|edge|behind cover|uncertain",
        "defenseInfo": {
          "evadeSkill": "N/A or exact skill",
          "deflectSkill": "N/A or exact skill",
          "toughnessAttribute": "N/A or exact attribute"
        },
        "circumstanceModifiers": [
          {
            "amount": 0,
            "reason": "Brief target-specific modifier reason"
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
    "weapon": "N/A, barehanded, or exact weapon/item name",
    "areaShape": "blast|cone|line|cloud|burst|sweep|other",
    "effectDescription": "Short description of the area effect",
    "rollMode": "sharedAttackRoll",
    "circumstanceModifiers": [
      {
        "amount": 0,
        "reason": "Brief attacker/effect modifier reason"
      }
    ],
    "secondaryEffect": {
      "name": "N/A or status effect name",
      "description": "Observed effect if applicable",
      "appliesOn": "hit|damage|anyEffect|never"
    }
  }
}
```

For v1, `rollMode` can be required to be `sharedAttackRoll`. This avoids prematurely designing every burst-fire or multi-shot edge case while still allowing the common grenade/blast use case.

## Resolution Model

1. Resolve and validate the attacker.
2. Resolve every target before applying anything.
3. Reject the whole tool call if any target is ambiguous or missing.
4. Roll one shared attack/placement result.
5. For each target:
   - Build a target-specific defense difficulty from the target's level, defense skill, position, and modifiers.
   - Apply the shared attack total against that target difficulty.
   - Calculate damage using the existing weapon/attribute/toughness/effectiveness machinery where possible.
   - Apply position scaling.
   - Apply health damage if the result is damaging.
   - Optionally apply a secondary status effect when the returned condition matches `appliesOn`.
6. Return one structured result object with all per-target outcomes.

This should be all-or-nothing at validation time, but not all-or-nothing mechanically. Once every referenced actor is valid, each target can hit, miss, resist, take partial damage, or receive a secondary effect independently.

## Position And Damage Scaling

V1 can use a simple symbolic position model:

| Position       | Suggested Meaning                           |
| -------------- | ------------------------------------------- |
| `center`       | Target is at or near the main impact point. |
| `near`         | Target is in the main affected group.       |
| `edge`         | Target is barely caught by the effect.      |
| `behind cover` | Target is in the area but shielded.         |

The server can translate this into per-target modifiers and/or damage scaling. The exact numbers should be conservative and configurable later if needed. Initial behavior could be:

- `center`: no defensive bonus, full damage.
- `near`: small defensive bonus, full damage.
- `edge`: defensive bonus, reduced damage.
- `behind cover`: stronger defensive bonus, reduced damage.

Avoid adding hard-coded numeric tuning until implementation, but the tool shape should preserve enough information for it.

## Return Shape

The LLM-facing tool content should stay concise, similar to `resolveAttack`, but the metadata should be fully structured for UI and event summaries.

Example LLM-facing content:

```text
Area attack results:
- Commander Razorclaw: hit, Damage: 14%, Remaining health: 62%, effect: Concussed
- Goblin Sapper 1: hit, Damage: 18%, Remaining health: 41%, effect: Disoriented
- Goblin Sapper 2: miss, no damage
Do not re-run tool calls for these same checks in later drafts.
```

Structured metadata:

```json
{
  "kind": "area-attack",
  "attacker": "Exis",
  "weapon": "Concussion Grenade",
  "ability": "N/A",
  "areaShape": "blast",
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
      "hit": true,
      "damageApplied": 14,
      "remainingHealthPercent": 62,
      "position": "center",
      "secondaryEffectApplied": true,
      "secondaryEffect": "Concussed"
    }
  ]
}
```

## Chat/UI Presentation

`check-results` should display this as one grouped area-attack box:

- Collapsed summary: `💥 Exis hit 3 targets with Concussion Grenade`
- Miss-only summary: `💨 Exis caught no targets with Concussion Grenade`
- Mixed summary: `💥 Exis hit 2/4 targets with Concussion Grenade`
- Expanded details: one row per target, including hit/miss, damage, remaining health, and applied secondary effect.

The event-summary drawer should avoid duplicating all of this as separate ungrouped attack rows if the area attack tool already recorded the mechanical results.

## Event Check Integration

The existing `attackDamage` XML tag can remain single-target for now. The event checker sees prose after the tool call and may still report attacks, but the actual health mutation should come from `resolveAreaAttack`, not from `attackDamage`.

Potential follow-up event schema additions:

```xml
<areaAttackDamage>
  <attackerName>Exact attacker name</attackerName>
  <targetName>Exact target name</targetName>
  <areaEffectName>Grenade blast, cone of fire, etc.</areaEffectName>
</areaAttackDamage>
```

This is optional for v1. The first version can rely on the tool metadata and existing status/death/incapacitation event checks.

## Caching

Area attack caching should follow the existing attack-tool pattern:

- Cache key should include prompt round id, attacker, weapon, ability, area shape, effect description, roll mode, and the sorted target names.
- A repeated call with the same key returns the original results and does not re-roll or re-apply damage/status effects.
- The cached tool content should include the existing warning telling the LLM not to rerun checks from earlier drafts.

The sorted target-name piece prevents harmless list ordering differences from reapplying damage.

## Error Handling

Prefer explicit tool errors before any mutation:

- Missing attacker: return a tool error.
- Missing target: return a tool error listing the unresolved target.
- Ambiguous target: return candidates and ask the LLM to retry by exact name or ID if that becomes supported.
- Empty target list: return a tool error.
- Duplicate target names: dedupe exact duplicates or reject. V1 should reject unless there is a clear reason to dedupe.
- Hit with no finite damage: return a tool error before applying that target's result.

No damage or status effects should be applied until every target has resolved and the attack result can be computed.

## Implementation Sketch

1. Add `resolveAreaAttack` to the regular player/NPC prose tool list.
2. Add argument parsing and validation in `chat_tool_calls.js`.
3. Reuse the existing attack resolver internals in `api.js` by extracting shared helpers from `resolveAttackToolCall`.
4. Add a new resolver that validates all targets, computes one shared attack roll, loops target outcome calculation, then applies damage/status.
5. Add grouped `check-results` rendering for `kind: "area-attack"`.
6. Extend tool-call caching to use an area-attack cache key and prevent repeated damage application.
7. Document the tool in `docs/api/chat.md`, `docs/api/common.md`, and `docs/server_llm_notes.md`.
8. Add tests for all-hit, mixed hit/miss, duplicate target rejection, missing target rejection, cache replay without reapplying damage, and grouped check-result shape.

## Open Questions

1. Should v1 support secondary status effects directly, or should the LLM narrate them and let event checks create `statusEffectChange` entries?
2. Should position scaling be hard-coded initially, or should it only influence suggested modifiers until there is more combat tuning?
3. Should the tool accept target IDs now, or stay name-only to match `resolveAttack`?
4. Should friendly fire be allowed by default if allies are included in the target list, or should the tool warn/reject unless an explicit `allowFriendlyFire` flag is true?

## Recommended V1

Implement `resolveAreaAttack` with:

- `sharedAttackRoll` only.
- Name-based target resolution matching `resolveAttack`.
- Required explicit target list.
- Per-target `position`, modifiers, and damage effectiveness.
- Grouped check-results UI.
- Cached replay protection.
- No direct XML event-schema changes yet.

For secondary effects, start conservatively: return suggested/applied effect text in metadata only if the implementation can create real status effects through existing status-effect helpers. If that is too invasive, defer direct status application and rely on event checks for `statusEffectChange`.
