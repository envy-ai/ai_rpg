# LLMClient

## Purpose
`LLMClient.js` is the shared text-completion orchestration layer. It selects the configured backend, builds chat-completion payloads, enforces concurrency, runs retries, reports prompt progress, handles cancellation, validates structured output, logs prompts/errors, supports deterministic test outputs, and records per-prompt output-character statistics.

Callers use it from gameplay routes, world-generation helpers, event checks, status-effect generation, chat-tool loops, and `scripts/run_prompts.js`. The class returns the final assistant text string; callers that need normalized response metadata or tool calls use `onResponse`.

## Backends
- `openai_compatible`: sends HTTP requests with `axios` to a normalized `/chat/completions` endpoint using `ai.endpoint`, `ai.apiKey` or OAuth refresh-token auth, and `ai.model`.
- `codex_cli_bridge`: delegates transport to `CodexBridgeClient.chatCompletion(...)`. `LLMClient` keeps ownership of retry handling, validation, progress tracking, prompt stats, cancellation, and Codex usage/quota reporting around the bridge response.
- `cline_cli_bridge`: delegates transport to `ClineBridgeClient.chatCompletion(...)`. It uses the authenticated local Cline CLI, keeps retry/validation/progress/cancellation behavior in `LLMClient`, and does not use endpoint/API-key config.
- `kimi_cli_bridge`: delegates transport to `KimiBridgeClient.chatCompletion(...)`. It uses the authenticated local Kimi Code CLI through a fresh ACP stdin session, streams decoded wrapper `content` deltas into prompt progress, rejects native tool events, keeps retry/validation/cancellation behavior in `LLMClient`, and does not use endpoint/API-key config.

Backend aliases are normalized through `CodexBridgeClient.normalizeBackend(...)`; backend-specific validation routes to the selected adapter. See [CodexBridgeClient.md](CodexBridgeClient.md) for Codex app-server transport, [ClineBridgeClient.md](ClineBridgeClient.md) for Cline one-shot CLI transport, and [KimiBridgeClient.md](KimiBridgeClient.md) for Kimi ACP JSON-RPC transport.

## Configuration Inputs
- `Globals.config.ai` is cloned for each request attempt. Matching `ai_model_overrides` profiles are applied by normalized `metadataLabel` before that attempt is dispatched.
- `ai_multimodal` overrides the text config when `chatCompletion({ multimodal: true })` is used; the multimodal config must exist and be enabled.
- `ai.custom_args` injects provider-specific top-level payload fields. Reserved core payload keys are rejected in configured custom args.
- `ai.headers`, override-profile headers, and per-call `headers` are merged for HTTP requests. OAuth-backed requests always set `Authorization` from the refreshed access token.
- `ai.cachebuster: true` prepends `[cachebuster:<uuid>]` to the final user message in the outbound payload copy. Caller-provided message objects are not mutated.
- `ai.prefill` adds a final assistant message for OpenAI-compatible requests so providers that support assistant prefill can continue from that text. Matching `ai_model_overrides` profiles can replace it or set it to `null`; per-call `prefill`/`assistantResponseSeed` takes precedence. Prefill is rejected for CLI bridges and ordinary tool-call requests. The explicit non-stream token-chunk mode used by live deslop permits tools plus prefill because the target llama.cpp API supports that combination.
- `ai.live_deslop` is validated as a boolean. The player-action integration supplies the live token handler and provider log-probability payload described in [LiveDeslop.md](LiveDeslop.md).
- `ai.sysprompt_append` adds an additional model-specific system-instruction message to the outbound payload copy. Matching `ai_model_overrides` profiles replace it or set it to `null`; the caller-provided `messages` array is not mutated.
- `ai.reasoning_effort`, override-profile `reasoning_effort`, payload `reasoning_effort`, or per-call `reasoningEffort` opt into OpenAI-compatible reasoning by sending `reasoning: true` and `reasoning_effort`.
- `ai.unload_during_image_generation` defaults to `false`. It can be overridden per prompt profile; when true, server validation requires an OpenAI-compatible text backend and the ComfyUI image engine. Every real transport attempt with an effective true value invokes the registered strict ComfyUI cleanup handler after acquiring the shared model-lifecycle gate and before contacting the text backend. Cleanup failure is propagated without running the prompt.
- `ai.terminate_during_image_generation` defaults to `false` and is mutually exclusive with router unload mode. `ai.local_startup_script_path` is required when termination is enabled. `LLMClient` validates the basic value types and required pairing; `server.js` validates the effective image-prompt profile, executable file, backend, and image engine, then owns the local process lifecycle.
- `ai.force_outputs_file` or `LLM_FORCE_OUTPUTS_FILE` supplies deterministic fixture output buckets for tests and scripted runs.
- Root `max_concurrent_requests_all_models` optionally adds a positive-integer cap across all real chat-completion requests, independent of model/backend/auth semaphore keys.

