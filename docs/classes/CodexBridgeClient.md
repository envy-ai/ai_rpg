# CodexBridgeClient

## Purpose
`CodexBridgeClient.js` is the text-generation backend adapter used when `config.ai.backend` resolves to `codex_cli_bridge`. It turns OpenAI-style chat messages into Codex app-server `developerInstructions` plus a text conversation payload, starts or resumes a Codex thread over stdio, constrains the assistant reply with a structured-output schema, and returns an OpenAI-style chat-completion response for `LLMClient`.

The class also owns backend-name normalization, AI config validation for both supported text backends, Codex bridge concurrency keys, bridge idle-timeout resolution, Codex rate-limit reads, app-server JSON-RPC transport, command-mode helper methods, usage extraction, prompt logging, and normalized progress events.

## Configuration
The Codex bridge requires `ai.model` and accepts `ai.codex_bridge` settings. Defaults are merged by `resolveBridgeConfig(...)`:

- `command`: Codex executable or absolute path; default `codex`.
- `home`: Codex state directory; default `./tmp/codex-bridge-home`. Relative paths resolve from `Globals.baseDir` or the process cwd.
- `session_mode`: `fresh`, `resume_last`, or `resume_id`; default `fresh`.
- `session_id`: required for `resume_id`.
- `sandbox`: `read-only`, `workspace-write`, or `danger-full-access`; default `read-only`.
- `skip_git_repo_check`: used by command-mode helper argument builders. App-server chat turns use app-server thread/turn sandbox settings instead.
- `reasoning_effort`: optional app-server `turn/start.effort`; valid values are `none`, `minimal`, `low`, `medium`, `high`, and `xhigh`.
- `profile`: optional Codex profile passed before `app-server --listen stdio://`.
- `prompt_preamble`: optional text prepended to the generated bridge wrapper instructions.
- `idle_timeout_ms`: positive no-stdout idle timeout for app-server requests; default `30000`.

`normalizeBackend(...)` accepts `openai`, `openai-compatible`, and `openai_compatible` for the OpenAI-compatible backend, plus `codex`, `codex-bridge`, `codex_cli`, and `codex_cli_bridge` for the bridge. Unknown backend values throw.

## Session Modes
- `fresh`: sends `thread/start` with `ephemeral: true` for each request.
- `resume_last`: calls `thread/list` for the unarchived thread with the highest `updated_at` value under the configured Codex home, then sends `thread/resume`.
- `resume_id`: sends `thread/resume` for the configured `session_id`.

Fresh requests use a semaphore key of `codex_cli_bridge::fresh::<model>` and can use `ai.max_concurrent_requests`. Resume modes are serialized: `resume_last` keys by Codex home, and `resume_id` keys by Codex home plus session id.

## Public API
- `backendName`: normalized backend id (`codex_cli_bridge`).
- `normalizeBackend(rawValue)`: resolves supported backend aliases and defaults omitted values to `openai_compatible`.
- `isCodexBackend(aiConfig)`: true when the supplied AI config selects the Codex bridge backend.
- `getMaxConcurrent(aiConfig)`: returns the effective bridge concurrency. `fresh` uses `ai.max_concurrent_requests`; resumed session modes stay at `1`.
- `getSemaphoreKey(aiConfig, model)`: returns the concurrency bucket key used by `LLMClient`, separating `fresh` traffic from resumed-session traffic and serializing resumed sessions by home/session target.
- `getConfigurationErrors(aiConfig)`: validates backend-specific config and returns a list of explicit error strings.
- `resolveBridgeConfig(aiConfig)`: merges defaults with `ai.codex_bridge` and throws on invalid config.
- `resolveBridgeIdleTimeoutMs(aiConfig)`: returns the configured bridge no-data timeout, falling back to `ai.baseTimeoutSeconds * 1000` and then `30000`.
- `resolveHomePath(aiConfig)`: resolves the configured bridge home directory, relative to the repo root when needed.
- `ensureRuntimeFiles({ allowToolCalls, aiConfig })`: prepares the runtime schema/output paths under `tmp/codex-bridge-runtime` and ensures the configured Codex home exists.
- `buildCommandArgs(...)`: builds `codex exec` or `codex exec resume` arguments for the command-mode helper path.
- `buildAppServerArgs(bridgeConfig)`: returns the `codex app-server --listen stdio://` argument list, including optional profile selection.
- `extractUsageFromStdout(rawText)`: parses Codex JSONL event output and extracts normalized per-turn token usage from either `turn.completed.usage` or app-server `thread/tokenUsage/updated` notifications.
- `readRateLimits({ aiConfig, timeoutMs })`: queries the local Codex app-server `account/rateLimits/read` endpoint over stdio and returns the current account rate-limit snapshot.
- `runCodexAppServer(...)`: spawns the Codex app-server, handles JSON-RPC request/response flow, forwards parsed notifications/chunks, honors abort signals, and returns captured stdout/stderr plus the session result.
- `runCodexCommand(...)`: spawns a Codex CLI command, writes the prompt to stdin, tracks stdout/stderr, honors optional abort signals, and can forward parsed stdout JSONL events/chunks.
- `chatCompletion(...)`: top-level bridge entry used by `LLMClient`; returns a normalized response object shaped like an OpenAI chat-completion response and accepts optional signal/progress callbacks.

