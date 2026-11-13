# Configuration

This document covers runtime configuration layers, editing surfaces, and config options that affect game behavior.

## Prompt audit latency

```yaml
prompt_audit:
  high_latency_seconds: 5
```

The per-turn [PromptAuditLog](classes/PromptAuditLog.md) records initial text-generation waits at or above this threshold, inclusively. The setting defaults to `5` when omitted and accepts a positive finite numeric value, including fractional seconds. Invalid provided values fail startup, configuration persistence or reload validation; values are never clamped.

Timing starts when a completion begins, including preparation and queueing, and ends at the first actual generated output. HTTP headers, keepalives and empty stream updates do not qualify. Streaming output is labeled `first_generated_output`; non-streaming requests use `first_response`, or `first_chunk` for chunked generation. These latter measurements are response-arrival times, not first-token estimates. If dispatched work ends without output, its observed wait is labeled `no_output`. Forced/cassette results without a transport dispatch produce no latency entry. Slow waits appear separately from errors and never increase failure or cancellation counts; they do not establish a cache miss.

## Base-context system prefix

The optional top-level `systemPromptPrefix` prepends text to every system prompt
rendered through `prompts/base-context.xml.njk`, including standard and TinyBrain
families. It does not replace the system prompt. Omitted, `null`, empty and
whitespace-only values add nothing; populated values must be strings, otherwise
rendering fails with the `config.systemPromptPrefix` path.

```yaml
systemPromptPrefix: >-
  Your shared system instruction here.
```

The global text comes first, followed by a blank line and the selected local
prefix: a nonblank explicit render `systemPromptPrefix`, or the first matching
entry in merged `defs/system_prompt_prefix_by_prompt.yaml`. Local matching
remains case-insensitive substring matching on `promptType`. Identical trimmed
global/local strings appear once. The global text is added only to SYSTEM;
existing local-prefix use in generation includes remains unchanged.

`getSystemPromptPrefix(promptType)` callers outside the base wrapper retain
per-prompt-only behavior. This setting does not affect non-base templates or
standalone benchmark inputs. `ai.sysprompt_append` remains a separate transport
option. A server running cached helper/template code needs a user-approved
restart before this newly connected setting can take effect.

## Region secrets

`regions.secrets_enabled` is a boolean and defaults to `false` in `config.default.yaml`. It is also editable under System Configuration → World Generation → Region Secrets.

```yaml
regions:
  secrets_enabled: false
```

When disabled, both main region generation and pending-region expansion omit secrets instructions/schema, and the background `region_generate_secrets` path makes no LLM request. Region parsers accept XML without secrets and ignore unsolicited generated secrets. Base context (including Standard and TinyBrain prompts), region NPC generation, short-description context, and region tool lookups omit stored region secrets; `moreInfo` does so even with `includeFullState: true`. Disabling while a background request is already running prevents that request from storing its result.

Existing secrets remain stored in saves and accessible through region editing. Enabling the switch restores their use and generation for regions with missing secrets. This setting does not rewrite descriptions, NPC histories/goals, chat history, summaries, or plot analysis that already incorporated secret-derived ideas, and it does not disable unrelated NPC secrets or mystery-thread systems.

Unsolicited `<secrets>` blocks are also removed from generated region XML before it is reused as entrance-selection or NPC-generation context. The original generation response remains in its prompt log.

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
If the server is started with `--config-override`, `reload_config` keeps using the same override file as its startup layer.

Object values are merged recursively. Arrays, scalars, and `null` replace the lower-precedence value.
`config.yaml` must exist for normal server startup; copy `config.default.yaml` to `config.yaml` during setup.

## Start with managed local LLMs off

```bash
npm start -- --config-override ./config.yaml.strata-davidau --no-llm-autostart
```

`--no-llm-autostart` leaves game-owned llama.cpp and native Strata managers
initialized but off. Configuration/path validation and header controls remain
available. The LED starts dark; use the header LLM button to start the configured
manager explicitly. The flag neither adopts nor stops an externally running
instance. Default startup behavior is unchanged when omitted.

While intentionally off, managed router preload and the default character's
optional background inventory prompt are skipped; the character is still created.
Local prompts fail through the existing off guard, and image work cannot restart
the model. Prewritten images and explicit remote-provider requests retain their
normal behavior. Remote-only/external-only profiles keep their existing startup
preload and inventory generation. An explicit `--load-game` that genuinely needs
local missing-data generation can fail clearly until the model is turned on; no
placeholder data or deferred loading is introduced.

The flag is process-local, not a config/save property. It follows the neighboring
boolean CLI convention (`--no-llm-autostart=true` or `=false`, also 1/0/yes/no/on/off);
invalid/duplicate values fail. A guarded self-restart preserves the original argv,
so it preserves this startup choice even if the model was manually turned on
before the restart. See [ManagedLocalLlmController](classes/ManagedLocalLlmController.md).

## Per-game YAML override

The `/config` page exposes a per-game YAML override textarea for the loaded save.

Merge precedence becomes:

1. `config.default.yaml`
2. `config.yaml`
3. `--config-override` file
4. loaded game's YAML override

An override file selected later with `/reload_config <override_file>` becomes a fifth, process-local layer above the loaded game's YAML override. This lets a running server switch profiles without editing the loaded save.

Rules:
- The per-game override must contain a YAML object when non-blank.
- Blank input clears the per-game override for the loaded game.
- Editing the field triggers the same runtime reload path used by `/reload_config`.
- The raw YAML is saved as `gameConfigOverride.yaml` inside the save and is reapplied before save hydration on `/api/load`.
- New game creation reloads config with a blank per-game override before world generation begins.
- Like `/reload_config`, mod enable/disable edits are validated immediately but require a restart to fully change the active mod set.

## Runtime editing surfaces

The web UI and slash commands expose different config write paths:

- `/config` renders the merged config across Server, AI, Story Engine, Gameplay, and Image Generation tabs. Its save target is the active session override selected by `/reload_config <file>`, otherwise the startup `--config-override` file, otherwise root `config.yaml`; the exact target is displayed below the tab bar. The complete merged form is serialized into that target, so saving a formerly sparse override intentionally turns it into a full configuration snapshot. Before replacement, the server copies the exact previous YAML to a timestamped file under Git-ignored `config-backups/`; that backup preserves comments, while the active `js-yaml` serialization does not. The page response tells the user to restart; the form save path does not run definition reloads or hot-toggle the active mod set. The separate Current Game tab requires an explicit save before its YAML override is reloaded and persisted.
- `/api/game-config-override` accepts `{ "yaml": "..." }`, requires a loaded game, stores the raw per-game YAML on `Globals`, and runs the same runtime reload path as `/reload_config`.
- `/reload_config [override_file]` reloads `config.default.yaml`, `config.yaml`, the startup CLI override, the loaded game override, and the active process-local session override; validates formula config; refreshes definition caches; invalidates Nunjucks caches; and reports mod enablement drift. A supplied relative path resolves from the project root and becomes the highest-precedence layer for the rest of the process. Bare reloads reuse it; restarting clears it. Selection is atomic, so a missing or invalid file leaves the current live config and prior session override unchanged.
- `/get <path>` reads a dotted path from `Globals.config`.
- `/set <path> <value>` mutates the in-memory `Globals.config` object only. It parses `true`/`false` as booleans and leaves other values as strings. It does not write YAML or reload definitions.

## Prompt concurrency and stagger

Two root-level values tune concurrent text prompts:

```yaml
max_concurrent_requests_all_models: null
stagger_concurrent_prompts: 4
```

- `max_concurrent_requests_all_models` is optional. When set to a positive integer, `LLMClient` enforces that cap across all real text-generation requests regardless of backend, model, API key, OAuth identity, or CLI bridge session key. Each request still also honors the existing per-model/API-key semaphore from `ai.max_concurrent_requests`.
- `stagger_concurrent_prompts` is the number of seconds between staggered prompt launches. It defaults to `4` when omitted or blank. Event checks launch immediately, need-bar event checks launch after one interval, and quest checks launch after two intervals. Values must be non-negative finite numbers.

## Test-only completion recording and replay

`ai.record_outputs_file` and `ai.force_outputs_file` support deterministic API regression runs. Their environment-variable equivalents are `LLM_RECORD_OUTPUTS_FILE` and `LLM_FORCE_OUTPUTS_FILE`. Relative paths resolve from the project root.

```yaml
ai:
  record_outputs_file: tmp/vehicle-live-record.json
  force_outputs_file: ""
```

Only one may be nonblank. `record_outputs_file` atomically records accepted logical LLM completions as an incomplete version 2 cassette until the scenario explicitly completes it through the cassette API. `force_outputs_file` accepts the existing legacy by-label fixtures or a complete version 2 cassette. Version 2 replay is globally ordered and requires an exact semantic request fingerprint; mismatch, exhaustion, concurrency, incomplete input, or unused entries fail explicitly and never fall through to a live model.

These are test controls, not normal gameplay settings. A replay startup profile should also blank `ai.local_startup_script_path`, set `ai.unload_during_image_generation: false`, blank `router_preload_model`, and set `unload_model_on_switch: false` when the goal is to prove the case runs without starting or contacting local llama.cpp. `tests/followup_api_playtest/config_profiles/vehicle-mechanics-replay.json` provides that overlay.

## Pause AI Model During Image Generation

The image model lifecycle coordinates GPU ownership with ComfyUI. Router mode uses `unload_during_image_generation`; locally managed process mode uses `terminate_during_image_generation`; optional `image_generation_handoff` selects Strata elastic cache resizing or full RAM standby. These choices are mutually exclusive. Each mode flushes image-prompt writing immediately, waits for active text requests, holds the exclusive model-lifecycle gate during the complete render batch, and requires `ai.backend: openai_compatible` plus `imagegen.engine: comfyui`.

### Strata elastic VRAM handoff

```yaml
ai:
  backend: openai_compatible
  endpoint: http://127.0.0.1:8080/v1/chat/completions
  apiKey: none  # Placeholder for a local Strata server without API authentication.
  model: qwen3.8-flash-next-davidau-turbo-brilliance-iq3_s-plain
  unload_during_image_generation: false
  terminate_during_image_generation: false
  local_startup_script_path: null
  image_generation_handoff:
    provider: strata
    mode: elastic
    min_free_vram_mib: 12288
unload_model_on_switch: false
router_preload_model: null
```

The effective `image_prompt_generation` profile supplies this configuration,
including prompt-specific endpoint/model/authentication overrides. The optional
handoff object defaults to null, preserving existing profiles. Only provider
`strata` is supported; its omitted minimum defaults to 12288. The minimum is a
positive integer of **total free VRAM in MiB** required before rendering.
AIRPG asks Strata to reserve the GPU's total MiB, allowing its elastic cache to
shrink as far as Strata permits, then checks actual free VRAM against that minimum.
An HTTP 200 response alone does not admit rendering. Unknown handoff keys,
invalid values, unsupported providers and conflicting
legacy modes fail explicitly; values are never clamped and failure never falls
back to unloading Strata.

`mode` defaults to `elastic`, preserving existing behavior. Set
`mode: ram_standby` to use a Strata run config with `"ram_standby": true` and
the matching patched engine/API. Strata saves its active session to private
tmpfs, retains its model pages in locked system RAM, exits its engine and
vision workers, and reports their absence and actual free VRAM before ComfyUI
starts. After rendering, AIRPG releases ComfyUI VRAM and releases the text gate
without proactively waking Strata. The next prompt wakes it after the existing
pre-prompt ComfyUI cleanup, attaches the retained arena and restores the active
session. An external caller's prompt is also a deliberate wake signal. A second
image batch while already in RAM standby keeps it there. Other parked
conversation caches may rebuild on later prompts. If strict page locking or
session handoff fails, rendering is refused with the original error.

Strata must already be running with `vram_elastic: true`. AIRPG verifies the exact
loaded model and elastic capability through `/v1/status`, requests `/v1/vram`,
and checks actual free VRAM before admitting ComfyUI. Its minimum cache can
prevent a requested reserve even when the HTTP action succeeds. After rendering
or cancellation/failure, AIRPG releases ComfyUI VRAM, then restores Strata with
`reserve_mib: null` before releasing queued text requests. A possibly accepted
shrink also receives compensating restoration. Recovery retains the original
endpoint/model even if configuration changes during rendering.

The engine, KV state and host expert arena stay loaded. Restoration may leave a
smaller cache than its nominal full size to honor Strata's startup reserve. The
measured DavidAU setup made 13,157 MiB total available in one cycle; this is not
proof that every ComfyUI workflow fits. Its PLE mapping is currently unlocked,
so this mode does not guarantee zero disk I/O under host-memory pressure.

New server code requires a separately authorized game-server restart. Later
configuration-only changes can use `/reload_config <profile>` when ComfyUI was
already initialized at startup; reload does not create a missing image client or
replace loaded JavaScript. Startup, saves and runtime reload validate the optional
handoff before applying it. This feature has YAML configuration only.
See [StrataVramClient](classes/StrataVramClient.md) and the
[implementation plan](strata_vram_handoff_plan.md).