## Public API
- `chatCompletion(options)`: runs one completion request and returns assistant text.
- `withPromptQueueReservation(callback)`: creates an opaque queue reservation, passes it to an awaited callback, and releases any retained permits in `finally`. Sequential `chatCompletion(...)` calls can pass that reservation to keep the same queue position across a logical multi-call prompt.
- `withExclusiveModelLifecycle(callback)`: waits for active real text requests to finish, blocks new real text transport attempts, runs the callback, and releases queued requests in `finally`. The image-render lifecycle uses this around llama.cpp unload/render/reload or terminate/render/restart.
- `resolveUnloadModelOnSwitch(config?)`: validates the root `unload_model_on_switch` boolean and defaults it to `false`. Enabled real transports take exclusive lifecycle access, compare their effective endpoint/model with the previous real prompt target, unload the previous llama.cpp model before a switch, and keep the lock through the replacement transport so an active request cannot be unloaded. Router failures are fatal before the new prompt is sent.
- `resetModelSwitchTracking()`: clears the process-local previous-prompt target; it is exposed for isolated tests. Forced outputs are not tracked because they skip transport.
- `setComfyModelCleanupHandler(handler)`: registers the server-owned ComfyUI `/free` operation used before enabled prompt transports. Passing `null` clears it for isolated tests; an enabled request with no handler fails explicitly.
- `resolveEffectiveAiConfiguration(metadataLabel, config)` and `resolveOpenAICompatibleModelManagementTarget(metadataLabel)`: resolve prompt-specific model overrides and the authenticated endpoint/model target used for llama.cpp router management.
- `withPromptProgressGroup({ progressGroupId, progressGroupTargetLabel }, callback)`: establishes an async-scoped logical progress group. Every nested `chatCompletion(...)`, including calls made by a tool loop, automatically inherits the stable group id and dedicated whole-run target label unless it supplies the identical values explicitly. Conflicting or nested groups fail clearly.
- `cancelPrompt(streamId, reason)`: aborts one tracked in-flight prompt and causes that request to return `''`.
- `retryPrompt(streamId, reason)`: aborts one tracked attempt and restarts the same `chatCompletion(...)` loop without consuming an automatic retry attempt.
- `recordPromptProgressGroupFailure(progressGroupId, responseText)`: records one parse-failed response for a logical prompt group, marks its current progress entry failed, and broadcasts an immediate `prompt_progress_group_failure` update.
- `clearPromptProgressGroup(progressGroupId, { recordOutputCharacters })`: releases transient failed-response history and completes a grouped logical prompt. With aggregate recording enabled, it writes the cumulative received-character total once under the group's dedicated target label before the completion pulse.
- `getBaseContextEndMarker()`, `getBaseContextNoToolCallsInstruction()`, and `applyBaseContextToolPolicy(messages, options)`: internal base-context prompt-policy helpers exposed for template and transport tests.
- `cancelAllPrompts(reason)`: aborts all prompts currently registered in the abort-controller map and returns cancellation counts.
- `waitForPromptDrain({ timeoutMs, pollIntervalMs })`: waits until prompt-progress entries and abort-controller entries are empty.
- `ensureAiConfig()`, `resolveBackend(aiConfigOverride)`, `getConfigurationErrors(aiConfigOverride)`, `isConfigured(aiConfigOverride)`, `getMaxConcurrent(aiConfigOverride)`, `resolveMaxConcurrentAllModels(configOverride)`: configuration helpers used by settings and tests.
- `resolveChatEndpoint(endpoint)`, `baseTimeoutMilliseconds()`, `resolveTimeout(timeoutMs, multiplier)`, `resolveTemperature(explicit, fallback)`, `resolveOutput(output, fallback)`: request utility helpers.
- `calculatePromptProgressFraction(receivedCharacters, targetCharacters)` and `resolvePromptProgressCharacterTarget(label, config)`: prompt-progress math and configured target lookup.
- `getPromptOutputCharacterStats(label)`, `listPromptOutputCharacterStats(options)`, `recordPromptOutputCharacters(label, outputCharacters)`, `clearPromptOutputCharacterStats()`: persistent output-character statistics helpers used by `/promptstats`.
- `logPrompt(options)`: writes prompt/response logs under `logs/`; callers can append later sections to the same file with `filePath` and `append: true`.
- `writeLogFile(options)`: writes `ERROR_<prefix>_<metadataLabel>_<timestamp>.log` files for validation, chat-completion, and tool-call failures.
- `formatMessagesForErrorLog(messages)`: renders chat messages into readable system/prompt/other sections for logs.
- `resetForcedOutputState()` and `resetPromptOutputCharacterStatsForTests()`: test helpers.

