# Mystery Box Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build periodic and manual mystery cleanup that marks resolved threads inactive and revealed boxes resolved.

**Architecture:** Add parser/apply helpers to `Events.js`, add a prompt runner and scheduler in `api.js`, expose the runner to slash commands, and keep the slash command thin. Use exact ids in the cleanup schema and persist mystery state through the existing mystery persistence path.

**Tech Stack:** Node.js CommonJS, `node:test`, Nunjucks, `@xmldom/xmldom`, YAML config.

---

### Task 1: Parser, Apply, And Prompt Context

**Files:**
- Modify: `Events.js`
- Modify: `prompts/_includes/mystery_box_cleanup.njk`
- Test: `tests/mystery_box_cleanup.test.js`

- [ ] Write failing tests for parsing `<mysteryThreads>` cleanup XML, applying resolved thread/box ids, and rendering cleanup prompt ids.
- [ ] Run `node --test tests/mystery_box_cleanup.test.js` and verify the tests fail because helpers do not exist or prompt context is missing.
- [ ] Implement `Events._parseMysteryBoxCleanupResponse(...)`, `Events._applyMysteryBoxCleanupResult(...)`, and a prompt helper/context shape that includes active threads plus unresolved boxes.
- [ ] Re-run `node --test tests/mystery_box_cleanup.test.js` and verify the focused tests pass.

### Task 2: Config And Periodic Runner

**Files:**
- Modify: `config.default.yaml`
- Modify: `server.js`
- Modify: `api.js`
- Test: `tests/mystery_box_cleanup.test.js`

- [ ] Add failing tests for `mystery_box_cleanup.interval` default/validation and source-level periodic scheduling hooks.
- [ ] Run `node --test tests/mystery_box_cleanup.test.js` and verify the new tests fail.
- [ ] Add `mystery_box_cleanup.interval: 10`, validate it in `server.js`, add an interval resolver/counter in `api.js`, schedule cleanup on eligible player-action turns, and persist/load the counter in save metadata.
- [ ] Re-run `node --test tests/mystery_box_cleanup.test.js` and verify it passes.

### Task 3: Slash Command

**Files:**
- Create: `slashcommands/resolve_mystery_threads.js`
- Modify: `api.js`
- Test: `tests/resolve_mystery_threads_command.test.js`

- [ ] Write failing command tests for registration, runner invocation, resolved output formatting, no-op output, and missing runner failure.
- [ ] Run `node --test tests/resolve_mystery_threads_command.test.js` and verify the tests fail.
- [ ] Add the slash command and expose `interaction.runMysteryBoxCleanupPrompt(...)` from the slash-command interaction builder.
- [ ] Re-run `node --test tests/resolve_mystery_threads_command.test.js` and verify it passes.

### Task 4: Documentation And Verification

**Files:**
- Modify: `docs/config.md`
- Modify: `docs/classes/Events.md`
- Modify: `docs/classes/MysteryBox.md`
- Modify: `docs/classes/MysteryThread.md`
- Modify: `docs/slash_commands.md`
- Create: `docs/slashcommands/ResolveMysteryThreadsCommand.md`
- Modify: `docs/README.md`

- [ ] Update docs to describe the cleanup config, prompt, periodic cadence, parser/apply behavior, and slash command.
- [ ] Run syntax checks for changed JavaScript files.
- [ ] Run focused tests:

```bash
node --test tests/mystery_box_cleanup.test.js tests/resolve_mystery_threads_command.test.js
```

- [ ] Run any affected existing tests:

```bash
node --test tests/mystery_threads_config.test.js tests/mystery_thread_check_prompt.test.js tests/events.xml_event_parser.test.js tests/housekeeping_command.test.js
```
