# StrataRuntime

`StrataRuntime.js` owns one saved Strata runtime profile through the installed
`strata runtime` CLI. Ownership is process-local; it is never stored in game saves.
[StrataVramClient](StrataVramClient.md) separately handles elastic VRAM and RAM
standby without changing this ownership.

## Configuration and startup

`ai.strata_runtime` defaults to `null`. An explicit object enables native ownership:

```yaml
ai:
  backend: openai_compatible
  endpoint: http://127.0.0.1:8080/v1/chat/completions
  model: exact-model-name
  strata_runtime:
    executable: /home/bart/.local/bin/strata
    profile: saved-profile-name
    resources:
      memory_max_mib: 90112
      memlock_mib: 98304
      shm_size_mib: 61440
    termination_trace_path: /absolute/path/to/strata-termination.jsonl  # optional
```

The executable must be an absolute executable regular file. The endpoint must use
HTTP without embedded credentials, query or fragment; model matching is exact.
The root target and any effective prompt profile enabling ownership must agree on
executable, profile, endpoint and model. Overrides for another provider clear
`strata_runtime` explicitly. Managed Strata cannot coexist with llama startup,
image unload/termination flags, router preloading or model-switch unloading.
Configuration changes that enable, disable or change the root ownership target
require a server restart; reload/save validation rejects them in-process.

Startup checks the saved profile is stopped and has no live ownership, releases
ComfyUI VRAM through the existing startup cleanup hook, and runs native
`runtime start --profile PROFILE --die-with-pid AI_RPG_PID --wait 600 --json`.
[StrataRuntimeService](StrataRuntimeService.md) launches it inside a unique transient
system service with explicit resource containment; there is no direct uncontained
start path.
It does not edit the saved Strata profile. An existing externally owned runtime
is refused; the game never silently adopts or stops it.

Startup finishes before router preloading or startup prompts. CLI status must
report the captured owner/instance, verified launch identity and matching API URL.
Linux `/proc` host-command attestation must bind the runtime to the current AI RPG
PID and its process start token. HTTP `/v1/status` must identify Strata, the exact
model and a stable `started` value. HTTP status does not supply ownership IDs.

## Prompt and shutdown boundaries

`LLMClient.setManagedStrataRuntimeHandler(handler)` verifies ownership and the
actual resolved prompt endpoint/model after lifecycle-gate acquisition and before
transport. Missing, exited or replaced runtimes fail the prompt visibly through
existing error reporting; readiness never starts or adopts a replacement. RAM
standby is accepted only for an effective `ram_standby` handoff and a matching
resident API identity. Ordinary ComfyUI cleanup and the prompt then wake the model.

Graceful shutdown and self-restart validate the captured owner/instance and stop
only the captured unique service invocation. Systemd sends normal SIGTERM to its
cgroup and enforces a bounded stop deadline. This matches managed process-group
shutdown; it does not request Strata's CLI drain protocol. The installed CLI's
`runtime stop` performs profile-wide stale cleanup before its identity guards,
so the game never uses that path. Replacement ownership is refused. The CLI's
parent-death binding also covers abrupt process exit.

Startup errors clean only the captured service invocation. A complete runtime
identity additionally verifies the expected owner and instance; before an instance ID is
published, cleanup uses the proven unique service directly. An unverifiable or
replaced unit is refused and cleanup failure is reported explicitly. Bootstrap
then exits, activating parent-death cleanup. The game does not fabricate IDs or
claim successful cleanup.

## Test interface

`new StrataRuntime({ executable, profile, endpoint, model, resources,
terminationTracePath, runtimeService, ownerPid, ownerToken, timeoutMs = 600000,
beforeStart, runCommand, httpClient, attestHost, logger })`
exposes serialized `start()`, `ensureReady({ endpoint, model, signal,
allowRamStandby })`, `stop()` and snapshot `getOwnership()`.

Injected `runCommand({ executable, args, timeoutMs, signal })` returns
`{ exitCode, stdout, stderr }`; `runtimeService` exposes `startCommand`,
`verifyRuntime`, and `stop` for contained startup and cleanup; `httpClient.get(url, options)` returns `{ data }`.
`attestHost({ hostPid, profile, ownerPid, ownerToken })` proves Linux owner binding.
These narrow seams permit lifecycle and replacement-race tests without starting
Strata or contacting its API.

`resolveStrataRuntimeConfiguration(aiConfig)` validates a single effective target;
`validateStrataRuntimeConfigurations(configuration, resolveEffectiveAiConfiguration)`
checks root and prompt targets together. Unknown options and invalid values fail
explicitly. Current deployment activation remains separately controlled: the
full candidate `tmp/config.strata-runtime-candidate.yaml` clones the existing
Strata profile with native ownership added. `tmp/strata-runtime-activation.yaml`
is only a merge fragment; selecting it alone would omit the Strata model/endpoint.
These preparation artifacts are not selected automatically; current ownership is
determined by the active profile and explicit runtime controls.

See the [implementation plan](../superpowers/plans/2026-10-31-managed-strata-runtime.md)
for deployment and activation boundaries.

The [shared local LLM control](ManagedLocalLlmController.md) can stop/start this
manager explicitly. A successful stop permits a fresh contained service on the
next start; failed cleanup retains its old ownership receipts. Tests may inject
`createRuntimeService()` to supply successive contained adapters.

Header readiness inspections waive their separate five-second status deadline
while any native `LLMClient` prompt work is active, including silent completions
and retained staged reservations. An inspection begun idle rechecks activity
once before its short deadline aborts. This changes no `ensureReady` ownership
checks or existing CLI/HTTP timeouts; genuine readiness failures still surface.
See [ManagedLocalLlmController](ManagedLocalLlmController.md).

`--no-llm-autostart` initializes the manager/readiness handlers but makes no runtime
start/status/stop call at boot. The shared controller begins confirmed off; its
header button can later start the ordinary contained, identity-verified runtime.
This flag changes no profile, save, external process or default startup behavior.