The optional full profile [`config.yaml.strata-davidau`](../config.yaml.strata-davidau)
routes all text and dedicated vision prompts to the local DavidAU Strata model.
It preserves the current gameplay and ComfyUI generation/edit settings, sets
the Strata handoff minimum to 12288 MiB, clears local llama.cpp lifecycle routes,
and replaces inactive remote image credentials with placeholders. It is a
secret-free configuration file; selecting it does not start Strata itself.
The profile sets both `ai.max_concurrent_requests` and the root
`max_concurrent_requests_all_models` to `1`, matching the running Strata profile's
single serving slot. Parallel decoding requires enabling Strata batch slots;
each slot consumes additional VRAM that would otherwise hold experts, so this
24 GB GPU/IQ3_S setup keeps one request at a time.
The local deployment enables `ai.live_deslop` with the custom Strata
generated-token logprob API described in
[LiveDeslop](classes/LiveDeslop.md#local-strata-backend). The upstream release
alone does not provide those token alternatives. TinyBrain is independent.
After Strata is running with elastic VRAM enabled, select the profile on a
separately authorized game-server start with:

```bash
npm start -- --config-override ./config.yaml.strata-davidau
```

The public profile has no Kimi prose override. A Kimi-prose alternative remains
only as a temporary review candidate under `tmp/strata-handoff-config-candidates/`.

### Router unload mode

`ai.unload_during_image_generation` controls coordinated GPU ownership between a llama.cpp text model and ComfyUI:

```yaml
ai:
  unload_during_image_generation: false
```

The setting defaults to `false` and must be a boolean. It is an AI model setting, so a matching `ai_model_overrides` profile can enable or disable it for specific prompt labels; the same effective profile supplies the model, endpoint, headers, and credentials used for router management.

For router servers that can leave streamed HTTP connections open, configure `ai.headers.Connection: close`. The header is reused for both chat and router-management requests, preventing a stale pooled connection from causing a later `/models` status read to fail with `socket hang up`.

Before every real LLM transport attempt whose effective setting is `true`, the server calls ComfyUI Cache Monitor's `/comfyui-cache-monitor/release_vram`, preserving its RAM-backed model cache. Only a failed or unconfirmed Cache Monitor release may invoke ComfyUI `/free` with both model-unload and memory-release flags. This happens after the request acquires the shared model-lifecycle gate and before any request reaches the text backend. Failure of both cleanup requests prevents the prompt from starting and surfaces as an explicit prompt error. When image rendering itself is disabled but any AI profile enables this mode, the server still initializes and connectivity-checks a ComfyUI client solely for pre-prompt cleanup.

When enabled:

1. Image-prompt writing requests flush immediately and finish before rendering begins.
2. Active text requests finish, while new text requests wait behind an exclusive lifecycle gate.
3. The server verifies the configured model through llama.cpp router `GET /models`, then calls `POST /models/unload` and waits for `unloaded`. Transient status-read failures receive two bounded retries; non-transient failures still surface immediately.
4. Every queued ComfyUI render runs using normal `imagegen.maxConcurrentJobs` concurrency.
5. After the render queue is empty, the server POSTs to ComfyUI Cache Monitor's `/comfyui-cache-monitor/release_vram` so active model weights leave VRAM without detaching their RAM-backed caches. If Cache Monitor fails, the server uses full ComfyUI `/free` cleanup and broadcasts a browser warning recommending installation or enablement of the custom nodes. It then calls llama.cpp `POST /models/load`, waits for `loaded`, and releases queued text requests.

The enabled setting requires `ai.backend: openai_compatible` and `imagegen.engine: comfyui`; incompatible configurations fail validation. The llama.cpp endpoint must be a router-mode server that exposes `/models`, `/models/unload`, and `/models/load`. ComfyUI cleanup is optional and logs a warning on failure, but llama.cpp reload is still attempted. Image-prompt requests received during rendering wait until the current model has reloaded, then begin the next cycle.

The System Configuration page exposes this setting as **Unload During Image Generation** in the AI section.

### Local LLM header control

A configured game-owned Strata or llama startup manager exposes the shared header
LLM toggle. It waits for active prompts/images before changing the model and
retains manual-off intent until explicitly turned on. The state belongs to this
server session, not a game save or configuration file; a server restart restores
the configured automatic startup behavior unless `--no-llm-autostart` is present.
External endpoints expose no control.
See [ManagedLocalLlmController](classes/ManagedLocalLlmController.md) for status,
error recovery and API contracts.

### Live XML closing-tag guard

`ai.xml_closing_tag_guard` is an independent boolean, default false, enabled in
`config.yaml.strata-davidau`. It requires OpenAI-compatible sampled logprobs and
exact assistant-prefill continuation. Standard and TinyBrain XML use the existing
stream/nonstream branch rewind; prose deslop can remain disabled. Plain stages
explicitly bypass guard overhead. Unsupported enabled transports or exhausted
alternatives fail explicitly; strict final XML/domain parsers still validate all
results. Actual premature EOS can continue only with explicit terminal sample metadata,
remaining output budget and a finite retry-derived EOS round allowance. Unknown
stop causes with incomplete XML fail diagnostically; completed XML is never repaired. See
[XmlClosingTagGuard](classes/XmlClosingTagGuard.md) for output-scope details.

### Native Strata runtime ownership

`ai.strata_runtime` defaults to `null`, retaining external runtime control. An
explicit object with `executable`, saved `profile`, and required `resources`
(`memory_max_mib`, `memlock_mib`, `shm_size_mib`, positive integer MiB values)
makes the game own that native Strata CLI runtime before startup prompts and stop
only its captured service invocation after verifying owner/instance during
graceful shutdown or self-restart. The
saved Strata model profile is unchanged. Endpoint/model and Linux parent-death
identity are verified; an already-running external runtime is refused. Startup
uses a unique systemd service with zero swap and a private `/dev/shm`; the optional
`termination_trace_path` passes Strata's trace environment variable to its API.
See [StrataRuntimeService](classes/StrataRuntimeService.md) for the explicit
privilege, containment and cleanup contract.

Managed ownership requires an HTTP OpenAI-compatible target and conflicts with
llama startup/unload/termination, router preload and model-switch unload settings.
Prompt overrides enabling ownership must match the root target; other providers
clear `strata_runtime` explicitly. Elastic and RAM standby image handoffs continue
to use their existing settings. Ownership changes require a server restart and
are rejected by in-process configuration reload/save validation. See
[StrataRuntime](classes/StrataRuntime.md) for lifecycle, cleanup and test contracts.
The DavidAU profile uses the ownership selection in its current YAML; the retained
`tmp/config.strata-runtime-candidate.yaml` and merge-only
`tmp/strata-runtime-activation.yaml` are preparation artifacts, not automatic
runtime selectors. Ownership changes require the separately authorized restart.
`--no-llm-autostart` can suppress startup without changing that profile.

### Local process startup and managed termination mode

`ai.local_startup_script_path` makes the game start and own a local llama.cpp process:

```yaml
ai:
  unload_during_image_generation: false
  terminate_during_image_generation: false
  local_startup_script_path: /absolute/path/to/start-llama.sh
```

Any nonblank root `local_startup_script_path` activates automatic startup independently of both `unload_during_image_generation` and `terminate_during_image_generation`. The path must resolve to an executable regular file, may be absolute or relative to the AI RPG project directory, and requires `ai.backend: openai_compatible`. The game executes it before router preloading and before any startup path can launch an LLM prompt, waits for the root AI endpoint's `/health` response, retains its PID/process group, and terminates it during normal game shutdown or before a guarded self-restart. This allows a game-owned local llama.cpp router to use router unloading or to run without any image-generation handoff.

`terminate_during_image_generation` defaults to `false` and must be a boolean. When it is true, `local_startup_script_path` is required. The termination and router-unload settings cannot both be true. As with router mode, the effective `image_prompt_generation` profile determines whether termination handoff is enabled. In that mode, startup uses the effective image-prompt startup path, and validation also resolves every prompt label referenced by `ai_model_overrides` and rejects any effective managed-process script that is missing, not a regular file, or not executable.

Termination handoff does not use llama.cpp router endpoints or model unload/load requests. It stops and starts only the saved local process group. The separate root-level `unload_model_on_switch` feature is independent and should remain `false` when local models are selected through startup scripts.

When either image-handoff mode is enabled, the server initializes the ComfyUI client and calls ComfyUI cleanup immediately before starting the local process. If ComfyUI is unreachable (for example, it is not running), startup logs a warning and continues: an unreachable ComfyUI instance cannot hold models in VRAM. A reachable cleanup failure still aborts startup explicitly. When both handoff flags are false, automatic local-process startup does not require or contact ComfyUI. Node retains the resulting PID and normalized script path in memory. The script should use `exec` for its final llama.cpp command; the managed child is also placed in its own process group so wrapper descendants receive the termination signal.

Before each real LLM transport whose effective AI profile enables managed termination, the request takes exclusive model-lifecycle access and compares its effective `local_startup_script_path` with the running process. If the normalized paths match, the process and PID are reused. If they differ, the old process group is terminated and awaited first; only then does the server run strict ComfyUI cleanup, start the replacement script, and wait for health before sending the prompt. This makes prompt-specific local-model overrides safe without repeatedly restarting consecutive prompts that use the same script. A switch failure is fatal for that prompt and the replacement transport is never sent.

For each image-render batch:

1. Image-prompt writing becomes quiescent and active text requests finish.
2. The server sends `SIGTERM` to the saved llama.cpp process group and waits for exit. A process that ignores the termination timeout receives `SIGKILL`; failure remains fatal and rendering does not start.
3. The queued ComfyUI render batch drains normally.
4. Even if rendering failed, the server POSTs to ComfyUI Cache Monitor's `/comfyui-cache-monitor/release_vram` so its RAM-backed cache is preserved. If that fails, it strictly performs full `/free` cleanup and broadcasts the Cache Monitor installation warning. It then immediately runs whichever startup script was active when rendering began.
5. The server waits for `/health`, then releases queued text prompts. If rendering and restart both fail, both errors are preserved in an `AggregateError`.

Configuration-page changes require the documented server restart to replace the process owner.

The System Configuration page exposes **Terminate During Image Generation** and **Local llama.cpp Startup Script** in the AI section. Leaving the path blank disables automatic local-process ownership.

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
  mutating_prompts_only: false
```

`chat_tools.request_user_input_enabled` defaults to `true` and must be a boolean when provided. When disabled, `requestUserInput` is removed from regular and generic chat-tool payloads.

`chat_tools.mutating_prompts_only` defaults to `false` and must be a boolean when provided. When enabled, native function calls execute only for prompts whose original execution scope contains a world-mutating or mechanical-resolution tool. Eligible prompts retain their existing tools, including lookups; this setting grants no new permissions. Standard player/NPC actions, generic world editing, plot analysis, mystery updates, and standard scheduled-event resolution retain their mutation-capable scopes. In-context questions explicitly opt out despite sharing the ordinary prose tool schema.

TinyBrain player/NPC actions and scheduled-event planning have lookup-only native scopes, so their native calls are disabled. Server-owned parsed plans, checks, attacks, XML event application, and scheduled-event mutations continue normally. TinyBrain creative actions retain their existing mutation-capable scope. A mod-only mutating tool must declare `mutatesWorld: true` when registered to qualify its prompt.

Disabled prompts receive no native tool definitions or generated tool-permission messages; restricted checkpoints receive only their executable subset. `tool_choice` is `none` when no tools are exposed. This can reduce prefix-cache reuse across checkpoints. Restricted prompts with callable tools may receive guidance listing only those exposed tools; forbidden responses are rejected before native execution. TinyBrain captures the original run scope before checkpoint narrowing. This option prevents native-call context growth; ordinary responses and checkpoints still accumulate normally. See [ChatToolPolicy](classes/ChatToolPolicy.md).

## Trackers

`trackers.short_string_max_words` controls the maximum number of whitespace-delimited words allowed for `short_string` tracker values.

```yaml
trackers:
  short_string_max_words: 4
```

The value defaults to `4` and must be an integer greater than or equal to `1` when provided. The limit is enforced by direct tracker creation, chat-tool tracker creation, and XML/legacy `tracker_updates` parsing, and the XML event prompt receives the same configured limit.

## Plot analysis

`plot_analysis.enabled` controls whether completed normal player-action turns schedule the non-blocking background `plot-analysis` prompt.

```yaml
plot_analysis:
  enabled: true
  interval: 3
  max_plot_threads: 3
  max_plot_complications: 3
```

`enabled` defaults to `true` and must be a boolean when provided. When disabled, new player turns do not schedule background plot-analysis work; queued or in-flight plot-analysis work rechecks the gate before tool execution and response storage. The latest saved `Globals.plotAnalysis` value still loads, persists, appears in base-context prompts, and remains visible through `/plot_analysis`. `/rp` temporarily sets this flag to `false` while roleplay mode is active.

`interval` sets how many eligible completed normal player-action turns pass between automatic plot-analysis runs. The counter advances after outcome/history processing and all player turn finalization, using the final location; errors or early returns before that boundary do not advance it. Creative-mode, question and generic prompt labels retain their existing exclusion. It defaults to `1` (every completed eligible turn) when omitted and must be an integer `>= 1` when provided; the shipped `config.default.yaml` sets it to `3`. The turn counter is stored in save metadata as `plotAnalysisTurnCounter` and resets on new game, so cadence survives save/load.

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

## Tonal Scale Evaluation

`tonal_scale_evaluation.enabled` controls whether completed player-action turns periodically schedule the tonal-scale evaluation prompt after turn finalization.

```yaml
tonal_scale_evaluation:
  enabled: true
  interval: 5
```

`enabled` defaults to `true` in `config.default.yaml` and must be a boolean when provided.

`interval` defaults to `5` and must be an integer greater than or equal to `1` when provided. The cadence counts completed player-action turns after `Player.finalizeTurn()` runs. The prompt renders `prompts/_includes/tonal-scale-evaluation.njk` through the shared base-context wrapper with `promptType: "tonal-scale-evaluation"`, logs through `LLMClient.logPrompt()` as `tonal_scale_evaluation`, extracts only the text inside `<tonalScaleEvaluation>`, and stores it in save metadata. Normal base-context prompts inject the latest stored result before `<currentConditions>` inside a `<tonalScaleEvaluation>` block with a turns-ago staleness warning; the block is omitted when rendering the tonal evaluation prompt itself. `/tonal_scale_evaluation` runs the same prompt immediately and stores a visible `tonal-scale-evaluation` chat entry that is excluded from every LLM-facing prompt-history path.

The System Configuration page exposes both settings in its **Tonal Scale Evaluation** section. The checkbox writes `tonal_scale_evaluation.enabled`; the numeric interval field writes `tonal_scale_evaluation.interval`, defaults to `5`, and enforces a minimum of `1` in the browser before server-side validation.

## Mystery Box Cleanup

`mystery_box_cleanup.interval` controls how often eligible player-action turns schedule the non-blocking mystery cleanup prompt.

```yaml
mystery_box_cleanup:
  interval: 10
```

`interval` defaults to `10` and must be an integer greater than or equal to `1` when provided. The cadence counts the same eligible player-action submissions as the improvement prompt. The prompt runs through the shared base-context wrapper with `promptType: "mystery_box_cleanup"`, reviews active mystery threads and unresolved contained boxes by exact id, logs through `LLMClient.logPrompt()` as `mystery_box_cleanup`, marks resolved threads inactive, marks revealed boxes resolved, and persists mystery state when a current save directory is attached. The same cleanup runner is available manually through `/resolve_mystery_threads`.

## Event Checks

`event_checks.enabled` controls whether narrative event processing runs at all. When it is `false`, prose does not mutate world state through event checks and quest completion checks are skipped.

```yaml
event_checks:
  enabled: true
  use_xml: true
```

`event_checks.use_xml` defaults to `true` and must be a boolean when provided. When enabled, `Events.runEventChecks(...)` uses the `events-xml` prompt for ordinary event categories and parses one `<events>` block. Need bars still use the dedicated `need-bars` prompt when need-bar definitions are present, and those results are injected as ordinary `needbar_change` events before outcomes are applied. Set `event_checks.use_xml` to `false` to use the legacy grouped `event-checks` prompts plus the same dedicated `need-bars` prompt. The `/config` page exposes the same option as “XML Event Pipeline”.

## Housekeeping And Quest-Check Intervals

Ordinary housekeeping, faction housekeeping, and quest-completion prompts have independently configurable intervals:

```yaml
housekeeping:
  interval: 4

faction_housekeeping:
  interval: 11

quest_checks:
  enabled: true
  interval: 5
```

All intervals must be integers greater than or equal to `1`. Missing ordinary-housekeeping and quest-check intervals default to `1`; missing `faction_housekeeping.interval` defaults to `11`, including older configurations. The shipped `config.default.yaml` sets ordinary housekeeping to `4`, faction housekeeping to `11`, and quest checks to `5`. An interval of `N` runs the prompt on every Nth eligible check. Housekeeping counts top-level automatic event-check passes; recursive and explicitly suppressed passes do not advance its counter. Split movement counts once after its origin and destination results are merged. Each successful housekeeping prompt advances a persisted player-turn history boundary; the next prompt receives every player turn after that boundary, while the first-ever prompt receives only the latest `housekeeping.interval` turns. The manual `/housekeeping` command bypasses the automatic interval but uses and advances the same successful-run history boundary. Quest checks count only when they are enabled and the player has at least one active, unpaused quest; calls with no eligible quests do not advance their counter. A true XML `anyQuestObjectivesCompleted` event signal runs the quest check during the same turn when it has not already run and resets the counter after a successful check.

The two counters and the `lastHousekeepingTurnId`/`lastHousekeepingTurnTimestamp` cursor are persisted in save metadata and restored on load, so cadence and housekeeping context continue across restarts. The timestamp lets housekeeping resume after a manually deleted boundary turn; legacy ID-only saves use one bounded recent-turn recovery window before migrating on a successful run. A new game resets both counters and begins without a housekeeping boundary. The `/config` page exposes all three interval fields.

Automatic faction housekeeping runs when the existing eligible housekeeping counter is positive and divisible by its own `faction_housekeeping.interval`, with no offset. At interval `11`, reviews run on eligible turns 11, 22, and so on; interval `1` runs from the first eligible turn. Ordinary housekeeping retains its own cadence. Changing the faction interval applies to the current persisted eligible-turn clock rather than resetting activation time. Suppressed/recursive passes and merged-movement counting remain shared, and ordinary-housekeeping failure does not alter faction cadence. The first faction review uses its own interval as the recent-history window; later successful reviews use the existing saved review boundary. Plans and that boundary persist without an additional counter or activity scheduler. See [FactionHousekeepingService](classes/FactionHousekeepingService.md).

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

The qwen-combo-router profile routes player-visible narrative work through its 27B prose-model override. In addition to ordinary, creative, NPC, crafting, random-event, and game-intro narration, this includes location-modification and checked-container results, quest rewards, visible while-away narration, storyteller questions, no-context generic prompts, scheduled-event narration, and the rewrite used only when an event occurs partway through a longer player action. `slop_remover` deliberately remains on the default fast model because it edits existing prose instead of originating a scene.

`config.yaml.qwen-combo-router-kimi-prose` is the hybrid frontier/local variant. It preserves that same prose prompt-label list but routes it through `kimi_cli_bridge` with Kimi's configured default model and low thinking effort. Those prose families use their ordinary non-TinyBrain templates; event checks, need-bar checks, scene summaries, and all other prompts remain on the local `Qwen3.6-35B-A3B-uncensored-heretic-Native-MTP-Preserved-GGUF`, with TinyBrain enabled for the three structured families. The local Qwen MoE is also the router preload target. Because a CLI bridge is not a llama.cpp router target, this profile disables global model-switch unloading and live deslop; completed-response slop removal remains enabled, while the existing ComfyUI render handoff still unloads and reloads the local model.

`config.yaml.kimi-cli-bridge` is the all-Kimi counterpart. It is a full configuration snapshot based on `config.yaml.qwen-combo-router-artemis`, preserves that profile's complete ComfyUI generation/edit workflow and image-prompt settings, and routes every text prompt—including the existing prose override labels—through `kimi_cli_bridge` using Kimi's saved default model with low thinking effort. TinyBrain is disabled so those families use their standard prompts. Since no local text model remains, the profile blanks router preload state, disables model-switch unloading and live deslop, and clears the managed llama.cpp startup and image-handoff settings. Completed-response slop removal and ComfyUI rendering remain enabled.

`config.yaml.codex-luna-kimi-prose` derives from the all-Kimi profile and keeps its complete Artemis-derived image-generation configuration. Unmatched text prompts use `codex_cli_bridge` with `gpt-5.6-luna` and `codex_bridge.reasoning_effort: none`; only the unified `event_checks` label moves to `gpt-5.6-terra` with the same `none` effort, while `need_bar_event_checks` and every other non-prose label remain on Luna. The existing player-visible prose label list explicitly overrides the backend to `kimi_cli_bridge`, using Kimi's saved default model with low thinking effort. The Codex bridge home is blank in both Codex routes so their subprocesses use the current user's already-authenticated default Codex home instead of an isolated unauthenticated directory. All routes use fresh sessions, TinyBrain and live deslop remain disabled, and no llama.cpp lifecycle setting is enabled.

`config.yaml.artemis-kimi-prose` keeps the same Artemis-derived ComfyUI workflow and current gameplay settings while routing every unmatched/non-prose text prompt to the local `Artemis-31B-v1.Q4_K_S` llama.cpp endpoint. Its sole active model override sends the player-visible prose label list to `kimi_cli_bridge` with Kimi's saved default model and low thinking effort. TinyBrain is enabled for local Artemis event checks, need-bar checks, and scene summaries; every supported prose family handled by the Kimi override has its family switch disabled so Kimi receives the ordinary prompt. The root route enables managed termination handoff, disables router unloading/model switching and startup preloading, and uses `scripts/start-artemis-ram-router.sh`. The prose override explicitly disables both image-handoff flags and clears the local startup path so Kimi never participates in the llama.cpp lifecycle.

`config.yaml.artemis-v1.2-nvfp4` derives from `config.yaml.artemis-kimi-prose`
and runs every text prompt on local `Artemis-31B-v1.2-NVFP4` at
`http://127.0.0.1:5005/v1/`. Root TinyBrain and all 15 inherited supported-family
switches stay enabled. Active model overrides are empty, so prose also uses
local Artemis, and dedicated multimodal routing is disabled to prevent remote
vision calls. The source profile's gameplay, rendering, sampling, and other
settings are preserved. Archived disabled provider settings remain inactive.
Select this profile at startup with:

```bash
npm start -- --config-override ./config.yaml.artemis-v1.2-nvfp4
```

Its executable `scripts/start-artemis-v1.2-nvfp4-ram-router.sh` delegates to
the existing Artemis RAM router launcher with the exact source
`/d/llms/Artemis-31B-v1.2-NVFP4.gguf` and an isolated staging directory,
`/dev/shm/ai-rpg-artemis-v1.2-nvfp4-models`. It retains the custom llama.cpp
binary, 70,000-token default context, Q8 K/V caches, one resident model, text-only
loading, three-minute idle sleep, and managed termination during ComfyUI
rendering. The GGUF is approximately 19.3 GB and is staged only when this
launcher is actually run; creating the profile does not activate it.

`config.yaml.gemma4-a4b-artemis-v1.2-prose` clones the current local Artemis
profile, including its TinyBrain, rendering, vision, and lifecycle settings.
Unmatched prompts now use `Merousis-26B-A4B.Q5_K_M` in place of the original
Gemma selection; the profile retains its existing filename. The `prose`
override uses `Artemis-31B-v1.2-NVFP4` for the same 16 narrative prompt labels
as the historical local MoE/Artemis split. This includes player/NPC actions,
crafting, location changes, container narration, random events, NPC
plausibility, quest rewards, while-away narration, generic prompts, questions,
game introductions, scheduled events, and interruption rewrites. Prose retains
the inherited TinyBrain switches. Other work, including `slop_remover`, stays
on Merousis.

The selected wrapper `scripts/start-merousis-a4b-ram-router.sh` uses the
regular model file `/d/llms/Merousis-26B-A4B.Q5_K_M.gguf`
and stages it in `/dev/shm/ai-rpg-merousis-a4b-models`. Both model wrappers
reuse the shared launcher's current 70,000-token default and local port 5005.
The managed process switches startup scripts between prompt profiles, stopping
the previous process before starting the next, so only one text model is
resident. Router-level model-switch unloading stays disabled; managed
termination during image generation stays enabled. Creating this profile does
not activate it or load either model. Select it on a separately authorized
server start with:

```bash
npm start -- --config-override ./config.yaml.gemma4-a4b-artemis-v1.2-prose
```

The root `config.yaml` follows the same local/Kimi split but selects a vision-capable main model with `ai.has_vision: true`, so image-referenced text prompts remain on their effective main or prompt-override profile instead of switching to `ai_multimodal`. It retains NanoGPT's image-generation credentials as the requested inactive alternative to the selected ComfyUI engine and omits unused Mimo, Pollinations, LocalAI, Codex bridge, Cline bridge, disabled Z.AI, and inactive `dumb` override service configuration.

`scripts/start-artemis-ram-router.sh` stages `/d/llms/Artemis-31B-v1.Q4_K_S.gguf` in the dedicated `/dev/shm/ai-rpg-artemis-models` directory before starting a one-model router. Staging is serialized with `flock`; an existing copy is reused only when its byte size and recorded source device/inode/size/mtime fingerprint still match. New copies are written to a partial file and renamed into place only after their size is verified. The staged GGUF intentionally survives managed llama.cpp termination and is naturally discarded when the host clears `/dev/shm`. The router uses a 70,000-token default context, Q8 KV caches, full GPU offload, `--no-mmproj`, and a three-minute idle sleep. Because it starts in router mode without `router_preload_model`, restarting the lightweight router after a ComfyUI batch does not load Artemis until a non-prose request arrives; idle sleep destroys the loaded model and KV cache while leaving the tmpfs GGUF available for the next RAM-to-VRAM load. `ARTEMIS_LLAMA_BINARY`, `ARTEMIS_SOURCE_MODEL`, `ARTEMIS_SHM_MODELS_DIR`, `ARTEMIS_LLAMA_HOST`, `ARTEMIS_LLAMA_PORT`, `ARTEMIS_LLAMA_CTX_SIZE`, and `ARTEMIS_LLAMA_SLEEP_IDLE_SECONDS` provide explicit launch-time overrides.

`scripts/start-all-models-router.sh` is the managed launcher for freely switching the root local model in `config.yaml`. It discovers every top-level `.gguf` in `/d/llms` except projector files whose names contain `mmproj`, rebuilds a symlink-only catalog at `/tmp/ai-rpg-all-model-catalog`, and points llama.cpp router discovery at that catalog. Its shared defaults are a 105,000-token context, Q8 KV caches, full GPU offload, no multimodal projector, no reasoning, one resident model, and a three-minute idle sleep. The catalog prevents a projector GGUF from appearing as a selectable language model without copying model weights. `ALL_MODELS_LLAMA_BINARY`, `ALL_MODELS_SOURCE_DIR`, `ALL_MODELS_CATALOG_DIR`, `ALL_MODELS_LLAMA_HOST`, `ALL_MODELS_LLAMA_PORT`, `ALL_MODELS_LLAMA_CTX_SIZE`, and `ALL_MODELS_LLAMA_SLEEP_IDLE_SECONDS` override those launch-time paths and values. Models that cannot support the shared context or fit its VRAM allocation fail during their own load rather than being silently adjusted.

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

Merchant currency refreshes also use a configurable NPC-level multiplier:

```yaml
formulas:
  barter:
    currency_multiplier: "1 + (level / 3)"
```

`level` is the merchant NPC's own level, rather than the location level. The formula uses the shared [FormulaEvaluator](classes/FormulaEvaluator.md) arithmetic and functions; no other variables are available. Missing/invalid formulas, unknown variables, or a negative/non-finite multiplier fail configuration validation. Startup and reload validate at level 1; each fresh merchant-currency estimate evaluates the formula again at that NPC's current level.

Initial stock generation and daily refresh ask the pricing prompt for an unscaled, level-neutral currency baseline. The server multiplies that fresh estimate once, then uses `Player.setCurrency()`'s existing whole-unit round-down. For example, level 6 and a baseline of 100 produce 300 currency. Zero is a valid multiplier. Baselines and the final whole-unit amount must stay within the non-negative safe integer range; invalid values fail rather than being clamped.

Opening a session without a stock refresh, haggling, and ordinary transfers preserve the current balance without another multiplication. Reloading the formula does not retroactively scale saved balances or NPC starting funds. Standard merged configuration and game/session overrides apply normally. See [barter-currency-formula](utils/barter-currency-formula.md) for the shared validation/application helpers.

## NPC Generation

`npc_generation.max_quantity` caps generated NPC quantity groups.

```yaml
npc_generation:
  max_quantity: 20
```

Location, region, and single-NPC generation prompts may return `<quantity>`. Missing or blank values default to `1`; non-integer text is warning-logged after stripping non-numeric characters; values are clamped to `1..npc_generation.max_quantity`. Quantity groups expand only after name cleanup, progression, abilities, inventory generation, and equipment assignment, so each numbered NPC receives its own copied gear with the original item names preserved. Those copied items remain separate while held by different NPCs but are stack-compatible when later dropped or moved into the same destination.

## Mystery Threads

`mystery_threads.max_active` caps how many active private mystery threads are injected into base-context prompts and how many automatic mystery threads the reactive mystery-box flow can keep active. `mystery_threads.max_unresolved_boxes_per_thread` caps unresolved boxes in each thread; resolved historical boxes remain persisted but free capacity.

```yaml
mystery_threads:
  max_active: 3
  max_unresolved_boxes_per_thread: 3
```

Both values require non-negative integers. Setting either effective capacity to `0` prevents automatic creation. Existing over-cap saves are preserved, but automatic tracking cannot add another unresolved box until capacity opens.

Base context exposes the active-thread count, per-thread unresolved counts, and whether overall mystery capacity is full. When all active thread and unresolved-box slots are full, prose prompts explicitly forbid every form of new mystery—including unexplained clues, hidden actors, secret motives, suspicious discrepancies, unexplained oddities, ominous implications, and foreshadowed questions. They may reveal or resolve established mysteries without branching them into new questions.

## Main quest

Optional persistent [main quest](api/main_quest.md) line.

```yaml
main_quest:
  enabled: true
  stage_count: 8
  full_check_interval: 12
  pressure_clock_enabled: true
```

- `enabled` (boolean, default `true`): when false there is no start popup or start action, no `<mainQuest>` prompt block, no plot-analysis pin, and no automatic checks. Saved main quests are kept.
- `stage_count` (whole number ≥ 1, default `8`): stages in a newly generated main quest. Never shown to the player; existing main quests keep their own count.
- `full_check_interval` (whole number ≥ 1, default `12`): completed player-action turns between full progress checks that run regardless of other triggers. Between those, the full check runs only at the end of a turn in which the current stage quest was completed or the event checker emitted `<mainQuestProgress>` (see [main quest API](api/main_quest.md#automatic-checks)).
- `pressure_clock_enabled` (boolean, default `true`): when false, main-quest prompts are not offered deadlines and no hidden deadline trackers or deadline scheduled events are created. The vague player-facing pressure text still appears.

TinyBrain families `main_quest_generate` and `main_quest_check` follow `ai.tinybrain_prompts`.

## Faction favors

Activatable [faction favors](api/factions.md#faction-favors) at positive reputation tiers.

```yaml
faction_favors:
  enabled: true
  rival_witness_penalty: 1
```

`enabled` (default `true`, must be a boolean) controls favor generation (new-game reputation tiers, faction form fill, older-save backfill), the base-context `<factionFavors>` block, the `/api/player/favors` list and activation. Disabling keeps stored favors and cooldowns; re-enabling restores them.

`rival_witness_penalty` (default `1`, whole number ≥ 0) is the standing lost by each faction whose relation toward the favor's faction is `rival` when one of its living members is in the scene or party as the favor is used; `hostile` factions lose double. `0` disables rival penalties. The penalty is computed in code with no LLM call.

Favor icons use `imagegen.prompt_generator_templates.favor` (default `favor-image.xml.njk`), `imagegen.image_prompt_instructions.favor`, and `imagegen.favor_settings.image` (default 1024 × 1024); see [images API](api/images.md#faction-favor-icons).

## AI backend selection

`config.ai.backend` selects the text-generation transport.

```yaml
ai:
  backend: openai_compatible
```

Supported values:
- `openai_compatible`: the `/chat/completions` HTTP path using `ai.endpoint`, `ai.apiKey` or OAuth refresh-token auth, and `ai.model`.
- `codex_cli_bridge`: runs text requests through the local Codex CLI bridge; this backend uses `ai.model` plus `ai.codex_bridge.*` and does not require `ai.endpoint` or `ai.apiKey`.
- `cline_cli_bridge`: runs text requests through the local Cline CLI bridge; this backend uses `ai.model` plus `ai.cline_bridge.*` and does not require `ai.endpoint` or `ai.apiKey`.
- `kimi_cli_bridge`: runs text requests through the authenticated local Kimi Code CLI; this backend uses `ai.kimi_bridge.*`, does not require an endpoint, API key, or shared `ai.model`, and uses Kimi's saved default model when `ai.kimi_bridge.model` is blank.

Validation rules:
- `backend` defaults to `openai_compatible` when omitted.
- Unknown backend values fail validation loudly at startup and on reload.

## Core AI request settings

Region/location generation uses a separate output-token budget:

```yaml
world_generation:
  max_tokens: 20000
```

`world_generation.max_tokens` must be a positive integer. The project default is
`20000` per standard completion or TinyBrain stage, including retries and tool
continuations. It overrides `ai.maxTokens`, model-profile limits and explicit
caller/payload caps for the allowlisted generation families, without changing
model routing or ordinary player-action/prose budgets. This includes item,
scenery and NPC population plus their inventory, naming, progression, abilities,
equipment and other structured enrichment prompts. It is an output budget, not a
context-window setting. Faction generation, relationships, reputation tiers and
short descriptions share this budget. Token-chunked completions retain their smaller transport
windows within this logical budget. OpenAI-compatible backends enforce the cap;
the existing CLI bridges do not expose output-token limits. See
[WorldGenerationTokenBudget](classes/WorldGenerationTokenBudget.md) for coverage
and payload precedence.

These keys are shared by normal prompt calls unless a caller or `ai_model_overrides` profile supplies a more specific value:

```yaml
ai:
  model: zai-org/glm-4.7
  has_vision: false
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

`ai.has_vision` defaults to `false`. For an image-bearing text prompt, an effective value of `true` keeps the request on the main AI profile instead of switching to `ai_multimodal`. Prompt-specific `ai_model_overrides` are included when resolving this flag: an override can set `has_vision: true` to keep that override's model, backend, endpoint, headers, and credentials for vision, or set it to `false` to retain the normal `ai_multimodal` merge followed by the matching override profile.

- `model` is the default model for OpenAI-compatible, Codex, and Cline requests. Kimi selects `ai.kimi_bridge.model` through ACP session configuration when set and otherwise keeps Kimi's saved default.
- `maxTokens` becomes `max_tokens` when a prompt call does not provide a positive `maxTokens`; server helpers may also use it as a minimum when resolving prompt-specific token caps.
- `temperature`, `top_p`, and `stream` map to chat-completion payload fields. CLI bridges force `stream: false` at the normalized `LLMClient` payload layer because streaming is handled by the bridge client.
- `lowTemperature` and `highTemperature` are available to caller code that chooses bounded temperature variants.
- `prefill` can be `null` or a string. When set for `openai_compatible`, `LLMClient` appends the string as a final assistant message and returns `prefill + generated continuation`, avoiding duplicate text when the provider echoes the prefill. This is rejected for tool-call requests and for CLI bridges.
- `sysprompt_append` can be `null`, blank, or a string. A non-empty string is inserted into the outbound request as an additional `system` message after existing system messages, or before the first user message when the prompt did not already include a system message. This applies to every text backend and does not mutate caller-provided message objects.
- `stream_start_timeout` and `stream_continue_timeout` are seconds. Retry attempts add `increment_start_timeout` and `increment_continue_timeout`, also in seconds.
- Streamed llama.cpp/Strata routes identified by managed startup, router unloading, Strata runtime/handoff or Strata prefix-cache configuration automatically request `return_progress: true`. Identification stays bound to each source's configured endpoint; endpoint-only remote overrides do not inherit it. External compatible servers may opt in through existing `custom_args: { return_progress: true }`; use a route-specific override (or remove/disable the inherited argument on unrelated providers). Explicit `false` disables the extension. Non-stream and CLI requests omit it. Valid context progress refreshes the start idle deadline without counting as generated output or ending TTFT waiting; the first generated text/reasoning/tool arguments switch the existing green context meter to ordinary output progress. Short/cached streams may have no prefill report. See [LLMClient progress](classes/LLMClient.md#prompt-progress-and-cancellation).
- `supress_seed: true` omits the `seed` payload field. The key name is spelled `supress_seed` in the config file and code.
- `max_concurrent_requests` controls the per-model/API-key semaphore for OpenAI-compatible requests and the one-shot/fresh-session concurrency limit for CLI bridges. The root `max_concurrent_requests_all_models` setting can add a process-wide cap across those per-key semaphores.
- `model_swap_options` drives the `/config` page model selector for remote providers and CLI bridges and is saved as a JSON string-array field by that page. When `ai.backend` is `openai_compatible` and either `ai.local_startup_script_path` is configured or `ai.endpoint` uses a loopback hostname, `/config` instead queries the running llama.cpp router's read-only `/models` endpoint and limits the selector (including mod model selectors) to the unique model IDs it advertises. A failed local query is shown on the page and does not fall back to stale configured choices.

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

`ai.baseTimeoutSeconds` is the shared base request timeout for non-Codex text-generation calls. `LLMClient` converts this value to milliseconds before dispatching a request. The Cline bridge uses it as the no-stdout idle timeout unless a per-call timeout overrides it. The Kimi bridge uses it as a no-output idle timeout and resets it for either stdout JSONL or stderr progress.

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

## Cline CLI bridge

When `config.ai.backend` is `cline_cli_bridge`, the game runs text completions through the local Cline CLI and translates the final bridge JSON or plain assistant text back into the normalized response shape `LLMClient` expects.

```yaml
ai:
  backend: cline_cli_bridge
  model: openai/gpt-5.3-codex
  cline_bridge:
    command: cline
    provider: ""
    cwd: ./tmp/cline-bridge-cwd
    thinking: ""
    compaction: basic
    timeout_seconds: 0
    config: ""
    data_dir: ""
    prompt_preamble: ""
```

Fields:
- `command`: command or absolute path used to launch Cline.
- `provider`: optional Cline provider id. Blank uses Cline's saved default provider.
- `cwd`: working directory for Cline. The default `./tmp/cline-bridge-cwd` is intentionally isolated so repo `AGENTS.md` or Cline rules do not turn provider prompts into coding-agent sessions.
- `thinking`: optional Cline thinking level: `none`, `low`, `medium`, `high`, or `xhigh`.
- `compaction`: Cline compaction mode: `agentic`, `basic`, or `off`.
- `timeout_seconds`: optional Cline total timeout. `0` leaves Cline without a total timeout; the bridge idle timeout still applies through `LLMClient`.
- `config`: optional Cline configuration directory.
- `data_dir`: optional isolated Cline data directory.
- `prompt_preamble`: optional text prepended ahead of the generated bridge wrapper prompt.

Behavior notes:
- Cline must already be installed and authenticated.
- Each prompt launches one non-interactive `cline --json --auto-approve false` subprocess.
- The bridge pipes the full bridge prompt through Cline stdin so large game prompts do not hit OS command-line argument limits.
- The command still includes a tiny bootstrap prompt argument because this Cline build only consumes piped stdin when a prompt argument is present.
- Incoming chat `system` messages, tool definitions, and the structured response contract are embedded in the stdin prompt as `Bridge Instructions`.
- `--system` is still set, but only to a short transport instruction telling Cline to read stdin and return the requested JSON.
- Non-system messages are flattened into a `Conversation:` transcript inside the stdin prompt.
- Prompt-progress live preview streams assistant `content` text parsed from Cline NDJSON `agent_event.event.text` records; if Cline ignores the wrapper and streams plain non-JSON text, that text is previewed directly.
- Final valid bridge JSON is parsed for `content` or `tool_calls`, including when Cline prepends prose before the JSON object. Final non-JSON assistant text is accepted as normal content, while malformed JSON-looking output still fails loudly.
- The bridge does not configure API keys, resume Cline sessions, or report Cline quota usage.

## Kimi CLI bridge

When `config.ai.backend` is `kimi_cli_bridge`, the game runs text completions through the already-authenticated local Kimi Code CLI and translates its ACP JSON-RPC assistant updates into the normalized response shape `LLMClient` expects.

```yaml
ai:
  backend: kimi_cli_bridge
  kimi_bridge:
    command: kimi
    cwd: ./tmp/kimi-bridge-cwd
    model: ""
    thinking: ""
    prompt_preamble: ""
```

Fields:

- `command`: command or absolute path used to launch Kimi Code. The current executable name is `kimi`.
- `cwd`: isolated working directory for fresh one-shot sessions. Relative paths resolve from the repo root.
- `model`: optional Kimi model alias selected through ACP session configuration. Blank uses `default_model` from Kimi's own `config.toml`.
- `thinking`: optional per-process Kimi thinking effort passed through `KIMI_MODEL_THINKING_EFFORT`. Blank uses Kimi's saved default and does not alter its global configuration.
- `prompt_preamble`: optional text prepended ahead of the generated bridge wrapper prompt.

Behavior notes:

- Kimi Code must already be installed and logged in under the user running the game server. The bridge does not read or configure an API key.
- Every request starts a fresh `kimi acp` process, negotiates ACP protocol version 1, and creates a new session. Session load, resume, and continue modes are intentionally not used.
- OpenAI-style image data-URL parts are normalized to WebP by `LLMClient`, labeled in the flattened conversation transcript, and sent as native ACP image content blocks after the text prompt. Missing, remote, malformed, or empty image data fails explicitly instead of being reduced to an image-omitted placeholder.
- Thinking effort is supplied when the Kimi subprocess starts, so it requires no ACP thinking-option negotiation. Models marked `always_thinking` may expose effort levels without an off value; `low` is then the minimum available setting, not disabled reasoning.
- The ACP client advertises no filesystem or terminal capabilities and passes no MCP servers. Kimi ACP does not expose the prompt-mode `--agent-file` or `--skills-dir` flags.
- The bridge prompt prohibits native Kimi tools. Any ACP tool event, permission request, or unsupported reverse client request fails the bridge request explicitly.
- Incoming system messages, application tool descriptions, and the structured response contract are embedded in `Bridge Instructions`; non-system messages are flattened into a `Conversation` transcript.
- Kimi's native ACP tool events are rejected. Application tool calls use the bridge JSON `tool_calls` field and are normalized into the standard OpenAI-compatible shape.
- Final bridge output must be valid wrapper JSON. Malformed or structurally invalid output fails loudly and enters `LLMClient`'s retry/error flow.
- The full prompt is sent as an ACP text block through child-process stdin and is never placed in argv, avoiding operating-system per-argument size limits.
- `ai.max_concurrent_requests` controls parallel fresh Kimi processes. `ai.baseTimeoutSeconds` is the no-output idle timeout.
- Prompt progress incrementally receives decoded bridge `content` as ACP assistant chunks arrive, including escaped characters and Unicode escapes. The completed content replaces the preview before the strict final wrapper validation result is returned.
- Kimi session data and authentication remain in Kimi's own home directory; the game does not manage or resume those sessions.

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

Prompt labels are normalized the same way as `metadataLabel`; keys ending in `*` match prefixes, and exact labels win over prefix matches. A tracked label without a matching entry uses a 5,000-character cold-start target. The same default applies when `prompt_progress` or its `character_targets` map is absent. Explicit malformed, non-finite, or non-positive configured targets remain errors. The default config gives region-related prompts `20000`, location-related and NPC-generation prompts `10000`, and other known prompt families, including the `creative_mode_action*`, `need_bar_event_checks*`, `while_you_were_away*`, and `scheduled_event_*` direct/TinyBrain labels, plus `scene_illustration_prompt` and `set_travel_times`, `5000`. Once `logs/prompt-output-character-stats.json` has a positive average output-character count for a label, that average becomes the prompt's progress target instead of the configured or default value. Character-appended labels for inventory generation, NPC memories, NPC progression, NPC abilities, and NPC alias assignment use the base prompt label's average. Use `/promptstats` to inspect stored averages and `/promptstats clear` to clear them.

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

For an OpenAI-compatible endpoint that leaves an SSE response transport open after its `[DONE]` event, `Connection: close` requests transport closure at the end of each response. This preserves streamed deltas while preventing the next sequential prompt from overlapping the provider's unfinished HTTP request. It trades HTTP connection reuse for a new connection per completion.

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

## Tiny-brain staged prompts

`config.ai.tinybrain` runs supported prompt programs as staged conversations intended for smaller local models. `ai.tinybrain_prompts` can disable individual families without disabling the master switch.

Location item/scenery generation has a per-family `ai.tinybrain_prompts.location_things_generation` switch, defaulting to `true` when omitted like other family switches. With the effective `ai.tinybrain` enabled, it first validates a compact item/scenery roster and then generates full XML for exactly that roster. Each stage uses the configured parser-retry budget, no native tools, and one shared run log/progress/reservation. When disabled, generation uses its one-shot prompt with strict error-feedback retries. See [LocationThingGenerationPlan](classes/LocationThingGenerationPlan.md).

Starting technique authoring uses `ai.tinybrain_prompts.starting_techniques`, also enabled by omission under the effective master switch. It validates a compact XML roster, then fully expands one technique per checkpoint with individual correction retries, before one atomic actor-batch commit. Setting the family to `false` retains standard full-batch XML generation. Neither path permits native tools. See [StartingTechniques](classes/StartingTechniques.md).

Ability attachment authoring uses `ai.tinybrain_prompts.ability_attachments`, enabled by omission under the effective master switch/model profile. A whole owned ability set or pending-option list shares one staged conversation, catalogue outline, queue owner, log and progress row. Per-ability lookup and authoring checkpoints retry independently; pending options preview independently and owned sets retain atomic combined application. Single manual generation uses a one-entry program. Setting this family to `false` retains standard per-ability two-phase generation. No native tools are exposed. See [AbilityAttachmentAuthoring](classes/AbilityAttachmentAuthoring.md).

Faction housekeeping uses `ai.tinybrain_prompts.faction_housekeeping`, enabled by omission under its effective master switch/model override. Its nine qualitative checkpoints and compact final synthesis share the logged runner reservation and local parser retries. Disabling this family uses the standard compact proposal prompt. Full faction creation is staged and committed afterward. See [FactionHousekeepingPrompt](classes/FactionHousekeepingPrompt.md).

```yaml
ai:
  tinybrain: false
  xml_repetition_fix: false
  tinybrain_prompts:
    player_action: true
    event_checks: true
    need_bar_event_checks: true
    quest_reward_prose: true
    game_intro: true
    random_event: true
    creative_mode_action: true
    npc_action: true
    craft_player_action: true
    location_modify_player_action: true
    location_things_generation: true
    starting_techniques: true
    ability_attachments: true
    faction_housekeeping: true
    player_action_open_container: true
    scene_summarize: true
    while_you_were_away: true
    scheduled_event_resolution: true
    scheduled_event_interruption_rewrite: true
```

- Must be a boolean when present and defaults to `false`.
- `tinybrain_prompts` must be an object when present. Its keys are restricted to the documented family names and every value must be boolean. A missing family key defaults to enabled when the master switch is true.
- With the effective master switch false, all families use their existing one-shot prompt. With it true, a family set to false intentionally stays one-shot. Runtime routing resolves `ai_model_overrides` for the family's metadata label before reading these switches, so a prompt-specific model profile can set `tinybrain: false` without disabling staged prompts handled by the base model. A selected staged family does not silently rerun its legacy prompt after parser failure.
- When enabled, TinyBrain templates pause at their `llm_dummy_action` and `llmparse(...)` checkpoints. Each response and any tool results remain in the conversation for later checkpoints. `need_bar_event_checks` uses one plain-text planning checkpoint followed by one strict `<characters>` response, so malformed final XML retries without rerunning the accepted plan. `scene_summarize` proposes and verifies scene boundaries, validates each completed scene independently, and assembles the terminal `<scenes>` XML locally.
- The full staged run retains one acquired per-model queue permit and its optional `max_concurrent_requests_all_models` permit across checkpoints, retries, and tool-call rounds. This reserves its current queue slot until completion without consuming other configured free slots.
- A checkpoint parse failure retries only that position, up to `ai.retryAttempts` retries after the initial response. The malformed terminal response is removed, while preceding tool calls and tool results are retained.
- The run is written incrementally to one prompt log with explicit begin/end markers around every LLM response.
- Attack and non-repetition-buster template branches currently contain no checkpoints, so those branches remain one completion even when the option is enabled.
- `ai.cachebuster: true` is still honored for every staged request, but its changing final-user prefix works against provider prefix caching.

`ai.xml_repetition_fix` is an independent TinyBrain-only safeguard for small models that repeat completed XML elements. It defaults to `false`, must be boolean, and has no effect unless both it and `ai.tinybrain` are exactly `true`. Every enabled TinyBrain family must resolve to the `openai_compatible` backend when the safeguard is enabled; startup validates the effective backend after prompt-specific model overrides.

While a TinyBrain checkpoint or final response streams, the safeguard tracks balanced explicit XML elements, including elements with nested tags. Comments, CDATA, declarations, processing instructions, incomplete elements, and self-closing tags are not candidate blocks. Once a completed block is longer than 50 raw characters, it detects either an immediate exact second copy (`AA`, ignoring only whitespace between the copies) or an exact direct-sibling alternation (`ABAB`). Whitespace and all other bytes inside a block remain significant.

On detection, the active transport is aborted, the repeated `A` or second `AB` suffix is removed, and the accepted prefix is appended to the request conversation as an `assistant` message followed by an exact `user` message of `continue`. Generation resumes from that conversation and the continuation is stitched onto the accepted prefix. A partial streamed tool call is discarded with the aborted response; tool calls and tool results completed during earlier TinyBrain rounds remain in the accumulated conversation. The maximum number of these continuation recoveries for one checkpoint/final completion is `ai.retryAttempts`; exhausting it raises an explicit error. This mechanism is independent of `ai.live_deslop` and can be enabled with or without it.

The supported prose families use domain-specific planning/outcome checkpoints followed by a plain draft, revision decision, and optional second draft. Where the terminal result is already determined, allowlisted local result builders assemble final XML from approved prose, authoritative mechanics, parsed checkpoint values, and completed tool outcomes instead of asking the model to repeat it. Quest rewards validate indexed coverage; craft/location prompts preserve already-applied mechanics and selected duration; checked containers share one tool cache and require exactly one successful check; while-away validates staged updates before mutation; scheduled-event planning may use read-only lookups before accepting a mutation plan, and its execution stage terminates locally once every accepted obligation is complete; interruption rewrites preserve every non-prose field. XML event checks retain their chunked `<events>` assembly pipeline. Need-bar event checks use their separate two-phase planning/characters program. Scene summaries use a proposal/correction boundary pass, per-scene validated checkpoints, and local final assembly.

Every current or future prompt implemented through `TinyBrainPromptRunner` automatically reserves one queue position and one cumulative progress row for its complete staged run. The fixed expected-output label is derived as `<metadataLabel>_tinybrain` (`player_action_tinybrain`, `event_checks_tinybrain`, and so on). Successful completed runs record one aggregate output-character sample under that label, which becomes the next run's expected total. The bar uses the ordinary progress curve: 75% at that expected total and an asymptotic approach toward 100% beyond it.

See [TinyBrainPromptRunner.md](classes/TinyBrainPromptRunner.md) for tag syntax, parsers, retries, and transcript behavior.

## Live deslop

`config.ai.live_deslop` corrects player-action prose from bounded token batches before accepting a branch:

```yaml
slop_buster: true
repetition_buster: true
ai:
  live_deslop: false
```

- It defaults to `false` and must be a boolean when present.
- Enabling it requires `slop_buster: true`, `repetition_buster: true`, and OpenAI-compatible effective backends for ordinary player/creative actions plus every enabled TinyBrain prose family. These requirements are validated at startup against each prompt family's model override.
- It applies to ordinary player/creative final XML and to enabled TinyBrain families. TinyBrain first/second drafts use plain-prose inspection; finals use family-specific player-facing XML tag profiles. Planning, outcome, state, tool, timing, hidden-summary, and analysis checkpoints are not inspected.
- Checked prose stages request the top 20 token log probabilities and first try streaming while retaining any tools allowed at that checkpoint. Content deltas without logprobs are preserved verbatim but excluded from live-token inspection, keeping XML tag fragments intact; structured tool calls are accumulated independently from `delta.tool_calls`. If streaming is rejected, supplies invalid or misaligned prose-token metadata, or fails before its first inspectable prose token, the request immediately retries with batches of at most 500 new tokens. That failure is remembered per effective family endpoint and current llama.cpp process; a game-server restart clears the latch and a managed llama.cpp restart changes the PID key. A non-stream batch ending with `finish_reason: length` continues from the accepted assistant prefix up to the normal logical token limit. Every completed word boundary uses the normal history-aware word, regex, configured n-gram, 3-token recent-history, and 6-token extended-history checks.
- XML markup is not analyzed as prose. Tag names/attributes and `<hidden>` contents are excluded, partial streamed tags are ignored, and tags split configured/repeated n-gram segments so phrases cannot match across XML structure. Rewind search likewise stops at the preceding tag boundary. The normal completed-response slop pass uses the same sanitation for historical frequency/ngram analysis and the remover's supporting story context while preserving any `<hidden>` block in the current response being edited.
- When a word, regex, or n-gram fires, generation stops before that branch is accepted. The client rewinds to the sampled token at the beginning of the match and continues with the highest-probability untried alternative from that token's returned candidates. If none is viable, it moves backward one word at a time—even before the beginning of the matched phrase—until it finds a viable branch. It never rewinds into the XML tags around the prose.
- No `logit_bias` or persistent token ban is sent. Tried branches are remembered only inside the current response so an exhausted branch is not selected repeatedly.
- A corrected continuation uses assistant prefill and the current executable tool subset. llama.cpp supports tools plus prefill in this non-stream mode; corrections that disable tools omit their definitions and use `tool_choice: "none"`. Prefix reuse depends on unchanged tool exposure.
- The ordinary completed-response slop pass still verifies the final parsed prose and handles text introduced by later transformations. Live correction diagnostics are included in the normal `slopRemoval` response/attachment data.
- If token metadata is missing or does not line up with the generated portion of a batch, or if no returned alternative remains viable after rewinding to the preceding XML boundary/draft start, the request fails explicitly instead of silently accepting the slop branch.

See [LiveDeslop.md](classes/LiveDeslop.md) for the token/word rewind behavior.

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

## Unload Model On Switch

`unload_model_on_switch` is a root-level boolean and defaults to `false`. The related root-level `router_preload_model` selects the first model loaded during server startup:

```yaml
unload_model_on_switch: false
router_preload_model: null
ai:
  router_slot_cache_enabled: false
  router_slot_cache_directory: /dev/shm
```

When `router_preload_model` is a nonblank string, the server treats the main AI endpoint as a llama.cpp router and loads that exact model before any startup path can launch an LLM prompt. When it is blank or omitted, router-backed configurations fall back to `ai.model`. Automatic startup preloading occurs when `unload_model_on_switch` is enabled or the effective `image_prompt_generation` profile uses `unload_during_image_generation`; a nonblank `router_preload_model` also enables it directly. Already-loaded models are left untouched, while unloaded models are loaded and polled until ready. Startup fails explicitly if router discovery, loading, or readiness fails.

The successfully preloaded endpoint/model becomes the initial model-switch target. If it differs from the first prompt's effective model, the normal switch lifecycle unloads the preloaded model before sending that prompt. Router preloading requires `ai.backend: openai_compatible` and cannot be combined with managed local-process termination mode.

When enabled, every real text transport uses exclusive access to the shared model-lifecycle gate. Without router startup preloading, the first prompt establishes the current effective endpoint/model without unloading anything. With preloading, that startup model is already the baseline. If a prompt resolves to a different llama.cpp router endpoint or model—including through `ai_model_overrides`—the server checks the previous model through `GET /models`, sends `POST /models/unload` for that previous model when it is loaded, waits for its `unloaded` status, and only then starts the replacement prompt.

`ai.router_slot_cache_enabled` is a boolean that defaults to `false` and can be overridden by prompt profiles. When it is true for both targets and both use the same game-owned local router (identified by a nonblank effective `ai.local_startup_script_path`), the switch additionally preserves slot 0. Before unloading, it sends `POST /slots/0?action=save` with the old model id and a stable model-specific filename, then unloads the old model. If the replacement model has a saved cache, the game immediately sends `POST /slots/0?action=restore`; llama.cpp's router autoloads and waits for that model before performing the restore. The game deletes a successfully restored file before sending the prompt. If no cache exists, the game immediately sends the replacement prompt and lets the llama.cpp router load it for the queued prompt. Prompt progress is registered before this lifecycle, so the client remains visibly busy during the router wait. `ai.router_slot_cache_directory` remains configurable, defaults to `/dev/shm`, must be an absolute path, and must exactly match llama.cpp's `--slot-save-path` whenever persistence is enabled. Leaving the router's `--slot-save-path` configured does not create cache files while AIRPG persistence is disabled.

Slot save and restore failures are logged with `console.warn` and do not cancel the switch or prompt. A failed restore retains the cache file for a later attempt, after which the prompt still gives the router an opportunity to autoload the replacement. An old-model unload failure also does not cancel the turn: the server logs it, broadcasts a `llama_router_unload_warning` modal with the diagnostic backtrace, and submits the replacement prompt. The replacement can still fail if the router cannot load it while the old model remains resident. Failure to delete a cache after the router has successfully restored it remains fatal.

When slot persistence is enabled, program termination and self-restart remove the exact cache paths for root, preload, prompt-override, and runtime-observed models that use a game-owned local router. Cleanup never scans `ai.router_slot_cache_directory`, so unrelated files remain untouched. Normal signal shutdown stops the managed router before asynchronous deletion, and the direct process-exit hook repeats deletion synchronously as a fallback. An uncatchable `SIGKILL` cannot run application cleanup.

llama.cpp may reject slot save/restore for a model loaded with multimodal projection data. The warning behavior keeps model switching operational, but context preservation requires a llama.cpp/model configuration that supports slot persistence. The qwen-combo-router configuration uses `scripts/start-qwen-combo-router.sh`, which launches the shared Prism router binary with the supported `--no-mmproj` option, a default 96k context, and `config/llama-qwen-combo-text-only.ini`. GPU layers are set to 99 in the preset's global section instead of on the router command line so model-specific values can override it. The preset replaces router directory discovery's explicit projector path with an empty value for both Qwen workers and the five benchmarked Gemma 4 31B workers, so they stay text-only even though their mmproj files remain installed on disk. Garnet's Q6 weights plus the large-context compute graph exceed a 24 GiB GPU when all layers are forced onto CUDA, so its preset partially offloads layers to CPU with `n-gpu-layers = 40`; the other listed models retain the 99-layer global setting.

This feature is independent of both image-generation handoff settings. Enabling `terminate_during_image_generation` neither requires nor enables `unload_model_on_switch`.

Holding lifecycle exclusivity across the transport prevents a switch from unloading a model that still has an active streamed request. Same-model prompts do not send router management requests, although enabled mode serializes them for deterministic switch ordering. Forced-output fixtures do not affect model tracking because they do not perform a real transport.

Enabled mode requires the effective prompt backend to be `openai_compatible`. Router authentication, custom headers, timeout, and endpoint are retained from each prompt's effective target. An unload/status failure is surfaced as a warning but does not prevent the replacement prompt from being sent; replacement-load or transport failures still propagate normally.

## Shared context prefix caching

`ai.shared_prefix_cache` defaults to `null`. To explicitly enable the existing Strata prefix-pinning API for a known compatible OpenAI endpoint:

```yaml
ai:
  shared_prefix_cache:
    provider: strata
    endpoint: http://127.0.0.1:8080/v1/chat/completions
```

Only `provider` and `endpoint` are accepted. The endpoint must be an absolute HTTP(S) URL without embedded credentials and must match the effective `ai.endpoint` after chat-completion path normalization. Endpoint/backend overrides must update the capability or clear it with `shared_prefix_cache: null`; incompatible backends, malformed settings, mismatched direct endpoint arguments, and a manually supplied `strata_prefix` alongside this capability fail explicitly. No server is identified by its hostname or model name.

Caching-enabled, non-generic shared-base prompts pin the message boundary after older history, NPC/world index and factions, before scene-specific mod references/current region. Focused item-family prompts instead pin their canonical setting and shared definitions before owner/scene/lore context. The final leading-message count includes system append messages and remains valid through TinyBrain checkpoints, tool rounds and retries. Images, generic editing prompts, prompts without base context and shared-context caching-disabled renders receive no automatically generated Strata argument. This leaves other providers unchanged by default and does not increase any RAM/VRAM budget. Earlier changing content still prevents prefix reuse, and CPU conversation parking capacity remains a separate backend setting. See [LLMClient](classes/LLMClient.md#internal-prompt-message-boundaries).

### Disk snapshot around Strata image rendering

```yaml
ai:
  image_generation_handoff:
    provider: strata
    mode: elastic
    min_free_vram_mib: 12288
  strata_context_cache_directory: /c/tmp  # default /tmp; null disables snapshots
```

`ai.strata_context_cache_directory` defaults to `/tmp` in `config.default.yaml` and when omitted. It is a single configurable path; explicit null disables snapshots. It applies only with native `ai.strata_runtime` ownership and elastic Strata image handoff. The path setting alone does not enable either capability, and unmanaged/standby handoffs ignore it. The former nested `image_generation_handoff.context_cache_directory` field is not accepted.

An enabled path must be absolute and point to an existing real directory owned by root or the game user, accessible for reading, writing and traversal. Group/other-writable directories need the sticky bit, allowing normal `/tmp` mode 1777. User-owned private directories such as mode 0700 also work. Snapshot files must remain private and owned by the game user; the application does not chmod shared directories. The native Strata run configuration must set its top-level `slot_save_path` to exactly the same directory. These settings are separate: the application never silently rewrites the native profile. Strata must start with disk session support enabled and a matching path before managed elastic image rendering.

The existing exclusive image lifecycle saves the held text context before releasing VRAM, renders its complete batch, cleans up ComfyUI, restores the VRAM reserve and reloads the saved session before queued text requests proceed. Recovery also runs after render failure or cancellation. Only the native typed refusal indicating no complete session is an explicit skip; save/restore, ownership, permission and file-validation failures surface through the existing lifecycle error UI. A failed restore retains its snapshot and blocks overwriting that artifact. Successful recovery deletes only its own acknowledged disposable file. See [StrataImageContextCache](classes/StrataImageContextCache.md) and [ImageGenerationModelLifecycle](classes/ImageGenerationModelLifecycle.md).

The named `config.yaml.strata-davidau` profile selects `/c/tmp`. On this installation the native run profile has the matching `slot_save_path`, plus checkpoint spread and a 4096-token minimum parked conversation size, prepared for the next startup. The 4 GiB conversation-cache budget and 16 GiB free-memory floor remain unchanged. Activation requires the ordinary application/model restart; no restart is triggered by saving these files.

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

## Technique recipe balance

`techniques.balance` configures engine-owned `standard-healing` and optional `standard-damage` recipes.
Defaults use `round(2 * B + 3 * level + skill + 0.5 * attributeModifier)` healing,
where `B` is `baseWeaponDamage` captured when the revision is authored. Mana cost
is `ceil(baseCost / (1 + 0.05 * skill + 0.02 * level))`, with base cost 100 and an
explicit `mana` resource profile requiring the existing 1000-point capacity.
Skill and level reduce or preserve cost; they never increase it. No capacity or
regeneration setting is changed by this policy.

The independent `healing.standard` and `damage.standard` coefficients, `resourceProfiles` and `improvementSteps`
are editable through existing YAML configuration layers. The default efficiency
step multiplies the personal base cost by 0.9; the default power step adds 2 HP
without increasing cost. Profile bindings use actual setting skills, attributes
and active need IDs. A configured Mana profile does not force Mana on an actor
or prevent a setting without it from loading. Selecting an unavailable or
incompatible resource profile reports an error.

Damage initially uses the same shipped amount and selected-resource cost formulas as healing. Its coefficients are separately configurable; changing healing coefficients does not change damage defaults. Older configurations may omit damage and receive the shipped damage defaults. Choosing a custom damage formula remains supported, including existing free/health/need costs and area/mixed effects; a standard recipe never mandates Mana for every technique.

New component recipes use `status.standard.fixedMagnitude: 1`,
`percentMagnitude: 5` and `durationMinutes: 3` for one selected attribute or
skill. Buffs use the positive magnitude; debuffs use the negative magnitude.
`statusImprovementSteps.statusPower` defaults to +1 fixed point or +5 percentage
points for the selected status component. Numeric `power` still adds 2 to a
selected healing or damage component, and `efficiency` multiplies its selected
component's base cost by 0.9. A multi-component improvement identifies its
`effectId` when more than one component is eligible. Historical version 1
managed snapshots keep their original improvement rules and digests.

Each new component contributes its complete configured resource cost. The
engine adds component costs and multiplies each by the number of actual selected
targets, including for area techniques; self/single targets have a count of one.
For example, the default level-3 skill-3 cost of 83 Mana becomes 249 for one
component affecting three targets, or 498 for two components affecting those
three targets. Missing `failureCosts` retains the same full cost after every
check fails. Only actor-applicable configured need profiles are offered; health
and item-charge costs remain deliberate custom mechanics with no guessed
standard-unit conversion. An area target list uses the native explicit,
colocated, living character IDs, without an inferred radius or team filter.

Each managed revision saves its policy snapshot, selected facts and canonical
formulas. Configuration reload validates new tuning before installing it and
affects newly authored mechanics. Existing catalogue revisions, learned personal
revisions and equipment grants retain their saved tuning; later character stat
changes still recalculate their formulas normally. Explicit rebalancing creates
new revisions. See [TechniqueBalancePolicy](classes/TechniqueBalancePolicy.md).

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

## Image prompt generation retries and render batching

`imagegen.prompt_generation_attempts` controls how many times the server asks the LLM to write the final image prompt before giving up. If prompt generation keeps failing or returns leaked prompt/context XML instead of a final image prompt, the image request is skipped with `reason: "image-prompt-failed"` and no image-rendering job is queued.

`imagegen.prompt_batching` controls batching for the same LLM prompt-writing step. It is separate from `imagegen.batch_prompts`, which batches the final ComfyUI rendering jobs.

`imagegen.image_prompt_instructions` remains the global per-target fallback for the prompt-writing LLM. Character, location, item, scenery, faction-emblem, ability-icon, technique-icon and discipline-icon values are editable under System Configuration → Image Prompts. An active world profile can override each target independently through World Profiles → Image Prompt Generation; an empty profile field deliberately retains the global instruction.

Ability, technique and discipline icons use separate `ability`, `technique` and `discipline` keys in
`imagegen.prompt_generator_templates` and `imagegen.image_prompt_instructions`.
Their default templates are `ability-image.xml.njk`, `technique-image.xml.njk` and
`discipline-image.xml.njk`; all direct the writer toward one readable symbol, strong contrast and no text or
interface frame. `imagegen.ability_settings.image` and
`imagegen.technique_settings.image` and `imagegen.discipline_settings.image` each default to 1024 × 1024. World profiles
persist independent `imagePromptPrefixAbility` / `imagePromptPrefixTechnique` / `imagePromptPrefixDiscipline`
render prefixes and `imagePromptInstructionsAbility` /
`imagePromptInstructionsTechnique` / `imagePromptInstructionsDiscipline` writer overrides. Discipline prompts describe the whole field of practice rather than one move. Icons use the ordinary
image-job backend and are requested lazily by visible Play cards; existing art
and final prompts persist without changing mechanics. Discipline artwork survives renaming because it is keyed by the stable discipline ID.

Ordinary ComfyUI workflow templates under `imagegen/` receive the full merged runtime config as `config`, in addition to the image job values under `image`. When render batching is enabled, the configured workflow instead receives the compatible jobs as `images`. For example, a workflow can reference `{{ config.imagegen.lora }}` to select a configured LoRA filename.

```yaml
imagegen:
  batch_prompts: false
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

`imagegen.batch_prompts` is a strict boolean and is only supported by the ComfyUI engine. When it is `true`:

- The server groups queued ordinary render jobs by effective selected workflow template, exact width, and exact height. Different resolutions or workflow overrides are submitted separately even when they were queued together.
- Every compatible group, including a one-item group, is rendered through the configured list-capable workflow with an `images` array. The configured workflow must therefore support list input even when only one prompt is present.
- The standard Krea 2 batch workflow uses Impact Pack's `ImpactMakeAnyList` to build prompt and seed lists. ComfyUI completes all mapped CLIP encodes before the mapped KSamplers, then completes all samplers before the mapped VAE decodes and saves.
- The jobs in one list submission share a Comfy prompt id and cancellation signal. Returned image order maps to prompt order, and the server requires exactly one output image per input prompt rather than guessing when counts differ.
- Location weather/lighting variants remain on their dedicated img2img workflow and are never merged into prompt-list batches.
- The server runs one list submission at a time; `maxConcurrentJobs` continues to control the non-batched path.

The standard Krea 2, MOSS Image, and MOSS Full Turbo families automatically select their matching list workflows when batching is enabled. The workflow editor's model, encoder, VAE, sampling, resolution, and LoRA choices are then applied to that standard graph. Linked sampler seed lists retain each image's own seed. MOSS Full Turbo also encodes a list of the individual images' negative prompts.

## Image generation size overrides and portrait layout

`imagegen.default_settings.image` remains the baseline size for generated character, item, scenery, and faction-emblem images. You can override those dimensions with the corresponding per-type image settings.

```yaml
imagegen:
  default_settings:
    image:
      width: 1024
      height: 1024
  character_settings:
    image:
      width: null
      height: null
  item_settings:
    image:
      width: null
      height: null
  scenery_settings:
    image:
      width: null
      height: null
  faction_settings:
    image:
      width: 1024
      height: 1024
```

- `character_settings.image.width` / `height` are optional. `null` or omission falls back to `default_settings.image`. The Play page precomputes the effective aspect ratio and reserves it for empty NPC/party/modal portraits; the player sidebar uses a separate player portrait layout hook with the same effective dimensions.
- `item_settings.image.width` / `height` are optional. `null` or omission falls back to `default_settings.image`.
- `scenery_settings.image.width` / `height` are optional. `null` or omission falls back to `default_settings.image`.
- `faction_settings.image.width` / `height` default to `1024 × 1024`. Each generated emblem is saved as a PNG with an alpha mask whose ellipse is inscribed in those exact dimensions, so every pixel outside the oval is transparent.
- When provided, character/item/scenery/faction override values must be between `64` and `4096`.
- If neither the per-type override nor `default_settings.image` provides a usable width/height, startup validation fails instead of silently hardcoding a fallback size.

## Canonical ComfyUI workflows

When `imagegen.engine` is `comfyui`, select the application-owned workflow under
`imagegen.workflow`:

```yaml
imagegen:
  workflow:
    generation:
      family: krea2 # krea2, moss, moss_full_turbo, sdxl, flux_klein, zimage, qwen, qwen21, anima, ideogram4
      model: "" # optional compatible model override
      text_encoder: ""
      text_encoder_type: "" # blank retains the workflow's loader type
      vae: ""
      loras: []
      steps: 6
      cfg: 1
      sampler: euler
      scheduler: simple
      denoise: 0.45
    edit:
      family: flux_klein # krea2, flux_klein, qwen, qwen21, or qwen21_skimmed
      flux_kv_cache: true # standard Flux Klein edit only; defaults on
```

Optional LoRA rows may be configured as
`loras: [{ name: "styles/example.safetensors", strength: 0.75 }]`.
The shared workflow editor adds/removes these rows and edits each strength.
Finite strengths, including zero and negative values, are preserved without
clamping. Older string-only entries remain supported at strength `1`.

The standard templates are held under `imagegen/standard/` and are not shown
among custom-workflow choices. The runtime applies nonblank compatible model,
encoder, VAE, sampling, resolution, and LoRA settings after template rendering.
It raises an error if an edit family is not supported or a selected LoRA cannot
be attached safely—there is no cross-family substitution. See
[`standard_image_workflows.md`](standard_image_workflows.md) for the graph
registry and limitations.

`family: moss` selects **Standard: MOSS Image**, with core ComfyUI
`VAELoader`/`VAEDecode` nodes and a Flux 2 latent. Its supplied defaults target
the installed Kromoss model, Qwen 3.5 9B encoder with type `moss_image`, and
`d/flux2-vae_small.safetensors`; normal workflow controls remain authoritative.
It supports generation and prompt-list batches, not image editing.

`family: moss_full_turbo` selects the separate **Standard: MOSS Full Turbo**
generation and batch graphs. Load the **MOSS Full Turbo** generation preset
to apply its MOSS model/encoder/VAE, 8 steps, CFG `35`, `dpmpp_2m_fixed`,
`simple`, and full denoise. The graph always applies its required turbo LoRA
at strength `1` and linear skimmed CFG with positive and negative scales both
`1.5`. Optional styles run before that required chain; the preset's optional
LoRA list is empty so it does not duplicate the turbo adapter. Both single
and batch graphs encode the supplied negative prompts. Changing the family
alone preserves existing editor settings, and explicit settings remain
authoritative. The original `moss` family and existing MOSS presets retain
their behavior; neither MOSS family supports editing.

The workflow editor uses native single-choice dropdowns with separate
case-insensitive search fields for model, text encoder, encoder type, VAE,
sampler, and scheduler. Each space-separated search term must occur somewhere
in the choice. Samplers, schedulers, and encoder types are discovered from the
active ComfyUI API. `text_encoder_type` applies to compatible standalone CLIP
loader nodes in standard and custom workflows, including batches. Leave it
blank for checkpoint-owned encoders or to retain the graph's default; see
[settings application](standard_image_workflows.md#settings-application).

`workflow.edit.flux_kv_cache` controls the core Flux KV Cache node in the
standard Flux Klein edit graph. Missing values are treated as `true` for
existing configurations. Setting it to `false` uses ComfyUI's normal
pass-through bypass topology for that node. It does not affect Qwen editing,
Krea 2 editing, or custom workflows.

The workflow editor stores named generation and edit presets in the shared
root `image-workflow-presets.yaml` file. **Load** applies the selected preset,
**Save** replaces it, and **Save As** opens a name dialog; names are YAML mapping
keys, so users enter a display name without appending `.yaml`. The preset store
is independent of the active system-config target, making every preset visible
under every config override. Edit presets never retain a `resolutions` field.

The **Qwen Image 2.1** generation and **Qwen Image 2.1 Edit** presets select
`qwen21` with the source Qwenvy model, Qwen3-VL encoder, Qwen Image 2.1 VAE,
20 steps, CFG 3.5, and `dpmpp_2m_sharp`/`bong_tangent`. Both graphs retain
the source classic-flat LoRA internally; optional LoRAs start empty and chain
after it. Generation uses the configured entity width and height without a
reference image; editing preserves the uploaded source dimensions. Their
`KSamplerAdvanced` receives the application seed through `noise_seed` and
keeps full sampling; the generic **Denoise** control does not apply to this
sampler. Qwen 2.1 does not support `imagegen.batch_prompts`; selecting it with
that option enabled raises a clear error.

The separate **Qwen Image 2.1 Edit Skimmed CFG** preset selects edit-only
`family: qwen21_skimmed`. Its regular `Skimmed CFG` patch uses scale `4`
with full negative skimming and flipping-filter disabling both false.
The graph retains the original Qwen Image 2.1 edit topology and source
dimensions, adding the patch between the required style LoRA and sampler;
optional selected LoRAs insert immediately before the patch. Its sampler
uses CFG `35` and 20-step `dpmpp_2m_sharp`/`bong_tangent` settings.
Load the named preset to apply those settings; choosing the family alone
preserves current editor overrides. The original Qwen Image 2.1 edit workflow
and preset remain available unchanged.

## Location weather/lighting image variants

Location image-to-image variants for the current world-time lighting, season, scope-appropriate seasonal description, and local weather use the effective `imagegen.workflow.edit` profile in its entirety. This is the root global edit profile when the active world's **Use global setting** checkbox is enabled, or that world's edit profile when it is disabled. The retired `imagegen.location_variant_settings` block is ignored at runtime and removed on the next System Configuration save, so it cannot silently replace configured edit sampling values.

- Location variants use `imagegen.workflow.edit`, whose shipped default is the standard Flux Klein edit workflow. The root `config.yaml` can select the standard Krea 2 Identity Edit v1.2 workflow for experimentation. Set `workflow.edit.custom_template` to select a custom img2img template under `imagegen/`. Missing custom or selected standard templates fail configuration validation.
- The Image Edit form has no resolution controls. Standard Krea 2, Flux Klein, Qwen, and Qwen 2.1 edit graphs use ComfyUI's `GetImageSize` on the loaded source and an explicit final `ImageScale` to preserve its exact dimensions. The standard Krea graph applies the required full `d/krea2_identity_edit_v1_2.safetensors` adapter internally at strength 1.0 and uses the Krea2Edit model-patch and dual grounded-conditioning nodes. Its supplied preset uses 10 steps, CFG 1, Euler/simple, full denoise, `fit` geometry, `ref_boost: 4`, and `grounding_px: 768`. Standard edit graphs route the rendered edit prompt through a Crystools `Show any [Crystools]` node with the `Final Prompt` prefix.
- When an enabled dedicated vision configuration is available, or the prompt's effective AI profile has `has_vision: true`, location variants generate their edit instructions through `prompts/base-context.xml.njk` with `_includes/generate-seasonal-image-vision.njk`. The request attaches the authoritative base location image and supplies the location, season, weather, and time-of-day context. The override/logging label is `generate_seasonal_image_vision`. An effective vision-capable main profile is used directly; otherwise the dedicated vision configuration takes precedence over non-vision prompt overrides for this request. The returned `<imageEditingInstructions>` supplies the edit prompt; `N/A` reuses the base image and caches that decision. Invalid vision responses fail explicitly rather than reverting to deterministic instructions.
- Vision variant cache keys are distinct from older deterministic variants and include regional weather even for interiors, allowing the model to judge visible weather effects from the source image. Concurrent requests for the same variant share prompt generation. The vision prompt runs before the ComfyUI rendering phase and uses the same path with or without TinyBrain enabled.
- When vision is unavailable, the deterministic edit prompt supplies lighting and season before weather. Weather-exposed and sheltered locations use `templates/location-weather-variant-image-prompt.njk` and receive the active calendar's `vegetationDescription`. Locations whose effective exposure is `no` use `templates/location-weather-variant-interior-image-prompt.njk` and the active season's `interiorDescription`, while prohibiting invented exterior vegetation, sky, openings, and precipitation. Legacy null exposure is inferred from `Exterior`/`Interior` location and region names; generated locations are required to persist an explicit scope. Variant cache keys include source image, season, lighting, effective scope, and weather.
- Custom variant workflows remain responsible for their own dimension handling; the server's `{{ image.width }}` and `{{ image.height }}` values are metadata/config fallbacks, not the canonical standard-workflow preservation mechanism.
- Model, encoder, VAE, optional LoRAs, steps, CFG, sampler, scheduler, denoise, and applicable Flux KV-cache selection all come from that same effective edit profile. The required Krea Identity Edit v1.2 LoRA remains baked into the Krea graph so it cannot be accidentally omitted or duplicated through preset selection. The standard Flux Klein graph retains its native `Flux2Scheduler`, which accepts steps and source dimensions but does not expose generic scheduler or denoise inputs; those two generic profile fields apply only to edit graphs with compatible nodes.
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

## Initial faction reputation

`factions.starting_reputation` controls the inclusive integer range used when new-game setup generates the player's initial reputation with every active faction.

```yaml
factions:
  starting_reputation:
    min: -80
    max: 20
```

Both values must be finite integers, and `min` must be less than or equal to `max`. The defaults permit hostile starting reactions down to `-80` and favorable affinity or implied membership up to `20`. The effective values appear in the generation prompt and are enforced again by its strict parser before the complete standings map is written atomically to the player. This does not add a starting-reputation property to faction records.

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
- `recent_history_batch_interval` controls how often turns move from recent to older base-context history.
- `client_message_history` affects only what the web client receives/renders via `/api/chat/history` and initial page load history.

```yaml
recent_history_turns: 25
recent_history_batch_interval: 10
client_message_history:
  max_messages: 100
  prune_to: 80
```

`recent_history_turns` is the minimum recent window. The recent window grows until `recent_history_batch_interval` additional prose turns accumulate. The complete interval-sized batch then moves into `<olderStoryHistory>`, and the recent window returns to its configured minimum. For example, minimum `10` and interval `10` produce recent-window sizes `10` through `19`, then `10` again. This keeps the cacheable older-history prefix unchanged for nine turns and changes it on the tenth. The interval must be an integer greater than or equal to `1`; use `1` for the former per-turn rollover behavior.

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
- `party_generate_memory_interval` controls the party-memory generation cadence, including the prompt's numeric disposition review. A positive integer enables it. Completed ordinary/creative gameplay turns and event-driven travel advance the counter once; questions, generic prompts, comments, rejections, failures and early recovery/benchmark responses do not. Direct travel retains the movement endpoint's existing scene-change cadence and consecutive-travel policy, without a second increment in its Chat prelude. Generation uses relevant NPC history and may return no disposition change.
- `autosaves_to_retain` is the autosave retention count; `0` disables autosaves.
- `summaries.enabled` gates automatic summarization. `summaries.summarize_on_load` controls load-time summarization.
- `batch_size` and `summary_word_length` tune line-summary generation. `max_unsummarized_log_entries` triggers automatic summarization; in scene-summary saves it does not truncate raw prompt history, which remains visible until contiguous scene coverage advances. `max_summarized_log_entries` caps the covered history considered for prompt rendering.
- `scene_summary_max_entries_per_prompt` must be a positive integer when provided and defaults to `500`.

## Base-context prompt caching hint

`prompt_uses_caching` tells base-context prompts to keep their structured prefix stable when callers request prompt-specific omissions.

```yaml
prompt_uses_caching: true
```

Rules:
- Must be a boolean when present.
- Default is `false`.
- Native tool exposure always matches actual execution permissions. Standard player actions retain their full permitted action scope, including `useTechnique` and mechanics even when NPC legacy prechecks are enabled. TinyBrain snapshots original definitions, then exposes only each checkpoint’s executable subset. Disabled/checkpoint-none/correction/exhausted requests expose no tools. The global input-request and mutating-prompt gates still apply.
- The internal base-context end marker becomes a real `user`-message boundary for non-generic prompts. Shared context ends in one message and prompt-specific instructions begin in the next, giving hybrid/recurrent backends a checkpoint immediately before prompt types diverge. Tool-less paths remain direct completions with no advertised native tools. Generic prompts keep their prior message shape. Changing executable tool subsets can invalidate the earlier tool prefix despite stable world-context sections.
- When `true`, the template ignores `omitGameHistory`, `omitInventoryItems`, `omitAbilities`, and `suppressQuestList`. Older history, actor inventories, actor abilities, and the player's quest list remain present before `<recentStoryHistory>`.
- Per-call `omitEventSummaryHistory` is also ignored, so event-summary filtering cannot change older history near the start of the prompt.
- The template inserts repeatable internal boundaries between major top-level base-context sections, plus a dedicated boundary immediately before `<recentStoryHistory>`. `LLMClient` removes the markers and sends each complete section group as a consecutive user message. This gives hybrid/recurrent backends nearby checkpoint candidates when player, location, party, tracker, or history data changes. Cache reuse is still prefix-based, so sections after the first difference are reevaluated. The implementation permits at most 12 section boundaries and one recent-story boundary, rejects empty/invalid placement, preserves TinyBrain chronology, and applies cachebusting only to the final user message.
- When `true`, slop-remover also switches from the standalone `prompts/slop-remover.xml.njk` template to the base-context include path (`prompts/base-context.xml.njk` with `promptType: slop-remover`). A player-action slop pass reuses the parsed system prompt and exact rendered generation-prefix text from that player action instead of cloning its live render objects or rebuilding world state. It appends the slop-specific include after the saved base-context marker. This keeps the shared messages byte-stable even if turn processing changes runtime state before editing. Legacy attack precheck still skips the cheap precheck when this is true, but can run the full legacy attack check when `use_legacy_prompt_checks` is enabled.
- Caching also ignores `omitCraftHistory` and keeps the ordinary history selection for `includeAllHistoryEntryTypes` callers. Requested non-diagnostic meta/admin extras render separately as `<supplementalPromptHistory>` after the shared base-context end marker, without changing older/recent core selection. Tool-history lookup options retain their separate behavior. Without caching, craft omission and all-entry selection retain their normal contracts.
- Status summaries and level-up notices appear only in `<recentStoryHistory>` by default, in source order and within the existing recent window; they do not enter `<olderStoryHistory>` or count as prose turns. This applies with caching on or off. A zero recent-history setting omits these notices. Current character state remains authoritative; prompts explicitly prohibit applying historical gains or status changes again. See [base_context_history](classes/base_context_history.md) for no-prose/summary coverage and metadata exclusion rules.
- The `plot-analysis` prompt still omits the prior `<plotAnalysis>` block, and `tonal-scale-evaluation` still omits the prior `<tonalScaleEvaluation>` block.

## Legacy prompt checks

`use_legacy_prompt_checks` retains the legacy separate attack/skill prompt flow for NPC and unrelated callers. Main player actions always resolve techniques, checks and attacks inside `player_action` in both standard and TinyBrain modes; their caller-specific mechanics/schema override does not mutate this global option.

```yaml
use_legacy_prompt_checks: false
```

Rules:
- Must be a boolean when present.
- Default is `false`.
- When `false`, regular prose prompts get `resolveAttack`, `resolveSkillCheck`, and `resolveOpposedSkillCheck` tools and resolve attacks/checks inside the prose tool loop. The staged TinyBrain NPC-action family is the exception for attacks: its prose program accepts an already-resolved mechanical outcome and exposes only lookup tools, so the NPC turn runs the existing attack detector/resolver before staged narration. This prevents an NPC attack plan from being mislabeled as a trivial automatic success without applying damage.
- When `true`, NPC and unrelated prose consumers omit those mechanical check tools. NPC turns retain their existing action-plan plausibility and legacy attack checks before narration. Main player actions are explicitly exempt: standard player_action preserves its full mechanics/technique tool schema and TinyBrain retains its existing combined resolution plans with lookup-only native tools. Neither player mode runs the old separate attack/plausibility prechecks.

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
soft_quest_limit: 10
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
- `soft_quest_limit` is the root-level threshold supplied with the active incomplete-quest count in base-context prompts, so quest-offering generation can avoid overloading the player with tasks.
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

`max_tool_calls` controls how many tool-call rounds an ordinary prompt loop may execute before the server returns `tool_call_attempts_exhausted` tool errors and disables tools for the follow-up completion. TinyBrain instead counts individual native tool-call attempts across the whole run, including batches, cache hits, denied calls, checkpoints, and parser retries. Exhaustion prevents further execution and removes native tool definitions from following requests, with `tool_choice: "none"`. Unexpected calls are rejected before response callbacks. Code-owned XML resolution-plan actions do not consume this native budget.

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

## Location danger indicator

`show_location_danger` controls the player-facing skull indicator beside the current location's level.

```yaml
show_location_danger: false
```

The option must be a boolean when present and defaults to `false`. When disabled, the server omits the indicator from the Play page. Encounter calculations, saved danger values, location and region editing, direct tools, events, and developer-facing danger details continue to work. Enabling it renders four skulls for effective danger levels `1` through `5`, with level `1` showing all four at 25% opacity and each later level filling one additional skull.

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

## Plot summary cadence

`plot_summary_prompt_frequency` controls automatic hidden `plot-summary` prompt cadence on eligible player-action turns.

```yaml
plot_summary_prompt_frequency: 10
```

- Default is `10` when omitted.
- Value must be an integer `>= 1`; invalid values raise runtime errors when scheduling.
- Automatic scheduling is also gated by `extra_plot_prompts.plot_summary`.
- The turn counter is stored in save metadata as `plotSummaryTurnCounter`, so cadence survives save/load.
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
