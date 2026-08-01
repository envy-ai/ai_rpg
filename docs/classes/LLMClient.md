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
- `ai.prefill` adds a final assistant message for OpenAI-compatible requests so providers that support assistant prefill can continue from that text. Matching `ai_model_overrides` profiles can replace it or set it to `null`; per-call `prefill`/`assistantResponseSeed` takes precedence. Prefill is rejected for CLI bridges and tool-call requests.
- `ai.sysprompt_append` adds an additional model-specific system-instruction message to the outbound payload copy. Matching `ai_model_overrides` profiles replace it or set it to `null`; the caller-provided `messages` array is not mutated.
- `ai.reasoning_effort`, override-profile `reasoning_effort`, payload `reasoning_effort`, or per-call `reasoningEffort` opt into OpenAI-compatible reasoning by sending `reasoning: true` and `reasoning_effort`.
- `ai.force_outputs_file` or `LLM_FORCE_OUTPUTS_FILE` supplies deterministic fixture output buckets for tests and scripted runs.
- Root `max_concurrent_requests_all_models` optionally adds a positive-integer cap across all real chat-completion requests, independent of model/backend/auth semaphore keys.

## Public API
- `chatCompletion(options)`: runs one completion request and returns assistant text.
- `withPromptQueueReservation(callback)`: creates an opaque queue reservation, passes it to an awaited callback, and releases any retained permits in `finally`. Sequential `chatCompletion(...)` calls can pass that reservation to keep the same queue position across a logical multi-call prompt.
- `cancelPrompt(streamId, reason)`: aborts one tracked in-flight prompt and causes that request to return `''`.
- `retryPrompt(streamId, reason)`: aborts one tracked attempt and restarts the same `chatCompletion(...)` loop without consuming an automatic retry attempt.
- `recordPromptProgressGroupFailure(progressGroupId, responseText)`: records one parse-failed response for a logical prompt group, marks its current progress entry failed, and broadcasts an immediate `prompt_progress_group_failure` update.
- `clearPromptProgressGroup(progressGroupId)`: releases transient failed-response history after a grouped logical prompt ends; active/completed entry snapshots keep their copied display data.
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
- `progressGroupId`: optional non-empty logical prompt id copied into prompt-progress entries. Sequential tiny-brain calls use one group id so a viewer can follow the run while individual stream ids change.
- `multimodal`: merges `Globals.config.ai_multimodal` into the effective AI config.
- `validateXML`, `validateXMLStrict`, `requiredTags`, `requiredRegex`: response validation controls.
- `forceOutput`: deterministic string or response-shaped object that skips network transport and runs normalization, validation, stats, and hooks.
- `captureRequestPayload`, `captureResponsePayload`, `onResponse`: testing and integration hooks.
- `logStreamChunksToConsole`: dumps raw OpenAI-compatible streamed `data:` payloads.
- `output`: `stdout`, `stderr`, or `silent`; `silent` suppresses normal console output and prompt-progress tracking.

Request flow:

1. Detect base-context prompts through their internal end marker, remove that marker, and apply the non-generic shared-tool policy before any provider-visible payload is built. Then expand internal message-boundary markers and convert any `image_url` data URLs in message content to WebP through `sharp`. Non-data image URLs in this preprocessing path fail with an explicit error.
2. Resolve deterministic output from `forceOutput` or a forced-output fixture, if configured.
3. Resolve retry count from the call option or `ai.retryAttempts`.
4. For each attempt, clone AI config, apply `ai_model_overrides`, merge custom args/headers, resolve backend, append configured system-prompt text, apply cachebuster, append OpenAI-compatible assistant prefill when configured, resolve model/temperature/token/top-p/reasoning settings, and choose a semaphore key.
5. Acquire the per-key semaphore, then the optional all-model semaphore from root `max_concurrent_requests_all_models`. Background requests share the same semaphores but foreground requests are dispatched first; with a limit above one, background work leaves one slot available for foreground prompts. A valid queue reservation retains these permits between sequential calls instead of releasing and reacquiring them.
6. Start prompt-progress tracking when the request is trackable and output is not `silent`.
7. Dispatch through `axios.post(...)`, `CodexBridgeClient.chatCompletion(...)`, `ClineBridgeClient.chatCompletion(...)`, or `KimiBridgeClient.chatCompletion(...)`.
8. Normalize the response into an OpenAI-style `chat.completion` payload, merge assistant prefill into returned text exactly once, call capture/on-response hooks, strip `<think>...</think>` blocks from returned text, validate output, update prompt stats, and return assistant text.

