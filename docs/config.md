# Configuration

This document covers runtime configuration layers, editing surfaces, and config options that affect game behavior.

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

Object values are merged recursively. Arrays, scalars, and `null` replace the lower-precedence value.
`config.yaml` must exist for normal server startup; copy `config.default.yaml` to `config.yaml` during setup.

## Per-game YAML override

The `/config` page exposes a per-game YAML override textarea for the loaded save.

Merge precedence becomes:

1. `config.default.yaml`
2. `config.yaml`
3. `--config-override` file
4. loaded game's YAML override

Rules:
- The per-game override must contain a YAML object when non-blank.
- Blank input clears the per-game override for the loaded game.
- Editing the field triggers the same runtime reload path used by `/reload_config`.
- The raw YAML is saved as `gameConfigOverride.yaml` inside the save and is reapplied before save hydration on `/api/load`.
- New game creation reloads config with a blank per-game override before world generation begins.
- Like `/reload_config`, mod enable/disable edits are validated immediately but require a restart to fully change the active mod set.

## Runtime editing surfaces

The web UI and slash commands expose different config write paths:

- `/config` renders the merged config and saves form submissions to root `config.yaml`. The page response tells the user to restart; the form save path does not run definition reloads or hot-toggle the active mod set.
- `/api/game-config-override` accepts `{ "yaml": "..." }`, requires a loaded game, stores the raw per-game YAML on `Globals`, and runs the same runtime reload path as `/reload_config`.
- `/reload_config` reloads `config.default.yaml`, `config.yaml`, the startup CLI override, and the loaded game override; validates formula config; refreshes definition caches; invalidates Nunjucks caches; and reports mod enablement drift.
- `/get <path>` reads a dotted path from `Globals.config`.
- `/set <path> <value>` mutates the in-memory `Globals.config` object only. It parses `true`/`false` as booleans and leaves other values as strings. It does not write YAML or reload definitions.

## Prompt concurrency and stagger

Two root-level values tune concurrent text prompts:

```yaml
max_concurrent_requests_all_models: null
stagger_concurrent_prompts: 4
```

- `max_concurrent_requests_all_models` is optional. When set to a positive integer, `LLMClient` enforces that cap across all real text-generation requests regardless of backend, model, API key, OAuth identity, or Codex bridge session key. Each request still also honors the existing per-model/API-key semaphore from `ai.max_concurrent_requests`.
- `stagger_concurrent_prompts` is the number of seconds between staggered prompt launches. It defaults to `4` when omitted or blank. Event checks launch immediately, need-bar event checks launch after one interval, and quest checks launch after two intervals. Values must be non-negative finite numbers.

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
- The active mod set is frozen at startup, so editing mod enablement on disk requires a server restart to apply. `/reload_config` reports drift but does not hot-toggle mods.
- The `/mods` page writes these same flags to `config.yaml` through the mod manager API.
- Save metadata includes the active enabled-mod list. Loading a save with a different list asks whether to apply the save configuration, keep the current configuration for that load, or cancel.

## Self restart

`server.allowSelfRestart` controls whether API-triggered mod configuration changes may start a replacement server process.

```yaml
server:
  allowSelfRestart: false
  selfRestartPortRetrySeconds: 10
```

Rules:
- `allowSelfRestart` defaults to `false` in `config.default.yaml`.
- When disabled, accepting a save's mod configuration writes a pending-load intent and the UI tells the user to restart manually.
- When enabled, accepting a save's mod configuration spawns a detached replacement `node server.js` process, then the current process closes after the response is sent.
- Startup uses `selfRestartPortRetrySeconds` to retry binding the configured host/port once per second before aborting. The value must be a non-negative integer.

## Dispositions

`dispositions.first_impression_multiplier` controls how strongly the first disposition delta is applied for an NPC that has no existing nonzero disposition toward the current player.

```yaml
dispositions:
  first_impression_multiplier: 3
```

Disposition types, ranges, icons, and threshold labels are defined in `defs/dispositions.yaml` plus mod defs overlays. The multiplier is loaded from merged config, so `config.yaml`, `--config-override`, and per-game YAML overrides can tune it without editing defs. The value must be a finite number when provided.

## Chat tools

