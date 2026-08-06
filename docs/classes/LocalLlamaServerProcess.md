# LocalLlamaServerProcess

## Purpose

`LocalLlamaServerProcess.js` owns the llama.cpp child process used by `ai.terminate_during_image_generation`. It starts the configured executable script, retains the returned PID in memory, and terminates that PID's detached process group when ComfyUI needs the GPU.

## Construction

`new LocalLlamaServerProcess({ startupScriptPath, beforeStart, waitUntilReady, spawnProcess, signalProcessGroup, terminationTimeoutMs, logger })`

- `startupScriptPath` is resolved to an absolute path. Server configuration validation requires it to be an executable regular file.
- `beforeStart` is mandatory. The server supplies a strict ComfyUI `/free` callback; the class awaits it and invokes the script immediately afterward.
- `waitUntilReady` is awaited after the child emits `spawn`. The server polls the effective llama.cpp base URL's `/health` endpoint until HTTP 200 or the configured AI base timeout expires.
- `spawnProcess` and `signalProcessGroup` default to Node's child-process spawn and `process.kill(-pid, signal)` behavior; they are injectable for tests.
- `terminationTimeoutMs` defaults to 10 seconds for each of the graceful and forced-exit waits.

## Lifecycle

`start()` rejects if a managed process is already recorded. After strict pre-start cleanup, it executes the script with its directory as `cwd`, inherited stdio, and a detached process group. It saves `child.pid`, waits for spawn and readiness, logs the PID, and returns `{ pid }`. If startup or readiness fails, it terminates any child that began running before propagating the error.

`stop()` requires a live saved PID. It sends `SIGTERM` to the complete process group and waits for the child exit event. If the first timeout expires, it sends `SIGKILL` and waits once more. Signal errors and a child that still does not exit are propagated explicitly. A successful stop clears the saved child and PID.

`getPid()` exposes the current in-memory PID. `terminateImmediately()` sends `SIGTERM` synchronously for process shutdown hooks. The server also stops the managed process before a guarded self-restart spawns the replacement AI RPG process.

The startup script should finish with `exec llama-server ...` so the returned PID remains the actual llama.cpp PID. The detached process group also covers scripts that retain wrapper descendants, unless a descendant deliberately creates a new session.

## Related Coverage

`tests/local_llama_server_process.test.js` covers strict cleanup-before-spawn ordering, PID retention, process-group termination, and cleanup failure preventing script execution.
