# Scheduled Events Implementation Plan

> Archive note: this implementation plan is complete. It is retained for historical design context and as a compact map of the implemented scheduled-event system, not as a live checklist.

**Historical goal:** Add a `scheduleEvent` chat tool that records future world events, resolves due events with an LLM/tool-call prompt, logs outcomes, and shows visible prose when the player is present.

**Implemented architecture:** Scheduled events are first-class persisted records with an in-memory index and save-file serialization. The chat tool schedules records by exact world time or relative duration. API time-advance flows invoke an async due-event resolver that runs a base-context prompt with scheduled-event tool access, records hidden outcome entries, and stores visible same-location prose when appropriate.

The current implementation also supports same-location interruptions for timed player actions: when a pending scheduled event falls inside parsed `<timePassed>` for a normal player-action response, the route advances to the interruption minute, resolves the local event with visible prose suppressed, rewrites the original player-action XML through `scheduled-event-interruption-rewrite`, then continues the normal turn flow.

**Current implementation map:**
- Model and persistence: `ScheduledEvent.js`, `Utils.js`, `IdGenerator.js`, `scheduledEvents.json`.
- Scheduling/runtime helpers: `scheduled_event_runtime.js`.
- Tool definition and executor: `chat_tool_calls.js`.
- Due-event resolution and time hooks: `api.js`.
- Prompt templates: `prompts/_includes/scheduled-event-resolution.njk` and `prompts/_includes/scheduled-event-interruption-rewrite.njk`.
- Diagnostic command: `slashcommands/scheduled.js`.
- Current reference docs: `docs/classes/ScheduledEvent.md`, `docs/api/chat.md`, `docs/api/serialization.md`, and `docs/slashcommands/ScheduledCommand.md`.
- Reference tests: `tests/scheduled_event.test.js`, `tests/scheduled_event_runtime.test.js`, `tests/chat_tool_schedule_event.test.js`, `tests/scheduled_event_api_integration.test.js`, `tests/api.player_action_rejection.test.js`, and `tests/scheduled_command.test.js`.

**Tech stack:** Node.js, Nunjucks prompt templates, existing `createChatToolRuntime` tool loop, `Utils` save serialization, built-in `node:test`.

---

### Task 1: Scheduled Event Model and Persistence

**Files:**
- Created: `ScheduledEvent.js`
- Modified: `Utils.js`
- Modified: `IdGenerator.js`
- Test: `tests/scheduled_event.test.js`

- [x] Added tests that create scheduled events, serialize them, load them, and list pending due records in chronological order.
- [x] Implemented `ScheduledEvent` with `getById`, `getAll`, `getPending`, `getPendingDue`, `getPendingBetween`, `serializeAll`, `loadAll`, `clear`, and instance `toJSON`, `markResolved`, and `markSkipped` helpers. The original plan called for a static `create`; the current code constructs records with `new ScheduledEvent(...)`, normally through `createScheduledEventScheduler(...)`.
- [x] Added the compact `sevent` ID prefix to `IdGenerator`.
- [x] Included `scheduledEvents.json` in save write, load, and hydration.
- [x] Kept focused model/persistence coverage in `tests/scheduled_event.test.js`.

### Task 2: scheduleEvent Tool

**Files:**
- Modified: `chat_tool_calls.js`
- Modified: `api.js`
- Created: `scheduled_event_runtime.js`
- Test: `tests/chat_tool_schedule_event.test.js`
- Test: `tests/scheduled_event_runtime.test.js`

- [x] Added tests proving `scheduleEvent` accepts exactly one of `in` or `at`, requires event/region/location, resolves the target region/location, and returns scheduled event metadata.
- [x] Added the tool definition and executor to `chat_tool_calls.js`.
- [x] Passed an API scheduling handler from `createScheduledEventScheduler(...)` into `createChatToolRuntime`.
- [x] Made `scheduleEvent` available in regular prose prompts and generic prompts.
- [x] Moved region/location resolution, timing validation, event creation, and result XML parsing into `scheduled_event_runtime.js`.

### Task 3: Resolution Prompt and Due Runner

**Files:**
- Created: `prompts/_includes/scheduled-event-resolution.njk`
- Modified: `api.js`
- Modified: `scheduled_event_runtime.js`
- Test: `tests/scheduled_event_api_integration.test.js`
- Test: `tests/scheduled_event_runtime.test.js`

- [x] Covered empty `<scheduledEventResult/>`, final result-block parsing, API wiring, prompt logging, hidden outcome logging, same-location visible prose logging, and scheduled-event tool-loop access.
- [x] Rendered a base-context prompt for due scheduled events at the scheduled location with `promptType: 'scheduled-event-resolution'`.
- [x] Ran resolution through `runChatCompletionWithToolLoop` using built-in and mod chat tools appropriate for scheduled resolution. Generic-prompt-only chat-history mutation tools are excluded; world-mutation tools are available.
- [x] Parsed the final `<scheduledEventResult>` block strictly. Empty/self-closing results skip the event; happened results require a summary and mark the event resolved.
- [x] Appended hidden `scheduled-event` entries for summaries and visible `scheduled-event-prose` entries only when the player is present and visible prose is not suppressed.
- [x] Notified the client when visible prose is stored.

### Task 4: Time-Advance Integration

**Files:**
- Modified: `api.js`
- Created: `prompts/_includes/scheduled-event-interruption-rewrite.njk`
- Test: `tests/scheduled_event_api_integration.test.js`
- Test: `tests/api.player_action_rejection.test.js`

- [x] Wired due-event processing after positive time advances from player turns, `/time`, travel/fast travel, crafting, and location modification.
- [x] Added `processDueScheduledEvents(...)`, which processes pending due events after existing status and vehicle-arrival effects.
- [x] Kept negative time rewinds as raw world-clock moves that do not process due scheduled events or undo prior side effects.
- [x] Included refresh hints when due events mutate visible state.
- [x] Added player-action interruption handling for same-location scheduled events inside parsed `<timePassed>`, including XML rewrite through `scheduled-event-interruption-rewrite`.

### Task 5: Documentation and Verification

**Files:**
- Created: `docs/classes/ScheduledEvent.md`
- Created: `docs/slashcommands/ScheduledCommand.md`
- Modified: `docs/api/chat.md`
- Modified: `docs/api/serialization.md`
- Modified: `docs/server_llm_notes.md`

- [x] Documented scheduling tool parameters, persistence, prompt behavior, chat-log behavior, visible prose behavior, player-action interruptions, and the `/scheduled` diagnostic command.
- [x] Treat the maintained reference docs listed above as authoritative for current behavior.
- [x] Kept focused verification in the scheduled-event model/runtime/tool/API/command tests listed above.
