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

## Per-game YAML override

The `/config` page also exposes a per-game YAML override textarea for the currently loaded save.

Merge precedence becomes:

1. `config.default.yaml`
2. `config.yaml`
3. `--config-override` file
4. current game's YAML override

Rules:
- The per-game override must contain a YAML object when non-blank.
- Blank input clears the per-game override for the loaded game.
- Editing the field triggers the same runtime reload path used by `/reload_config`.
- The raw YAML is saved as `gameConfigOverride.yaml` inside the save and is reapplied before save hydration on `/api/load`.
- Starting a brand-new game clears any previous loaded-save override before world generation begins.
- Like `/reload_config`, mod enable/disable changes are validated immediately but still require a restart to fully change the active mod set.

## Mod enablement

You can enable or disable discovered mods from the merged YAML config:

```yaml
mods:
  need-bar-hydration:
    enabled: false
  sceneIllustration:
    additional_instructions: "..."
```

Rules:
- `mods` must be an object when present.
- Each `mods.<name>` entry must be an object when present.
- `mods.<name>.enabled` must be a boolean when present.
- Missing `enabled` defaults to `true`.
- This merged-config value takes precedence over `mods/<name>/config.json` `enabled`.
- Disabled mods are skipped for `mod.js` loading, defs overlays, and `public/` asset serving.
- The active mod set is frozen at startup, so changing mod enablement on disk still requires a server restart to apply. `/reload_config` reports drift but does not hot-toggle mods.

## Event Checks

`event_checks.enabled` controls whether narrative event processing runs at all. When it is `false`, prose does not mutate world state through event checks and quest completion checks are skipped.

```yaml
event_checks:
  enabled: true
  use_xml: true
```

`event_checks.use_xml` defaults to `true` and must be a boolean when provided. When enabled, `Events.runEventChecks(...)` uses the `events-xml` prompt for ordinary event categories and parses one `<events>` block. Need bars still use the dedicated `need-bars` prompt when need-bar definitions are present, and those results are injected as ordinary `needbar_change` events before outcomes are applied. Set `event_checks.use_xml` to `false` to use the legacy grouped `event-checks` prompts plus the same dedicated `need-bars` prompt. The `/config` page exposes the same option as “XML Event Pipeline”.

## AI backend selection

`config.ai.backend` selects which text-generation transport the game uses.

```yaml
ai:
  backend: openai_compatible
```

Supported values:
- `openai_compatible`: the existing `/chat/completions` HTTP path using `ai.endpoint`, `ai.apiKey`, and `ai.model`.
- `codex_cli_bridge`: runs text requests through the local Codex CLI bridge; this backend uses `ai.model` plus `ai.codex_bridge.*` and does not require `ai.endpoint` or `ai.apiKey`.

Validation rules:
- `backend` defaults to `openai_compatible` when omitted.
- Unknown backend values fail validation loudly at startup and on reload.

## OAuth Refresh-Token Auth

For the `openai_compatible` backend, `ai.oauth-key` can be used instead of `ai.apiKey` for providers that expose a standard refresh-token endpoint:

```yaml
ai:
  endpoint: https://provider.example/v1
  model: provider-model-name
  oauth-url: https://provider.example/oauth/token
  oauth-key: "<refresh token>"
  # Optional, included as client_id when set:
  oauth-client-id: "<client id>"
```

The value of `oauth-key` is treated as an OAuth refresh token. `LLMClient` posts it to the exact `oauth-url`, sends the returned short-lived access token as `Authorization: Bearer ...`, and stores rotated credentials in the ignored local cache under `tmp/oauth/` rather than rewriting `config.yaml`. If the provider rejects a chat request with 401, `LLMClient` invalidates the cached access token, refreshes once, and retries the request.

These fields also work in `ai_model_overrides` profiles, so only selected prompt labels can use an OAuth-backed provider. Request headers from `ai.headers` or the matching override profile are reused for OAuth refresh requests, excluding `Authorization`, `Content-Type`, and `Content-Length`. For chat requests, OAuth-backed configs always use the refreshed access token as the `Authorization` header.

## AI request timeout

