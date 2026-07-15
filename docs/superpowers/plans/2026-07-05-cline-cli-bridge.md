# Cline CLI Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use git for this repo unless the user explicitly asks.

**Goal:** Add `cline_cli_bridge` as a text-generation backend that uses the authenticated local `cline` CLI and preserves the existing `LLMClient` streaming, cancellation, retry, logging, validation, and tool-call behavior.

**Architecture:** Add a focused `ClineBridgeClient.js` next to `CodexBridgeClient.js`. Keep Codex-specific app-server behavior unchanged, and route backend-specific configuration and dispatch through `LLMClient.js` plus config UI/API updates.

**Tech Stack:** Node.js CommonJS, `child_process.spawn`, NDJSON stdout parsing, Node built-in test runner, existing Express/config Nunjucks UI.

---

## File Structure

- Create `ClineBridgeClient.js`: Cline backend config validation, prompt wrapping, Cline command args, process transport, NDJSON parsing, streaming preview conversion, final JSON parsing, prompt logging, and normalized chat-completion response construction.
- Create `tests/fixtures/fake_cline_cli.js`: fake executable for deterministic Cline CLI tests.
- Create `tests/llmclient.cline_bridge.test.js`: focused bridge tests mirroring the Codex bridge test style.
- Modify `LLMClient.js`: import `ClineBridgeClient`, resolve backend dispatch, concurrency, timeout, prefill rejection, streaming progress, and response handling for either CLI bridge.
- Modify `CodexBridgeClient.js`: widen backend normalization or move only minimal backend normalization knowledge to include Cline aliases without changing Codex chat behavior.
- Modify `api.js`: `/api/test-config` accepts Cline bridge payloads.
- Modify `server.js`: startup logging names Cline bridge settings.
- Modify `config.default.yaml`: default `ai.cline_bridge` block and backend comment.
- Modify `views/config.njk` and `public/js/config.js`: backend selector and Cline bridge fields.
- Update docs listed in the design spec, including `docs/README.md`.

## Task 1: Add Failing Tests And Fake CLI

**Files:**
- Create: `tests/fixtures/fake_cline_cli.js`
- Create: `tests/llmclient.cline_bridge.test.js`

- [ ] **Step 1: Create the fake CLI fixture**

Implement a Node executable that:

- Records `process.argv.slice(2)`, stdin, cwd, and selected env to `FAKE_CLINE_LOG_PATH` when set.
- Emits each object from `FAKE_CLINE_STDOUT_EVENTS` as JSON lines when set.
- Otherwise emits two `agent_event` lines where `event.text` grows from an opening fragment to the complete response.
- Uses `FAKE_CLINE_RESPONSE` as the final text, defaulting to `{"content":"fake cline response"}`.
- Waits `FAKE_CLINE_DELAY_MS` before output when set.
- Exits with `FAKE_CLINE_EXIT_CODE`, defaulting to `0`.
- On `SIGTERM`, writes the log and exits.

- [ ] **Step 2: Write routing/config tests**

Add tests that fail until implementation exists:

- `LLMClient.chatCompletion uses Cline bridge backend without axios`
- `Cline bridge configuration rejects invalid options`
- `Cline bridge backend aliases normalize to cline_cli_bridge`

Use `axios.post = async () => { throw new Error(...) }` and stub `ClineBridgeClient.chatCompletion` for the first test after the client module exists.

- [ ] **Step 3: Write process/streaming tests**

Add tests that call the real fake fixture through `ClineBridgeClient.runClineCommand(...)` and `ClineBridgeClient.chatCompletion(...)`:

- command args include `--json`, `--auto-approve`, `false`, `--cwd`, `--system`, `--model`, optional `--provider`, `--thinking`, `--compaction`, `--timeout`, `--config`, and `--data-dir`; the command keeps only a short stdin-bootstrap prompt argument while the full bridge prompt is piped through stdin
- content response parses to `choices[0].message.content`
- tool response parses to `choices[0].message.tool_calls`
- streamed `agent_event.event.text` reaches prompt progress as plain assistant preview text
- abort signal rejects with the abort reason

- [ ] **Step 4: Run the new test file and verify it fails**

Run:

```bash
node --test tests/llmclient.cline_bridge.test.js
```

Expected: failure because `ClineBridgeClient.js` and backend routing do not exist yet.

## Task 2: Implement `ClineBridgeClient.js`

**Files:**
- Create: `ClineBridgeClient.js`
- Modify if needed: `tests/llmclient.cline_bridge.test.js`

- [ ] **Step 1: Add constants and helpers**

