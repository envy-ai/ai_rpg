# PromptFailureReporter

The separate [PromptAuditLog](PromptAuditLog.md) records transient and terminal prompt failures per gameplay turn. Reporter scopes share audit logical ownership, and terminal reports mark ultimate failure without adding another occurrence when the same exception or cause was already counted. Existing notification delivery and deduplication remain unchanged.

`PromptFailureReporter.js` owns transient terminal prompt-failure notifications.
`LLMClient.chatCompletion` owns a direct completion; `TinyBrainPromptRunner.run`
owns an entire staged program; the native chat-tool runtime owns an entire loop.
Standard location item/scenery generation also owns its complete validation conversation, including recoverable parser retries and final exhaustion. Matching-label nested completions/loops join their owner. A nested prompt with a
different label owns a separate notification, including when its caller handles
its exception. Every failed invocation gets a fresh `prompt_failure_N` identity, even for the same label.

`withMetadataAlias(metadataLabel, callback)` explicitly lets one stage with a different transport/model label join an already-active logical failure owner. It requires a nonblank label, callback and active owner. The alias is bound to that exact owner through native async-local scope: unrelated nested reporter owners cannot inherit it, and completion, failure or cancellation restores the previous aliases automatically. Combined TinyBrain event/need-bar programs use this narrow scope so need-bar completions retain their model label while transport attempts accumulate on one event owner and terminal failure reports once. Other differently labelled prompts keep independent ownership.

Labelled `runPromptWithParseRetries` conversations own kind `parse_retry` for their complete bounded completion/parse loop. This includes startup ability attachments, starting techniques, initial faction standings and region generation, even when every model completion succeeds but the outer parser exhausts. Its actual corrections increment `validationRetries` centrally; helper-backed callers do not double-count them. Unlabelled generic helper calls do not invent a notification identity.

The three existing faction-authoring stage loops separately own their real labels (`faction_generation`, `faction_relationship_generation`, `faction_reputation_generation`) through all three attempts. The existing single/batched image-text validation loop similarly owns `image_prompt_generation` with kind `image_text`. Their parser rejections count a validation retry only before an actual next attempt; image executors explicitly mark the response-validation boundary so transport retries do not inflate this count. These scopes preserve existing budgets and batching. Explicit cancellation propagates immediately. Optional startup callers can still continue after terminal calendar, inventory, equipment, abilities or intro failures; their prompt owners emit the same global terminal notification before those caller catches handle the error.

Character inventory generation similarly owns its full XML/domain/candidate
validation conversation under `inventory_generation_<Name>`. Each actual
correction increments `validationRetries`; recoverable item/mod errors produce
no notification. Terminal exhaustion reports once even when the caller retains
the optional empty-result error interface.

`run({ metadataLabel, kind, signal, join }, callback)` emits `prompt_failed` only
when its logical operation fails. Recoverable transport/parser/tool attempts and
successful final responses after tool-budget exhaustion emit nothing. Explicit
`PROMPT_CANCELLED`/`PromptCancellationError` cancellation and explicitly aborted
caller signals are excluded; a caller signal's `TimeoutError` and internal
transport cancellations/timeouts still report. TinyBrain parser exhaustion keeps
the original exception in `cause`.

`isFatalExecution(error)` follows the cause chain for an explicit
`fatalTinyBrainExecution` marker. Staged and shared parse loops use this signal
to propagate deterministic host preparation failures without treating them as
model-correctable parser output. Ordinary unmarked validation errors retain
their normal correction attempts.

The event follows the global `prompt_progress` audience through
`Globals.realtimeHub.emit(null, 'prompt_failed', payload)`. Its payload is:

```js
{
    id, metadataLabel, kind, message, stack, serverTime,
    transportAttempts, validationRetries,
    toolCalls: null // or { attempted, executed, denied, cached, limit?, limitUnit? }
}
```

`transportAttempts` counts entered completion attempts (including preparation
failures); `validationRetries` counts actual TinyBrain, shared parser-loop and explicitly owned manual response-validation retries. Tool counts
come from actual policy/executor branches, accumulating across staged retries.
`executed` counts executor invocations, including failures, while cache hits are
counted separately. `denied` counts policy/budget/pre-execution validation refusals. A configured TinyBrain
limit uses `calls`; ordinary native loops use `rounds`, which can contain several
calls. Unknown counters/limits stay unknown rather than being presented as zero.
Earlier policy refusals retain their totals when a later loop supplies its limit.

Failure details preserve exception/cause stacks and tool error diagnostics, never
the provider request/configuration/headers object. An emitted safe envelope is
also attached non-enumerably as `error.promptFailure` for explicit foreground
response forwarding. `getFailure(error)` looks through a cycle-safe cause chain so contextual wrapper errors can forward the original attached envelope and identity. This lookup does not change independent ownership or merge differently labelled nested prompts. `/api/chat` and event post-processing/quest errors forward
it so a client can display the same notification even if HTTP wins the race with
WebSocket delivery. The browser deduplicates by event ID, retaining ordinary
request cleanup and unrelated error dialogs.

`/api/new-game` forwards this same envelope in its terminal HTTP error and `new_game:error` status. Play and New Game status handlers render it through the existing singleton; reviewed setup HTTP errors attach it before `PageFeedback.showError`. Ordinary New Game keeps its immediate navigation to Play, where the existing realtime connection displays startup failures. A still-live form request callback also consumes the HTTP envelope. No backlog, save fields or extra failure UI is introduced.

Every app page opens a persistent, independently dismissible modeless failure
window through `public/js/widgets/prompt-windows.js`, loaded by the shared head.
The browser asset is generated from `client/widget-adapters/prompt-windows.js` by
`npm run widgets:build`. Its singleton `window.AIRPG_PROMPT_WINDOWS` retains safe
failure rendering, placement, stacking policy and ID deduplication, while the
portable [FloatingWindow](FloatingWindow.md)/[PointerDrag](PointerDrag.md) own
modeless shell/drag behavior and explicit teardown. Play's live
viewers compose the same shell. Standalone pages use PageFeedback's existing
WebSocket; Play keeps its existing Chat connection. `PageFeedback.showError`
consumes safe `error.promptFailure` envelopes through the same singleton before
considering its ordinary error modal. It shows the prompt label, failure
message, known tool counts/budget units, model attempts, validation retries and
expandable stack details. Unknown tool counts say `Not recorded`. Text is inserted
literally. Windows cascade, drag, resize, and close with their X or Escape while
focused; opening a failure does not move focus or block the page. Events and
windows are ephemeral, with no save-state fields or missed-event backlog API.
