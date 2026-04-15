# LLMClient

## Purpose
Centralized client for LLM chat completions with concurrency limits, streaming progress reporting, retry logic, prompt logging, and optional image preprocessing. Also exposes prompt cancellation and log utilities.

## Internal Class: Semaphore
- `constructor(maxConcurrent)`: sets concurrency limit.
- `acquire()` / `release()`: manage async access.
- `setLimit(newLimit)` / `dispatch()`: adjust and drain queued acquisitions.

## Key State (Static)
- `#semaphores`: per-key Semaphore instances.
- `#semaphoreLimit`: current global limit.
- `#streamProgress`: active stream tracking and ticker state.
- `#abortControllers`: map of in-flight requests by stream id.
- `#controllerAbortIntents`: per-attempt abort intent (`cancel` vs `retry`) keyed by abort controller.
- `#codexUsageStats`: running in-process totals for Codex prompt count plus input/cached/output/total token usage.

## Public API (Static)
- `cancelPrompt(streamId, reason)`: aborts an in-flight request.
- `retryPrompt(streamId, reason)`: aborts the current attempt and restarts the same prompt call.
- `cancelAllPrompts(reason)`: aborts all currently tracked in-flight prompt attempts.
- `waitForPromptDrain({ timeoutMs, pollIntervalMs })`: waits until tracked prompt activity is fully drained.
- `ensureAiConfig()`: validates `Globals.config.ai`.
- `resolveBackend(aiConfigOverride)`: resolves the active text backend (`openai_compatible` or `codex_cli_bridge`).
- `getConfigurationErrors(aiConfigOverride)`: returns backend-aware config validation errors.
- `isConfigured(aiConfigOverride)`: true when the selected backend has the required config.
- `getMaxConcurrent(aiConfigOverride)`: reads `max_concurrent_requests`.
- `resetForcedOutputState()`: clears cached forced-output fixture data/counters.
- `writeLogFile({ prefix, metadataLabel, payload, serializeJson, onFailureMessage, error, append })`: writes error logs.
- `formatMessagesForErrorLog(messages)`: formats messages into a readable log.
- `logPrompt({...})`: writes prompt/response logs to `logs/`.
- `baseTimeoutMilliseconds()` / `resolveTimeout(timeoutMs, multiplier)`.
- `resolveChatEndpoint(endpoint)` / `resolveTemperature(explicit, fallback)` / `resolveOutput(output, fallback)`.
- `chatCompletion({ messages, metadataLabel, timeoutMs, temperature, stream, ... })`:
  - Handles retries, streaming, logging, and optional image preprocessing.
  - Optional `validateXMLStrict: true` upgrades XML validation from the normal lenient parser to `Utils.parseXmlDocumentStrict(...)`, causing malformed XML to fail with parser diagnostics instead of being normalized first.
  - Optional `logStreamChunksToConsole: true` dumps raw streamed `data:` payload chunks to the server console with separator lines; it is a no-op for non-streamed calls.
  - Supports deterministic `forceOutput` mode for tests: skips AI network calls but still runs response post-processing/validation and emits normalized `onResponse` data.
  - Supports fixture-driven deterministic outputs via `LLM_FORCE_OUTPUTS_FILE` env or `ai.force_outputs_file` config:
    - Fixture maps prompt labels to response arrays (consumed in order per label).
    - Label lookup prefers exact `metadataLabel`, then normalized underscore form.
    - Additional fixture-key fallbacks: `prompt_<label>` and grouped `<label>_group_N` buckets (flattened by numeric `N` order).
    - In strict mode (default), missing labels or exhausted arrays throw explicit errors.
  - Normalizes response payloads for both stream and non-stream calls so `choices[0].message.tool_calls` is available to callers.
  - Assembles streamed `delta.tool_calls` chunks into full function calls and validates that each call has parseable JSON `function.arguments`.
  - Uses `LLMClient.logPrompt` and emits prompt progress via `Globals.realtimeHub`.