## `chatCompletion(...)`
Important options:

- `messages`: required OpenAI-style chat messages.
- `metadataLabel`: prompt label used for override matching, logging, prompt progress, stats, and Codex usage labels.
- `errorLogLabel`: optional error-log label. Error logs otherwise prefer `metadata.promptName`, then `metadata.promptType`, then `metadataLabel`.
- `additionalPayload`: extra request body fields such as `tools`, `tool_choice`, or provider-specific parameters. Provider-visible fields must be placed here unless `chatCompletion(...)` has an explicit top-level option for them.
- `headers`: per-call HTTP headers.
- `model`, `apiKey`, `endpoint`, `temperature`, `maxTokens`, `topP`, `frequencyPenalty`, `presencePenalty`, `seed`: per-call request overrides.
- `prefill` or `assistantResponseSeed`: optional OpenAI-compatible assistant response prefill. `null` suppresses configured `ai.prefill` for that call.
- `timeoutMs`, `timeoutScale`, `retryAttempts`, `waitAfterError`, `waitAfterRateLimitError`, `waitAfterNetworkError`: timeout and retry controls.
- `stream`: OpenAI-compatible streaming control. CLI bridge requests are sent through the bridge with `stream: false` while bridge events feed prompt progress.
- `runInBackground`: marks the request as background for progress display and lower semaphore priority.
- `queueReservation`: an opaque reservation supplied by `withPromptQueueReservation(...)`. Reserved calls must be sequential and must keep the same model semaphore key, all-model concurrency configuration, and foreground/background priority.
- `progressGroupId`: optional non-empty logical prompt id copied into prompt-progress entries. Sequential TinyBrain calls reuse one stable progress entry/id for that group until `clearPromptProgressGroup(...)` completes it. Grouped requests must also provide `progressGroupTargetLabel`, whose dedicated historical whole-run average or configured character target supplies one fixed expected-output denominator for the entire group. Both values can be inherited from `withPromptProgressGroup(...)`.
- `multimodal`: merges `Globals.config.ai_multimodal` into the effective AI config.
- `validateXML`, `validateXMLStrict`, `requiredTags`, `requiredRegex`: response validation controls.
- `forceOutput`: deterministic string or response-shaped object that skips network transport and runs normalization, validation, stats, and hooks.
- `captureRequestPayload`, `captureResponsePayload`, `onResponse`: testing and integration hooks.
- `onStreamToken`: optional async OpenAI-compatible token hook. In ordinary stream mode content deltas with aligned `choices[0].logprobs.content` entries are exposed to live-token inspection. Content deltas without logprobs are still appended verbatim to the response but remain opaque to the hook because no sampled alternatives exist; this preserves XML tag pieces that some llama.cpp builds omit from logprob metadata. Structured `delta.tool_calls` data is accumulated separately and never treated as prose. The final inspectable text token is called once with `responseComplete: true`, including when the provider reports completion in a later empty SSE chunk. With `nonStreamTokenChunkSize`, the same hook processes each visible token in a non-stream response batch and receives `responseComplete` on the final visible token. llama.cpp's trailing zero-byte stop/control record is excluded from the callback and retained-token history. The hook receives full response text (including prefill and opaque content), generated text, the current token, and sampled token records. Returning a rewind offset plus alternative token restarts the logical completion with corrected assistant prefill; throwing fails explicitly. This hook is incompatible with forced output.
- `nonStreamTokenChunkSize`: optional positive integer that requires `stream: false`, `onStreamToken`, and the OpenAI-compatible backend. Each transport request is limited to this many new tokens. A clean `finish_reason: "length"` response continues from assistant prefill without consuming an error retry, up to the original logical `max_tokens` budget. Aligned non-stream `choices[0].logprobs.content` metadata is mandatory. Tool definitions and selection policy remain unchanged across continuations and corrections.
- `liveTokenStreamFallbackChunkSize`: optional positive batch size for adaptive live-token transport. The request first uses streaming; invalid or misaligned supplied prose-token logprobs, or a stream transport failure before the first inspectable prose token, mark the current capability key as failed and immediately retry through bounded non-stream logprob batches of this size. A content delta with no logprobs is preserved as opaque response text and does not trigger fallback.
- `liveTokenStreamCapabilityKey`: required with `liveTokenStreamFallbackChunkSize`. Failed keys remain latched for the lifetime of the game-server process. Player actions include the effective llama.cpp endpoint and managed process PID, so restarting managed llama.cpp produces a new key and re-enables one streaming probe.
- `onLiveTokenStreamFallback`: optional callback used with adaptive fallback. It runs once when a capability key is first latched and receives the exact console message plus timestamp, prompt label, failure classification, capability key, HTTP status, error name/code/message, server response body, backtrace, and fallback chunk size. Callback failures propagate instead of silently losing diagnostics.
- `logStreamChunksToConsole`: dumps raw OpenAI-compatible streamed `data:` payloads.
- `output`: `stdout`, `stderr`, or `silent`; `silent` suppresses normal console output and prompt-progress tracking.