`ai.baseTimeoutSeconds` is the shared base request timeout for non-Codex text-generation calls. `LLMClient` converts this value to milliseconds before dispatching a request.

For `codex_cli_bridge`, `ai.codex_bridge.idle_timeout_ms` is used instead. This is an idle timeout, not a fixed total deadline: the bridge starts the timer when the Codex app-server process starts, resets it whenever stdout data streams in from Codex, and terminates the request if no streamed data arrives before the timer expires. The default is `30000`, giving Codex prompts a 30-second no-data timeout that is not multiplied by prompt `timeoutScale`.

## Codex CLI bridge

When `config.ai.backend` is `codex_cli_bridge`, the game runs text completions through the local Codex app-server stdio protocol and translates the final structured assistant message back into the same normalized response shape `LLMClient` expects.

```yaml
ai:
  backend: codex_cli_bridge
  model: gpt-5.4-mini
  codex_bridge:
    command: codex
    home: ./tmp/codex-bridge-home
    session_mode: fresh
    session_id: ""
    sandbox: read-only
    skip_git_repo_check: true
    reasoning_effort: none
    profile: ""
    prompt_preamble: ""
    idle_timeout_ms: 30000
```

Fields:
- `command`: command or absolute path used to launch Codex.
- `home`: Codex state directory for the bridge; relative paths resolve from the repo root.
- `session_mode`: `fresh`, `resume_last`, or `resume_id`.
- `session_id`: required only when `session_mode` is `resume_id`.
- `sandbox`: sandbox passed to Codex app-server thread/turn creation (`read-only`, `workspace-write`, `danger-full-access`).
- `skip_git_repo_check`: retained bridge config field; the current app-server turn path does not need the old `codex exec --skip-git-repo-check` flag.
- `reasoning_effort`: optional reasoning-effort override passed through on app-server `turn/start`; supported values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`. `none` is the lowest setting.
- `profile`: optional Codex config profile.
- `prompt_preamble`: optional text prepended ahead of the generated bridge wrapper prompt.
- `idle_timeout_ms`: no-data timeout for Codex app-server stdout streaming. The timer resets on each stdout chunk and aborts the turn if no more data arrives before this many milliseconds.

Behavior notes:
- `fresh` is the safest default because each request is isolated from prior bridge context.
- Session-mode mapping:
  - `fresh` starts a new ephemeral Codex thread for each request.
  - `resume_last` looks up the most recently updated thread under the configured Codex home, then resumes it.
  - `resume_id` resumes the exact Codex thread id in `session_id`.
- Resume modes intentionally target an existing Codex session and therefore can accumulate extra context from earlier bridge turns or manual use of that session.
- Resume modes only see sessions stored under the selected `home` directory. If you want to attach to an already-running Codex CLI session, point `ai.codex_bridge.home` at the same Codex home that session is using instead of the default isolated `./tmp` bridge home.
- `fresh` mode honors `ai.max_concurrent_requests`, so multiple isolated Codex requests can run in parallel.
- `resume_last` and `resume_id` stay serialized at one active request per targeted session/home to avoid interleaving turns into the same resumed Codex session.
- The bridge uses the shared `ai.model` field as the Codex thread/turn model override.
- The bridge forwards its wrapper instructions and all incoming chat `system` messages through Codex `developer_instructions`; only non-system messages are flattened into the user-message conversation transcript.
- Prompt-progress live preview now streams real assistant `content` text from Codex app-server message deltas, rather than waiting for the old `codex exec --json` final-message file path.

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

## AI request headers

`config.ai.headers` lets you inject HTTP headers into every LLM chat-completion request.

```yaml
ai:
  headers:
    User-Agent: "Firefox 99.0"
```

Rules:
- `headers` must be an object when present.
- Header names must be non-empty strings.
- Header values must be strings.

Header precedence:
1. built-in defaults (`Authorization`, `Content-Type`)
2. `ai.headers`
3. per-call `LLMClient.chatCompletion({ headers })`

### Override behavior (`ai_model_overrides`)

`ai_model_overrides.<profile>.headers` is merged per header key (not replaced as a whole object).

```yaml
ai_model_overrides:
  dialogue_generation:
    prompts: [player_action]
    headers:
      User-Agent: "Firefox 99.0"