`chat_tools.request_user_input_enabled` controls whether LLM chat-tool prompts can ask the player one direct follow-up question through the realtime UI.

```yaml
chat_tools:
  request_user_input_enabled: true
```

The value defaults to `true` and must be a boolean when provided. When disabled, `requestUserInput` is removed from regular and generic chat-tool payloads.

## Trackers

`trackers.short_string_max_words` controls the maximum number of whitespace-delimited words allowed for `short_string` tracker values.

```yaml
trackers:
  short_string_max_words: 4
```

The value defaults to `4` and must be an integer greater than or equal to `1` when provided. The limit is enforced by direct tracker creation, chat-tool tracker creation, and XML/legacy `tracker_updates` parsing, and the XML event prompt receives the same configured limit.

## Plot analysis

`plot_analysis.enabled` controls whether normal player actions schedule the non-blocking background `plot-analysis` prompt.

```yaml
plot_analysis:
  enabled: true
  max_plot_threads: 3
  max_plot_complications: 3
```

`enabled` defaults to `true` and must be a boolean when provided. When disabled, new player turns do not schedule background plot-analysis work; queued or in-flight plot-analysis work rechecks the gate before tool execution and response storage. The latest saved `Globals.plotAnalysis` value still loads, persists, appears in base-context prompts, and remains visible through `/plot_analysis`. `/rp` temporarily sets this flag to `false` while roleplay mode is active.

`max_plot_threads` and `max_plot_complications` default to the values shown in `config.default.yaml`. `prompts/_includes/plot-analysis-blurb.njk` uses `max_plot_complications`; `max_plot_threads` is available to prompt include customizations.

## Improvement Prompt

`improvement_prompt.enabled` controls whether normal player actions periodically schedule the non-blocking background `improvement-prompt` prompt.

```yaml
improvement_prompt:
  enabled: false
  interval: 10
```

`enabled` defaults to `false` in `config.default.yaml` and must be a boolean when provided.

`interval` defaults to `10` and must be an integer greater than or equal to `1` when provided. The cadence counts eligible player-action submissions (normal/creative actions; excludes question, generic, forced-event, and comment-only flows) and runs on every Nth eligible turn. The prompt runs through the shared base-context wrapper with all ordinary `@@`-eligible history available, logs through `LLMClient.logPrompt()` as `improvement_prompt`, and appends a visible `game-improvement-suggestions` chat entry headed `Game improvement suggestions`. That entry is excluded from base-context history, including all-entry generic prompt modes.

## Event Checks

`event_checks.enabled` controls whether narrative event processing runs at all. When it is `false`, prose does not mutate world state through event checks and quest completion checks are skipped.

```yaml
event_checks:
  enabled: true
  use_xml: true
```

`event_checks.use_xml` defaults to `true` and must be a boolean when provided. When enabled, `Events.runEventChecks(...)` uses the `events-xml` prompt for ordinary event categories and parses one `<events>` block. Need bars still use the dedicated `need-bars` prompt when need-bar definitions are present, and those results are injected as ordinary `needbar_change` events before outcomes are applied. Set `event_checks.use_xml` to `false` to use the legacy grouped `event-checks` prompts plus the same dedicated `need-bars` prompt. The `/config` page exposes the same option as “XML Event Pipeline”.

## Per-prompt reasoning effort

OpenAI-compatible `ai.reasoning_effort` can also be set per prompt through `ai_model_overrides` profiles. Matching profiles are selected by the prompt's `metadataLabel`, so this can tune cheap background checks without enabling reasoning globally.

```yaml
ai_model_overrides:
  low_reasoning_checks:
    reasoning_effort: low
    prompts:
      - quest_check
      - event_checks
      - need_bar_event_checks
```

`quest_check` covers quest completion checks. `event_checks` covers both the XML `events-xml` pipeline and the legacy grouped event-check prompts because they share the same AI override label. `need_bar_event_checks` covers the dedicated need-bar event prompt.

## Barter

`barter` controls NPC trade sessions and generated merchant stock.

```yaml
barter:
  generated_stock:
    min_items: 0
    max_items: 16
    max_items_per_prompt: 8
  daily_refresh:
    min_fraction: 0.3333333333
    max_fraction: 0.6666666667
  refusal_duration_minutes: 1440
  session_timeout_minutes: 60
```