Request flow:

1. Detect base-context prompts through their internal end marker, remove that marker, and apply the non-generic shared-tool policy before any provider-visible payload is built. Then expand internal message-boundary markers and convert any `image_url` data URLs in message content to WebP through `sharp`. Non-data image URLs in this preprocessing path fail with an explicit error.
2. Resolve deterministic output from `forceOutput` or a forced-output fixture, if configured.
3. Resolve retry count from the call option or `ai.retryAttempts`.
4. For each attempt, clone AI config, apply `ai_model_overrides`, merge custom args/headers, resolve backend, append configured system-prompt text, apply cachebuster, append OpenAI-compatible assistant prefill when configured, resolve model/temperature/token/top-p/reasoning settings, and choose a semaphore key.
5. Acquire the per-key semaphore, then the optional all-model semaphore from root `max_concurrent_requests_all_models`, then model-lifecycle access. Normal requests use shared access. With root `unload_model_on_switch: true`, real requests use exclusive access, unload the previous effective llama.cpp model when the target changes, and retain exclusivity through transport. Background requests share the same semaphores but foreground requests are dispatched first; with a limit above one, background work leaves one slot available for foreground prompts. A valid queue reservation retains semaphore permits between sequential calls, while lifecycle-gate access remains scoped to each real transport attempt.
6. Start prompt-progress tracking when the request is trackable and output is not `silent`.
7. Dispatch through `axios.post(...)`, `CodexBridgeClient.chatCompletion(...)`, `ClineBridgeClient.chatCompletion(...)`, `KimiBridgeClient.chatCompletion(...)`. OpenAI SSE chunks are processed in arrival order. Adaptive live-token requests prefer streaming with tools and prose-token logprobs. Content deltas without logprobs are appended verbatim but excluded from live-token inspection, while structured `delta.tool_calls` are assembled separately. If the capability probe fails, the same logical completion switches to bounded non-stream batches and later requests reuse that decision for the same server-process key. A length-limited non-stream batch continues from the accepted assistant prefix. A requested branch correction rewinds retained token records and starts a new transport request without consuming a normal error retry. The caller decides whether tools remain available; player-action live deslop preserves them in both modes.
8. Normalize the response into an OpenAI-style `chat.completion` payload, merge assistant prefill into returned text exactly once, call capture/on-response hooks, strip `<think>...</think>` blocks from returned text, validate output, update prompt stats, and return assistant text.

