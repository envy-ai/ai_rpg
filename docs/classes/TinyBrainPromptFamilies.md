# TinyBrainPromptFamilies

`TinyBrainPromptFamilies.js` is the allowlisted router for staged prompt programs. `base-context.xml.njk` accepts only the template path supplied by this module; prompt call sites select a stable family key rather than constructing an include path.

`isTinyBrainPromptEnabled(aiConfig, family)` requires the master `ai.tinybrain` switch and then reads the optional `ai.tinybrain_prompts.<family>` override. A known family defaults to enabled when its override is omitted. Unknown family keys throw in runtime routing and are rejected during configuration validation.

`configureTinyBrainPromptContext(context, family)` creates the render state, adds the private program-start marker state, and assigns the allowlisted template. `runTinyBrainPromptProgram(...)` verifies that the family and template still match, constructs `TinyBrainPromptRunner`, and runs the full staged conversation under the runner's single queue reservation and progress group.

Runner options may register local `resultBuilders` for an allowlisted call site. The `player_action` route alone registers `player_action_result`; its prompt terminates through `llmresult` after parsed non-XML fields, including an exact-name-or-alias accompanying-character selection for player movement, and the builder emits the canonical XML consumed by the existing route. Companion selection distinguishes a request or invitation from movement actually established by the draft, while retaining eligible deliberate travelers named through aliases. Player-action drafting also preserves authoritative carried/equipped inventory unless the player action or a mechanical tool result commits an ownership change; ordinary travel flavor must not invent a drop or transfer. `Player.currentVehicle.vehicleKind` keeps true location-to-location movement inside a region vehicle distinct from movement among narrated areas of one location vehicle. The latter emits scoped prose without a player destination, duration, or companion selection, so it cannot create an unrelated world location or lose the active vehicle route. For an underway vehicle, the staged decision prompt reports the mechanical outcome established by the second draft: a halt is `STOP`, a committed new route is `REDIRECT`, and objections, delays, conditional offers, or unresolved requests remain `UNCHANGED`. Result-builder names are not globally discoverable and cannot be invoked by a family whose call site did not register them.

Supported family keys are:

- `player_action`
- `event_checks`
- `need_bar_event_checks`
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
