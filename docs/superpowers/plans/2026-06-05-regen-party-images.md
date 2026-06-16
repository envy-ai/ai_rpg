# Regen Party Images Implementation Archive

> **Archive status:** Implemented. This document preserves the historical plan and task structure for reference. Current command behavior is documented in `docs/slashcommands/RegenPartyImagesCommand.md`; the design summary remains in `docs/superpowers/specs/2026-06-05-regen-party-images-design.md`.

**Goal:** Build `/regen_party_images` so it queues portrait regeneration for every party NPC and excludes the player.

**Current architecture:** `slashcommands/regen_party_images.js` resolves the current player from `interaction.currentPlayer` or `interaction.user.id` plus `Globals.playersById`, reads party member ids from `getPartyMembers()` or `partyMembers`, trims and de-duplicates ids, resolves each member through `Globals.playersById`, and keeps only NPCs. It calls `interaction.generatePlayerImage(member, { force: true, clientId })` concurrently for eligible NPCs.

`api.js` exposes `generatePlayerImage` through the slash-command interaction context. The shared generator in `server.js` handles forced regeneration, existing job joining, in-progress prompt generation joining, realtime job subscription, image-generation skip reasons, and the portrait prompt batching path.

**Tech Stack:** Node.js, existing slash-command registry, existing `Player`/`Globals` registries, `node:test`.

---

### Task 1: Command Behavior Tests

**Files:**
- `tests/regen_party_images_command.test.js`
- `slashcommands/regen_party_images.js`

- [x] Tests build a fake interaction with `currentPlayer`, `clientId`, `generatePlayerImage`, and `reply`.
- [x] Assert the command is registered as `/regen_party_images`.
- [x] Assert only NPC ids from the current party are sent to `generatePlayerImage`; non-NPC and missing ids are reported as skipped.
- [x] Assert each generator call receives `{ force: true, clientId }`.
- [x] Assert an empty party replies without invoking the generator.
- [x] Assert missing `generatePlayerImage` throws `Portrait image generation helper is unavailable in slash-command context.`
- [x] Assert party portrait requests start concurrently so compatible prompt requests can batch.
- [x] Focused verification command: `node --test tests/regen_party_images_command.test.js`.

### Task 2: Command Implementation

**Files:**
- `slashcommands/regen_party_images.js`
- `api.js`

- [x] Implement `RegenPartyImagesCommand` with no args and description `Regenerate portraits for every current party NPC.`
- [x] Resolve the current player from `interaction.currentPlayer`, then `interaction.user.id` plus `Globals.playersById`; throw `Current player is unavailable for party portrait regeneration.` when unresolved.
- [x] Resolve party member ids through `Globals.playersById`, ignore blank or duplicate ids, and filter to `isNPC`.
- [x] Call `interaction.generatePlayerImage(member, { force: true, clientId })` concurrently, using a trimmed client id or `null`.
- [x] Summarize queued, joined-existing, skipped, and failed entries in a public markdown reply. Missing member ids are included in skipped entries.
- [x] Add `generatePlayerImage` to `buildSlashCommandInteractionContext` in `api.js`.
- [x] Focused verification command: `node --test tests/regen_party_images_command.test.js`.

### Task 3: Documentation And Verification

**Files:**
- `docs/slashcommands/RegenPartyImagesCommand.md`
- `docs/README.md`
- `docs/slash_commands.md`

- [x] `docs/slashcommands/RegenPartyImagesCommand.md` documents `/regen_party_images`, including player exclusion, skipped entries, forced generation, existing job joining, and reuse of prompt batching.
- [x] `docs/README.md` indexes the command doc and this archive plan in the current documentation map.
- [x] `docs/slash_commands.md` lists `/regen_party_images` and includes `interaction.generatePlayerImage` in the interaction helper reference.
- [x] JavaScript syntax check target: `node --check slashcommands/regen_party_images.js`.
- [x] Focused test target: `node --test tests/regen_party_images_command.test.js`.

## Current Notes For Future Work

- Treat this file as an archive, not an active implementation checklist.
- Keep current command usage details in `docs/slashcommands/RegenPartyImagesCommand.md`.
- If `generatePlayerImage` changes its result shape or skip reasons, update the command doc first and then adjust this archive only if the historical/current distinction becomes misleading.
