# TinyBrainPromptRunner

## Purpose

`TinyBrainPromptRunner.js` executes staged prompts used when `ai.tinybrain: true`. It drives player actions, event checks, need-bar checks, quest rewards, game intros, random/creative/NPC narration, crafting, location modification, checked containers, while-away updates, scheduled-event resolution, and scheduled-event interruption rewrites. It lets a small model answer one reasoning instruction at a time while preserving the conversation, tool calls, and tool results for later checkpoints and the final response.

The normal one-shot player-action path remains active when the option is omitted or false. In `prompts/_includes/player-action.tinybrain.njk`, non-attack prompts first pause after selecting the NPCs that may respond. Repetition-buster prompts then run the additional analysis, editing, and branching checkpoints. Its nine built-in editing/pruning audit questions are nine separate `llm_dummy_action` checkpoints, so the model answers only one audit question per completion and each nonblank answer remains in the conversation for the second draft. For exit-button travel to a location whose name ends in `Exterior`, the exterior/interior deferral checkpoint includes the resolved destination's canonical name and description. It obtains them at render time through the prompt-only `getLocationInfo(name, id?)` Nunjucks global using the exact travel destination id, including stub-description metadata when necessary. A non-attack prompt with `repetition_buster: false` therefore makes the NPC-selection completion followed by the final prose completion. Attack branches contain no checkpoint tags and make one completion through the runner.

Dedicated need-bar checks use two completions. The first asks for the existing plain-text per-character planning analysis and forbids XML. The second retains that analysis and asks only for the `<characters>` block. A strict domain parser retries the second phase in place when its XML or need-bar fields are malformed.

## Nunjucks Tags

`TinyBrainPromptExtension` registers three synchronous Nunjucks tags. They render private checkpoint/result markers that the runner consumes; the markers are never sent to the model.

```njk
{% llm_dummy_action %}
{% llmparse('player_is_traveling') as travel %}
{% llmparse('parser_name', extraArgument, anotherArgument) as result %}
{% llmresult('registered_result_builder') %}
```

- `llm_dummy_action` normally requires a non-whitespace assistant response. A blank terminal response is accepted when that same checkpoint completed at least one successful tool invocation, because the retained tool result already supplies the checkpoint's useful context.
- `llmparse(name, ...args)` selects a named parser and passes the response followed by all extra arguments to it.
- `as variable` is optional. When present, the parsed value is restored into the Nunjucks context on the next program render, so later conditionals can branch on it.
- `llmresult(name)` must be the only content after the final checkpoint. It invokes a registered local result builder with the named parsed assignments and performs no additional LLM request. Unknown builders, duplicate result markers, duplicate assignment targets, and trailing prompt text fail explicitly. Programs without this marker retain the ordinary final LLM completion.
- `accept_or_reject` accepts exactly one `<accepted></accepted>` or `<rejected>...</rejected>` result. Rejection ends the program immediately.
- `player_is_traveling` accepts `<travel>yes</travel>` or `<travel>no</travel>` and returns a boolean.
- `response_or_na` returns `false` for normalized short no-result answers such as `N/A`, `not applicable`, `none`, `no`, `no issues`, or `nothing`. It also returns `false` when the trimmed response begins or ends with a standalone `N/A` token, including `NA` and `N.A.` variants; token boundaries prevent words such as `narrative` or `banana` from matching. Every other non-whitespace response returns `true`. The player-action template uses this value to decide whether to request a revised draft after each editing check.
- `yes_no` accepts a response beginning with `yes` or `no` (optionally prefixed by `Answer:`), normalizes it to a boolean, and rejects ambiguous or differently formatted answers.
- `revision_decision`, `allowed_character_selection`, `narrative_scope`, `exact_xml_root`, `outcome_acknowledgement`, and `while_away_character_update` are provided by `TinyBrainPromptParsers.js`. They return JSON-safe structured values and fail on malformed, duplicate, unknown, or cross-stage-inconsistent content.
- Parser names beginning with `mod_step_` currently require non-whitespace and retain the response without additional transformation.
- Unknown parser names fail before another LLM request is sent.

## Execution