```

Merge semantics:
- Header keys are merged per key across matching profiles.
- `null` on a specific header key removes that inherited header key.
- `headers: null` clears inherited headers for that override chain.

## AI prompt cachebuster

`config.ai.cachebuster` prepends a random cachebuster line to the final `user` message sent by `LLMClient.chatCompletion()`.

```yaml
ai:
  cachebuster: false
```

- Must be a boolean when present.
- Omitted or `false` disables the cachebuster.
- When `true`, each outbound request attempt gets a fresh line in the form `[cachebuster:<uuid>]` before the final `user` message body.
- The original caller-provided `messages` array is not mutated; the tag is applied only to the request payload copy.
- The live prompt-progress viewer and chat-completion error logs reflect the cachebusted prompt actually sent on that attempt.

## AI retry wait after errors

`config.ai.waitAfterError` controls how many seconds to wait between automatic retry attempts after retryable non-rate-limit failures (`5xx`).
`config.ai.waitAfterRateLimitError` is a specific override used for rate-limit failures (`429`).

```yaml
ai:
  retryAttempts: 3
  waitAfterError: 10
  waitAfterRateLimitError: 10
```

- Must be a non-negative number.
- `0` disables the delay between retries.
- If unset, the default is `10`.
- Can be overridden per prompt via `ai_model_overrides.<profile>.waitAfterError` (using that profile's `prompts` selection).
- `waitAfterRateLimitError` falls back to `waitAfterError` when unset.
- `waitAfterRateLimitError` can also be overridden per prompt via `ai_model_overrides.<profile>.waitAfterRateLimitError`.
- Per-call `LLMClient.chatCompletion({ waitAfterError })` still takes precedence over config values when explicitly provided.
- Per-call `LLMClient.chatCompletion({ waitAfterRateLimitError })` takes highest precedence for rate-limit retries.

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

## Difficulty DC formulas

`config.formulas.dc` controls the DC used for unopposed plausible action checks. The formulas are evaluated with `level` set to the current location's `baseLevel`.

```yaml
formulas:
  dc:
    trivial: "0"
    easy: "10"
    medium: "15"
    hard: "20"
    very_hard: "25"
    legendary: "30"
```

The default formulas preserve the previous hardcoded DCs. Invalid or missing DC formulas fail configuration validation, and a recognized difficulty cannot be rolled unless its formula evaluates to a finite number.

## Outcome margin formulas

`config.formulas.outcome_margins` controls how far above or below the DC/opposed total a roll must land to produce each outcome tier. Like DC formulas, `level` is the current location's `baseLevel`.

```yaml
formulas:
  outcome_margins:
    critical_success: "10"
    major_success: "6"
    success: "3"
    barely_succeeded: "0"
    critical_failure: "-10"
    major_failure: "-6"
    failure: "-3"
```

`barely_failed` is the implicit band between `failure` and `barely_succeeded`. The evaluated formulas must remain ordered (`critical_success >= major_success >= success >= barely_succeeded` and `critical_failure <= major_failure <= failure < barely_succeeded`) or config validation fails.

## Critical roll threshold formulas

`config.formulas.critical_thresholds` controls the d20 roll gates that must be met before a critical outcome remains critical. The thresholds are inclusive. For example, `normal.success: 16` means a normal action needs a d20 roll of `16` or higher to keep `critical_success`, while `normal.failure: 4` means it needs a d20 roll of `4` or lower to keep `critical_failure`.

```yaml
formulas:
  critical_thresholds:
    normal:
      success: 16
      failure: 4
    crafting:
      success: 19
      failure: 2
