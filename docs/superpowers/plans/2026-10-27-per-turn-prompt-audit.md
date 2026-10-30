# Per-turn prompt failure audit

Requested: 2026-10-27. This is diagnostic logging, separate from gameplay history and model context.

## Intended result

Each gameplay turn owns an ephemeral in-memory collector. Failed prompt attempts remain visible in that collector even when correction succeeds and TinyBrain removes rejected responses from its conversation. At the end of the turn, including its owned background prompt work, write a compact file under `logs/` that makes recurring failures easy to investigate.

The summary identifies the turn/request and action route, starting/ending world location, prompt label, section/checkpoint/parser or execution phase, failure category, count, short error and available detailed-log references. Group repeated failures without merging distinct prompts or stages. Distinguish successful recovery from terminal prompt failure; deliberate cancellation does not count as a model error. A clean turn produces a short zero-error summary.

## Scope and boundaries

- Shared `PromptAuditLog` owns async-local turn/prompt/section context, grouping and file output.
- Canonical chat, travel, crafting and location-modification handlers establish turn ownership; nested NPC/event/generation prompts retain that owner.
- Track detached continuity work through the existing `trackTurnContextWork` lifecycle and track prompt scopes. Close admission when the actual handler settles, then flush after its owned work settles without delaying the HTTP response or blocking another turn.
- Instrument shared transport/validation retries, TinyBrain section corrections, standard structured parse retries, native tool failures and terminal prompt reporting. Supply real metadata labels at standard parse-helper callers. Audit concrete manual retry loops for omissions.
- Keep concurrent turns and their delayed callbacks isolated. Count a failed attempt once when the same exception propagates through several layers, while counting distinct rejected attempts separately.
- Preserve all existing prompt/error logs, retry budgets, terminal notifications and committed tool receipts. Audit data never enters chat history, saves or provider payloads.
- Summaries contain no prompt bodies, credentials, headers or request/configuration objects. Detailed failures remain in their existing logs.
- Use fresh unique log filenames. Surface file-write errors explicitly. Release finalized collector memory; do not manually delete logs or rewrite saved history.

## Implementation order

1. Define collector lifecycle and instrumentation contracts; review async ownership and deduplication risks.
2. Implement collector and shared failure hooks with prompt/stage/log provenance.
3. Connect actual request settlement and owned background work; thread standard retry labels and close concrete manual-loop gaps.
4. Add focused mocked tests for recovery, aggregation, isolation, cancellation, finalization and real retry-boundary integration.
5. Update module/lifecycle documentation and the documentation index; syntax-check changed JavaScript and run bounded affected tests.

## Verification

Tests run in a transient systemd unit with `MemoryMax=16G` and `MemorySwapMax=0`. Use temporary logs under `tmp/` and mocked completions, never a live model. Cover interleaved turns, background completion after an HTTP response, nested prompts/checkpoints, transient versus terminal errors, correct counts, detailed-log references, write failure and preservation of existing retry/context behavior. Run no broad browser journey for this backend diagnostic feature.

The user subsequently granted standing authorization to restart the game server when needed. The coordinator owns activation after source/test checks and preserves the model server; implementation/testing agents do not restart services.

## Implemented Contract

`PromptAuditLog` now supplies turn, logical prompt and independent stage ownership; actual occurrence grouping; cause/tool propagation deduplication; compact error sanitization; explicit cancellation; log references; owned work reservations; and detached file finalization. Gameplay boundaries cover chat, canonical player move, NPC teleport, craft, location modification and checked-container opening. Matching nested prompts join their owner. Deferred chooser/plot launches reserve at scheduling time.

All production standard parser-retry callers carry real metadata labels. Shared completion/runner/tool/reporter hooks record actual failed attempts, and accepted validation marks its own stage recovered. Manual slop/image-text/ability retry loops and swallowed background response parsers have narrow hooks. Shared image text batches fan out through captured per-request contexts without regrouping requests, assigning a global latest turn, or waiting for GPU rendering.

The module's `snapshot` is for ongoing diagnostics; rows/references are released after finalization. Unexpected late owned failures append explicitly marked rows to the same artifact with a warning. Existing prompt/error logs, UI notifications, retry budgets and tool receipts remain unchanged.

Syntax checks and all 35 focused tests across the audit, stat-label, failure-reporting, parser-retry and TinyBrain cleanup suites passed. After preserving exact long/bracketed detailed-log references, the ten audit tests passed again. See [PromptAuditLog](../../classes/PromptAuditLog.md) for exact APIs, lifecycle and privacy scope.

Activated on 2026-10-27 at 15:51 UTC after saving the loaded game. AI RPG passed readiness on port 7777 with no save automatically loaded; the original Strata instance remained running unchanged.

## Related completed change

The stat-only skill-check title correction is active and its three focused recorder tests pass. It prefers the actual attribute when a skill is absent or `N/A`, retains real skill names, and does not change mechanics or old saved records.
