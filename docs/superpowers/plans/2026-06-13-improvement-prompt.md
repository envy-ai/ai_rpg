# Improvement Prompt Implementation Archive

> Archive note: this implementation plan is complete. It is retained for historical design context and as a compact map of the implemented improvement-prompt behavior, not as a live checklist.

**Historical goal:** Add a visible client chat entry for periodic game-improvement suggestions while keeping those suggestions out of every base-context prompt, including `@@` generic prompts.

**Implemented architecture:** `api.js` schedules a fire-and-forget `improvement-prompt` background request on eligible player-action turns when `improvement_prompt.enabled` is true and the persisted cadence counter reaches `improvement_prompt.interval`. The prompt renders through `base-context.xml.njk` with all ordinary `@@`-eligible history available. Its stored `game-improvement-suggestions` entry is visible to the client, but `base_context_history.js` treats that type as an always-excluded diagnostic entry so it stays out of normal history, all-entry generic prompts, improvement prompts, and `getHistory`.

**Current implementation map:**
- Config defaults and local enablement: `config.default.yaml` and `config.yaml`.
- Config validation: `server.js`.
- Scheduler, prompt execution, prompt logging, chat-entry storage, client notification, and save/load counter persistence: `api.js`.
- Prompt template: `prompts/_includes/improvement-prompt.njk`.
- Prompt-history exclusion rules: `base_context_history.js`.
- Current reference docs: `docs/config.md`, `docs/api/chat.md`, `docs/classes/base_context_history.md`, `docs/api/common.md`, and `docs/api/serialization.md`.
- Reference tests: `tests/base_context_history.test.js`, `tests/api.plot_analysis_scheduling.test.js`, and `tests/chat_tool_calls.test.js`.

**Tech stack:** Node.js, Express route helpers in `api.js`, Nunjucks prompt includes, YAML config, `node:test`.

---

### Task 1: Tests

**Files:**
- Modified: `tests/base_context_history.test.js`
- Modified: `tests/api.plot_analysis_scheduling.test.js`
- Modified: `tests/chat_tool_calls.test.js`

- [x] Added base-context exclusion coverage proving `game-improvement-suggestions` entries with renderable content are excluded with and without `includeAllEntryTypes`.
- [x] Added config/scheduler source coverage for default disabled config, local enablement, server validation, interval gating, visible entry storage, hidden-client-type exclusion, and scheduling before ordinary event checks.
- [x] Added `getHistory` coverage proving all-entry generic prompt history can search non-diagnostic prompt-excluded rows while still excluding `game-improvement-suggestions`.
- [x] Kept the focused verification target as:

```bash
node --test tests/base_context_history.test.js tests/api.plot_analysis_scheduling.test.js
```

### Task 2: Runtime Implementation

**Files:**
- Modified: `config.default.yaml`
- Modified: `config.yaml`
- Modified: `server.js`
- Modified: `base_context_history.js`
- Modified: `api.js`
- Created: `prompts/_includes/improvement-prompt.njk`

- [x] Added `improvement_prompt.enabled` and `improvement_prompt.interval`. Defaults are disabled with interval `10`; the checked-in local config enables the prompt. Validation rejects non-object config, non-boolean `enabled`, and provided intervals below `1` or non-integers.
- [x] Added `_includes/improvement-prompt.njk`, rendered through `base-context.xml.njk` as `promptType: 'improvement-prompt'`.
- [x] Added the cadence counter and scheduler. Eligible user turns exclude comment-only, forced-event, question, and generic-prompt flows; creative-mode turns count as eligible player-action turns.
- [x] Stored visible `role: assistant`, `type: game-improvement-suggestions` entries with a `Game improvement suggestions` heading, `metadata.excludeFromBaseContextHistory: true`, parent linkage, location metadata, and optional source request metadata. The type is intentionally absent from `HIDDEN_CHAT_ENTRY_TYPES`.
- [x] Logged prompt artifacts through `LLMClient.logPrompt()` with `metadataLabel: 'improvement_prompt'`.
- [x] Persisted `metadata.improvementPromptTurnCounter` on save and restored it on load, matching the plot prompt counter pattern.

### Task 3: Documentation And Verification

**Current reference docs:**
- `docs/config.md`
- `docs/api/chat.md`
- `docs/classes/base_context_history.md`
- `docs/api/common.md`
- `docs/api/serialization.md`

- [x] Documented enabled/interval config, visible chat entry behavior, background scheduling, prompt logging, save metadata, and base-context/history-tool exclusion.
- [x] Treat the maintained reference docs listed above as authoritative for current behavior.
- [x] Current focused verification targets:

```bash
node --test tests/base_context_history.test.js tests/api.plot_analysis_scheduling.test.js
node --check api.js
node --check server.js
node --check base_context_history.js
```
