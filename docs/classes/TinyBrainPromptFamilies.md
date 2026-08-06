# TinyBrainPromptFamilies

`TinyBrainPromptFamilies.js` is the allowlisted router for staged prompt programs. `base-context.xml.njk` accepts only the template path supplied by this module; prompt call sites select a stable family key rather than constructing an include path.

`isTinyBrainPromptEnabled(aiConfig, family)` requires the master `ai.tinybrain` switch and then reads the optional `ai.tinybrain_prompts.<family>` override. A known family defaults to enabled when its override is omitted. Unknown family keys throw in runtime routing and are rejected during configuration validation.

`configureTinyBrainPromptContext(context, family)` creates the render state, adds the private program-start marker state, and assigns the allowlisted template. `runTinyBrainPromptProgram(...)` verifies that the family and template still match, constructs `TinyBrainPromptRunner`, and runs the full staged conversation under the runner's single queue reservation and progress group.

Supported family keys are:

- `player_action`
- `event_checks`
- `quest_reward_prose`
- `game_intro`
- `random_event`
- `creative_mode_action`
- `npc_action`
- `craft_player_action`
- `location_modify_player_action`
- `player_action_open_container`
- `while_you_were_away`
- `scheduled_event_resolution`
- `scheduled_event_interruption_rewrite`

When the master switch or a family switch is false, that call site uses its existing one-shot prompt. Once a staged family is selected, parser exhaustion is surfaced; it does not silently rerun the legacy one-shot prompt.
