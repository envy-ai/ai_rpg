# Configuration

This document covers config options that change game behavior beyond model/runtime settings.

## Character creation point pools

`config.formulas.character_creation` controls the formulas used to calculate the base point pools for the New Game attribute and skill allocators.

```yaml
formulas:
  character_creation:
    attribute_pool_formula: "level * (number_of_attributes / 2)"
    skill_pool_formula: "level * ceil(number_of_skills / 5)"
    max_attribute: "infinity"
    max_skill: "infinity"
```

### Variables

- `level`
- `number_of_attributes`
- `number_of_skills`
- `attribute.<name>.value` (ex: `attribute.intelligence.value`)
- `attribute.<name>.bonus` (ex: `attribute.intelligence.bonus`)
- `attribute_modified.<name>.value` (ex: `attribute_modified.intelligence.value`)
- `attribute_modified.<name>.bonus` (ex: `attribute_modified.intelligence.bonus`)
- `skill.<name>` (ex: `skill.lockpicking`)
- `infinity` (constant = 1e100)

Attribute/skill names are normalized to lowercase with non-alphanumeric characters replaced by underscores (for example, `Two-Handed Weapons` becomes `skill.two_handed_weapons`).
`attribute.*` always reflects base values; `attribute_modified.*` reflects modified values (if supplied).

### Functions

- `abs`, `round`, `floor`, `ceil`
- `min`, `max`, `clamp(value, min, max)`

### Notes

- The formulas compute the **base** pool. Existing spend/refund logic still applies:
  - Attributes: lowering a stat below 10 refunds points; raising above 10 spends points.
  - Skills: ranks above 1 spend points.
- `max_attribute` and `max_skill` are evaluated as caps for New Game allocation inputs.
- When the Player Stats page loads without a player, the skill formula is used to set the default unspent points.
- Invalid formulas throw errors and block the allocator until corrected.
