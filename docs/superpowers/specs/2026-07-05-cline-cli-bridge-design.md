# Cline CLI Bridge Design

## Goal

Add Cline CLI as a text-generation backend provider that behaves like the existing Codex bridge from the rest of the game server's point of view: `LLMClient.chatCompletion(...)` still receives OpenAI-style messages and returns normalized OpenAI-style chat-completion data, with streaming prompt progress, cancellation, retries, prompt logging, and tool-call loops preserved.

## Scope

This feature adds a new backend id, `cline_cli_bridge`. It does not replace or change `codex_cli_bridge` behavior, and it does not introduce Cline session resume modes. The first implementation uses one Cline one-shot process per prompt.

The bridge assumes Cline is already installed and authenticated. It does not store or request an API key.

## Architecture

Create a new `ClineBridgeClient.js` alongside `CodexBridgeClient.js`. The new client owns Cline-specific configuration, command arguments, subprocess handling, NDJSON event parsing, final output parsing, and normalized response construction. `LLMClient.js` selects this client when `ai.backend` resolves to `cline_cli_bridge`.

The Cline bridge will reuse the same completion-wrapper contract as Codex at the prompt level:

- System messages become bridge system instructions passed through `cline --system`.
- Non-system messages are flattened into a `Conversation:` prompt and piped to Cline stdin with the bridge instructions.
- If no application tools are present, the model must return exactly `{"content":"..."}`.
- If application tools are present, the model must return exactly `{"content":"...","tool_calls":[...]}`.
- Tool-call arguments remain JSON strings at the bridge boundary and are normalized to OpenAI-style `message.tool_calls`.

## Configuration

`config.ai.backend` accepts `cline`, `cline_cli`, `cline-bridge`, and `cline_cli_bridge` aliases, normalizing to `cline_cli_bridge`.

Default config:

```yaml
ai:
  backend: openai_compatible
  cline_bridge:
    command: cline
    provider: ""
    cwd: ./tmp/cline-bridge-cwd
    thinking: ""
    compaction: basic
    timeout_seconds: 0
    config: ""
    data_dir: ""
    prompt_preamble: ""
```

Fields:

- `command`: command or absolute path used to launch Cline.
- `provider`: optional `--provider` override. Blank uses Cline's saved default provider.
- `cwd`: `--cwd` value. The default isolated tmp directory avoids repo instructions turning provider prompts into coding-agent sessions.
- `thinking`: optional `--thinking` value: `none`, `low`, `medium`, `high`, or `xhigh`.
- `compaction`: optional `--compaction` value: `agentic`, `basic`, or `off`.
- `timeout_seconds`: optional Cline `--timeout` value. `0` means no Cline total timeout; the bridge still enforces the existing idle timeout through `LLMClient`.
- `config`: optional Cline `--config` directory.
- `data_dir`: optional Cline `--data-dir` directory.
- `prompt_preamble`: optional text prepended before the generated bridge wrapper instructions.

`ai.model` remains the model override passed to `cline --model` when non-empty.

## Command Shape

For each prompt, the bridge spawns:

```bash
cline --json --auto-approve false --cwd <cwd> --system <short transport instruction> --model <model> <short stdin bootstrap prompt>
```

Optional configured arguments are added only when non-empty and valid: `--provider`, `--thinking`, `--compaction`, `--timeout`, `--config`, and `--data-dir`. The full bridge prompt is written to stdin instead of argv so large game prompts do not hit OS command-line argument limits. The short prompt argument is kept because this Cline build only consumes piped stdin when a prompt argument is present.

`--auto-approve false` is required because Cline is an autonomous agent. The system prompt also tells Cline not to use shell commands, file access, web access, MCP tools, or any external tools. The game bridge only wants model text and application-level tool calls represented in JSON.

## Streaming

Cline `--json` streams NDJSON. The bridge parses stdout line-by-line and forwards text previews to `LLMClient` as Codex-compatible progress events:

```js
{ type: 'agent_message_delta', delta: '...' }
```

The parser recognizes documented Cline records shaped like:

```js
{ type: 'agent_event', event: { text: '...' } }
```

The bridge treats `event.text` as a streamed append when it grows from the previous text, and as a replacement preview when it does not. Replacement previews are forwarded through an `item.completed`-style final preview event so the prompt-progress UI shows the current visible assistant text instead of raw NDJSON.

At process exit, the final assistant text is resolved from the most recent non-empty Cline text event. If no final text can be found, the bridge throws a clear error and includes stdout/stderr in the prompt log.

## Response Parsing

The final assistant text must parse as JSON after stripping a single surrounding markdown code fence if present. Invalid JSON, missing `content`, invalid `tool_calls`, simultaneous non-empty `content` and tool calls, empty tool-call names, empty tool-call arguments, or non-object tool-call arguments throw.

Normalized responses use the same shape as the Codex bridge:

```js
{
  status: 200,
  statusText: 'OK',
  headers: {},
  config: { backend: 'cline_cli_bridge' },
  data: {
    object: 'chat.completion',
    choices: [{ message: { role: 'assistant', content, tool_calls } }]
  }
}
```

Usage reporting is not required for the first version because Cline's documented JSON example does not guarantee token usage fields. If Cline emits parseable usage metadata, it can be added later without affecting the backend contract.

## Error Handling

Configuration errors fail validation at startup and reload:

- unknown backend alias
- missing `ai.model`
- non-string `ai.sysprompt_append`
- non-empty `ai.prefill`
- non-object `ai.cline_bridge`
- empty `ai.cline_bridge.command`
- invalid `thinking`
- invalid `compaction`
- negative or non-finite `timeout_seconds`

Runtime errors fail loudly:

- Cline process cannot start
- Cline exits non-zero
- process is aborted by prompt cancellation or retry
- no stdout data arrives before the idle timeout
- no final assistant text is discoverable
- final assistant text cannot be parsed into the required bridge JSON

Prompt logs include Cline stdout/stderr, request payload, normalized response payload, system instructions, and flattened conversation prompt.

## Testing

Add a fake Cline CLI fixture under `tests/fixtures/` that emits NDJSON text events, records passed arguments and stdin, supports delayed output for abort tests, and exits with configurable status.

Focused tests:

- `LLMClient.chatCompletion` routes `cline_cli_bridge` to `ClineBridgeClient` without Axios.
- Configuration aliases and validation work for Cline.
- Command arguments include `--json`, `--auto-approve false`, `--system`, `--cwd`, model/provider/thinking/compaction overrides, and no API key.
- Text completions parse final JSON and return content.
- Tool-call completions normalize OpenAI-style tool calls.
- Streaming Cline text reaches prompt progress as character-based preview text.
- Abort signals terminate the Cline process and reject clearly.

## Documentation

Update:

- `docs/classes/LLMClient.md`
- `docs/classes/ClineBridgeClient.md`
- `docs/config.md`
- `docs/server_llm_notes.md`
- `docs/developer_overview.md`
- `docs/README.md`
- `docs/api/misc.md`
- `docs/ui/pages.md`

## Out Of Scope

- Cline session resume and hub/zen mode.
- Cline API key or authentication setup.
- Cline rate-limit or quota status reporting.
- Refactoring CodexBridgeClient into a generic shared base.