Fields:
- `generated_stock.min_items` / `generated_stock.max_items`: inclusive range for how many new barter-stock item seeds the `barter-prices` prompt may request when a merchant's stock is generated or refreshed.
- `generated_stock.max_items_per_prompt`: maximum number of generated barter-stock item seeds to instantiate in one `inventory-generator` prompt batch.
- `daily_refresh.min_fraction` / `daily_refresh.max_fraction`: fraction range for how much persisted NPC barter stock is flushed when at least one in-world day has passed since that NPC's stock was updated.
- `refusal_duration_minutes`: how long a `willingToTrade: false` refusal lasts before the NPC automatically becomes willing to trade again.
- `session_timeout_minutes`: in-world minutes before a quoted barter session expires and must be repriced.

Validation fails loudly if item counts are not non-negative integers, `generated_stock.max_items_per_prompt` or duration fields are not positive integers, fractions are outside `0..1`, or min values exceed max values.

## NPC Generation

`npc_generation.max_quantity` caps generated NPC quantity groups.

```yaml
npc_generation:
  max_quantity: 20
```

Location, region, and single-NPC generation prompts may return `<quantity>`. Missing or blank values default to `1`; non-integer text is warning-logged after stripping non-numeric characters; values are clamped to `1..npc_generation.max_quantity`. Quantity groups expand only after name cleanup, progression, abilities, inventory generation, and equipment assignment, so each numbered NPC receives its own copied gear with the original item names preserved. Those copied items remain separate while held by different NPCs but are stack-compatible when later dropped or moved into the same destination.

## Mystery Threads

`mystery_threads.max_active` caps how many active private mystery threads are injected into base-context prompts and how many automatic mystery threads the reactive mystery-box flow can keep active.

```yaml
mystery_threads:
  max_active: 3
```

Validation requires a non-negative integer. `0` disables active mystery-thread base-context injection and forces automatic mystery tracking to skip rather than create new active mystery continuity.

## AI backend selection

`config.ai.backend` selects the text-generation transport.

```yaml
ai:
  backend: openai_compatible
```

Supported values:
- `openai_compatible`: the `/chat/completions` HTTP path using `ai.endpoint`, `ai.apiKey` or OAuth refresh-token auth, and `ai.model`.
- `codex_cli_bridge`: runs text requests through the local Codex CLI bridge; this backend uses `ai.model` plus `ai.codex_bridge.*` and does not require `ai.endpoint` or `ai.apiKey`.

Validation rules:
- `backend` defaults to `openai_compatible` when omitted.
- Unknown backend values fail validation loudly at startup and on reload.

## Core AI request settings

These keys are shared by normal prompt calls unless a caller or `ai_model_overrides` profile supplies a more specific value:

```yaml
ai:
  model: zai-org/glm-4.7
  maxTokens: 10000
  lowTemperature: 0.0
  temperature: 0.6
  highTemperature: 1.0
  top_p: 1.0
  prefill: null
  sysprompt_append: ""
  max_concurrent_requests: 6
  stream: true
  stream_start_timeout: 45
  stream_continue_timeout: 15
  increment_start_timeout: 15
  increment_continue_timeout: 5
  supress_seed: true
model_swap_options:
  - "zai-org/glm-4.7"
```