## Response Normalization And Validation
- Streaming OpenAI-compatible responses are assembled from SSE `data:` chunks. Text deltas are concatenated and `delta.tool_calls` chunks are assembled into complete function calls. `[DONE]` ends the SSE data sequence, but `chatCompletion(...)` waits for the HTTP transport's `end` event before releasing the caller so a following request cannot overlap a response the provider still considers active. Completion is guarded so `end`, `error`, and timeout paths cannot settle the same request twice. Providers that hold streaming responses open after `[DONE]` can be configured with `ai.headers.Connection: close` to request immediate transport closure while preserving streaming.
- Live-token streaming inspects only deltas with aligned logprob metadata. Content without logprobs is preserved verbatim as opaque response text, which keeps XML tag fragments intact without inventing branch alternatives. Structured tool-call deltas are accumulated separately. Assistant prefill and the unchanged tool schema are allowed together for live streaming corrections.
- Non-stream responses and CLI bridge responses use the same normalized shape for `choices[0].message.content` and `choices[0].message.tool_calls`.
- Token-chunked non-stream responses may echo the supplied assistant prefill in `message.content`; only newly generated text is expected in `logprobs.content`. `LLMClient` verifies exact alignment, merges the prefill once, and fails explicitly on missing or mismatched metadata. For a normal `finish_reason: "stop"`, one final `token: ""`, `bytes: []` llama.cpp control record is accepted and omitted from visible-text processing; empty records anywhere else remain invalid.
- Tool-call arguments must be parseable JSON strings. Malformed tool-call payloads throw before callers receive them.
- Empty assistant text is accepted only when one or more valid tool calls are present. Tool-call-only completions return `''` while `onResponse` carries the normalized tool calls.
- `requiredRegex`, XML validation, and required-tag checks are skipped for tool-call turns.
- With XML validation enabled, `Utils.extractFinalXmlBlockFromResponse(...)` isolates the final complete XML block for parsing and required-tag checks. `validateXMLStrict: true` uses `Utils.parseXmlDocumentStrict(...)`; otherwise `Utils.parseXmlDocument(...)` is used.
- Chat-completion errors, invalid XML, missing tags, and missing regex matches write dedicated error logs containing response text and formatted prompts. Exhausted per-attempt failures return `''`; preflight/configuration errors and strict fixture-resolution errors throw.

