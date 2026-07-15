# ClineBridgeClient

## Purpose
`ClineBridgeClient.js` is the text-generation backend adapter used when `config.ai.backend` resolves to `cline_cli_bridge`. It turns OpenAI-style chat messages into a one-shot Cline CLI prompt, pipes the full bridge prompt through Cline stdin, streams Cline NDJSON output into normalized prompt-progress events, and returns an OpenAI-style chat-completion response for `LLMClient`.

The bridge assumes the local `cline` CLI is already installed and authenticated. It never configures or stores an API key.

## Configuration
The bridge requires `ai.model` and accepts `ai.cline_bridge` settings:

- `command`: Cline executable or absolute path; default `cline`.
- `provider`: optional `--provider` override. Blank uses Cline's saved default provider.
- `cwd`: working directory. The default is `./tmp/cline-bridge-cwd` so repo `AGENTS.md` or Cline rules do not turn provider prompts into coding-agent sessions.
- `thinking`: optional `--thinking` value: `none`, `low`, `medium`, `high`, or `xhigh`.
- `compaction`: Cline compaction mode: `agentic`, `basic`, or `off`; default `basic`.
- `timeout_seconds`: optional Cline total timeout; `0` leaves Cline without a total timeout.
- `config`: optional Cline configuration directory.
- `data_dir`: optional isolated Cline data directory.
- `prompt_preamble`: optional text prepended ahead of the generated bridge wrapper prompt.

`getConfigurationErrors(...)` rejects missing models, non-string system-prompt append values, non-empty assistant prefill, malformed bridge config, empty commands, invalid thinking or compaction values, and invalid timeouts.

## Chat Flow
1. `chatCompletion(...)` splits incoming messages into system messages and non-system conversation messages.
2. System messages, tool definitions, metadata label, and the bridge wrapper become `Bridge Instructions` inside the stdin prompt.
3. `--system` carries only a short transport instruction telling Cline to read stdin and return the requested JSON, which keeps large prompts out of OS argv limits.
4. Non-system messages are flattened into a `Conversation:` prompt and piped to Cline stdin with the bridge instructions.
5. `runClineCommand(...)` spawns `cline --json --auto-approve false --cwd <cwd> --system <short transport instruction> --model <model> <short stdin bootstrap prompt>` plus optional provider, thinking, compaction, timeout, config, and data-dir flags, then pipes the full bridge prompt to stdin. The tiny bootstrap prompt is required because this Cline build only consumes piped stdin when a prompt argument is also present.
6. The stdin pipe is backed by a transient `0600` prompt file under `tmp/cline-bridge-prompts`, which is removed after the subprocess settles. This makes prompt bytes available before Cline starts without putting large game prompts in argv.
7. Cline NDJSON `agent_event.event.text` records are parsed as streamed assistant text. Content inside the bridge JSON `content` field is forwarded to `LLMClient` as prompt preview text; if Cline ignores the wrapper and streams plain non-JSON assistant text, that text is forwarded directly.
8. The final text is parsed as bridge JSON when it is valid: `{ "content": "..." }` or `{ "content": "", "tool_calls": [...] }`. If Cline prepends prose before a valid bridge JSON object, the bridge extracts that object and ignores the prose. If the final text is clearly not JSON and contains no embedded bridge object, the bridge treats it as normal assistant `content`. Malformed JSON-looking output still raises a bridge error so broken structured responses are not hidden.
9. The result is normalized to `chat.completion` data with `config.backend: 'cline_cli_bridge'`.

## Tool Calls
When tools are supplied, the bridge requires the model to choose one active branch:

- non-empty `content` and no tool calls
- empty `content` and at least one tool call

Tool-call arguments must be JSON strings that parse to JSON objects. Normalized tool calls receive generated `cline_call_<uuid>` ids and are returned in the same shape as OpenAI-compatible and Codex bridge tool calls.

Plain non-JSON assistant text is only useful for normal content responses. Tool calls still require the bridge JSON `tool_calls` form.

## Streaming And Cancellation
Cline requests are sent with `payload.stream: false` at the normalized `LLMClient` layer because streaming is handled by the CLI bridge. Prompt preview supports both JSON-wrapped `content` and plain non-JSON assistant text from Cline NDJSON events. `runClineCommand(...)` resets the idle timeout on stdout data, honors abort signals, sends `SIGTERM` on cancellation, and escalates to `SIGKILL` after one second.

## Logging
Prompt logs are written through `LLMClient.logPrompt(...)`. Logs include bridge instructions, flattened conversation prompt, request payload, normalized response payload, and captured Cline stdout/stderr when available.

## Limitations
Cline bridge requests are one-shot subprocesses. The bridge does not implement Cline session resume, hub/zen mode, Cline auth setup, or quota reporting.