- `model` is the default model for OpenAI-compatible requests and the Codex bridge model override.
- `maxTokens` becomes `max_tokens` when a prompt call does not provide a positive `maxTokens`; server helpers may also use it as a minimum when resolving prompt-specific token caps.
- `temperature`, `top_p`, and `stream` map to chat-completion payload fields. The Codex bridge forces `stream: false` at the normalized `LLMClient` payload layer because Codex streaming is handled by the bridge client.
- `lowTemperature` and `highTemperature` are available to caller code that chooses bounded temperature variants.
- `prefill` can be `null` or a string. When set for `openai_compatible`, `LLMClient` appends the string as a final assistant message and returns `prefill + generated continuation`, avoiding duplicate text when the provider echoes the prefill. This is rejected for tool-call requests and for `codex_cli_bridge`.
- `sysprompt_append` can be `null`, blank, or a string. A non-empty string is inserted into the outbound request as an additional `system` message after existing system messages, or before the first user message when the prompt did not already include a system message. This applies to both text backends and does not mutate caller-provided message objects.
- `stream_start_timeout` and `stream_continue_timeout` are seconds. Retry attempts add `increment_start_timeout` and `increment_continue_timeout`, also in seconds.
- `supress_seed: true` omits the `seed` payload field. The key name is spelled `supress_seed` in the config file and code.
- `max_concurrent_requests` controls the per-model/API-key semaphore for OpenAI-compatible requests and the fresh-session concurrency limit for the Codex bridge. The root `max_concurrent_requests_all_models` setting can add a process-wide cap across those per-key semaphores.
- `model_swap_options` drives the `/config` page model selector and is saved as a JSON string-array field by that page.

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
  model: zai-org/glm-4.7
  codex_bridge:
    command: codex
    home: ./tmp/codex-bridge-home
    session_mode: fresh
    session_id: ""
    sandbox: read-only
    skip_git_repo_check: true
    reasoning_effort: ""
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
- `skip_git_repo_check`: accepted bridge config field. App-server requests do not pass a git-repo-check flag.
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
- Prompt-progress live preview streams assistant `content` text from Codex app-server message deltas.

## Prompt Progress Targets

`prompt_progress.character_targets` configures the character-count target used by the docked prompt tracker progress bars.

```yaml
prompt_progress:
  character_targets:
    region_*: 20000
    location_*: 10000
    npc_generation_*: 10000
    player_action*: 5000
```

Prompt labels are normalized the same way as `metadataLabel`; keys ending in `*` match prefixes, and exact labels win over prefix matches. Missing target coverage for a tracked prompt label throws a clear error instead of falling back to a placeholder. The default config gives region-related prompts `20000`, location-related and NPC-generation prompts `10000`, and other known prompt families, including `scheduled_event_resolution`, `scene_illustration_prompt`, and `set_travel_times`, `5000`. Once `logs/prompt-output-character-stats.json` has a positive average output-character count for a label, that average becomes the prompt's progress target instead of the configured value; the config value remains the cold-start target before a usable average exists. Character-appended labels for inventory generation, NPC memories, NPC progression, NPC abilities, and NPC alias assignment use the base prompt label's average. Use `/promptstats` to inspect stored averages and `/promptstats clear` to clear them.

Progress uses decoded JavaScript characters, not tokens or UTF-8 bytes. Up to the target `X`, the bar advances linearly through 75% of its width. After `X`, it approaches the end asymptotically: each additional `X` characters consumes half of the remaining 25%.

## OpenAI-Compatible Reasoning Effort

`config.ai.reasoning_effort` is an optional OpenAI-compatible chat-completion payload setting.

```yaml
ai:
  reasoning: false
  reasoning_effort: ""
```

Blank or omitted `reasoning_effort` preserves the current request payload shape: `LLMClient` does not send `reasoning` or `reasoning_effort` just because `config.ai.reasoning` is `false`. When `reasoning_effort` is a non-empty string, `LLMClient.chatCompletion()` sends `reasoning: true` and `reasoning_effort: "<value>"`. Per-call `LLMClient.chatCompletion({ reasoningEffort })` takes precedence over the merged AI config value.

The field must be a string when provided. It can also be set through `ai_model_overrides` for selected prompt labels. This is separate from `ai.codex_bridge.reasoning_effort`, which controls Codex app-server `turn/start.effort`.

## AI system prompt append

`config.ai.sysprompt_append` appends provider- or model-specific instructions to the system prompt without editing every prompt template.

```yaml
ai:
  sysprompt_append: ""

ai_model_overrides:
  qwen_event_checks:
    prompts:
      - event_checks
    model: qwen-specific-model
    sysprompt_append: "Follow this model's XML-formatting guidance exactly."
```

Rules:
- Blank, omitted, or `null` disables the append.
- Non-empty values must be strings.
- Matching `ai_model_overrides` profiles replace the inherited scalar value. Use `sysprompt_append: null` or `sysprompt_append: ""` in a profile to clear a global append for that prompt label.
- The appended text appears in prompt-progress snapshots and chat-completion error logs because it is added before dispatch.

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
- Non-object values replace inherited values.
- Arrays replace inherited arrays.
- `null` deletes the targeted key from the inherited `custom_args` tree.

