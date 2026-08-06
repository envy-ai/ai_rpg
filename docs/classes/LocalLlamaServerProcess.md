# LocalLlamaServerProcess

## Purpose

`LocalLlamaServerProcess.js` owns the llama.cpp child process selected by `ai.local_startup_script_path`. A nonblank root path makes the game start the script during server initialization even when both image-handoff flags are false. The manager retains the returned PID in memory, can terminate that PID's detached process group when `ai.terminate_during_image_generation` needs the GPU, and switches scripts when a termination-mode prompt's effective model override names a different startup path.

## Construction

`new LocalLlamaServerProcess({ startupScriptPath, beforeStart, waitUntilReady, spawnProcess, signalProcessGroup, terminationTimeoutMs, logger })`

- `startupScriptPath` is resolved to an absolute path. Server configuration validation requires it to be an executable regular file.
- `beforeStart` is mandatory. The server supplies a callback that strictly calls ComfyUI `/free` when router-unload or process-termination image handoff is enabled and otherwise completes without contacting ComfyUI. The class always awaits it before invoking the script.
- `waitUntilReady` is awaited after the child emits `spawn`. The server polls the effective llama.cpp base URL's `/health` endpoint until HTTP 200 or the configured AI base timeout expires.
- `spawnProcess` and `signalProcessGroup` default to Node's child-process spawn and `process.kill(-pid, signal)` behavior; they are injectable for tests.
- `terminationTimeoutMs` defaults to 10 seconds for each of the graceful and forced-exit waits.

## Lifecycle

`start()` rejects if a managed process is already recorded. After its configured pre-start callback, it executes the script with its directory as `cwd`, inherited stdio, and a detached process group. It saves `child.pid`, waits for spawn and readiness, logs the PID, and returns `{ pid }`. If startup or readiness fails, it terminates any child that began running before propagating the error.

`stop()` requires a live saved PID. It sends `SIGTERM` to the complete process group and waits for the child exit event. If the first timeout expires, it sends `SIGKILL` and waits once more. Signal errors and a child that still does not exit are propagated explicitly. A successful stop clears the saved child and PID.

`switchStartupScriptPath(path)` resolves the requested path and compares it with the active script identity. An identical normalized path is a no-op and retains the current PID. A different path stops the old process completely, replaces the configured path, then uses the ordinary strict cleanup/start/readiness sequence. It never starts the replacement before the old process exits. Stop/start failures propagate and prevent the prompt transport; the class does not silently fall back to the old model. Calling it while the recorded current process is not running also fails explicitly.

`getPid()` exposes the current in-memory PID, and `getStartupScriptPath()` exposes the normalized active script identity. `terminateImmediately()` sends `SIGTERM` synchronously for process shutdown hooks. The server also stops the managed process before a guarded self-restart spawns the replacement AI RPG process.

At server startup, termination mode retains its existing behavior and starts the effective `image_prompt_generation` script. Outside termination mode, a nonblank root `ai.local_startup_script_path` is itself the activation signal; the process starts before router-model preloading and before any startup prompt. This permits a game-owned local llama.cpp router to be used with `unload_during_image_generation: true` or with image handoff disabled. The configured AI backend must be `openai_compatible`, and startup waits on that root profile's endpoint.

The startup script should finish with `exec llama-server ...` so the returned PID remains the actual llama.cpp PID. The detached process group also covers scripts that retain wrapper descendants, unless a descendant deliberately creates a new session.

## Related Coverage

`tests/local_llama_server_process.test.js` covers strict cleanup-before-spawn ordering, PID retention, process-group termination, same-script reuse, different-script stop/start ordering, and cleanup failure preventing script execution.
