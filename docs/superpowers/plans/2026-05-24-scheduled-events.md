# Scheduled Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `scheduleEvent` chat tool that records future world events, resolves due events with an LLM/tool-call prompt, logs outcomes, and shows visible prose when the player is present.

**Architecture:** Scheduled events are first-class persisted records with an in-memory index and save-file serialization. The chat tool schedules records by exact world time or relative duration. API time-advance flows invoke an async due-event resolver that runs a base-context prompt with world-mutation tools and records hidden outcome entries plus visible same-location prose.

**Tech Stack:** Node.js, Nunjucks prompt templates, existing `createChatToolRuntime` tool loop, `Utils` save serialization, built-in node:test.

---

### Task 1: Scheduled Event Model and Persistence

**Files:**
- Create: `ScheduledEvent.js`
- Modify: `Utils.js`
- Modify: `IdGenerator.js`
- Test: `tests/scheduled_event.test.js`

- [ ] Write failing tests that create scheduled events, serialize them, load them, and list pending due records in chronological order.
- [ ] Implement `ScheduledEvent` with static `create`, `getById`, `getAll`, `getPendingDue`, `serializeAll`, `loadAll`, `clear`, and instance `toJSON`/state transition helpers.
- [ ] Add a compact ID prefix to `IdGenerator`.
- [ ] Include `scheduledEvents.json` in save write/load/hydration.
- [ ] Run `node --test tests/scheduled_event.test.js` and keep it green.

### Task 2: scheduleEvent Tool

**Files:**
- Modify: `chat_tool_calls.js`
- Modify: `api.js`
- Test: `tests/chat_tool_schedule_event.test.js`

- [ ] Write failing tests proving `scheduleEvent` accepts exactly one of `in` or `at`, requires event/region/location, resolves target location, and returns scheduled event metadata.
- [ ] Add the tool definition and executor to `chat_tool_calls.js`.
- [ ] Pass an API scheduling handler into `createChatToolRuntime`.
- [ ] Allow `scheduleEvent` in regular prose prompts as well as generic prompts.
- [ ] Run the focused chat-tool tests.

### Task 3: Resolution Prompt and Due Runner

**Files:**
- Create: `prompts/_includes/scheduled-event-resolution.njk`
- Modify: `api.js`
- Test: `tests/api.scheduled_events.test.js`

- [ ] Write failing tests for empty `<scheduledEventResult/>`, hidden outcome logging, same-location visible prose logging, and world-mutation tool-loop usage.
- [ ] Render a base-context prompt for due scheduled events at the scheduled location.
- [ ] Run it through `runChatCompletionWithToolLoop` with full world-mutation tools.
- [ ] Parse the final XML result strictly and mark events resolved.
- [ ] Append a hidden `scheduled-event` entry for the summary and a visible `scheduled-event-prose` entry only when the player is in that location.
- [ ] Notify the client when visible prose is stored.

### Task 4: Time-Advance Integration

**Files:**
- Modify: `api.js`
- Test: `tests/api.scheduled_events_time_hooks.test.js`

- [ ] Write failing source/behavior tests that due-event processing is invoked after positive time advances from player turns, `/time`, travel, crafting, and location modification.
- [ ] Add a helper that processes due scheduled events after existing status/vehicle time effects.
- [ ] Skip due-event processing on negative time rewinds.
- [ ] Include world-time refresh/location-refresh hints when due events mutate visible state.

### Task 5: Documentation and Verification

**Files:**
- Create: `docs/classes/ScheduledEvent.md`
- Modify: `docs/api/chat.md`
- Modify: `docs/server_llm_notes.md`
- Modify: `docs/README.md`

- [ ] Document scheduling tool parameters, persistence, prompt behavior, chat-log behavior, and visible prose behavior.
- [ ] Run syntax checks for modified JavaScript files.
- [ ] Run all new focused tests plus affected tool/runtime tests.
