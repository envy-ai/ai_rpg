# TinyBrainPromptFamilies

`TinyBrainPromptFamilies.js` is the allowlisted router for staged prompt programs. `base-context.xml.njk` accepts only the template path supplied by this module; prompt call sites select a stable family key rather than constructing an include path.

`isTinyBrainPromptEnabled(configOrAiConfig, family)` accepts either a standalone AI configuration or the complete runtime configuration. Runtime callers pass the complete configuration so the router first resolves the family metadata label through `ai_model_overrides`, then requires the effective `ai.tinybrain` switch and reads the effective optional `ai.tinybrain_prompts.<family>` setting. This lets a Kimi or other prose profile set `tinybrain: false` while an Artemis base profile keeps staged event and maintenance prompts. A known family defaults to enabled when its setting is omitted. Unknown family keys throw in runtime routing and are rejected during configuration validation.

`configureTinyBrainPromptContext(context, family)` creates the render state, adds the private program-start marker state, and assigns the allowlisted template. `runTinyBrainPromptProgram(...)` verifies that the family and template still match, constructs `TinyBrainPromptRunner`, and runs the full staged conversation under the runner's single queue reservation and progress group.

Built-in XML checkpoint functions expose shared expected-root output contracts.
Custom family parsers declare `runnerOptions.parserOutputContracts`; final-model
closures declare `finalOutputContract` (or use the shared narrative adapter's
existing request-root contract). These declarations scope live XML checks and
final no-native-tool policy checks to the intended root independently of generic
whole-document validation. Prose/scalar checkpoints remain plain. Family routing
does not guess XML roots or enable live guarding for providers that opted out.

Runner options may register local `resultBuilders` for an allowlisted call site. Result builders are used across the supported prose families to assemble terminal XML from already-approved prose, authoritative mechanics, parsed checkpoint values, and completed tool outcomes. Builder-bound draft and revision checkpoints are parsed as prose-only values before assembly, so an accidental full XML response retries at that checkpoint instead of corrupting the locally assembled result. This avoids asking the model to repeat an exact result that the program already knows. Result-builder names are not globally discoverable and cannot be invoked by a family whose call site did not register them.

When both `event_checks` and `need_bar_event_checks` are enabled through their effective family configurations, XML event extraction appends the existing need-bar planning and characters stages inside the event program. Suppression or absent definitions skips them; mixed-family and standalone need bars retain their original programs. The appended completions keep `need_bar_event_checks` metadata for model overrides while sharing one event transcript/base context, queue reservation, progress group and log. Native empty-tool and XML repetition scopes remain specific to each family. A narrowly scoped [failure-owner alias](PromptFailureReporter.md) keeps terminal reporting under the combined event owner. The characters checkpoint validates and converts entries before local event-result assembly; no repeated event response or new combined XML envelope is requested. See [Events](Events.md).

The `player_action` program asks for a possible pre-draft destination name at a no-tools checkpoint and has server code inject short/full descriptions, visible present NPCs, and exits only for a unique existing match; that advisory context does not replace the later mechanical movement decision. When this checkpoint selected a destination, the later movement question repeats it and permits `NONE` only if revision removed the travel entirely, including when final prose uses a landmark or shelter instead of the canonical name. It accepts exact names or aliases only for non-party accompanying characters and keeps those whose movement is explicit or reasonably established by the draft; an empty eligible non-party list skips that question and resolves locally. Living party members travel automatically through the shared movement executor and never need model selection. Deterministic unchanged vehicle decisions also resolve locally. `Player.currentVehicle.vehicleKind` keeps true location-to-location movement inside a region vehicle distinct from movement among narrated areas of one location vehicle. The latter emits scoped prose without a player destination, duration, or companion selection, so it cannot create an unrelated world location or lose the active vehicle route. The temporary inventory-freeze and attack micro-policy prose restrictions are not part of the program. The `random_event` program treats its seed as story input whose concrete outcome remains the model's judgment. The `scene_summarize` program is selected inside the dedicated scene-summary wrapper rather than base context; it verifies boundaries before requesting each completed scene and finishes through a local builder. The `scheduled_event_resolution` applicability checkpoint treats its location-override base context as authoritative and uses player presence only to control visible prose. Its planning checkpoint may use read-only lookup tools before committing a parser-validated call plan; it does not copy the raw event text, derived change status, duplicate target references, or unused call-purpose prose into that plan. Mutations remain deferred until the plan is accepted. Duplicate identical operations collapse safely, conflicting operations fail, and the server executes all accepted calls locally without asking the model to emit them again. These are structured contracts and prompt steering rather than heuristic prose policing.