Override profiles can also set scalar AI fields directly. For example, a string `prefill` replaces the default assistant prefill for matching prompt labels, `prefill: null` clears an inherited `ai.prefill`, and `sysprompt_append` behaves the same way for appended system instructions.

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

`config.ai.waitAfterError` controls how many seconds to wait between automatic retry attempts after retryable non-rate-limit HTTP failures (`5xx`).
`config.ai.waitAfterRateLimitError` is a specific override used for rate-limit failures (`429`).
`config.ai.waitAfterNetworkError` controls how many seconds to wait before retrying transport/network failures that do not have an HTTP status, such as `ECONNRESET`, `EPIPE`, `ETIMEDOUT`, or `ENETUNREACH`.

```yaml
ai:
  retryAttempts: 3
  waitAfterError: 10
  waitAfterRateLimitError: 10
  waitAfterNetworkError: 5
```

- Must be a non-negative number.
- `0` disables the delay between retries.
- If unset, `waitAfterError` defaults to `10`, `waitAfterRateLimitError` falls back to `waitAfterError`, and `waitAfterNetworkError` defaults to `0`.
- Can be overridden per prompt via `ai_model_overrides.<profile>.waitAfterError` (using that profile's `prompts` selection).
- `waitAfterRateLimitError` falls back to `waitAfterError` when unset.
- `waitAfterRateLimitError` can also be overridden per prompt via `ai_model_overrides.<profile>.waitAfterRateLimitError`.
- `waitAfterNetworkError` can also be overridden per prompt via `ai_model_overrides.<profile>.waitAfterNetworkError`.
- Per-call `LLMClient.chatCompletion({ waitAfterError })` still takes precedence over config values when explicitly provided.
- Per-call `LLMClient.chatCompletion({ waitAfterRateLimitError })` takes highest precedence for rate-limit retries.
- Per-call `LLMClient.chatCompletion({ waitAfterNetworkError })` takes highest precedence for network-error retries.

## Character creation point pools

`config.formulas.character_creation` controls the formulas used to calculate the base point pools for the New Game attribute and skill allocators.

```yaml
formulas:
  character_creation:
    attribute_pool_formula: "ceil(level * (number_of_attributes / 2))"
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
    easy: "10 + level"
    medium: "floor(15 + level * 1.1)"
    hard: "floor(10 + level * 1.2)"
    very_hard: "floor(25 + level * 1.3)"
    legendary: "floor(30 + level * 1.4)"
```

Invalid or missing DC formulas fail configuration validation, and a recognized difficulty cannot be rolled unless its formula evaluates to a finite number.

## Outcome margin formulas

`config.formulas.outcome_margins` controls how far above or below the DC/opposed total a roll must land to produce each outcome tier. Like DC formulas, `level` is the current location's `baseLevel`.

```yaml
formulas:
  outcome_margins:
    critical_success: "20"
    major_success: "10"
    success: "3"
    barely_succeeded: "0"
    failure: "-3"
    major_failure: "-10"
    critical_failure: "-20"
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

`offscreen_npc_activity_prompt_count` controls the twice-daily hidden offscreen NPC activity prompt size.

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
- Regeneration is applied when elapsed world-time effects are processed, and each actor persists `healthRegenAppliedAt` so reloads do not replay elapsed minutes from before the saved application point.
- Current health is stored internally as a float; client health readouts round displayed values upward.

## Image prompt generation retries and batching

`imagegen.prompt_generation_attempts` controls how many times the server asks the LLM to write the final image prompt before giving up. If prompt generation keeps failing or returns leaked prompt/context XML instead of a final image prompt, the image request is skipped with `reason: "image-prompt-failed"` and no image-rendering job is queued.

`imagegen.prompt_batching` controls batching for the same LLM prompt-writing step. It does not batch the final image-rendering jobs.

```yaml
imagegen:
  prompt_generation_attempts: 3
  prompt_batching:
    enabled: true
    delay_ms: 2000
    max_items: 10
```

- `prompt_generation_attempts` defaults to `3` and must be an integer greater than or equal to `1`.
- When enabled, each queued image-prompt generation request waits `delay_ms` milliseconds after the last queued request so compatible requests can be sent in one LLM call.
- Compatibility is based on the rendered image-prompt system prompt. Requests with different system prompts are kept separate.
- `max_items` is the maximum number of compatible requests in one batch. Reaching the cap flushes the queue immediately.
- Validation fails if `prompt_generation_attempts` is not a positive integer, `enabled` is not boolean, `delay_ms` is not a non-negative integer, or `max_items` is not a positive integer.

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
slop_remover_base_attempts: 1
```

- Must be an integer `>= 1`.
- This is the base attempt count before parse-failure extensions. If omitted, the runtime fallback is `2`.
- Parse failures can still increase the effective cap up to 5 attempts.

## Random event frequency and custom types

`random_event_frequency` controls random-event roll chances and supports extensible file-based event types.

```yaml
random_event_frequency:
  enabled: true
  common: 0.05
  rare: 0.01
  regionSpecific: 0.05
  locationSpecific: 0.05
```

- `enabled: false` disables random event rolls and seed-pool generation. Missing location and region seed pools are generated again on the next eligible turn after random events are re-enabled.
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
recent_history_turns: 25
client_message_history:
  max_messages: 100
  prune_to: 80
```

`client_message_history.max_messages` is interpreted as a **turn cap** (anchored on user entries; assistant prose anchors are used only as fallback when user entries are unavailable). This does not change `recent_history_turns`.

`client_message_history.prune_to` is a validated config value (`<= max_messages`) for prune-mode flows. Standard chat-history responses use `max_messages` turn-capped output, so client-visible history length is independent of `recent_history_turns`.

## Memory, summaries, and autosaves

These keys control memory selection, scene-summary sizing, and save retention:

```yaml
max_memories_to_recall: 10
party_generate_memory_interval: 12
autosaves_to_retain: 50
summaries:
  enabled: true
  summarize_on_load: false
  batch_size: 30
  summary_word_length: 12
  max_unsummarized_log_entries: 200
  max_summarized_log_entries: 2000
  scene_summary_max_entries_per_prompt: 500
```

- `max_memories_to_recall` limits selected memories per NPC or party member in base context. Values below `1` fall back to `10`.
- `party_generate_memory_interval` controls the party-memory generation cadence.
- `autosaves_to_retain` is the autosave retention count; `0` disables autosaves.
- `summaries.enabled` gates automatic summarization. `summaries.summarize_on_load` controls load-time summarization.
- `batch_size`, `summary_word_length`, `max_unsummarized_log_entries`, and `max_summarized_log_entries` tune summary batching and base-context history windows.
- `scene_summary_max_entries_per_prompt` must be a positive integer when provided and defaults to `500`.

## Base-context prompt caching hint

`prompt_uses_caching` tells the base-context template to keep prompt-level history blocks present even when a caller requests `omitGameHistory: true`.

```yaml
prompt_uses_caching: true
```

Rules:
- Must be a boolean when present.
- Default is `false`.
- When `true`, prompt-level omissions inside `prompts/base-context.xml.njk` are ignored so the prompt shape stays more stable for cache reuse experiments.
- This affects the template-level `omitGameHistory` flag, causing `<olderStoryHistory>` to remain present for prompt families that would otherwise suppress it.
- When `true`, slop-remover also switches from the standalone `prompts/slop-remover.xml.njk` template to the base-context include path (`prompts/base-context.xml.njk` with `promptType: slop-remover`). Legacy attack precheck still skips the cheap precheck when this is true, but can run the full legacy attack check when `use_legacy_prompt_checks` is enabled.
- This does **not** override lower-level base-context builder exclusions such as `base_context.omit_inventory_items`, `base_context.omit_abilities`, `base_context.omit_craft_history`, or per-call `omitEventSummaryHistory`.

## Legacy prompt checks

`use_legacy_prompt_checks` switches player/NPC action attack and skill checks to the legacy separate prompt flow.

```yaml
use_legacy_prompt_checks: false
```

Rules:
- Must be a boolean when present.
- Default is `false`.
- When `false`, regular prose prompts get `resolveAttack`, `resolveSkillCheck`, and `resolveOpposedSkillCheck` tools and resolve attacks/checks inside the prose tool loop.
- When `true`, regular player/NPC prose prompts do not receive those mechanical check tools. Player actions run the legacy `attack_precheck`/`attack_check` and player-action plausibility prompt before prose generation; NPC turns run their existing action-plan plausibility prompt and legacy attack check before NPC prose generation.

## NPC turn gates

`npc_turns` controls ordinary post-player NPC turns outside combat. `combat_npc_turns` controls post-player NPC turns while `Globals.isInCombat()` is true.

```yaml
npc_turns:
  enabled: false
  maxNpcsToAct: 1
  npcTurnFrequency: 0.3
combat_npc_turns:
  enabled: true
  maxNpcsToAct: 2
  npcTurnFrequency: 1
```

Rules:
- The two enabled flags are independent. Disabling `npc_turns.enabled` does not disable combat NPC turns when `combat_npc_turns.enabled` is true.
- In combat, the enabled flag and turn frequency come from `combat_npc_turns`.
- Outside combat, actor limits and frequency come from `npc_turns`.
- The combat execution path reads `combat_npc_turns.maxFriendlyNpcsToAct` and `combat_npc_turns.maxHostileNpcsToAct` when present. If those keys are absent, the friendly limit falls back to `npc_turns.maxNpcsToAct` and the hostile limit stays `0`; `combat_npc_turns.maxNpcsToAct` is present in `config.default.yaml` but is not read by the turn-selection path.

## Generation and parser controls

These keys are exposed by the `/config` page and are mainly used for world generation, checks, and development-time parsing:

```yaml
plausibility_checks:
  enabled: true
quest_completion_prose:
  enabled: true
regions:
  minLocations: 2
  maxLocations: 3
locations:
  maxNpcs: 4
  maxHostiles: 4
  maxItems: 4
  maxScenery: 4
  levelVariation: 3
events_to_check_concurrently: 10
check_move_plausibility: unexplored_locations
omit_npc_generation: false
omit_item_generation: false
deduplicate_item_names: true
strictXMLParsing: false
base_context:
  omit_inventory_items: false
  omit_abilities: false
```

- `plausibility_checks.enabled: false` disables plausibility/combat activation checks; event checks can still apply damage and world mutations when `event_checks.enabled` is true.
- `quest_completion_prose.enabled: false` suppresses prose generated for completed quests without disabling quest checks or rewards.
- `regions.*` and `locations.*` set generation count limits and location level variation for generated worlds.
- `events_to_check_concurrently` limits event-check batching; omit it or leave it blank to check all event categories together.
- `check_move_plausibility` accepts `never`, `unexplored_regions`, `unexplored_locations`, or `always`.
- `omit_npc_generation` and `omit_item_generation` skip those generation paths for faster testing/development flows.
- `deduplicate_item_names` controls generated item-name deduplication.
- `strictXMLParsing` makes XML parse failures surface instead of being tolerated by permissive parsing paths.
- `base_context.omit_inventory_items`, `base_context.omit_abilities`, and the supported but not default-listed `base_context.omit_craft_history` remove those sections from base-context prompt assembly unless a caller overrides them.

## Tool-call chat debugging

`debug_tool_calls` controls whether supported prompt tool calls are mirrored into the visible chat history while the prompt is still running.

```yaml
debug_tool_calls: false
```

Rules:
- Must be a boolean when present.
- Default is `false`.
- When `true`, `/api/chat` creates one `tool-call-debug` chat entry per supported prompt that uses tools, including prose prompts and silent housekeeping prompts. It updates that same entry as each tool starts and completes, and emits the existing `chat_history_updated` realtime event after each update.
- The debug entry stores the tool name, parameters, result content, and result metadata in structured `toolCalls` records. It is marked with `metadata.excludeFromBaseContextHistory: true`, so it is visible in the chat log but excluded from future prompt context.
- The chat client renders each tool call as its own collapsible sub-box, marks cached results as `cache hit`, and uses `@andypf/json-viewer` to format the parameters/result JSON. Result/Error `content` fields are XML-entity-decoded for display only and shown as separate preformatted text blocks, with the JSON tree retaining a `[shown below]` marker at those fields; the stored tool payload remains unchanged.

## Tool-call round limit

`max_tool_calls` controls how many tool-call rounds a prompt may execute before the server returns `tool_call_attempts_exhausted` tool errors and disables tools for the follow-up completion.

```yaml
max_tool_calls: 8
```

Rules:
- Must be a positive integer.
- This is a round limit, matching the chat-completion tool-loop behavior. A single round may contain multiple parallel tool calls.
- The configured value replaces the built-in tool-loop limit; invalid values fail loudly when a tool loop tries to run.

## Extra system instructions and tonal scale

Applied world profiles can define `unifiedTonalScale` selections through the `/settings` Tone Scale tab. When present, the rendered tonal-scale section is inserted into relevant system prompts before `extra_system_instructions`.

Rules:
- `extra_system_instructions` remains global/config-driven prompt text.
- Setting-level tonal scale selections are persisted on `SettingInfo` and rendered from `defs/unified_tonal_scale.yaml`.
- Tone Scale dropdowns include generated half-step midpoint values between adjacent defined levels. These values are not stored in the defs file, but prompt rendering accepts them and labels them with combined adjacent level names such as `3.5 (Hopeful/Mixed)`.
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

## Hidden NPC check visibility

`hide_hide_checks` controls whether failed automatic hide/perception checks for hidden NPCs are omitted from client-visible chat payloads.

```yaml
hide_hide_checks: true
```

Rules:
- Must be a boolean when present.
- Default config sets this to `true`.
- Automatic checks still run and are logged/stored as `check-results`; this option only marks failed automatic hidden-NPC checks as hidden from the client when set to `true`.
- Successful checks remain visible because they reveal the NPC and refresh location state.

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

## While-you-were-away location revisit threshold

`while_you_were_away_threshold_minutes` controls whether the blocking `while-you-were-away` prompt runs after the player arrives at a previously visited destination, using canonical total world minutes since that destination was last visited before the current move. First-time/unvisited destination arrivals skip the prompt entirely. Previously visited arrivals below the threshold also skip the prompt, so short back-and-forth moves do not produce reunion prose.

```yaml
while_you_were_away_threshold_minutes: 30
```

Rules:
- Must be an integer `>= 0` when present.
- Default is `30`.
- The prompt runs only when the movement path captured an affirmative pre-arrival visit snapshot. Non-NPC `Player.setLocation(...)` records that snapshot before marking the destination visited, so player-action event-check movement and explicit travel paths share the same gate. If the destination's pre-arrival `lastVisitedTime` is known, it must be at least this many in-game minutes old when compared with `Globals.getTotalWorldMinutes()`. `0` runs the prompt for any destination that was explicitly known to be previously visited before the move. Missing pre-arrival snapshots skip the prompt instead of trusting the destination's current `visited` flag after movement.
- The prompt input includes current-location NPCs that have persisted `last_seen_time` / `last_seen_location` and were not in the same location as the player on the previous round, so already-present reunion NPCs stay in the candidate list instead of being misclassified as arrivals. When a qualifying destination has visible current-location NPCs without per-NPC last-seen metadata, the prompt synthesizes candidate entries from the destination's pre-arrival visit state so the structured update list is not empty solely because the save lacks newer last-seen fields; the synthesized elapsed text uses the pre-arrival `lastVisitedTime` when known and `some time ago` otherwise.
- The prompt input includes each need-bar definition's `while_you_were_away_prompt_notes` when provided, letting need-bar defs guide how offscreen NPCs tend to satisfy or lose that bar.
- The threshold does not filter individual NPC candidates; once the destination qualifies, all current-location reunion candidates are listed for possible `<characterUpdate>` entries.
- The LLM response must include a complete `<response>...</response>` wrapper before `LLMClient` returns it to the while-you-were-away parser, so truncated completed responses trigger the configured retry flow.
- When it runs, it blocks the arrival flow long enough to apply returned need-bar percentage values, optional NPC travel destinations, optional `<itemSceneryMoves>` item/scenery relocation entries, store the hidden `while-you-were-away` internal history entry, and optionally append a visible `while-you-were-away-player` assistant chat entry when the prompt returns non-empty `<proseForPlayer>`. Need-bar values strip nonnumeric text before parsing, clamp parsed out-of-range percentages to `0..100`, and ignore blank/`N/A` values for that bar. Item/scenery relocation only moves existing things that are at the pre-arrival origin location and not in a character inventory; other listed names warn and are ignored. If `slop_buster` is enabled, that visible prose is run through the shared slop-removal pipeline before storage.