## Prompt Progress And Cancellation
Prompt progress is active when output is not `silent` and either an interactive terminal or `Globals.realtimeHub.emit(...)` is available.

Progress entries include:
- `id`, `label`, `model`, elapsed seconds, timeout seconds, retry count, and background flag.
- `promptText` from `formatMessagesForPromptProgress(...)`, which labels each request message and preserves chronological system/user/assistant/tool order. This keeps the current staged user checkpoint immediately before its live response in the prompt viewer. Error-log formatting remains separately grouped by system, user, and other messages.
- `previewText` from streamed assistant text or CLI bridge assistant-content events.
- `progressGroupId`, `failedResponses`, and `responseFailed` when a logical staged prompt groups requests and reports parse failures.
- `receivedCount` and `receivedUnit`; OpenAI-compatible streaming and CLI bridge progress count decoded JavaScript characters.
- `targetCharacters`, `progressFraction`, `runCount`, and `averageOutputCharacters`.

Cold-start targets come from `config.prompt_progress.character_targets`. Label matching normalizes metadata labels; exact entries win over `*` prefix entries. Missing coverage throws. When a positive stored average exists for a prompt label, that average is used as the target for the next run. Progress advances linearly to 75% at the target and approaches 100% asymptotically after that.

High-frequency progress broadcasts are coalesced to at most one active update every 500 ms. Ordinary completion sends an immediate `progressFraction: 1` update, holds the completed entry for 250 ms, then emits the clear event. A grouped completion instead keeps its stable entry alive with `isGroupWaiting: true`. Its decoded-character `receivedCount` accumulates across requests while `targetCharacters` remains the one multiprompt target selected when the group first starts. Grouped progress uses the same curve as an ordinary prompt: it reaches 75% at the historical/configured target and approaches 100% asymptotically beyond it. Starting another stage cannot lower the percentage because both cumulative received output and the fixed target are preserved. The next request with that group id reactivates the same entry while resetting only stage-local prompt, preview, latency, timeout, and rate state. Grouped sub-requests do not write individual output-stat samples. `clearPromptProgressGroup(..., { recordOutputCharacters: true })` records one aggregate whole-run sample after a successfully completed group, then performs the final 100% completion pulse and removal; failures and explicitly non-recordable action rejections clear without affecting the expected-total history. Prompt-progress `id` values are the ids accepted by `cancelPrompt(...)` and `retryPrompt(...)`; grouped waiting entries have no active abort controller until their next stage starts.

`recordPromptProgressGroupFailure(...)` force-broadcasts the updated progress entry and also emits `prompt_progress_group_failure`, allowing the browser to recolor a failed response even if the completed stream entry has already left the normal 250 ms hold window. The failed text is display metadata only and is not added to request messages.

## Internal prompt message boundaries

Every `base-context.xml.njk` render places an internal end marker after the shared context and immediately before the prompt-specific include. For non-generic base-context prompts, `chatCompletion(...)` replaces that marker with a real boundary between two consecutive `user` messages. The first message ends with the shared base context; the second begins with the prompt-specific instructions. This gives hybrid/recurrent backends a checkpoint immediately before prompt types such as `player_action` and `slop_remover` diverge. The marker also activates one canonical ordered tool schema containing all built-in definitions plus all registered mod tools. `requestUserInput` is removed globally when `chat_tools.request_user_input_enabled` is false, and resolution/check tools are removed globally when `use_legacy_prompt_checks` is true. A non-generic caller that supplied no tool definitions before this policy receives the exact instruction `Do not make tool calls.` at the start of the prompt-specific message; it still uses its existing direct-completion path and does not execute emitted calls. An explicit `tool_choice: "none"` remains `none` while the schema stays serialized, allowing exhausted tool loops to disable further calls without changing the tool prefix. Base-context generic prompts (`generic_prompt`) only have the marker removed and their two halves rejoined: their existing message shape, tool payload, and behavior are preserved. Prompts not rendered through base context are untouched.

