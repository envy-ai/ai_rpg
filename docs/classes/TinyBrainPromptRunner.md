# TinyBrainPromptRunner

## Purpose

`TinyBrainPromptRunner.js` executes staged prompts used when `ai.tinybrain: true`. It currently drives both player-action prose and XML event checks, and provides the shared lifecycle for future TinyBrain prompt programs. It lets a small model answer one reasoning instruction at a time while preserving the conversation, tool calls, and tool results for later checkpoints and the final response.

The normal one-shot player-action path remains active when the option is omitted or false. In `prompts/_includes/player-action.tinybrain.njk`, non-attack prompts first pause after selecting the NPCs that may respond. Repetition-buster prompts then run the additional analysis, editing, and branching checkpoints. A non-attack prompt with `repetition_buster: false` therefore makes the NPC-selection completion followed by the final prose completion. Attack branches contain no checkpoint tags and make one completion through the runner.

## Nunjucks Tags

`TinyBrainPromptExtension` registers two synchronous Nunjucks tags. They render private checkpoint markers that the runner consumes; the markers are never sent to the model.

```njk
{% llm_dummy_action %}
{% llmparse('player_is_traveling') as travel %}
{% llmparse('parser_name', extraArgument, anotherArgument) as result %}
```

- `llm_dummy_action` requires a non-whitespace assistant response.
- `llmparse(name, ...args)` selects a named parser and passes the response followed by all extra arguments to it.
- `as variable` is optional. When present, the parsed value is restored into the Nunjucks context on the next program render, so later conditionals can branch on it.
- `accept_or_reject` accepts exactly one `<accepted></accepted>` or `<rejected>...</rejected>` result. Rejection ends the program immediately.
- `player_is_traveling` accepts `<travel>yes</travel>` or `<travel>no</travel>` and returns a boolean.
- `response_or_na` returns `false` for normalized short no-result answers such as `N/A`, `not applicable`, `none`, `no`, `no issues`, or `nothing`. It also returns `false` when the trimmed response begins or ends with a standalone `N/A` token, including `NA` and `N.A.` variants; token boundaries prevent words such as `narrative` or `banana` from matching. Every other non-whitespace response returns `true`. The player-action template uses this value to decide whether to request a revised draft after each editing check.
- `yes_no` accepts a response beginning with `yes` or `no` (optionally prefixed by `Answer:`), normalizes it to a boolean, and rejects ambiguous or differently formatted answers. The final travel check uses this value to select the `moveTurnResult` or `turnResult` instructions.
- Parser names beginning with `mod_step_` currently require non-whitespace and retain the response without additional transformation.
- Unknown parser names fail before another LLM request is sent.

## Execution

The first full `base-context.xml.njk` render places a private program-start marker immediately before the tiny-brain include. The runner keeps the already-rendered base-context prefix and system prompt fixed, then rerenders only `player-action.tinybrain.njk` after parsed assignments. This prevents random-word seeds or other base-context values from changing between checkpoints.

For each checkpoint, the runner:

1. Appends only the new instruction segment as a `user` message.
2. Runs the normal completion or chat-tool loop.
3. Keeps assistant tool-call messages and `tool` results in the conversation.
4. Parses the terminal assistant response.
5. On success, keeps that response and advances to the next checkpoint.
6. On parse failure, reports the failed text to the prompt-progress viewer, removes only the malformed terminal assistant response, and retries the unchanged checkpoint prompt without adding an error message or stack trace to the model conversation.

Checkpoint parse retries use `ai.retryAttempts` as the number of retries after the initial response. Transport retries inside `LLMClient` remain separate. Exhausted parse retries throw a clear error. Final repetition-buster XML is parsed without invoking the separate XML-repair prompt, so malformed final output is retried in the same accumulated conversation instead.

The optional `onParseFailure` callback receives the failed response, checkpoint, attempt, final-step flag, and parser error. The player-action integration uses it only for UI progress reporting; parser errors and backtraces remain in server logs and are never appended to the LLM conversation. Tool-call messages and tool results that preceded the malformed terminal response remain available on retry.

`runChatCompletionWithToolLoop()` returns `conversationMessages` for this purpose. Its terminal assistant response is included after any tool-call and tool-result messages.

Because the initial player-action render uses `base-context.xml.njk`, every TinyBrain stage receives the same canonical non-generic base-context tool schema used by other specialized base-context prompts. The base-context marker is removed before the first request and the retained initial user message remains fixed across checkpoints.

`TinyBrainPromptRunner.run()` owns a single `LLMClient.withPromptQueueReservation()` lifecycle for every runner instance. Every checkpoint, parse retry, transport retry, and tool-call round receives the same opaque reservation. Once its first real completion acquires a per-model queue permit and optional all-model permit, those permits remain assigned to the staged prompt until the runner returns or throws; queued prompts cannot take that slot between checkpoints. The reservation releases in `finally`, including parser failures and cancellation paths. Other genuinely free concurrency slots remain available.

The runner also owns one async-scoped prompt-progress group, using the render state's stable run id and a dedicated target label derived from its metadata label (`player_action_tinybrain`, `event_checks_tinybrain`, and the same `<metadataLabel>_tinybrain` rule for future runners). Every nested `LLMClient.chatCompletion()`, including tool-loop rounds, inherits that group automatically. `LLMClient` therefore reuses one prompt-progress entry and stable prompt id for the entire run without prompt-specific lifecycle code. The decoded-character received count accumulates across requests while the expected multiprompt target is selected once from the dedicated historical whole-run average or configured family target and never changes during the run. Progress uses the ordinary asymptotic curve: 75% at the expected total, then approaching 100% as additional output arrives. The current stage uses the ordinary yellow/orange fill. Parsing, tool execution, or rerendering gaps retain the same row in blue at its current character count and percentage. The next stage preserves both totals and returns the fill to its active color. Successful completed programs, including an event program ending normally with `<done/>`, write one aggregate whole-run sample when the group clears; parse/transport failures and rejected player actions do not change that history. Parse-failed text is retained in order for the group and displayed separately from the live retry response.

## Logging

Each run creates one `player_action_tinybrain` prompt log through `LLMClient.logPrompt()`. Every later prompt segment, tool-call round, parser error, retry, and response is appended to that same file. LLM responses use explicit markers such as:

```text
=== TINY-BRAIN CHECKPOINT 1 ATTEMPT 1 LLM RESPONSE BEGIN ===
...
=== TINY-BRAIN CHECKPOINT 1 ATTEMPT 1 LLM RESPONSE END ===
```

`LLMClient.logPrompt({ filePath, append: true })` only accepts paths inside the runtime `logs/` directory and fails if the target file is missing. Tiny-brain execution treats log creation or append failure as fatal rather than silently producing fragmented logs.

## Prompt Caching

Every checkpoint resends the accumulated conversation. Providers with prefix caching can reuse the stable prefix. If `ai.cachebuster: true` is also enabled, `LLMClient` adds a new random cachebuster to the final user message for every request, which intentionally prevents reliable prefix-cache reuse.