Implement:

- `BACKEND_CLINE = 'cline_cli_bridge'`
- `DEFAULT_CLINE_BRIDGE_CONFIG`
- `CLINE_THINKING_LEVELS`
- `CLINE_COMPACTION_MODES`
- plain-object detection
- directory path resolution relative to `Globals.baseDir || process.cwd()`
- message flattening matching Codex behavior
- system-message extraction
- tool-definition rendering
- bridge response schema instructions
- JSON fence stripping
- normalized tool-call parsing
- normalized response construction

- [ ] **Step 2: Add configuration API**

Implement static methods:

- `backendName`
- `isClineBackend(aiConfig)`
- `getMaxConcurrent(aiConfig)`
- `getSemaphoreKey(aiConfig, model)`
- `getConfigurationErrors(aiConfig)`
- `resolveBridgeConfig(aiConfig)`
- `resolveBridgeIdleTimeoutMs(aiConfig)`
- `resolveCwdPath(aiConfig)`
- `buildCommandArgs({ bridgeConfig, developerInstructions, promptText, model })`

Validation must reject non-empty `ai.prefill`, missing `ai.model`, invalid `ai.sysprompt_append`, malformed `ai.cline_bridge`, blank command, invalid thinking/compaction, and invalid `timeout_seconds`.

- [ ] **Step 3: Add process transport**

Implement `runClineCommand({ aiConfig, timeoutMs, signal, onStdoutChunk, onStdoutEvent, promptText, developerInstructions, model })` using `spawn`.

Behavior:

- Spawn configured command with args from `buildCommandArgs`.
- Pipe the full bridge prompt to stdin because large game prompts can exceed OS argv limits. Keep a tiny bootstrap prompt argument because this Cline build only consumes piped stdin when a prompt argument is present.
- Parse stdout as NDJSON line-by-line.
- On parsed text updates, call `onStdoutEvent` with preview events compatible with `LLMClient.#extractCodexPreviewUpdate`.
- Reset the idle timeout whenever stdout data arrives.
- On abort, send `SIGTERM`, escalate to `SIGKILL` after one second, and reject with the abort reason.
- On non-zero exit, reject with code plus stderr/stdout details.
- Resolve stdout, stderr, parsed events, and final assistant text.

- [ ] **Step 4: Add chat completion**

Implement `chatCompletion(...)`:

- Split system and non-system messages.
- Build developer instructions from system messages, tools, metadata label, and prompt preamble.
- Build conversation prompt from non-system messages.
- Call `runClineCommand(...)`.
- Parse the final assistant text into content or tool calls.
- Log prompt artifacts through `LLMClient.logPrompt(...)`.
- Return `{ status, statusText, headers, config: { backend: 'cline_cli_bridge' }, data }`.

- [ ] **Step 5: Run Cline bridge tests**

Run:

```bash
node --test tests/llmclient.cline_bridge.test.js
```

Expected: Cline-specific process and parsing tests pass; LLMClient routing tests may still fail until Task 3.

## Task 3: Wire `LLMClient` Backend Selection

**Files:**
- Modify: `LLMClient.js`
- Modify: `CodexBridgeClient.js`
- Modify: `tests/llmclient.cline_bridge.test.js`
- Test: `tests/llmclient.codex_bridge.test.js`

- [ ] **Step 1: Import and classify CLI bridge backends**

Add `const ClineBridgeClient = require('./ClineBridgeClient.js');`.

Add small helper logic so LLMClient can answer:

- backend is Codex bridge
- backend is Cline bridge
- backend is any CLI bridge

Keep Codex quota reporting only for Codex.

- [ ] **Step 2: Normalize backend aliases**

Extend backend normalization to return:

- `openai_compatible`
- `codex_cli_bridge`
- `cline_cli_bridge`

Unknown values continue to throw.

- [ ] **Step 3: Route config validation and concurrency**

Update:

- `LLMClient.resolveBackend`
- `LLMClient.getConfigurationErrors`
- `LLMClient.getMaxConcurrent`
- attempt runtime concurrency key selection
- bridge idle timeout selection
- prefill rejection
- payload stream forcing
- API-key/endpoint skipping

Cline fresh one-shot mode uses `ai.max_concurrent_requests` and semaphore key `cline_cli_bridge::fresh::<model>`.

- [ ] **Step 4: Route dispatch and progress**

Dispatch Cline attempts through `ClineBridgeClient.chatCompletion(...)`. Use the same `onStdoutEvent` callback path as Codex so prompt progress stays centralized.

Do not call Codex quota reporting for Cline.