## Chat Completion Flow
1. `chatCompletion(...)` resolves and validates bridge config, then splits incoming messages into ordered `system` messages and non-system conversation messages. `LLMClient` has already inserted any configured `ai.sysprompt_append` text as an additional system message before this point. At least one non-system message is required.
2. System messages, the bridge wrapper, optional `prompt_preamble`, metadata label, and tool definitions become Codex `developerInstructions`.
3. Non-system messages become a text `Conversation:` prompt. Content arrays are flattened into text, remote image URLs are rendered as markers, and inline image data URLs are replaced with an unsupported-content marker.
4. `runCodexAppServer(...)` launches `codex app-server --listen stdio://`, sets `CODEX_HOME` when a bridge home is configured, sends `initialize`, starts or resumes a thread, then sends `turn/start`.
5. `turn/start` includes `approvalPolicy: 'never'`, cwd, optional model, optional reasoning effort, a text input containing the conversation prompt, the structured-output schema, and a sandbox policy derived from `ai.codex_bridge.sandbox`.
6. App-server notifications update turn state. `item.completed` agent messages provide the final structured assistant text, `thread/tokenUsage/updated` provides usage, `turn.completed` resolves the turn, and `turn.failed` or error notifications reject it.
7. The final assistant text is parsed as JSON and normalized into a response with `status: 200`, `config.backend: 'codex_cli_bridge'`, and `data.object: 'chat.completion'`.

## Structured Output And Tools
- Prompts without tools use the schema `{ "content": "..." }`.
- Prompts with tools use the schema `{ "content": "...", "tool_calls": [...] }`; both keys are required by the schema.
- The schema uses a Codex-compatible subset of JSON Schema: explicit `type` declarations, `additionalProperties: false`, and no composition keywords such as `oneOf`.
- Tool-call entries contain `name` and `arguments`. `arguments` is a JSON string at the Codex boundary and must parse to a JSON object.
- The parser accepts exactly one active response branch: non-empty `content` with no tool calls, or empty `content` with one or more tool calls.
- Direct content becomes `choices[0].message.content` with `finish_reason: 'stop'`.
- Tool calls become OpenAI-style `choices[0].message.tool_calls` with generated `codex_call_<uuid>` ids and `finish_reason: 'tool_calls'`.

## Progress, Logging, And Usage
- App-server stdout chunks and parsed notifications can be forwarded to callers.
- Structured-output assistant deltas are converted into plain preview text before reaching `LLMClient` prompt progress. Character counts are based on emitted preview text.
- Prompt logs are written through `LLMClient.logPrompt(...)`. Logs include developer instructions, conversation prompt, request payload, normalized response payload, and captured Codex stdout/stderr when available.
- The main log response section contains plain assistant content when present; tool-call responses are logged as tool-call JSON.
- Usage from `thread/tokenUsage/updated` or `turn.completed.usage` is normalized to `input_tokens`, `cached_input_tokens`, `output_tokens`, and `total_tokens`.
- `LLMClient` reports Codex usage from the normalized response and queries `readRateLimits(...)` for counted quota turns.

## Error And Abort Behavior
- Invalid backend values, non-string `ai.sysprompt_append`, malformed `ai.codex_bridge`, invalid session mode, missing `session_id` for `resume_id`, empty command, invalid sandbox, invalid reasoning effort, and non-positive `idle_timeout_ms` produce explicit configuration errors.
- `resolveBridgeConfig(...)` throws the joined configuration errors instead of returning a partial bridge config.
- `resume_last` throws when no prior thread is visible under the configured Codex home.
- Empty assistant messages, invalid JSON, missing response keys, both content and tool calls in the same parsed response, empty tool-call arguments, and non-object parsed tool-call arguments throw.
- App-server request failures include stderr/stdout details when available.
- Abort signals terminate the app-server process with `SIGTERM` and escalate to `SIGKILL` after one second. The bridge idle timeout also terminates stalled app-server requests after `idle_timeout_ms` without stdout data.
- `readRateLimits(...)` uses the same app-server transport as chat turns and propagates query failures to callers.