```

`normal` applies to ordinary action outcome classification. `crafting` applies to the craft/salvage/harvest and Modify Location success-degree remap that can downgrade critical outcomes to major outcomes. Values may be numeric literals or formula strings, and formula strings receive the same `level` variable as DC and outcome-margin formulas.

## Player level-up ability selection

Two config keys control player-only level-up ability drafting:

```yaml
player_ability_options_per_level: 6
player_abilities_per_level: 3
```

- `player_ability_options_per_level`: how many ability cards/options are shown per level draft.
- `player_abilities_per_level`: how many abilities the player must submit for that level.
- Both values must be positive integers.
- `player_abilities_per_level` cannot exceed `player_ability_options_per_level`.
- NPC level-up ability assignment remains automatic; this config applies only to the player draft modal flow.

## Extra plot prompt toggles

`extra_plot_prompts` gates the automatic hidden story-note schedulers for plot summary, plot expander, supplemental story info, and offscreen NPC activity.

```yaml
extra_plot_prompts:
  plot_summary: true
  plot_expander: true
  supplemental_story_info: true
  offscreen-npc-activity-daily: true
  offscreen-npc-activity-weekly: true
```

- Missing keys default to `true`.
- Each populated key must be a boolean; invalid values raise a runtime error when scheduling.
- Disabled categories do not auto-schedule and do not advance that category's cadence counters while disabled.
- These toggles only affect automatic scheduling. Manual slash-command plot note runs (`/runplotsummary`, `/runplotexpander`) still work.

## Supplemental story info prompt frequency

`supplemental_story_info_prompt_frequency` controls when hidden supplemental story-info prompts run after a player turn.

```yaml
supplemental_story_info_prompt_frequency: 5
```

- `0`: never run supplemental story info prompts.
- `>0`: run every `X` turns (`X` = configured value), and also run on any turn where one or more new NPCs or things (items/scenery) were generated.
- Automatic scheduling is also gated by `extra_plot_prompts.supplemental_story_info`.
- Value must be an integer `>= 0`; invalid values raise a runtime error when scheduling the prompt.

## Offscreen NPC activity prompt count

`offscreen_npc_activity_prompt_count` controls the twice-daily hidden "what are they doing right now" NPC activity prompt size.

```yaml
offscreen_npc_activity_prompt_count: 5
```

- Runs when world time crosses `07:00` and `19:00`.
- The configured value controls how many non-present NPCs the twice-daily prompt requests.
- `0` disables the twice-daily prompt.
- Automatic scheduling is also gated by `extra_plot_prompts.offscreen-npc-activity-daily`.
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
  - Automatic scheduling is also gated by `extra_plot_prompts.offscreen-npc-activity-weekly`.
  - Reaching this many turns since the last weekly run forces one weekly run.
- `0` disables turn-cap forcing for that cadence.
- Values must be integers `>= 0`; invalid values raise runtime errors when scheduling.
- Single-run-per-turn still applies: if multiple offscreen prompts are due in one turn (time-based and/or turn-cap based), only one is run.

## World time

`time` controls the canonical world clock configuration. Internally, the server tracks world time in minutes (`worldTime.timeMinutes`), and config inputs are also minute-based.

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

## Health

`healthRegenPercentPerMinute` controls passive current-health regeneration as a percentage of each actor's current maximum health per elapsed world minute.

```yaml
# 0.01736111111% per minute is about 25% of max health per day.
healthRegenPercentPerMinute: 0.01736111111
```

- The value must be a finite non-negative number.
- Regeneration is applied when elapsed world-time effects are processed, and each actor persists `healthRegenAppliedAt` so reloads do not replay old elapsed minutes.
- Current health is stored internally as a float; client health readouts round displayed values upward.

## Image generation thing size overrides

`imagegen.default_settings.image` remains the baseline size for generated item and scenery images. You can optionally override those dimensions per thing type with `imagegen.item_settings.image` and `imagegen.scenery_settings.image`.

```yaml
imagegen:
  default_settings:
    image:
      width: 1024
      height: 1024
  item_settings:
    image:
      width: null
      height: null
  scenery_settings:
    image:
      width: null
      height: null
```

- `item_settings.image.width` / `height` are optional. `null` or omission falls back to `default_settings.image`.
- `scenery_settings.image.width` / `height` are optional. `null` or omission falls back to `default_settings.image`.
- When provided, override values must be between `64` and `4096`.
- If neither the per-type override nor `default_settings.image` provides a usable width/height, startup validation fails instead of silently hardcoding a fallback size.

## Location weather/lighting image variants

`imagegen.location_variant_settings` controls ComfyUI-only image-to-image variants of existing location images for the current world-time lighting and local weather.

```yaml
imagegen:
  location_variant_settings:
    api_template: flux2_klein_edit.json.njk
    image:
      width: null
      height: null
    sampling:
      steps: 20
      denoise: 0.45
      cfg: 6
      sampler: dpmpp_2m
      scheduler: karras
