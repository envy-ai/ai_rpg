# ImageGenerationModelLifecycle

## Purpose

`ImageGenerationModelLifecycle.js` provides the transactional ordering around a batch of ComfyUI render jobs when either llama.cpp handoff mode is enabled.

Router-unload mode (`mode: "unload"`) runs this order:

1. Acquire `LLMClient`'s exclusive model-lifecycle gate after active text requests finish.
2. Resolve the effective `image_prompt_generation` endpoint and model.
3. Unload that model through the llama.cpp router.
4. Run the supplied render-batch callback until the server image queue is quiescent.
5. POST to Cache Monitor's `/comfyui-cache-monitor/release_vram`, partially unloading active model weights from VRAM while preserving their registered RAM-backed caches.
6. Reload the llama.cpp model if this lifecycle unloaded it.
7. Release the gate so queued text prompts can proceed.

The LLM reload is attempted after successful or failed rendering. If Cache Monitor fails, `ComfyUIClient.releaseVram()` falls back to full `/free` cleanup. The lifecycle warning-logs that downgrade and invokes its `onComfyCacheMonitorFallback` callback so the server can notify browsers. A failure of both cleanup requests is logged as optional and does not suppress the critical LLM reload attempt. If both rendering and reload fail, the lifecycle raises an `AggregateError` containing both errors. An unload failure prevents rendering from starting; if unload may already have begun, a compensating reload is attempted first.

Managed-process mode (`mode: "terminate"`) instead:

1. Acquires the same exclusive model-lifecycle gate.
2. Terminates the process group identified by `LocalLlamaServerProcess`'s saved PID.
3. Drains the supplied render batch.
4. Calls `LocalLlamaServerProcess.start({ beforeStartOptions: { preserveComfySystemCache: true } })` even after a render failure. The pre-start callback invokes Cache Monitor's VRAM-release endpoint, falls back to strict full `/free` cleanup with a browser warning when necessary, then runs the configured startup script and waits for llama.cpp readiness.
5. Releases the text gate only after the restarted server is ready.

If rendering and local restart both fail, the lifecycle raises an `AggregateError` containing both failures. A termination failure prevents rendering from starting. `mode: "none"` calls the render callback directly without acquiring exclusive access. The supported modes are mutually exclusive by configuration validation.

## Server Integration

`server.js` waits for image-prompt generation to become idle before starting this lifecycle. The render callback drains queued jobs using `imagegen.maxConcurrentJobs` on the normal path. With ComfyUI `imagegen.batch_prompts`, it instead drains one prompt-list submission at a time, grouping jobs by effective workflow and exact resolution. Prompt-writing requests that arrive while the text server is paused remain queued until it is available again, then start the next image lifecycle.

## Related Coverage

`tests/image_generation_model_lifecycle.test.js` covers successful router and local-process ordering, render failures, optional router-mode Comfy cleanup failure, unload failure, local restart behavior, and disabled behavior. `tests/local_llama_server_process.test.js` covers cleanup-before-spawn ordering and saved-PID termination.
