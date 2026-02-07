# Configuration

This document covers config options that change game behavior beyond model/runtime settings.

## CLI config override file

You can layer an additional YAML file on top of `config.default.yaml` and `config.yaml` at startup:

```bash
node server.js --config-override ./tmp/local.override.yaml
```

You can also use:

```bash
node server.js --config-override=./tmp/local.override.yaml
```

Merge precedence is:

1. `config.default.yaml`
2. `config.yaml`
3. `--config-override` file

The override file must exist and contain a YAML object. Invalid or missing files fail startup with a clear error.
If the server is started with `--config-override`, `reload_config` keeps using the same override file.

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

## Supplemental story info prompt frequency

`supplemental_story_info_prompt_frequency` controls when hidden supplemental story-info prompts run after a player turn.

```yaml
supplemental_story_info_prompt_frequency: 5
```

- `0`: never run supplemental story info prompts.
- `>0`: run every `X` turns (`X` = configured value), and also run on any turn where one or more new NPCs or things (items/scenery) were generated.
- Value must be an integer `>= 0`; invalid values raise a runtime error when scheduling the prompt.
