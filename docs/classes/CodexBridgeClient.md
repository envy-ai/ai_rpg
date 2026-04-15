# CodexBridgeClient

## Purpose
Bridges the game's text-generation requests into the local Codex CLI when `config.ai.backend` is `codex_cli_bridge`. It converts chat-style message arrays into Codex developer instructions plus a user-message conversation payload, optionally advertises tool-call schemas, runs `codex exec` or `codex exec resume`, and normalizes the final Codex message back into an OpenAI-style chat-completion payload.

## Public API
- `backendName`: normalized backend id (`codex_cli_bridge`).
- `normalizeBackend(rawValue)`: resolves supported backend aliases and defaults omitted values to `openai_compatible`.
- `isCodexBackend(aiConfig)`: true when the supplied AI config selects the Codex bridge backend.
- `getMaxConcurrent(aiConfig)`: returns the effective bridge concurrency. `fresh` uses `ai.max_concurrent_requests`; resumed session modes stay at `1`.
- `getSemaphoreKey(aiConfig, model)`: returns the concurrency bucket key used by `LLMClient`, separating `fresh` traffic from resumed-session traffic and serializing resumed sessions by home/session target.
- `getConfigurationErrors(aiConfig)`: validates backend-specific config and returns a list of explicit error strings.
- `resolveBridgeConfig(aiConfig)`: merges defaults with `ai.codex_bridge` and throws on invalid config.
- `resolveHomePath(aiConfig)`: resolves the configured bridge home directory, relative to the repo root when needed.
- `ensureRuntimeFiles({ allowToolCalls, aiConfig })`: ensures the bridge runtime directory and JSON schema files exist under `tmp/`.
- `buildCommandArgs(...)`: chooses the correct `codex exec` / `codex exec resume` argument list for the configured session mode, including optional `model_reasoning_effort` pass-through.
- `extractUsageFromStdout(rawText)`: parses Codex `--json` event output and extracts normalized per-turn token usage when a `turn.completed.usage` object is present.
- `readRateLimits({ aiConfig, timeoutMs })`: queries the local Codex app-server `account/rateLimits/read` endpoint over stdio and returns the current account rate-limit snapshot.
- `runCodexCommand(...)`: spawns the Codex CLI, writes the wrapped prompt to stdin, tracks stdout/stderr, honors optional abort signals, and can forward parsed stdout JSONL events/chunks back to `LLMClient`.
- `chatCompletion(...)`: top-level bridge entry used by `LLMClient`; returns a normalized response object shaped like an OpenAI chat-completion response and accepts optional signal/progress callbacks.

## Response handling
- Fresh runs use Codex `--output-schema` plus `-o` to constrain the final message to a JSON object.
- The bridge maps its wrapper instructions and every incoming `system` message into Codex `developer_instructions`, preserving system-message order there instead of flattening those messages into the user conversation transcript.
- The fresh-run schema intentionally sticks to a narrow Codex-compatible subset of JSON Schema: it avoids composition keywords such as `oneOf`, and every nested schema node declares an explicit `type`.
- When tool calls are allowed, fresh-mode structured output requires both `content` and `tool_calls` keys because Codex's validator requires every declared property to be listed in `required`; direct replies use `tool_calls: []`, and tool turns use `content: ""`.
- Tool-call `arguments` are declared as JSON strings at the Codex boundary because Codex's structured-output schema subset does not accept arbitrary nested object payloads there; the bridge parses those strings back into JSON objects before returning the normalized tool calls to the rest of the game.
- The bridge parser still enforces that only one branch is active at a time: non-empty `content` with an empty `tool_calls` array, or empty `content` with one or more tool calls.
- Resume modes still use `-o`, but rely on prompt instructions rather than `--output-schema` because the resume subcommand does not expose that flag.
- Direct assistant output is normalized into `choices[0].message.content`.
- Bridge-emulated tool calls are normalized into OpenAI-style `choices[0].message.tool_calls` so the existing chat-tool loop can execute them unchanged.
- The wrapped bridge prompt and normalized response are logged through `LLMClient.logPrompt(...)`, including captured Codex stdout/stderr when available. When the normalized response has plain assistant `content`, the main `=== RESPONSE ===` log section now writes that content directly instead of JSON-escaping the whole response object; the full normalized payload still appears separately in `=== RESPONSE JSON ===`.
- When `ai.codex_bridge.reasoning_effort` is set, the bridge forwards it with `-c 'model_reasoning_effort="..."'`. Codex accepts `none`, `minimal`, `low`, `medium`, `high`, and `xhigh`.
- When `LLMClient` supplies progress callbacks, the bridge forwards coarse Codex stdout lifecycle events (`thread.started`, `turn.started`, `item.completed`, `turn.completed`, failures/errors, etc.) into the existing prompt-progress system instead of trying to emulate token streaming.
- When Codex emits `turn.completed.usage`, the bridge normalizes that into an OpenAI-style top-level `usage` object (`input_tokens`, `cached_input_tokens`, `output_tokens`, `total_tokens`) so `LLMClient` can report prompt burn in server logs.

## Notes
- The bridge intentionally fails loudly on invalid config, empty final messages, invalid JSON, malformed tool-call objects, and missing `resume_id` session ids.
- Non-system message content arrays are flattened into text for the user-message conversation payload; inline image data URLs are replaced with an explicit unsupported marker instead of being silently passed through.
- Temporary schema and output files are written under `tmp/codex-bridge-runtime`.
- Abort signals from `LLMClient` terminate the spawned Codex child process, which lets the existing `/api/prompts/:id/cancel` and `/api/prompts/:id/retry` paths work for Codex-backed prompts through the standard prompt-progress popup.
- The separate rate-limit query uses the Codex app-server stdio protocol instead of `codex exec`, because remaining quota is not included in normal prompt JSONL output. Query failures are surfaced to `LLMClient` as explicit errors so logging can warn clearly without pretending the quota snapshot succeeded.
- Fresh-mode parallelism is intentionally isolated from resumed-session traffic: `resume_last` remains serialized per Codex home, and `resume_id` remains serialized per home + session id.