- [ ] **Step 5: Run bridge routing tests**

Run:

```bash
node --test tests/llmclient.cline_bridge.test.js tests/llmclient.codex_bridge.test.js
```

Expected: both Cline and existing Codex bridge tests pass.

## Task 4: Add Config, UI, API, And Startup Support

**Files:**
- Modify: `config.default.yaml`
- Modify: `views/config.njk`
- Modify: `public/js/config.js`
- Modify: `api.js`
- Modify: `server.js`
- Test: `tests/llmclient.cline_bridge.test.js`

- [ ] **Step 1: Update default config**

Add `cline_cli_bridge` to the backend comment and add the default `ai.cline_bridge` object from the design spec.

- [ ] **Step 2: Update settings UI template**

Add backend option `<option value="cline_cli_bridge">cline_cli_bridge</option>`.

Add Cline fields:

- command
- provider
- cwd
- thinking
- compaction
- timeout seconds
- config directory
- data directory
- prompt preamble

Use `data-ai-backend-section="cline_cli_bridge"` and `data-required-backend="cline_cli_bridge"` only on command.

- [ ] **Step 3: Update settings JS**

Make backend visibility work for the new backend. Add `clineBridge` payload to `testConnection()` with the Cline fields. Require only model and command for Cline tests.

- [ ] **Step 4: Update `/api/test-config`**

Accept `clineBridge` from the request. For Cline backend, validate through `ClineBridgeClient.getConfigurationErrors(...)`, then run a short `ClineBridgeClient.chatCompletion(...)`.

- [ ] **Step 5: Update startup logging**

When backend is Cline, log the configured Cline command and cwd instead of Codex home. The default cwd should be an isolated `./tmp/cline-bridge-cwd` directory so repo instructions do not turn provider prompts into coding-agent sessions.

- [ ] **Step 6: Run syntax checks**

Run:

```bash
node --check ClineBridgeClient.js
node --check LLMClient.js
node --check api.js
node --check server.js
node --check public/js/config.js
```

Expected: no syntax errors.

## Task 5: Documentation

**Files:**
- Create: `docs/classes/ClineBridgeClient.md`
- Modify: `docs/classes/LLMClient.md`
- Modify: `docs/classes/CodexBridgeClient.md` only if backend normalization docs remain there
- Modify: `docs/config.md`
- Modify: `docs/server_llm_notes.md`
- Modify: `docs/developer_overview.md`
- Modify: `docs/README.md`
- Modify: `docs/api/misc.md`
- Modify: `docs/ui/pages.md`

- [ ] **Step 1: Document Cline bridge class**

Create `docs/classes/ClineBridgeClient.md` covering purpose, config, command args, streaming, response parsing, logging, and errors.

- [ ] **Step 2: Update shared LLM docs**

Add `cline_cli_bridge` to backend lists and explain that Cline uses one-shot CLI subprocesses, authenticated Cline config, NDJSON streaming, and no quota reporting.

- [ ] **Step 3: Update config docs and README index**

Add config section after Codex bridge and add README table row for `ClineBridgeClient.md`.

- [ ] **Step 4: Run doc grep**

Run:

```bash
rg -n "cline_cli_bridge|ClineBridgeClient|cline_bridge" docs config.default.yaml views/config.njk public/js/config.js
```

Expected: references appear in the new class doc, config doc, README, LLM docs, UI docs, default config, and UI files.

## Task 6: Verification

**Files:**
- All touched files

- [ ] **Step 1: Run targeted unit tests**

Run:

```bash
node --test tests/llmclient.cline_bridge.test.js tests/llmclient.codex_bridge.test.js tests/llmclient.prefill.test.js tests/llmclient.sysprompt_append.test.js
```

Expected: all tests pass.

- [ ] **Step 2: Run syntax checks**

Run the `node --check` commands from Task 4 again.

- [ ] **Step 3: Run one real Cline smoke test if safe**

Run a short CLI-level test without touching game state:

```bash
mkdir -p /home/bart/ai_rpg/tmp/cline-bridge-smoke
cline --json --auto-approve false --cwd /home/bart/ai_rpg/tmp/cline-bridge-smoke --timeout 30 --system 'Return exactly {"content":"ok"} and do not use tools.' 'Return the requested JSON.'
```

Expected: Cline emits NDJSON and exits successfully. If this real call fails because auth/provider setup differs, report that separately; the fake CLI tests still verify bridge behavior.

- [ ] **Step 4: Final docs check**

Confirm docs changed and `docs/README.md` lists the new class doc.

No git commit is part of this plan.
