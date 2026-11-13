# ImageGenerationModelLifecycle

## Purpose

`ImageGenerationModelLifecycle.js` provides the transactional ordering around a batch of ComfyUI render jobs for llama.cpp router unloading, managed-process termination, or Strata elastic/RAM standby handoff.

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

Strata mode (`mode: "strata_vram"`) uses the same exclusive gate and render drain:

1. Resolve and capture the effective `image_prompt_generation` Strata target once.
2. Validate that the configured model is already loaded with elastic VRAM and
   the minimum does not exceed the GPU total. Request the GPU's total MiB as
   Strata's reserve goal, then verify actual free VRAM meets the configured minimum.
3. Drain the render batch; text requests remain queued behind the gate.
4. Release ComfyUI VRAM through the existing Cache Monitor operation and warning
   path for its full `/free` cleanup alternative.
5. Restore Strata's startup reserve with explicit JSON null, then release the gate.

This mode never unloads the model or terminates the engine. A failed shrink that
may have been accepted still attempts cleanup and restoration before propagating
its error. Rendering failure or cancellation also runs both recovery operations;
recovery requests do not reuse an aborted render signal. A cleanup failure is
fatal for this cycle, but restoration is still attempted. Multiple failures are
retained in an `AggregateError`. A changed config during rendering applies to a
later cycle; recovery continues against the captured endpoint/model/goal.

`ai.strata_context_cache_directory` (default `/tmp`, null disables) extends managed elastic
mode with [StrataImageContextCache](StrataImageContextCache.md): save the held
conversation before shrinking, then restore it after ComfyUI cleanup and Strata
VRAM recovery. All operations share the original exclusive gate. An acknowledged
snapshot is restored after rendering failure, cancellation, or a shrink failure;
every independent failure is preserved. A native typed no-complete-session
refusal is logged explicitly and admits rendering without a disk snapshot. Other
snapshot failures prevent rendering. The configured directory must match native
`slot_save_path`, and managed ownership is required. The directory preference is
unused for unmanaged and RAM standby handoffs; their behavior is unchanged.

RAM standby (`mode: "strata_ram_standby"`) uses the same exclusive text gate
and captured target. It requests `/v1/standby`, verifies both Strata GPU workers
have exited and actual free VRAM meets the minimum, then renders. On completion
or failure it releases ComfyUI VRAM before releasing the text gate. It leaves
Strata resident in system RAM; there is no immediate GPU restoration. The
existing pre-prompt ComfyUI cleanup runs before the next queued text request
reaches Strata and triggers automatic attach/session restore. A later image
batch may reuse the already resident state without waking Strata. If a standby
request has ambiguous outcome, the lifecycle still attempts ComfyUI cleanup;
it preserves both errors if cleanup also fails.

The constructor adds optional `resolveStrataTarget`, `createStrataClient`, and
`createStrataContextCache`
dependencies. `run({ mode, renderBatch, signal })` accepts an optional cancellation
signal for Strata admission. Existing modes retain their contracts; `mode: "none"`
still directly invokes the render callback. See [StrataVramClient](StrataVramClient.md).

`server.js` waits for image-prompt generation to become idle before starting this lifecycle. The render callback drains queued jobs using `imagegen.maxConcurrentJobs` on the normal path. With ComfyUI `imagegen.batch_prompts`, it instead drains one prompt-list submission at a time, grouping jobs by effective workflow and exact resolution. Prompt-writing requests that arrive while the text server is paused remain queued until it is available again, then start the next image lifecycle.

A cycle failure emits `image_model_lifecycle_error` to open chat clients even if
the render queue is already empty. The existing PageFeedback error dialog keeps
the original stack and each `AggregateError` cause visible until dismissed.

## Related Coverage

`tests/image_generation_model_lifecycle.test.js` covers successful router and local-process ordering, render failures, optional router-mode Comfy cleanup failure, unload failure, local restart behavior, and disabled behavior. `tests/local_llama_server_process.test.js` covers cleanup-before-spawn ordering and saved-PID termination.

With a configured [local LLM controller](ManagedLocalLlmController.md), even
`mode: "none"` renders use the exclusive gate so explicit toggles wait for images.
A manually switched-off model uses render-only handling, and a pending off request
suppresses termination-mode post-image restart. Other configurations retain the
existing disabled-mode direct render behavior.
