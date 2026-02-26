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

## Public API (Static)
- `cancelPrompt(streamId, reason)`: aborts an in-flight request.
- `retryPrompt(streamId, reason)`: aborts the current attempt and restarts the same prompt call.
- `cancelAllPrompts(reason)`: aborts all currently tracked in-flight prompt attempts.
- `waitForPromptDrain({ timeoutMs, pollIntervalMs })`: waits until tracked prompt activity is fully drained.
- `ensureAiConfig()`: validates `Globals.config.ai`.
- `getMaxConcurrent(aiConfigOverride)`: reads `max_concurrent_requests`.
- `writeLogFile({ prefix, metadataLabel, payload, serializeJson, onFailureMessage, error, append })`: writes error logs.
- `formatMessagesForErrorLog(messages)`: formats messages into a readable log.
- `logPrompt({...})`: writes prompt/response logs to `logs/`.
- `baseTimeoutMilliseconds()` / `resolveTimeout(timeoutMs, multiplier)`.
- `resolveChatEndpoint(endpoint)` / `resolveTemperature(explicit, fallback)` / `resolveOutput(output, fallback)`.
- `chatCompletion({ messages, metadataLabel, timeoutMs, temperature, stream, ... })`:
  - Handles retries, streaming, logging, and optional image preprocessing.
  - Normalizes response payloads for both stream and non-stream calls so `choices[0].message.tool_calls` is available to callers.
  - Assembles streamed `delta.tool_calls` chunks into full function calls and validates that each call has parseable JSON `function.arguments`.
  - Uses `LLMClient.logPrompt` and emits prompt progress via `Globals.realtimeHub`.

## Private Helpers (Selected)
- Stream tracking: `#isInteractive`, `#renderStreamProgress`, `#ensureProgressTicker`, `#trackStreamStart`, `#trackStreamBytes`, `#trackStreamEnd`, `#broadcastProgress`.
- Concurrency: `#ensureSemaphore`.
- Formatting: `#formatMessageContent`, `#cloneAiConfig`.
- Parsing/validation: `#resolveBoolean`, `#generateSeed`.
- Image handling: `#getSharp`, `#parseImageDataUrl`, `#convertImageDataUrlToWebp`, `#convertMessagesToWebp`.

## Notes
- Streaming progress is broadcast through `Globals.realtimeHub` when available.
- Streamed tool calls are allowed: empty textual content is accepted when valid tool calls are present, and regex/XML output validation is skipped for those tool-call turns.
- Retries are built in; stream timeouts are incrementally increased on retry.
- Manual retries from prompt-progress UI do not consume configured automatic retry attempts for the prompt call.
- Retry attempts re-resolve active AI runtime settings (including `ai_model_overrides` selected by `metadataLabel`) before each request attempt, so model/endpoint/key and other settings can change between retries.
- `ai.custom_args` supports structured provider-specific top-level request args; profile `ai_model_overrides` merge `custom_args` per key (deep merge), with `null` deleting inherited keys.
- `ai.headers` supports global HTTP request headers; profile `ai_model_overrides` merge `headers` per key, with `null` deleting inherited headers.
- `logPrompt` is the standard logging path for prompts throughout the codebase.
- The chat completion payload no longer forces `reasoning: true`; it is only sent when configured explicitly.
