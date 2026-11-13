# EventReprocessor

`EventReprocessor.js` owns `/reprocess_events` replay selection and saved event-pass tracking. The command processes the most recent stored gameplay turn, including its stored player/NPC/random-event prose, while retaining that prose unchanged. Slash commands, questions, generic prompts and comment-only inputs do not become gameplay turn anchors.

## Replay contract

- No arguments are needed. The service selects the latest gameplay input and its associated prose, stopping at the next non-command user input.
- Event extraction uses the normal standard or TinyBrain event pipeline. Supporting generation needed to apply an event, such as item, NPC, status, or alteration generation, remains enabled.
- Replay suppresses movement and time advancement, the dedicated need-bar prompt, quest checking, housekeeping, and follow-up extraction of generated reward prose. It does not enter player-action/story generation, NPC turns, scheduled/random-event resolution, memory work, or automatic prose summarization.
- Completed tracked passes are skipped. Accepted XML from those passes is supplied to pending TinyBrain sections for duplicate suppression. Required final-state tags remain the responsibility of each ordinary section.
- Original technique operation IDs resolve back to committed service receipts. Captured authoritative hide/reveal checks are reused through the existing matching rules. Untracked turns recover available committed technique receipts and structured opposed check results from the saved turn.
- Turns without replay tracking run immediately with a warning that earlier changes may be repeated. The first replay establishes tracking for subsequent calls. A partial or interrupted application is also retryable with a duplication warning; the service does not guess which unreceipted mutations succeeded.
- If all tracked passes completed, the command reports that no event passes remain. It does not repeat their prompts or mutations.

## Saved state

Normal `/api/chat` processing uses an async-local turn owner and attaches `metadata.eventReplay` to the stored gameplay user entry. Ordinary chat save/hydration preserves this metadata. Version `1` stores `playerId` and ordered `passes`. Each pass records the exact source entry/content, event prose, original included action, authoritative location/section/mode/options (including request-local protected consumption Thing IDs), committed technique operation IDs, pre-resolved checks, processing state, accepted XML, and application errors.

Replay metadata is server-only: outbound chat/history/realtime payloads and shared prompt-history context omit it, including when hidden-note display is enabled. Filtering copies entries and leaves the saved anchor unchanged.

Movement processing plans origin, transit, destination and tracker passes before extraction begins, so an origin failure does not discard the remaining prose sections. Actual pass invocation replaces planned location/options with their resolved runtime values. Replay uses the recorded section locations and suppresses another player move or clock increment.

Pass states are `pending`, `extracting`, `applying`, `applied`, `failed`, or `partial`. `markApplying()` runs the replay guard immediately before the shared outcome pipeline mutates state. An extraction failure remains retryable without claiming any event effects. Recorded handler failures mark partial application. Successful mutation stays `applied` if later summary/reporting fails, preventing another command from repeating those mechanics.

## Runtime boundaries

`replayLatest(...)` accepts history, player, event runner, location resolver, report writer, optional stream and runtime-generation/busy callbacks. `runTurn(...)`, `attachTurnEntry(...)`, `planMovement(...)` and `beginPass(...)` capture ordinary gameplay work; `runPass(...)` associates application checks and failures with one pass.

The API helper takes the existing player move lock and active-turn drain reservation, and blocks overlapping chat/slash/move requests until replay settles. Runtime generation and the exact saved source are checked after event extraction and immediately before application. Missing locations/receipts, changed source prose, unsupported metadata and runtime replacement raise explicit errors. Old untracked turns are supported without requiring diagnostic logs.

Reports use existing event/status summary builders and hidden-check/quest-offer history helpers. Refresh runs after success or failure. Slash errors preserve original stacks and prompt-failure envelopes for the existing persistent error UI; reporting failures do not clear already-applied markers.

Focused verification: `tests/event_reprocessor.test.js` covers the service, slash command and API integration alongside focused event pipeline regressions.

`getCurrentPassIdentity()` returns the active sourceEntryId/eventSectionKind or null. Charge/reload event identities use that native source, explicit sourceEntryId, or chargeEventScope; nested followups preserve a deterministic child scope. The durable item-charge ledger reuses exact committed reload/adjust operations while allowing identical independent actions in later prose entries.
