# TinyBrainPromptFamilies

`TinyBrainPromptFamilies.js` is the allowlisted router for staged prompt programs. `base-context.xml.njk` accepts only the template path supplied by this module; prompt call sites select a stable family key rather than constructing an include path.

`isTinyBrainPromptEnabled(aiConfig, family)` requires the master `ai.tinybrain` switch and then reads the optional `ai.tinybrain_prompts.<family>` override. A known family defaults to enabled when its override is omitted. Unknown family keys throw in runtime routing and are rejected during configuration validation.

`configureTinyBrainPromptContext(context, family)` creates the render state, adds the private program-start marker state, and assigns the allowlisted template. `runTinyBrainPromptProgram(...)` verifies that the family and template still match, constructs `TinyBrainPromptRunner`, and runs the full staged conversation under the runner's single queue reservation and progress group.

Runner options may register local `resultBuilders` for an allowlisted call site. Result builders are used across the supported prose families to assemble terminal XML from already-approved prose, authoritative mechanics, parsed checkpoint values, and completed tool outcomes. Builder-bound draft and revision checkpoints are parsed as prose-only values before assembly, so an accidental full XML response retries at that checkpoint instead of corrupting the locally assembled result. This avoids asking the model to repeat an exact result that the program already knows. Result-builder names are not globally discoverable and cannot be invoked by a family whose call site did not register them.

The `player_action` program accepts exact names or aliases for accompanying characters and keeps characters whose movement is explicit or reasonably established by the draft; an empty eligible-character list skips that question and resolves locally. Deterministic unchanged vehicle decisions also resolve locally. `Player.currentVehicle.vehicleKind` keeps true location-to-location movement inside a region vehicle distinct from movement among narrated areas of one location vehicle. The latter emits scoped prose without a player destination, duration, or companion selection, so it cannot create an unrelated world location or lose the active vehicle route. The temporary inventory-freeze and attack micro-policy prose restrictions are not part of the program. The `random_event` program treats its seed as story input whose concrete outcome remains the model's judgment. The `scheduled_event_resolution` applicability checkpoint treats its location-override base context as authoritative and uses player presence only to control visible prose. Its planning checkpoint may use read-only lookup tools before committing a parser-validated mutation plan; it does not copy the raw event text into the plan. Mutations remain deferred until the plan is accepted, duplicate identical operations collapse safely, conflicting operations fail, and deterministic or fully completed execution paths terminate locally. These are structured contracts and prompt steering rather than heuristic prose policing.

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
