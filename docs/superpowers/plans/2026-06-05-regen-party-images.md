# Regen Party Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/regen_party_images` so it queues portrait regeneration for every party NPC and excludes the player.

**Architecture:** Add one slash-command module that resolves the current party and calls the existing portrait generator concurrently. Expose `generatePlayerImage` through the slash-command interaction context so command code can reuse image prompt batching, force regeneration, de-dupe, and job tracking.

**Tech Stack:** Node.js, existing slash-command registry, existing `Player`/`Globals` registries, `node:test`.

---

### Task 1: Command Behavior Tests

**Files:**
- Create: `tests/regen_party_images_command.test.js`
- Create: `slashcommands/regen_party_images.js`

- [ ] Write tests that build a fake interaction with `currentPlayer`, `clientId`, `generatePlayerImage`, and `reply`.
- [ ] Assert the command is registered as `/regen_party_images`.
- [ ] Assert only NPC ids returned by `currentPlayer.getPartyMembers()` are sent to `generatePlayerImage`.
- [ ] Assert each generator call receives `{ force: true, clientId }`.
- [ ] Assert an empty party replies without invoking the generator.
- [ ] Assert missing `generatePlayerImage` throws `Portrait image generation helper is unavailable in slash-command context.`
- [ ] Run `node --test tests/regen_party_images_command.test.js` and confirm the new command tests fail before implementation.

### Task 2: Command Implementation

**Files:**
- Create: `slashcommands/regen_party_images.js`
- Modify: `api.js`

- [ ] Implement `RegenPartyImagesCommand` with no args and description `Regenerate portraits for every current party NPC.`
- [ ] Resolve the current player from `interaction.currentPlayer`, then `interaction.user.id` plus `Globals.playersById`.
- [ ] Resolve party member ids through `Globals.playersById` and filter to `isNPC`.
- [ ] Call `interaction.generatePlayerImage(member, { force: true, clientId: interaction.clientId || null })` concurrently.
- [ ] Summarize queued, existing, skipped, failed, and unresolved entries in a markdown reply.
- [ ] Add `generatePlayerImage` to `buildSlashCommandInteractionContext` in `api.js`.
- [ ] Run `node --test tests/regen_party_images_command.test.js` and confirm it passes.

### Task 3: Documentation And Verification

**Files:**
- Create: `docs/slashcommands/RegenPartyImagesCommand.md`
- Modify: `docs/README.md`
- Modify: `docs/slash_commands.md`

- [ ] Document `/regen_party_images`, including player exclusion and reuse of image prompt batching.
- [ ] Add the new command doc to `docs/README.md`.
- [ ] Update the slash-command guide interaction helper list to mention `interaction.generatePlayerImage`.
- [ ] Run syntax checks for changed JavaScript files.
- [ ] Run the focused command test again.
