# Regen Party Images Design

> **Archive status:** Implemented. This file preserves the design intent and summarizes the current implementation. Current command usage details live in `docs/slashcommands/RegenPartyImagesCommand.md`; the historical implementation checklist lives in `docs/superpowers/plans/2026-06-05-regen-party-images.md`.

## Goal

`/regen_party_images` queues forced portrait regeneration for every current party NPC while excluding the player character and other non-NPC party entries.

## Implemented Behavior

The command lives in `slashcommands/regen_party_images.js` and follows existing slash-command conventions.

- Resolves the invoking player from `interaction.currentPlayer`, or from `Globals.playersById` using `interaction.user.id`.
- Reads party member ids from `currentPlayer.getPartyMembers()` when available, otherwise from `currentPlayer.partyMembers` as a `Set` or array.
- Trims string ids, ignores blank and duplicate ids, resolves each remaining id through `Globals.playersById`, and keeps only resolved members with `isNPC`.
- Reports missing party ids and non-NPC party entries as skipped rather than sending them to image generation.
- Requires `interaction.generatePlayerImage` and throws `Portrait image generation helper is unavailable in slash-command context.` if the slash-command context does not provide it.
- Calls `interaction.generatePlayerImage(member, { force: true, clientId })` concurrently for each eligible NPC. `clientId` is the trimmed invoking client id or `null`.

The command intentionally does not duplicate portrait prompt or image-job logic. `api.js` exposes the shared `generatePlayerImage` helper to the slash-command interaction context, and `server.js` owns the image pipeline. That shared path handles forced portrait regeneration, active image-job joining, in-progress portrait-prompt joining, realtime job subscription, generation skip reasons, and LLM-authored portrait prompt batching.

`imagegen.prompt_batching` applies to the LLM prompt-writing step only. Compatible party portrait prompt requests can batch, but final portrait image-rendering jobs still queue per NPC.

## Responses

When at least one eligible NPC is processed, the command replies publicly with `## Party Portrait Regeneration` followed by whichever result groups are non-empty:

- `Queued portraits`
- `Joined existing portrait jobs`
- `Skipped party entries`
- `Failed portraits`

When no NPC party members are available, the command replies publicly with `No NPC party members are available for portrait regeneration.` If every party entry was skipped before generation, the no-NPC reply also includes the skipped entries.

## Testing

Focused `node:test` coverage lives in `tests/regen_party_images_command.test.js`. It covers command registration, NPC-only filtering, skipped missing/non-NPC entries, forced generator calls with `clientId`, empty-party replies, concurrent request startup for prompt batching, and fail-loud behavior when the image helper is unavailable.