```

- `api_template` is required when the ComfyUI engine is active. The default img2img template is `flux2_klein_edit.json.njk`. The template must exist under `imagegen/`; missing templates fail configuration validation and location-variant requests return an explicit skipped reason.
- The default `flux2_klein_edit.json.njk` workflow detects width and height from the source image and does not use configured dimensions, so edited variants should return at the original resolution. It also routes the rendered edit prompt through a `Text to Console` node labeled `Final Prompt`, matching the current non-edit Qwen workflows' ComfyUI-console prompt visibility.
- `image.width` / `height` are optional for custom variant workflows that reference `{{ image.width }}` or `{{ image.height }}`. `null` or omission falls back to the source image metadata, then `location_settings.image`, then `default_settings.image`.
- `sampling.steps` falls back to `location_settings.sampling.steps`, then `default_settings.sampling.steps`.
- `denoise`, `cfg`, `sampler`, and `scheduler` are passed to the variant workflow template.
- V1 does not support OpenAI or NanoGPT editing. Non-ComfyUI engines skip `/api/images/location-variant/request` with `unsupported-engine`.

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

## Faction generation count

`factions.count` controls the requested number of factions during new-game generation.

```yaml
factions:
  count: 7
```

- `0` disables faction generation.
- Positive integers request that many factions from the generator.
- If the generator returns more factions than requested, extras are accepted.
- If the generator returns fewer factions than requested, new-game setup fails with an error.
- Active-setting overrides:
  - If the applied setting defines `defaultFactionCount`, that value is used instead of `factions.count`.
  - If `defaultFactionCount` is unset and the setting has `defaultFactions`, the draft count is used.
  - `factions.count` remains the fallback when the applied setting has neither.

## Chat completion sound

`chat_completion_sound` controls the optional realtime sound cue clients play when `/api/chat` completes.

```yaml
chat_completion_sound: assets/audio/bleep.mp3
```

- `null` or `false` disables playback.
- Any non-empty string is treated as the client-playback path.
- The default path resolves to `/assets/audio/bleep.mp3` and requires static serving from the server.

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

## Base-context prompt caching hint

`prompt_uses_caching` tells the base-context template to keep prompt-level history blocks present even when a caller requests `omitGameHistory: true`.

```yaml
prompt_uses_caching: true
```

Rules:
- Must be a boolean when present.
- Default is `false`.
- When `true`, prompt-level omissions inside `prompts/base-context.xml.njk` are ignored so the prompt shape stays more stable for cache reuse experiments.
- Currently this affects the template-level `omitGameHistory` flag, causing `<olderStoryHistory>` to remain present even for prompt families that would normally suppress it.
- When `true`, slop-remover also switches from the standalone `prompts/slop-remover.xml.njk` template to the base-context include path (`prompts/base-context.xml.njk` with `promptType: slop-remover`). Legacy attack precheck still skips the cheap precheck when this is true, but can run the full legacy attack check when `use_legacy_prompt_checks` is enabled.
- This does **not** override lower-level base-context builder exclusions such as `base_context.omit_inventory_items`, `base_context.omit_abilities`, `base_context.omit_craft_history`, or per-call `omitEventSummaryHistory`.

## Legacy prompt checks

`use_legacy_prompt_checks` switches player/NPC action attack and skill checks back to the older separate prompt flow.

```yaml
use_legacy_prompt_checks: false
```

Rules:
- Must be a boolean when present.
- Default is `false`.
- When `false`, regular prose prompts get `resolveAttack`, `resolveSkillCheck`, and `resolveOpposedSkillCheck` tools and resolve attacks/checks inside the prose tool loop.
- When `true`, regular player/NPC prose prompts do not receive those mechanical check tools. Player actions run the legacy `attack_precheck`/`attack_check` and player-action plausibility prompt before prose generation; NPC turns run their existing action-plan plausibility prompt and legacy attack check before NPC prose generation.

## Tool-call chat debugging

`debug_tool_calls` controls whether prose-prompt tool calls are mirrored into the visible chat history while the prompt is still running.

```yaml
debug_tool_calls: false
```

Rules:
- Must be a boolean when present.
- Default is `false`.
- When `true`, `/api/chat` creates one `tool-call-debug` chat entry per prose prompt that uses tools, updates that same entry as each tool starts and completes, and emits the existing `chat_history_updated` realtime event after each update.
- The debug entry stores the tool name, parameters, result content, and result metadata in structured `toolCalls` records. It is marked with `metadata.excludeFromBaseContextHistory: true`, so it is visible in the chat log but excluded from future prompt context.
- The chat client renders each tool call as its own collapsible sub-box, marks cached results as `cache hit`, and uses `@andypf/json-viewer` to format the parameters/result JSON.

## Extra system instructions and tonal scale

Applied world profiles can define `unifiedTonalScale` selections through the `/settings` Tone Scale tab. When present, the rendered tonal-scale section is inserted into relevant system prompts before `extra_system_instructions`.

Rules:
- `extra_system_instructions` remains global/config-driven prompt text.
- Setting-level tonal scale selections are persisted on `SettingInfo` and rendered from `defs/unified_tonal_scale.yaml`.
- If the same tonal guidance is also left in `extra_system_instructions`, the prompt will contain both sections.

## Hidden player-action notes

`show_hidden_notes` controls whether player-action `<hidden>...</hidden>` notes are sent to developer-facing full-history views such as Story Tools.

```yaml
show_hidden_notes: false
```

Rules:
- Must be a boolean when present.
- Default is `false`.
- The Adventure chat feed always strips hidden-note blocks from server-rendered history, realtime player-action payloads, and ordinary `/api/chat/history` results.
- Stored chat history keeps hidden-note blocks for future LLM context.
- When `true`, `/api/chat/history?includeAllEntries=true` keeps hidden tags in the full-history response used by Story Tools.
- When `false`, hidden blocks are stripped from that full-history response too.

## Plot expander cadence

`plot_expander_prompt_frequency` controls automatic hidden `plot-expander` prompt cadence on eligible player-action turns.

```yaml
plot_expander_prompt_frequency: 10
```

- Default is `10` when omitted.
- `0` disables automatic runs.
- Automatic scheduling is also gated by `extra_plot_prompts.plot_expander`.
- Value must be an integer `>= 0`; invalid values raise runtime errors when scheduling.
- Runs use the base-context `plot-expander` include and store hidden `plot-expander` entries.
- The latest `plot-expander` output is injected into base-context as `<plotExpander>` immediately after `<plotSummary>`.

## While-you-were-away reunion threshold

`while_you_were_away_threshold_minutes` controls when the blocking `while-you-were-away` reunion prompt runs after the player arrives at a location containing NPCs they have not been with continuously.

```yaml
while_you_were_away_threshold_minutes: 240
```

Rules:
- Must be an integer `>= 0` when present.
- Default is `240` (`4` hours).
- The prompt input includes current-location NPCs that have persisted `last_seen_time` / `last_seen_location` and were not in the same location as the player on the previous round, so already-present reunion NPCs stay in the candidate list instead of being misclassified as arrivals.
- The prompt input includes each need-bar definition's `while_you_were_away_prompt_notes` when provided, letting need-bar defs guide how offscreen NPCs tend to satisfy or lose that bar.
- The threshold only controls whether the prompt runs at all: it runs when at least one such NPC has been away at least this many in-game minutes.
- When it runs, it blocks the arrival flow long enough to apply returned need-bar percentage values, optional NPC travel destinations, store the hidden `while-you-were-away` internal history entry, and optionally append a visible `while-you-were-away-player` assistant chat entry when the prompt returns non-empty `<proseForPlayer>`. Need-bar values strip nonnumeric text before parsing; blank/`N/A` values are ignored for that bar. If `slop_buster` is enabled, that visible prose is run through the shared slop-removal pipeline before storage.
