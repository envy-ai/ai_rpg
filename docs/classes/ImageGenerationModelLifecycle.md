# ImageGenerationModelLifecycle

## Purpose

`ImageGenerationModelLifecycle.js` provides the transactional ordering around a batch of ComfyUI render jobs when either llama.cpp handoff mode is enabled.

Router-unload mode (`mode: "unload"`) runs this order:

1. Acquire `LLMClient`'s exclusive model-lifecycle gate after active text requests finish.
2. Resolve the effective `image_prompt_generation` endpoint and model.
3. Unload that model through the llama.cpp router.
4. Run the supplied render-batch callback until the server image queue is quiescent.
5. Ask ComfyUI to unload cached models and free memory.
6. Reload the llama.cpp model if this lifecycle unloaded it.
7. Release the gate so queued text prompts can proceed.

The LLM reload is attempted after successful or failed rendering. A ComfyUI `/free` failure is logged as a warning because cleanup is optional, but it does not suppress the critical reload attempt. If both rendering and reload fail, the lifecycle raises an `AggregateError` containing both errors. An unload failure prevents rendering from starting; if unload may already have begun, a compensating reload is attempted first.

Managed-process mode (`mode: "terminate"`) instead:

1. Acquires the same exclusive model-lifecycle gate.
2. Terminates the process group identified by `LocalLlamaServerProcess`'s saved PID.
3. Drains the supplied render batch.
4. Calls `LocalLlamaServerProcess.start()` even after a render failure. That method strictly clears ComfyUI VRAM immediately before running the configured startup script and waits for llama.cpp readiness.
5. Releases the text gate only after the restarted server is ready.

If rendering and local restart both fail, the lifecycle raises an `AggregateError` containing both failures. A termination failure prevents rendering from starting. `mode: "none"` calls the render callback directly without acquiring exclusive access. The supported modes are mutually exclusive by configuration validation.

## Server Integration

`server.js` waits for image-prompt generation to become idle before starting this lifecycle. The render callback drains queued jobs using `imagegen.maxConcurrentJobs` on the normal path. With ComfyUI `imagegen.batch_prompts`, it instead drains one prompt-list submission at a time, grouping jobs by effective workflow and exact resolution. Prompt-writing requests that arrive while the text server is paused remain queued until it is available again, then start the next image lifecycle.

## Related Coverage

`tests/image_generation_model_lifecycle.test.js` covers successful router and local-process ordering, render failures, optional router-mode Comfy cleanup failure, unload failure, local restart behavior, and disabled behavior. `tests/local_llama_server_process.test.js` covers cleanup-before-spawn ordering and saved-PID termination.
