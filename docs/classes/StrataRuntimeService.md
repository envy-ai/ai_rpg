# StrataRuntimeService

`StrataRuntimeService.js` contains native Strata startup in a unique systemd
service. [StrataRuntime](StrataRuntime.md) owns the profile/API identity and uses
this adapter for launch, cgroup verification and bounded cleanup. No service or
runtime operation occurs merely by importing either module.

The unit name includes the AI RPG PID, Linux process start ticks and a per-process
attempt counter. Before launching, that name must not already exist. The installed
CLI runs through `/usr/bin/sudo -n /usr/bin/systemd-run`, without interactive
privilege prompts. The service runs as the current UID/GID in the user's home;
privileged execution is used only to ask systemd for the resource sandbox.

`ai.strata_runtime.resources` requires positive safe integer MiB values for
`memory_max_mib`, `memlock_mib` and `shm_size_mib`. The deployment candidate uses
90112, 98304 and 61440 MiB respectively: 88 GiB memory, 96 GiB memlock and a private
60 GiB `/dev/shm`. Swap is always zero. The oneshot service retains workers with
`RemainAfterExit=yes`, uses `KillMode=control-group`, disables restart, enables IO
accounting, sets OOM score adjustment 300 and OOM policy kill, and has bounded
900-second startup/360-second stop deadlines. It uses no profile-wide `ExecStop`.
Optional `termination_trace_path` passes the existing Strata termination trace
variable to the host/API without changing the saved model profile.

The adapter uses systemd-run's default start-job wait. `--wait`, `--no-block` and
`--pipe` are deliberately absent: the retained service must not hold a game pipe
or wait for its entire lifetime. CLI JSON and stderr are captured in mode-0600
files inside a new mode-0700 directory under `tmp`. These files are retained as
startup diagnostics.

After launch, the adapter captures the unit's `InvocationID`, any existing cgroup,
and the effective resource properties. An empty retained oneshot may have no
cgroup; the same proven invocation can still be cleaned up. Runtime PID
verification always requires an actual current cgroup. Runtime host and API PIDs must belong to that
cgroup. Subsequent checks require the same invocation; cleanup stops only its
captured unique unit and refuses a replacement. Normal shutdown checks runtime
owner/instance first, then uses this SIGTERM/bounded-unit-stop path without
profile-level CLI cleanup or a custom drain RPC. This also allows bounded cleanup
when startup fails before the runtime publishes an instance ID. Abrupt game death
activates Strata's native parent-death binding; an empty retained unit may remain,
and the game does not sweep arbitrary historical units.

Tests inject `runCommand({ executable, args, timeoutMs, signal })` and
`readProcessCgroup(pid)`; configurable temporary directory/user/home values keep
fixtures isolated. `startCommand`, `verifyRuntime` and `stop` exercise the same
production protocol without actual sudo, service changes, runtime starts or API
requests. A harmless real transient-service probe with an inert Python command
verified actual systemd property normalization, 16 GiB memory/no swap, 96 GiB
memlock, private 60 GiB shm, UID/GID, and cleanup of an empty retained unit.
That probe started no Strata/GPU workload. The candidate's 88 GiB runtime launch
and model/API readiness remain untested while startup is on hold.

The real probe is skipped by default. Explicitly select it with
`STRATA_RUNTIME_SERVICE_REAL_PROBE=1 node --test tests/strata_runtime_service_real_probe.test.js`
inside the required 16 GiB/no-swap test wrapper. It requires noninteractive sudo
and creates and stops only its unique inert test service.

The inert service probe is opt-in and never starts Strata or GPU work:

```bash
systemd-run --wait --collect --pipe -p MemoryMax=16G -p MemorySwapMax=0 \
  -p "WorkingDirectory=$PWD" env STRATA_RUNTIME_SERVICE_REAL_PROBE=1 \
  node --test tests/strata_runtime_service_real_probe.test.js
```
