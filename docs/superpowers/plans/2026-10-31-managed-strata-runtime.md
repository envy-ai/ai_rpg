# Game-owned Strata runtime

## Objective and boundaries

Let AI RPG start and own its configured local Strata profile, validate readiness before prompts, and stop that exact runtime when the game shuts down or self-restarts. Preserve the existing llama.cpp manager and Strata elastic/RAM-standby image handoff. Enable the current DavidAU Strata game profile without modifying Strata's saved model configuration.

Use an optional root `ai.strata_runtime` configuration with an executable and saved profile. Default configuration remains opt-out. Prepare a reviewed activation overlay in `./tmp` selecting the established local executable and `davidau-iq3-s-ram` profile; leave the active profile disabled until fresh startup authorization because the user requested Strata remain stopped during implementation. Do not add UI or model-switch machinery for this task.

## Ownership and acceptance

- Use Strata's runtime manager rather than launching a background service through the llama.cpp child-process wrapper.
- Launch with `--die-with-pid` bound to the AI RPG PID so the runtime owner can clean up after process death.
- Capture the returned owner and instance identities and attest both runtime processes inside a uniquely named, resource-contained systemd unit. Normal shutdown checks both identities, then stops only that captured unit using bounded SIGTERM/control-group cleanup. Never silently adopt or stop a separately running instance. Do not call profile-wide CLI stop: the installed CLI sweeps stale processes before its identity guard.
- Validate configured endpoint and exact model against runtime/API readiness. Reuse existing ComfyUI VRAM cleanup before startup and existing exclusive image/text handoff afterward.
- Startup failure, readiness failure and normal shutdown remain explicit errors. Clean up a proven owned instance; avoid broad process signals and speculative cleanup of unknown ownership.
- Serialize lifecycle transitions, including shutdown requested during startup. Stop the owned runtime before spawning a game self-restart.
- Validate configuration before startup/reload, reject conflicts with llama.cpp process ownership and incompatible router modes, and require a restart for ownership-changing configuration.
- Runtime identity/PID receipts are process state, not game-save data. User configuration persists through existing configuration paths.

## Sequence

1. Inspect installed CLI identity, launch, wait and owner-death contracts. Preserve the existing deployment's 88 GiB memory cap, zero swap, 96 GiB memlock and private 60 GiB shared-memory mount with explicit resource configuration.
2. Implement the dedicated manager with injectable CLI/HTTP boundaries and integrate game startup, shutdown and self-restart.
3. Add optional configuration validation and prepare the current Strata profile's activation overlay; update relevant class/config documentation and index.
4. Run syntax/config checks and focused ownership, failure, concurrency and integration tests using mocks under the required 16 GB/no-swap systemd limit.
5. Verify actual service properties and empty-unit cleanup with a tiny contained test process, without starting Strata or loading a model. Present the concrete result while leaving activation held. When the user requests startup, the lifecycle-owner thread alone handles the clean external-instance handoff and game restart, with no save auto-load; then verify readiness and ownership.

## Live-state constraint

The user authorized implementation, then explicitly requested stopping Strata for now and continuing the work. The lifecycle-owner thread handles that stop and its separate direct game-restart request. Startup/shutdown wiring edits wait until that game-only restart completes; active Strata ownership configuration stays disabled. No game-owned activation or real-model tests may occur without fresh startup authorization. No unrelated process/configuration changes are part of this work.

## Implementation and verification

The manager, contained service adapter, server startup/shutdown hooks, pre-transport
readiness checks, configuration validation and documentation are implemented.
Seventeen mocked lifecycle, service, LLM and server-integration checks passed under
the 16 GiB/no-swap test limit. A separate inert Python service probe verified real
systemd properties, a 16 GiB memory limit, zero swap, 96 GiB memlock, private 60 GiB
shared memory and cleanup after the last child exited. That probe is opt-in and
starts no Strata/model/GPU workload. The staged 88 GiB runtime, real model readiness
and real owner-death coupling await authorized activation.

The full activation candidate is `tmp/config.strata-runtime-candidate.yaml`;
`tmp/strata-runtime-activation.yaml` is a merge fragment only. The active profile
is unchanged. The lifecycle owner confirmed Strata stopped, port 8080 closed and
the startup hold active after verification; AI RPG and ComfyUI remained running.
