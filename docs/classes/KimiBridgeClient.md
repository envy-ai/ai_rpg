# KimiBridgeClient

## Purpose

`KimiBridgeClient.js` is the text-generation backend adapter used when `config.ai.backend` resolves to `kimi_cli_bridge`. It turns OpenAI-style chat messages into a one-shot Kimi Code prompt, drives the already-authenticated local `kimi acp` server through JSON-RPC on stdin/stdout, and returns an OpenAI-style chat-completion response for `LLMClient`.

The bridge never reads, configures, or stores an API key. Kimi Code must already be installed and authenticated under the server process's user account.

## Configuration

The backend accepts `ai.kimi_bridge`:

- `command`: executable name or absolute path; default `kimi`.
- `cwd`: isolated working directory for fresh sessions; default `./tmp/kimi-bridge-cwd`.
- `model`: optional Kimi model alias selected through ACP session configuration. Blank keeps `default_model` from Kimi's own `config.toml`.
- `thinking`: optional per-process thinking effort passed to Kimi as `KIMI_MODEL_THINKING_EFFORT`. Blank keeps Kimi's own default.
- `prompt_preamble`: optional text prepended to the generated bridge instructions.

The bridge uses `ai.baseTimeoutSeconds` as a no-output idle timeout, falling back to 30 seconds. `ai.max_concurrent_requests` controls parallel fresh Kimi processes.

`getConfigurationErrors(...)` rejects malformed bridge config, an empty command, non-string bridge fields, non-string system-prompt append values, and non-empty assistant prefill. It does not require `ai.endpoint`, `ai.apiKey`, or `ai.model`.

## Invocation and isolation

Each request:

1. Separates application `system` messages from the non-system conversation.
2. Renders the system messages, optional application tool definitions, metadata label, structured response contract, and optional prompt preamble into `Bridge Instructions`.
3. Flattens the remaining messages into a `Conversation` transcript.
4. Starts `kimi acp` with piped stdin/stdout in the configured isolated working directory.
5. Sends ACP `initialize` with protocol version 1 and no client filesystem or terminal capabilities.
6. Creates a fresh session with `session/new`, the absolute isolated CWD, and no MCP servers.
7. If `model` is non-empty, selects it through `session/set_config_option` and verifies that Kimi applied it.
8. Sends the complete bridge prompt as a text content block in `session/prompt` over stdin.
9. Collects `agent_message_chunk` updates, incrementally decodes the wrapper JSON `content` string into prompt-preview deltas, and continues until the prompt response supplies its stop reason.
10. Replaces the live preview with the fully decoded final content, validates the complete wrapper JSON, then terminates the fresh ACP subprocess.

Configured thinking effort is placed in the child process environment before `kimi acp` starts. The bridge does not perform a `session/set_config_option` thinking negotiation or modify Kimi's global configuration. Models marked `always_thinking` may support only effort levels such as `low`, `high`, and `max`; for those models, `low` is the minimum available setting rather than a true off switch.

Kimi's ACP subcommand does not accept `--agent-file` or `--skills-dir`. The bridge therefore enforces the completion boundary through the isolated CWD, no advertised client filesystem/terminal capabilities, an empty MCP-server list, explicit no-native-tools prompt instructions, automatic cancellation of permission requests, and rejection of every native ACP `tool_call` or `tool_call_update`. Application tool descriptions remain data in the bridge prompt and never become Kimi-native tools.

The full bridge prompt exists only in the ACP `session/prompt` JSON written to the child process's stdin. It is never placed in process arguments, so normal large game prompts do not encounter the operating system's per-argument size limit.

## ACP JSONL and response normalization

Kimi emits one JSON-RPC object per stdout line in ACP mode. The bridge validates the initialization response, requires a `sessionId`, groups `agent_message_chunk` text by `messageId`, and treats the last assistant message as the bridge response when `session/prompt` completes. As partial wrapper JSON arrives, the bridge incrementally decodes the `content` string—including JSON escapes and Unicode escapes—and forwards append or replacement events through `LLMClient`'s character-counted prompt-progress stream. Tool-call wrappers keep an empty content preview.

Native Kimi ACP tool events and reverse client requests are rejected. Application tool calls remain available through the wrapper JSON:

```json
{
  "content": "",
  "tool_calls": [
    {
      "name": "toolName",
      "arguments": "{\"key\":\"value\"}"
    }
  ]
}
```

Without application tools, the required wrapper is `{ "content": "..." }`. With tools, both `content` and `tool_calls` are required and exactly one branch must be non-empty. Tool-call arguments must parse to JSON objects. Normalized calls receive `kimi_call_<uuid>` ids.

Malformed JSON, missing content, invalid tool-call arguments, mixed content/tool-call branches, native Kimi tool calls, nonzero process exits, and missing assistant messages fail loudly so `LLMClient` can apply its normal retry and error flow.

Completed assistant `content` is forwarded as a final prompt-preview replacement event. Partial preview decoding does not relax final validation: malformed JSON, invalid response branches, and invalid tool calls still fail after the ACP turn completes. Cancellation first sends ACP `session/cancel`, then sends `SIGTERM` to the process group and escalates to `SIGKILL` after one second.

## Logging

Every request is logged through `LLMClient.logPrompt(...)`. Logs include the bridge instructions, flattened conversation prompt, normalized request/response payloads, and captured Kimi stdout/stderr. Authentication remains owned by Kimi Code and is not included in game configuration or prompt logs.