The first full `base-context.xml.njk` render places a private program-start marker immediately before the allowlisted tiny-brain include selected by `TinyBrainPromptFamilies.js`. The runner keeps the already-rendered base-context prefix and system prompt fixed, then rerenders only that family program after parsed assignments. This prevents random-word seeds or other base-context values from changing between checkpoints.

Callers that need several separately rendered programs to act as one sequential model conversation can pass a state from `createTinyBrainContinuationState()`. After each successful program, the runner replaces that state with cloned `conversationMessages`, accumulated tool invocations, and the active prompt-log path. The next program retains the original system message, appends its newly rendered base context and first instruction as the next user message, and continues writing to the same log file. A changed system prompt or malformed continuation state fails explicitly. Each program still owns its own queue reservation and progress-group lifecycle; continuation shares model context and logging, not concurrency permits.

For each checkpoint, the runner:

1. Appends only the new instruction segment as a `user` message.
2. Runs the normal completion or chat-tool loop.
3. Keeps assistant tool-call messages and `tool` results in the conversation.
4. Parses the terminal assistant response. Parsers receive read-only checkpoint metadata plus the current and accumulated tool-invocation records, allowing final semantic checks to run before acceptance.
5. On success, keeps that response and advances to the next checkpoint.
6. On parse failure, reports the failed text to the prompt-progress viewer, removes only the malformed terminal assistant response, and retries the unchanged checkpoint prompt without adding an error message or stack trace to the model conversation.

When a parser returns `normalizedResponse`, the runner returns that cleaned response to the downstream caller while preserving and logging the model's original response in the conversation transcript. XML domain parsers use this to accept harmless fences or surrounding commentary without passing those wrappers into consumers that expect XML.

Checkpoint parse retries use `ai.retryAttempts` as the number of retries after the initial response. Transport retries inside `LLMClient` remain separate. Exhausted parse retries throw a clear error. Final repetition-buster XML is parsed without invoking the separate XML-repair prompt, so malformed final output is retried in the same accumulated conversation instead.

The non-attack repetition-buster player-action program ends with `llmresult('player_action_result')`. Its final prose, movement, vehicle state, destination, hidden-note, and time answers are parsed checkpoints rather than one model-authored XML response. For committed route travel, `/api/chat` passes an authoritative movement type alongside the destination, and the template skips the movement parser checkpoint. `PlayerActionTinyBrainResult.js` validates that the passed type agrees with current vehicle state and uses it during canonical XML assembly. The assembled response is appended to the same prompt log, keeps the accumulated tool/progress state, and is not inserted as a fabricated assistant message.

When `ai.xml_repetition_fix: true`, `run()` wraps the complete staged program in a metadata-scoped XML repetition context. Every matching checkpoint, final completion, and tool-loop completion gains the streaming detector; nested prompts with a different metadata label do not. A balanced explicit XML block longer than 50 characters that exactly repeats the immediately preceding trimmed suffix is removed, as is the second half of an exact direct-sibling `ABAB` sequence. The interrupted completion then resumes from the retained assistant prefix after the exact user prompt `continue`. Comments, CDATA, self-closing elements, incomplete elements, and near-matches are left alone. The recovery budget is the runner's `ai.retryAttempts` value, independent of parse/transport retry counters, and exhaustion fails explicitly. Earlier completed tool results remain in the staged transcript, but any partial tool call in the aborted stream is discarded.

The optional `onParseFailure` callback receives the failed response, checkpoint, attempt, final-step flag, and parser error. The player-action integration uses it only for UI progress reporting; parser errors and backtraces remain in server logs and are never appended to the LLM conversation. Tool-call messages and tool results that preceded the malformed terminal response remain available on retry.

`runChatCompletionWithToolLoop()` returns `conversationMessages` for this purpose. Its terminal assistant response is included after any tool-call and tool-result messages.

Because most staged families render through `base-context.xml.njk`, their retained prefix starts from the same canonical base context used by the corresponding one-shot prompt. Tool definitions are then narrowed per family and checkpoint: checked containers expose only their two check tools at the roll checkpoint, NPC narration exposes lookup-only tools at its information checkpoint, and scheduled events expose their full mutation schema only at the execution checkpoint. The base-context marker is removed before the first request and the retained initial user message remains fixed across checkpoints.