Production call sites select native execution definitions before the first
checkpoint: player actions and NPC narration permit information lookups; creative
actions permit enabled prose tools; scheduled-event resolution permits
non-mutating planning tools. Other families permit no native calls. Each checkpoint exposes only its actual executable definitions; disabled
checkpoints expose none. The mutating-prompts-only gate disables lookup-only
native scopes while retaining server-owned structured plan execution.
The shared API narrative helper defaults its execution definitions to `[]`;
Events and scene-summary runners explicitly pass `[]`. Non-base-context programs
retain their own schemas. See [ChatToolPolicy](ChatToolPolicy.md). Server-executed
XML plans retain separate resolver contracts. Scheduled-event planning omits
player-input requests when disabled or lacking an input handler.

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
- `location_things_generation`
- `location_npc_generation`
- `starting_techniques`
- `status_effect_repair`
- `faction_housekeeping`
- `player_action_open_container`
- `scene_summarize`
- `while_you_were_away`
- `scheduled_event_resolution`
- `scheduled_event_interruption_rewrite`

When the master switch or a family switch is false, that call site uses its existing one-shot prompt. Once a staged family is selected, parser exhaustion is surfaced; it does not silently rerun the legacy one-shot prompt.

`status_effect_repair` runs the explicit
[`/repair_status_effects`](../slashcommands/RepairStatusEffectsCommand.md)
maintenance request through one base-context conversation and queue reservation,
with one locally validated effect per checkpoint. Standard mode uses batches of
at most ten. The program supplies owner context once, binds target identities
on the server, exposes no native tools, and stages all accepted results before
the canonical owner records are changed.

`location_things_generation` first validates a compact XML roster against the existing minimum count and per-kind rarity requirements, then expands exactly its approved names/kinds/rarities into full Thing XML. Final strict XML and whole-Thing validation run inside the final stage, so corrections preserve the approved roster. Both stages expose no native tools and share the runner's log, reservation and progress. See [LocationThingGenerationPlan](LocationThingGenerationPlan.md).

`location_npc_generation` validates a compact XML NPC roster, then expands one remaining NPC profile per checkpoint with stage-specific named schemas and local final assembly. Name, kind, quantity and brief durable description are bound from the roster, while existing native construction checks run before registration. It uses the original location-generation prompt once as the fixed prefix. See [LocationNpcGenerationProgram](LocationNpcGenerationProgram.md).

`starting_techniques` validates a compact XML roster grouped by existing or newly defined parent discipline, then expands one approved child technique per checkpoint without repeating parent metadata. Repeated parent blocks append children under the first canonical metadata. Each entry undergoes cumulative actor-aware batch preparation, with detached discipline identities and no partial commits. A local result builder completes the run without a final model request. Standard mode retains full-batch generation. See [StartingTechniques](StartingTechniques.md).

`faction_housekeeping` uses nine private qualitative worksheet checkpoints and one compact final synthesis. The service's local parsers validate XML and faction references; the final builder returns only accepted synthesis XML. Full faction authoring and atomic state installation happen afterward, with no native tools. See [FactionHousekeepingService](FactionHousekeepingService.md).

`while_you_were_away` selects additional existing reunion NPC names before expanding each selected arrival separately. The API supplies a broad existing living-NPC roster excluding player, party, and already-listed characters; recorded locations remain context rather than a restriction on eligible names. The model judges actual presence at the exact current location, excluding merely nearby characters. An empty roster skips selection, and an empty selection skips expansions. Each expansion has a self-contained canonical `<characterUpdate>` example with literal `HERE`, shared with standard prompt examples. Typed parsers correct the affected name/update checkpoint locally; final assembly verifies names/counts without another model call. See [TinyBrainResultBuilders](TinyBrainResultBuilders.md).
