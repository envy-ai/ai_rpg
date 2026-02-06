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
- `#canceledStreams`: set of canceled stream ids.

## Public API (Static)
- `cancelPrompt(streamId, reason)`: aborts an in-flight request.
- `ensureAiConfig()`: validates `Globals.config.ai`.
- `getMaxConcurrent(aiConfigOverride)`: reads `max_concurrent_requests`.
- `writeLogFile({ prefix, metadataLabel, payload, serializeJson, onFailureMessage, error, append })`: writes error logs.
- `formatMessagesForErrorLog(messages)`: formats messages into a readable log.
- `logPrompt({...})`: writes prompt/response logs to `logs/`.
- `baseTimeoutMilliseconds()` / `resolveTimeout(timeoutMs, multiplier)`.
- `resolveChatEndpoint(endpoint)` / `resolveTemperature(explicit, fallback)` / `resolveOutput(output, fallback)`.
- `chatCompletion({ messages, metadataLabel, timeoutMs, temperature, stream, ... })`:
  - Handles retries, streaming, logging, and optional image preprocessing.
  - Uses `LLMClient.logPrompt` and emits prompt progress via `Globals.realtimeHub`.

## Private Helpers (Selected)
- Stream tracking: `#isInteractive`, `#renderStreamProgress`, `#ensureProgressTicker`, `#trackStreamStart`, `#trackStreamBytes`, `#trackStreamEnd`, `#broadcastProgress`.
- Concurrency: `#ensureSemaphore`.
- Formatting: `#formatMessageContent`, `#cloneAiConfig`.
- Parsing/validation: `#resolveBoolean`, `#generateSeed`.
- Image handling: `#getSharp`, `#parseImageDataUrl`, `#convertImageDataUrlToWebp`, `#convertMessagesToWebp`.

## Notes
- Streaming progress is broadcast through `Globals.realtimeHub` when available.
- Retries are built in; stream timeouts are incrementally increased on retry.
- `logPrompt` is the standard logging path for prompts throughout the codebase.
- The chat completion payload no longer forces `reasoning: true`; it is only sent when configured explicitly.