When `ai.live_deslop` is enabled, first-draft checkpoints, conditional second drafts, player-action final-prose checkpoints, and other families' final structured responses use live slop correction. Drafts and the parsed player-action prose sections use plain-prose extraction; planning, destination, hidden-note, timing, tool, outcome, and audit checkpoints are not inspected. Other final extraction uses the family's explicit player-facing XML tag profile, so hidden summaries, tool results, state blocks, timing fields, and other non-prose XML are excluded. These stages first request streamed prose-token logprobs while keeping the tool schema. Content deltas without logprobs are preserved at their exact response offsets but bypass prose-token inspection; structured tool calls are handled through `delta.tool_calls`. If the current llama.cpp process rejects streaming or supplies invalid/misaligned prose-token metadata, all later live stages for that process use non-stream logprob batches of at most 500 tokens.

`TinyBrainPromptRunner.run()` owns a single `LLMClient.withPromptQueueReservation()` lifecycle for every runner instance. Every checkpoint, parse retry, transport retry, and tool-call round receives the same opaque reservation. Once its first real completion acquires a per-model queue permit and optional all-model permit, those permits remain assigned to the staged prompt between ordinary checkpoints and synchronous tools. A known prompt-launching tool temporarily yields both retained permits while its nested prompt runs, then reacquires the original permits at the front before the runner resumes. This avoids a parent/nested-prompt deadlock when the global concurrency cap is one and also permits a nested prompt to switch managed local models. The reservation releases in `finally`, including parser failures and cancellation paths. Other genuinely free concurrency slots remain available.

The runner also owns one async-scoped prompt-progress group, using the render state's stable run id and a dedicated target label derived from its metadata label (`player_action_tinybrain`, `event_checks_tinybrain`, and the same `<metadataLabel>_tinybrain` rule for future runners). Every nested `LLMClient.chatCompletion()`, including tool-loop rounds, inherits that group automatically. `LLMClient` therefore reuses one prompt-progress entry and stable prompt id for the entire run without prompt-specific lifecycle code. The decoded-character received count accumulates across requests while the expected multiprompt target is selected once from the dedicated historical whole-run average or configured family target and never changes during the run. Progress uses the ordinary asymptotic curve: 75% at the expected total, then approaching 100% as additional output arrives. The current stage uses the ordinary yellow/orange fill. Parsing, tool execution, or rerendering gaps retain the same row in blue at its current character count and percentage. The next stage preserves both totals and returns the fill to its active color. Successful completed programs, including an event program ending normally with `<done/>`, write one aggregate whole-run sample when the group clears; parse/transport failures and rejected player actions do not change that history. Parse-failed text is retained in order for the group and displayed separately from the live retry response.

## Logging

Each run creates one family-specific TinyBrain prompt log through `LLMClient.logPrompt()`. Every later prompt segment, tool-call round, parser error, retry, response, locally assembled terminal result, and adaptive live-stream failure is appended to that same file. A caller-provided continuation state also carries that path into later sequential programs, so the entire logical conversation uses one prompt log. The completion callback receives a strict `appendLogSection(...)` helper tied to this file. Live-stream failure sections record the exact fallback message, classification, capability key, HTTP details, server response, and backtrace before the non-stream retry starts. LLM responses use explicit markers such as:

XML repetition recovery also appends its detected pattern, removed offsets, retained assistant prefix, and exact `continue` user prompt to this transcript before the continuation request. As with every later TinyBrain append, a filesystem failure emits a warning and does not terminate the running turn.

```text
=== TINY-BRAIN CHECKPOINT 1 ATTEMPT 1 LLM RESPONSE BEGIN ===
...
=== TINY-BRAIN CHECKPOINT 1 ATTEMPT 1 LLM RESPONSE END ===
```

`LLMClient.logPrompt({ filePath, append: true })` only accepts paths inside the runtime `logs/` directory and returns `null` if the target file is missing or another filesystem write fails. Tiny-brain execution still treats initial log creation as required. Once a run has started, however, failure to append a later prompt, response, diagnostic, or parse-error section emits a console warning naming the log and lets the running turn continue without that entry.

## Prompt Caching

Every checkpoint resends the accumulated conversation. Providers with prefix caching can reuse the stable prefix. If `ai.cachebuster: true` is also enabled, `LLMClient` adds a new random cachebuster to the final user message for every request, which intentionally prevents reliable prefix-cache reuse.
