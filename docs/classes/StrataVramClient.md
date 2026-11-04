# StrataVramClient

`StrataVramClient.js` coordinates ComfyUI's GPU access with Strata. The default
`elastic` mode resizes a running expert cache. `ram_standby` requests a complete
GPU worker exit while Strata retains locked model pages in system RAM. The
client never owns the Strata processes. Optional native process ownership belongs
to [StrataRuntime](StrataRuntime.md).

## Configuration

The effective `image_prompt_generation` AI profile selects the endpoint, exact
model, authentication and optional handoff:

```yaml
ai:
  image_generation_handoff:
    provider: strata
    mode: elastic  # optional; ram_standby uses full GPU release
    min_free_vram_mib: 12288
```

`min_free_vram_mib` is a positive integer of **total free VRAM required for rendering**,
defaults to 12288 when omitted, and is never clamped. AIRPG requests the GPU's
total MiB as Strata's reserve goal, then checks the actual free MiB against this
minimum. Absent/null `image_generation_handoff` retains the
existing llama.cpp settings. Unknown providers, non-object settings, invalid
minimums or unknown keys, a non-OpenAI-compatible backend, non-ComfyUI image engine, legacy
unload/terminate flags, or managed startup scripts fail explicitly. Strata handoff
also rejects global model-switch unloading and explicit router preloading.
`mode` defaults to `elastic`; only `elastic` and `ram_standby` are valid.

`ImageGenerationHandoff.js` exports `DEFAULT_STRATA_MIN_FREE_VRAM_MIB`,
`resolveImageGenerationHandoff(aiConfig)` (null or a frozen resolved object), and
`validateImageGenerationHandoffs(configuration, resolveEffectiveAiConfiguration)` for
startup, configuration saves, and runtime reload before live configuration mutation.
The server injects `LLMClient.resolveEffectiveAiConfiguration` so every prompt label
is checked after all matching overrides compose. Prompt overrides inherit
AI values as usual; set `image_generation_handoff: null` explicitly on an override
that must not inherit Strata handling. The handoff itself follows the effective
`image_prompt_generation` profile, including its model and connection headers.

## Client contract

`new StrataVramClient({ endpoint, model, minFreeVramMiB = 12288, headers = {},
timeoutMs = 120000, httpClient = axios, signal = null, handoffMode = 'elastic' })`

- Endpoint normalization accepts an API root, `/v1`, or `/v1/chat/completions`,
  preserves a reverse-proxy prefix, and removes query/fragment components.
- `getStatus()` reads `/v1/status` and requires `service: "strata"`, the exact
  configured model, `loaded: true`, `vram.elastic: true`, and a valid `started`
  server identity and positive integer `machine.gpu.total_mib`. The first release
  captures that identity for the cycle.
- `releaseForImages()` validates status, sends `POST /v1/vram` with the requested
  `reserve_mib: machine.gpu.total_mib`, requires `status: "ok"`, validates integer
  memory/slot fields and the echoed goal, checks actual
  `vram_free_mib >= minFreeVramMiB`, then validates status again. A minimum larger
  than GPU total fails before POST. `status: "not loaded"` never admits image generation.
- A release failure carries `releaseMayHaveStarted` once its POST may have been
  sent. A timeout, inadequate free VRAM, or failed postflight status can therefore
  still require compensation. Control actions are never implicitly retried.
- `restore()` validates the same live server/model, POSTs explicit
  `{ "reserve_mib": null }`, validates its response and status, and uses bounded
  requests independent of a cancelled image signal. Restoration honors Strata's
  startup reserve; its cache may remain below the nominal full slot count.
- In `ram_standby` mode, `getStatus()` requires `gpu_residency.capable: true` and
  a valid state instead of elastic VRAM. `standbyForImages()` sends
  `POST /v1/standby` with the exact model, requires measured free VRAM above
  the configured minimum and null engine/vision worker PIDs, then verifies
  `/v1/status` still reports `ram_resident` with the same `instance_id` on the same API server. Another
  image cycle may enter while Strata is already resident in RAM. There is no
  eager restoration call: the next actual prompt wakes Strata after ComfyUI
  cleanup. A timed-out control request is marked as possibly accepted.

`LLMClient.resolveStrataVramManagementTarget()` uses the existing shared OpenAI
authentication/header preparation, including prompt-specific overrides and OAuth.
The lifecycle captures one client/target for both release and restoration, so a
configuration reload during rendering cannot redirect recovery to another server.
Strata's `started` identifies its API server; it does not expose an engine-process
generation identifier through this status contract.

## Residency and measurements

A local measurement on the installed DavidAU IQ3_S model released 12,780 MiB
(12.48 GiB): total free VRAM rose from 377 to 13,157 MiB. Shrink took 0.073 seconds
and restoration 0.625 seconds with the same engine process. These are observed
values, not an image-workflow memory guarantee. Admission always checks the actual
resize response against the configured minimum.

The pinned expert arena stays in RAM. The installed `--ple-io ram` PLE mapping
reported a failed `mlock`, so memory pressure can reclaim its disk-backed pages.
Keeping the engine loaded avoids repeated model startup/expert loading, but does
not guarantee zero disk I/O for every model component under memory pressure.
These measurements describe `elastic` mode. Strict `ram_standby` instead needs
a patched Strata engine/API, adequate host RAM and memlock, and an explicit
`ram_standby: true` Strata run config. It fails if any required source or arena
page cannot be locked. Its worker PID changes on wake; the API server's
`started` identity remains stable.

See [ImageGenerationModelLifecycle](ImageGenerationModelLifecycle.md) for batching,
cleanup, cancellation and failure ordering, and [configuration](../config.md) for
deployment and runtime reload boundaries.