Caching-enabled base-context templates also place repeatable section markers between complete top-level context sections and a dedicated marker immediately before `<recentStoryHistory>`. The section boundaries cover older history when present, the world index, current region, current location when present, player, party, supplemental prompt context, and mystery/tracker continuity state when present. Before system-prompt append text, cachebusting, progress display, or backend transport, `chatCompletion(...)` replaces those markers with consecutive `user` messages. This gives hybrid/recurrent backends restorable checkpoints near a changed section instead of relying only on a checkpoint near the end of the full context. The cache remains prefix-based: content after the first changed section still requires evaluation. Expansion accepts at most 12 section markers plus one recent-story marker, preserves later assistant/tool/user chronology, and leaves cachebusting on only the final user message. Internal markers are never sent to the model. Markers in non-user messages, markers spread across multiple source messages, duplicate recent-story markers, excessive section markers, and empty content between markers raise explicit errors.

## Concurrency
`LLMClient` keeps a semaphore per backend/model/auth/session key, plus an optional process-wide semaphore when root `max_concurrent_requests_all_models` is set.

- OpenAI-compatible keys use the resolved API credential or OAuth cache key plus model.
- Codex fresh-mode, Cline, and Kimi bridge keys use backend plus model identity and honor `ai.max_concurrent_requests`.
- Codex resumed-session keys serialize by Codex home and, for `resume_id`, session id.
- The all-model semaphore caps real outbound text-generation attempts across every key. It is acquired only after the per-key permit so a request waiting on a busy model does not occupy an all-model slot.
- `runInBackground: true` lowers queue priority and limits concurrent background occupancy so foreground gameplay prompts can start ahead of queued background prompts.
- `withPromptQueueReservation(...)` retains one acquired per-key permit and its optional all-model permit until the callback completes. This prevents another queued prompt from taking that logical prompt's slot between stages or retries without reducing configured capacity or blocking other genuinely free slots.
- Reservations reject concurrent reuse, model/semaphore-key changes, all-model concurrency changes, and foreground/background priority changes. Permits are released in `finally` when the callback succeeds or fails.
- The model-lifecycle gate permits concurrent ordinary requests. Exclusive image-render lifecycle access waits for active readers, then prevents queued/new text requests from dispatching until the llama.cpp model reload attempt finishes.

## Prompt Logging
`logPrompt(...)` writes `logs/<timestamp>_<prefix>_<metadataLabel>.log` with:
- prompt output-character stats header.
- model, endpoint, and token metadata when available.
- request and response JSON payload sections when supplied.
- system prompt, generation prompt, reasoning, custom sections, and response text.

For incremental logs, pass the path returned by the first call back as `filePath` with `append: true`. Append targets must already exist inside the runtime `logs/` directory. `markResponseBoundaries: true` writes explicit `BEGIN` and `END` headings around the response; `responseLabel` customizes the heading. The tiny-brain player-action runner uses these options so an entire staged conversation occupies one file.

Adaptive live-token failures invoke `onLiveTokenStreamFallback` before the non-stream retry begins. The player-action integration appends that diagnostic to the associated prompt log, including the server response and backtrace when present, so terminal scrollback is not the only record of why fallback was latched.

`writeLogFile(...)` writes error files under `logs/` using sanitized labels. It serializes `Error` objects, including retry metadata (`attemptNumber`, `maxAttempts`, `willRetry`) and common Axios/custom error fields. Chat tool failures use this path for structured `ERROR_tool_call_failed_*` JSON logs.

## Prompt Output Character Stats
Successful `chatCompletion(...)` calls record the final assistant text length in decoded characters under `logs/prompt-output-character-stats.json`. Tool-call-only completions do not update averages.

