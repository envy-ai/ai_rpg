# LlamaCppRouterClient

## Purpose

`LlamaCppRouterClient.js` manages one configured model on a remote llama.cpp server running in router mode. The image-generation lifecycle uses it to release the text model before ComfyUI rendering and restore that same model afterward. `LLMClient` also uses it when root `unload_model_on_switch` is enabled, targeting the previous real prompt's effective endpoint/model before a replacement-model prompt begins.

## Construction

`new LlamaCppRouterClient({ endpoint, model, headers, timeoutMs, pollIntervalMs, statusRetryAttempts, statusRetryDelayMs, httpClient, sleep, logger })`

- `endpoint` is the effective OpenAI-compatible chat endpoint. The client removes trailing `/chat/completions` and `/v1` segments to find the router root.
- `model` is the exact effective model id selected for the `image_prompt_generation` label, including `ai_model_overrides`.
- `headers` carry the same configured custom and authorization headers used by the text backend.
- `timeoutMs` limits each request and the status-polling lifecycle.
- `statusRetryAttempts` is the number of retries after the initial `GET /models` attempt. It defaults to `2`.
- `statusRetryDelayMs` is the wait between transient status-read attempts. It defaults to `250` milliseconds.
- `httpClient` and `sleep` are injectable for deterministic tests.
- `logger` receives warnings when a transient status read will be retried.

## API

- `listModels()` calls `GET /models` and requires a `data` array. Network failures, HTTP 408/429 responses, and HTTP 5xx responses are retried with the configured bounded retry policy. Other HTTP failures and malformed successful responses fail immediately.
- `getModelStatus()` finds the exact configured model id, requires a status value, and rejects failed router states.
- `unloadModelIfLoaded()` records the initial state, skips a model already marked `unloaded`, otherwise calls `POST /models/unload` and polls until the model is `unloaded`.
- `loadModel()` calls `POST /models/load` and polls until the model is `loaded`.
- `resolveRouterBaseUrl(endpoint)` exposes endpoint normalization for tests and diagnostics.

Router response mismatches, missing models, rejected actions, failed states, exhausted status retries, and timeouts throw explicit errors. Only the read-only status request is retried; unload and load action requests are never repeated implicitly. If an unload request was accepted but status polling fails, the error is marked so the lifecycle can attempt a compensating reload.

## Related Coverage

`tests/llama_cpp_router_client.test.js` covers endpoint normalization, unload/load polling, already-unloaded state, action payloads, missing-model errors, transient status retries, and immediate rejection of non-transient status errors.
