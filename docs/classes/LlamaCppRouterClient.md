# LlamaCppRouterClient

## Purpose

`LlamaCppRouterClient.js` manages one configured model on a llama.cpp server running in router mode. The image-generation lifecycle uses it to release the text model before ComfyUI rendering and restore that same model afterward. `LLMClient` also uses it when root `unload_model_on_switch` is enabled, targeting the previous real prompt's effective endpoint/model before a replacement-model prompt begins. For a game-owned local router, it can also persist and restore slot 0 context between model swaps.

## Construction

`new LlamaCppRouterClient({ endpoint, model, headers, timeoutMs, pollIntervalMs, statusRetryAttempts, statusRetryDelayMs, slotId, slotCacheDirectory, httpClient, fileSystem, sleep, logger })`

- `endpoint` is the effective OpenAI-compatible chat endpoint. The client removes trailing `/chat/completions` and `/v1` segments to find the router root.
- `model` is the exact effective model id selected for the `image_prompt_generation` label, including `ai_model_overrides`.
- `headers` carry the same configured custom and authorization headers used by the text backend.
- `timeoutMs` limits each request and the status-polling lifecycle.
- `statusRetryAttempts` is the number of retries after the initial `GET /models` attempt. It defaults to `2`.
- `statusRetryDelayMs` is the wait between transient status-read attempts. It defaults to `250` milliseconds.
- `slotId` defaults to `0`. `slotCacheDirectory` defaults to `/dev/shm` and must match the local llama.cpp router's `--slot-save-path`.
- `httpClient`, `fileSystem`, and `sleep` are injectable for deterministic tests.
- `logger` receives warnings when a transient status read will be retried.

## API

- `listModels()` calls `GET /models` and requires a `data` array. Network failures, HTTP 408/429 responses, and HTTP 5xx responses are retried with the configured bounded retry policy. Other HTTP failures and malformed successful responses fail immediately.
- `getModelStatus()` finds the exact configured model id, requires a status value, and rejects failed router states.
- `unloadModelIfLoaded()` records the initial state, skips a model already marked `unloaded`, otherwise calls `POST /models/unload` and polls until the model is `unloaded`.
- `loadModel()` calls `POST /models/load` and polls until the model is `loaded`.
- `loadModelIfNeeded()` supports idempotent startup preloading. It skips an already-loaded or sleeping model, waits for an in-progress load, waits out an in-progress unload before loading, and otherwise loads an unloaded model. Unexpected states fail explicitly.
- `buildSlotCacheFilename(model)` derives a stable filesystem-safe name with a model-id hash so model caches cannot collide after sanitization.
- `saveSlotCache()` calls `POST /slots/0?action=save` with the exact model id and safe relative filename, then verifies that the file exists beneath `slotCacheDirectory`.
- `restoreSlotCacheIfPresent()` skips a model with no saved cache. Otherwise it calls `POST /slots/0?action=restore` and immediately unlinks the restored file. A restore failure leaves the file available for a later attempt; a post-restore deletion failure is marked explicitly.
- `resolveRouterBaseUrl(endpoint)` exposes endpoint normalization for tests and diagnostics.

Router response mismatches, missing models, rejected actions, failed states, exhausted status retries, and timeouts throw explicit errors. Only the read-only status request is retried; unload and load action requests are never repeated implicitly. If an unload request was accepted but status polling fails, the error is marked so the lifecycle can attempt a compensating reload.

`LLMClient` decides which slot-cache errors are nonfatal: failed saves and restores emit `console.warn` and the model swap continues. Model unload/load failures remain fatal. A successful restore followed by a deletion failure is also fatal so a consumed cache file cannot silently linger.

Some llama.cpp builds reject slot persistence for models loaded with multimodal projection data. That response (currently HTTP 501 with `This feature is not supported by multimodal`) follows the same nonfatal save-warning path: the old model still unloads and the replacement still loads, but no context cache is retained for that switch.

## Related Coverage

`tests/llama_cpp_router_client.test.js` covers endpoint normalization, unload/load polling, idempotent startup loading, already-unloaded state, action payloads, missing-model errors, transient status retries, slot filename isolation, save verification, restore deletion, absent-cache skipping, and post-restore deletion failure.