## Private Helpers (Selected)
- Stream tracking: `#isInteractive`, `#shouldTrackPromptProgress`, `#renderStreamProgress`, `#ensureProgressTicker`, `#trackStreamStart`, `#trackStreamBytes`, `#trackStreamStatus`, `#trackStreamEnd`, `#formatCodexProgressEvent`, `#broadcastProgress`.
- Codex reporting: `#formatTokenCount`, `#formatEpochTimestamp`, `#formatCodexRateLimitWindow`, `#formatCodexRateLimits`, `#reportCodexUsage`.
- Concurrency: `#ensureSemaphore`.
- Formatting: `#formatMessageContent`, `#cloneAiConfig`.
- Parsing/validation: `#resolveBoolean`, `#generateSeed`.
- Image handling: `#getSharp`, `#parseImageDataUrl`, `#convertImageDataUrlToWebp`, `#convertMessagesToWebp`.

## Notes
- `chatCompletion(...)` is now backend-aware: the default `openai_compatible` path still POSTs to `/chat/completions`, while `codex_cli_bridge` delegates transport to `CodexBridgeClient` and then reuses the same response normalization, retry, prompt logging, and XML/regex validation flow.
- Streaming/progress updates are broadcast through `Globals.realtimeHub` when available, including per-prompt `promptText` content for the request payload and `previewText` content for the currently streamed textual response or backend status text.
- Prompt-progress tracking no longer depends on an interactive TTY alone; it stays active whenever the realtime hub is available, so the browser prompt-progress popup can still work when the server process is running non-interactively.
- Streamed tool calls are allowed: empty textual content is accepted when valid tool calls are present, and regex/XML output validation is skipped for those tool-call turns.
- Retries are built in; stream timeouts are incrementally increased on retry.
- Manual retries from prompt-progress UI do not consume configured automatic retry attempts for the prompt call.
- Retry attempts re-resolve active AI runtime settings (including `ai_model_overrides` selected by `metadataLabel`) before each request attempt, so model/endpoint/key and other settings can change between retries.
- Retry wait time between automatic attempts comes from `waitAfterError` (per-call override), else `ai.waitAfterError` (including per-prompt `ai_model_overrides`), else default `10` seconds. Rate-limit (`429`) retries can use `waitAfterRateLimitError`/`ai.waitAfterRateLimitError`, which overrides the general retry wait for those failures only.
- `ai.custom_args` supports structured provider-specific top-level request args; profile `ai_model_overrides` merge `custom_args` per key (deep merge), with `null` deleting inherited keys.
- `ai.headers` supports global HTTP request headers; profile `ai_model_overrides` merge `headers` per key, with `null` deleting inherited headers.
- `ai.cachebuster` is boolean; omitted or `false` disables it, while `true` prepends a fresh `[cachebuster:<uuid>]` line to the final `user` message for each outbound request attempt. The payload copy, prompt-progress broadcast, and error logs show the tagged prompt, while the caller's original `messages` array remains unchanged.
- When the Codex bridge backend is selected, `fresh` mode uses `ai.max_concurrent_requests`, while resumed Codex session modes remain serialized through backend-specific semaphore keys.
- Codex bridge requests reuse the same prompt-progress ids and abort-controller registry as streamed OpenAI requests, so the existing prompt-progress popup's cancel/retry controls work for Codex runs too.
- Codex bridge progress is coarse-grained rather than token-streamed: `LLMClient` tracks stdout byte counts plus short status lines such as thread/turn/item lifecycle events, then clears the popup when the bridge finishes or aborts.
- When a Codex response includes normalized `usage`, `LLMClient` writes an unconditional server-console usage line for that prompt attempt and accumulates running totals for the current server process.
- `LLMClient` now queries the local Codex app-server for a rate-limit snapshot every 5 counted gameplay turns rather than every N raw prompts. Counted turns are opt-in via request metadata (`__codexQuotaCountAsTurn` + stable `__codexQuotaTurnKey`) so tool-loop rounds do not double-count. If that auxiliary quota query fails, it logs a clear warning instead of silently claiming quota data.
- Successful 5-turn Codex quota snapshots also append a visible `status-summary` chat entry (`🌀 Codex Quota`) with up to three short lines: optional positive credit balance, `Primary: <percent> remaining; resets <time>`, and `Secondary: <percent> remaining; resets <month day ordinal> at <time>`. The entry is flagged `metadata.excludeFromBaseContextHistory = true` so it never enters base prompt history.
- `logPrompt` is the standard logging path for prompts throughout the codebase.
- The chat completion payload no longer forces `reasoning: true`; it is only sent when configured explicitly.
