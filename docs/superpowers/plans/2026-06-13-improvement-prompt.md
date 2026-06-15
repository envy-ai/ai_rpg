# Improvement Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a visible client chat entry for periodic game-improvement suggestions while keeping those suggestions out of every base-context prompt, including `@@` generic prompts.

**Architecture:** Reuse the existing base-context prompt renderer, background prompt request flow, chat-history entry storage, and prompt-counter persistence used by plot summary/expander prompts. The new entry type is client-visible because it is not a hidden chat type, but it is prompt-invisible because the base-context history predicate treats it as a diagnostic/system-support type.

**Tech Stack:** Node.js, Express route helpers in `api.js`, Nunjucks prompt includes, YAML config, `node:test`.

---

### Task 1: Tests

**Files:**
- Modify: `tests/base_context_history.test.js`
- Modify: `tests/api.plot_analysis_scheduling.test.js`

- [ ] **Step 1: Add base-context exclusion coverage**

Add a test asserting that a `game-improvement-suggestions` entry with renderable content is excluded with and without `includeAllEntryTypes`.

- [ ] **Step 2: Add config/scheduler source coverage**

Add a test asserting default config has `improvement_prompt.enabled: false` and `interval: 10`, `config.yaml` enables it, server validation exists, and `/api/chat` schedules the improvement prompt before the ordinary event-check await.

- [ ] **Step 3: Run the focused tests to verify failure**

Run:

```bash
node --test tests/base_context_history.test.js tests/api.plot_analysis_scheduling.test.js
```

Expected: at least one assertion fails because the new config keys, scheduler, prompt, and exclusion type do not exist yet.

### Task 2: Runtime Implementation

**Files:**
- Modify: `config.default.yaml`
- Modify: `config.yaml`
- Modify: `server.js`
- Modify: `base_context_history.js`
- Modify: `api.js`
- Create: `prompts/_includes/improvement-prompt.njk`

- [ ] **Step 1: Add config and validation**

Add:

```yaml
improvement_prompt:
  enabled: false
  interval: 10
```

to `config.default.yaml`, and:

```yaml
improvement_prompt:
  enabled: true
```

to `config.yaml`. Validate `enabled` as boolean and `interval` as an integer greater than or equal to 1 when the prompt is enabled.

- [ ] **Step 2: Add prompt template**

Create `_includes/improvement-prompt.njk` with the requested base-context prompt asking for ideas about features, improvements, prompt optimizations, etc.

- [ ] **Step 3: Add scheduler**

Track `improvementPromptTurnCounter`, increment it on eligible normal/creative player-action turns, and schedule `runImprovementPrompt(...)` when enabled and the counter is divisible by interval.

- [ ] **Step 4: Store visible prompt-excluded chat entry**

Append a `role: assistant`, `type: game-improvement-suggestions` entry with content headed `Game improvement suggestions`, `metadata.excludeFromBaseContextHistory: true`, and the parent player-action entry id. Do not add the type to hidden client types.

- [ ] **Step 5: Persist counter**

Save `metadata.improvementPromptTurnCounter` and restore it on load, matching the existing plot prompt counters.

### Task 3: Docs And Verification

**Files:**
- Modify: `docs/api/chat.md`
- Modify: `docs/config.md`
- Modify: `docs/server_llm_notes.md`
- Modify: `docs/classes/base_context_history.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Document config and behavior**

Document the enabled/interval config, visible chat entry behavior, background scheduling, and base-context exclusion.

- [ ] **Step 2: Run checks**

Run:

```bash
node --test tests/base_context_history.test.js tests/api.plot_analysis_scheduling.test.js
node --check api.js
node --check server.js
node --check base_context_history.js
```

Expected: all commands exit 0.
