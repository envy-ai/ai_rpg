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

## AI custom args

`config.ai.custom_args` lets you inject structured top-level request arguments into every LLM chat-completion payload.

```yaml
ai:
  custom_args:
    thinking:
      type: disabled
```

Rules:
- `custom_args` must be an object when present.
- Keys are merged into the request payload before the standard core fields are applied.
- Reserved top-level payload keys are rejected in `custom_args`: `messages`, `model`, `seed`, `stream`, `max_tokens`, `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`.

### Override behavior (`ai_model_overrides`)

`ai_model_overrides.<profile>.custom_args` is merged per argument key (deep object merge), rather than replacing the entire `custom_args` object.

```yaml
ai_model_overrides:
  dialogue_generation:
    prompts: [player_action]
    custom_args:
      thinking:
        type: disabled
```

Merge semantics:
- Object values merge recursively by key.
- Non-object values replace previous values.
- Arrays replace previous arrays.
- `null` deletes the targeted key from the inherited `custom_args` tree.

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

## Offscreen NPC activity prompt count

`offscreen_npc_activity_prompt_count` controls the twice-daily hidden "what are they doing right now" NPC activity prompt size.

```yaml
offscreen_npc_activity_prompt_count: 5
```

- Runs when world time crosses `07:00` and `19:00`.
- The configured value controls how many non-present NPCs the twice-daily prompt requests.
- `0` disables the twice-daily prompt.
- Weekly offscreen NPC activity still runs independently (fixed at 15 NPCs).
- If elapsed time crosses multiple scheduled offscreen prompt checkpoints in one turn, only one offscreen prompt is run for that turn.

## Offscreen NPC activity max turns between prompts

These caps force an offscreen NPC activity run if too many turns pass without that cadence firing.

```yaml
offscreen_npc_activity_daily_max_turns_between_prompts: 20
offscreen_npc_activity_weekly_max_turns_between_prompts: 100
```

- `offscreen_npc_activity_daily_max_turns_between_prompts`:
  - Applies to the twice-daily cadence.
  - When the daily prompt is enabled (`offscreen_npc_activity_prompt_count > 0`), reaching this many turns since the last daily run forces one daily run.
- `offscreen_npc_activity_weekly_max_turns_between_prompts`:
  - Applies to the weekly cadence.
  - Reaching this many turns since the last weekly run forces one weekly run.
- `0` disables turn-cap forcing for that cadence.
- Values must be integers `>= 0`; invalid values raise runtime errors when scheduling.
- Single-run-per-turn still applies: if multiple offscreen prompts are due in one turn (time-based and/or turn-cap based), only one is run.

## World time

`time` controls the canonical world clock configuration. Internally, the server tracks world time in decimal hours (`worldTime.timeHours`), while config inputs are minute-based.

```yaml
time:
  cycleLengthMinutes: 1440
  tickMinutes: 15
  segmentBoundaries:
    dawn: 360
    day: 480
    dusk: 1080
    night: 1200
```

- `cycleLengthMinutes`: total minutes in a full day cycle.
- `tickMinutes`: baseline tick value for systems that need default advancement.
- `segmentBoundaries`: map of `segmentName -> startMinute` within the cycle.
- Segment boundaries must be within `[0, cycleLengthMinutes)`.

## Slop remover base attempts

`slop_remover_base_attempts` controls the starting number of rewrite attempts for the slop-remover pass.

```yaml
slop_remover_base_attempts: 2
```

- Must be an integer `>= 1`.
- This is the base attempt count before parse-failure extensions.
- Parse failures can still increase the effective cap up to 5 attempts.

## Random event frequency and custom types

`random_event_frequency` controls random-event roll chances and supports extensible file-based event types.

```yaml
random_event_frequency:
  enabled: true
  common: 0.05
  rare: 0.01
  party: 0.2
  regionSpecific: 0.06
  locationSpecific: 0.06
```

- `enabled: false` disables random event rolls.
- `locationSpecific` and `regionSpecific` continue to use location/region seed pools (not text files).
- Any other key under `random_event_frequency` is treated as a file-based random event type (excluding control/seed keys: `enabled`, `location`, `region`, `locationSpecific`, `regionSpecific`).
- File-based random event types load from `random_events/<type>.txt` (for example `party` -> `random_events/party.txt`).
- `common` and `rare` remain built-in file-based types and load from `random_events/common.txt` and `random_events/rare.txt`.
- Chance values:
  - `<= 1` are treated as decimal probabilities and converted to percentages.
  - `> 1` are treated as percent values directly.
  - `<= 0` disables that specific type for normal random rolls.

`random_event_frequency_multiplier` scales roll frequency globally and must be a positive number.

## History windows (`recent_history_turns` vs `client_message_history`)

`recent_history_turns` and `client_message_history` control different history windows:

- `recent_history_turns` affects only base-context prompt assembly (`<recentStoryHistory>` vs `<olderStoryHistory>`).
- `client_message_history` affects only what the web client receives/renders via `/api/chat/history` and initial page load history.

```yaml
recent_history_turns: 10
client_message_history:
  max_messages: 50
  prune_to: 40
```

`client_message_history.max_messages` is interpreted as a **turn cap** (anchored on user entries; assistant prose anchors are used only as fallback when user entries are unavailable). This does not change `recent_history_turns`.

`client_message_history.prune_to` remains a validated config value (`<= max_messages`) for prune-mode flows, but the standard chat-history responses now use `max_messages` turn-capped output so client-visible history length no longer tracks `recent_history_turns`.

## Plot expander cadence

`plot_expander_prompt_frequency` controls automatic hidden `plot-expander` prompt cadence on eligible player-action turns.

```yaml
plot_expander_prompt_frequency: 10
```

- Default is `10` when omitted.
- `0` disables automatic runs.
- Value must be an integer `>= 0`; invalid values raise runtime errors when scheduling.
- Runs use the base-context `plot-expander` include and store hidden `plot-expander` entries.
- The latest `plot-expander` output is injected into base-context as `<plotExpander>` immediately after `<plotSummary>`.