## Response Normalization And Validation
- Streaming OpenAI-compatible responses are assembled from SSE `data:` chunks. Text deltas are concatenated and `delta.tool_calls` chunks are assembled into complete function calls.
- Non-stream responses and CLI bridge responses use the same normalized shape for `choices[0].message.content` and `choices[0].message.tool_calls`.
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

High-frequency progress broadcasts are coalesced to at most one active update every 500 ms. Completion sends an immediate `progressFraction: 1` update, holds the completed entry for 250 ms, then emits the clear event. Prompt-progress `id` values are the ids accepted by `cancelPrompt(...)` and `retryPrompt(...)`.

`recordPromptProgressGroupFailure(...)` force-broadcasts the updated progress entry and also emits `prompt_progress_group_failure`, allowing the browser to recolor a failed response even if the completed stream entry has already left the normal 250 ms hold window. The failed text is display metadata only and is not added to request messages.

## Internal prompt message boundaries

Every `base-context.xml.njk` render places an internal end marker after the shared context and immediately before the prompt-specific include. `chatCompletion(...)` removes it before prompt-progress display or transport. For non-generic base-context prompts, that marker activates one canonical ordered tool schema containing all built-in definitions plus all registered mod tools. `requestUserInput` is removed globally when `chat_tools.request_user_input_enabled` is false, and resolution/check tools are removed globally when `use_legacy_prompt_checks` is true. A non-generic caller that supplied no tool definitions before this policy also receives the exact instruction `Do not make tool calls.` at the marker position; it still uses its existing direct-completion path and does not execute emitted calls. An explicit `tool_choice: "none"` remains `none` while the schema stays serialized, allowing exhausted tool loops to disable further calls without changing the tool prefix. Base-context generic prompts (`generic_prompt`) only have the marker removed: their existing tool payload and behavior are preserved. Prompts not rendered through base context are untouched.

Caching-enabled base-context templates also place a second internal marker immediately before `<recentStoryHistory>`. Before system-prompt append text, cachebusting, progress display, or backend transport, `chatCompletion(...)` replaces that marker with a real boundary between two consecutive `user` messages. This gives hybrid/recurrent llama.cpp servers a user-message checkpoint after the cache-stable base-context prefix and before recent history. The expansion preserves later assistant, tool, and user messages, so TinyBrain and tool-loop transcripts keep their original chronology. Internal markers are never sent to the model. Invalid placement, duplication, or empty content around a required boundary raises an explicit error.

## Concurrency
`LLMClient` keeps a semaphore per backend/model/auth/session key, plus an optional process-wide semaphore when root `max_concurrent_requests_all_models` is set.

- OpenAI-compatible keys use the resolved API credential or OAuth cache key plus model.
- Codex fresh-mode, Cline, and Kimi bridge keys use backend plus model identity and honor `ai.max_concurrent_requests`.
- Codex resumed-session keys serialize by Codex home and, for `resume_id`, session id.
- The all-model semaphore caps real outbound text-generation attempts across every key. It is acquired only after the per-key permit so a request waiting on a busy model does not occupy an all-model slot.
- `runInBackground: true` lowers queue priority and limits concurrent background occupancy so foreground gameplay prompts can start ahead of queued background prompts.
- `withPromptQueueReservation(...)` retains one acquired per-key permit and its optional all-model permit until the callback completes. This prevents another queued prompt from taking that logical prompt's slot between stages or retries without reducing configured capacity or blocking other genuinely free slots.
- Reservations reject concurrent reuse, model/semaphore-key changes, all-model concurrency changes, and foreground/background priority changes. Permits are released in `finally` when the callback succeeds or fails.

## Prompt Logging
`logPrompt(...)` writes `logs/<timestamp>_<prefix>_<metadataLabel>.log` with:
- prompt output-character stats header.
- model, endpoint, and token metadata when available.
- request and response JSON payload sections when supplied.
- system prompt, generation prompt, reasoning, custom sections, and response text.

For incremental logs, pass the path returned by the first call back as `filePath` with `append: true`. Append targets must already exist inside the runtime `logs/` directory. `markResponseBoundaries: true` writes explicit `BEGIN` and `END` headings around the response; `responseLabel` customizes the heading. The tiny-brain player-action runner uses these options so an entire staged conversation occupies one file.

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