The stats file has `version: 1`, is validated on load, and is written atomically via temp-file rename. Invalid JSON, unsupported versions, non-normalized keys, invalid numeric values, or inconsistent zero-run entries throw. Character-appended labels for `inventory_generation`, `npc_memories`, `npc_progression_assignments`, `npc_ability_assignments`, and `npc_alias_assignments` aggregate under their base label, including compatible persisted per-character entries.

`listPromptOutputCharacterStats()` includes stored stats and configured prompt-progress target labels. `clearPromptOutputCharacterStats()` replaces the stats file with an empty validated file and returns the cleared prompt count.

## Deterministic Outputs
Per-call `forceOutput` accepts either a string or a response-shaped object with `content`, `message`, `choices`, `tool_calls`/`toolCalls`, `finish_reason`/`finishReason`, `model`, `id`, and `usage` fields where applicable.

Forced-output fixtures are loaded from `LLM_FORCE_OUTPUTS_FILE` or `ai.force_outputs_file`. Fixture groups can live under `byMetadataLabel`, `labels`, `outputs`, or top-level keys. Label lookup tries the raw label, normalized label, `unknown`, `prompt_<label>`, and ordered `<label>_group_N` buckets. Fixture strict mode is enabled unless `strict: false`; in strict mode, missing buckets and exhausted buckets throw.

## Codex Usage And Quota Reporting
When the Codex bridge response includes normalized `usage`, `LLMClient` writes a server-console usage line for that prompt with input, cached-input, output, and total token counts.

Cline and Kimi bridge responses do not currently report quota usage because their CLI JSONL streams do not guarantee token-usage metadata.

Quota snapshots are based on unique gameplay-turn metadata rather than raw prompt count. A prompt counts only when `metadata.__codexQuotaCountAsTurn === true` and `metadata.__codexQuotaTurnKey` is a non-empty stable string. Duplicate keys are ignored; a missing key with counting enabled throws. Every fifth counted turn calls `CodexBridgeClient.readRateLimits(...)`.

When a rate-limit snapshot contains multiple buckets, reporting prefers an exact active-model bucket, then the generic `codex` bucket, then the first available bucket. Successful quota reads append a visible `status-summary` chat entry titled `🌀 Codex Quota` through `Globals.appendChatEntry(...)`; the entry is marked `metadata.excludeFromBaseContextHistory = true`. Quota read or chat-notice failures warn to the server console and do not fail the completed prompt.

## Current Call Patterns
- `/api/chat` uses `player_action`, `question`, `generic_prompt`, and `generic_prompt_nocontext` labels, passes chat tools through `additionalPayload`, and uses `metadata.__codexQuotaCountAsTurn` only for player-action turns.
- Silent housekeeping prompts call `LLMClient.chatCompletion` as plain XML generation. As non-generic base-context prompts, they serialize the canonical shared schema for prefix-cache stability and receive `Do not make tool calls.`, but they do not run a model tool loop. The returned `<housekeeping>` XML is parsed and applied afterward by `Events.js`, so tracker, quest, and relationship maintenance does not depend on provider-emitted tool calls.
- `chat_tool_calls.js` relies on `onResponse` to inspect normalized tool calls across multiple tool-loop rounds, and logs tool-loop rounds with `LLMClient.logPrompt(...)`.
- `Events.js` uses labels such as `event_checks`, `need_bar_event_checks`, `quest_check`, `mystery_thread_check`, `mystery_box_update`, `alter_location`, and `alter_npc`, with regex/XML validation on structured prompts.
- `server.js` uses the client for generation, summaries, image-prompt writing, NPC/item/location/region creation, and background prompts. Region/location/item/character generation prompts that can use random integers go through the chat-tool loop with only `generateRandomInteger` exposed. Background prompt callers set `runInBackground: true`.
- `StatusEffect.js` uses `status_effect_generate` and logs the rendered prompt/response through `LLMClient.logPrompt(...)`.
- `scripts/run_prompts.js` disables XML validation, accepts an optional required regex, and logs each run through `LLMClient.logPrompt(...)`.
