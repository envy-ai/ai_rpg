# RegenPartyImagesCommand

## Purpose

`/regen_party_images` queues forced portrait regeneration for each unique NPC in the invoking player's current party.

## Usage

```text
/regen_party_images
```

## Behavior

- Resolves the current player from `interaction.currentPlayer`, or from `Globals.playersById` using `interaction.user.id`.
- Throws `Current player is unavailable for party portrait regeneration.` when no current player can be resolved.
- Reads party member ids from `currentPlayer.getPartyMembers()` when available, otherwise from `currentPlayer.partyMembers` as a `Set` or array.
- Trims string ids, ignores blank ids, and ignores duplicate ids.
- Resolves party member ids through `Globals.playersById`.
- Keeps only resolved party members with `isNPC`; missing ids and non-NPC entries are reported as skipped.
- Requires `interaction.generatePlayerImage` and throws `Portrait image generation helper is unavailable in slash-command context.` when the helper is unavailable.
- Calls `interaction.generatePlayerImage(member, { force: true, clientId })` concurrently for each eligible NPC. `clientId` is the trimmed invoking client id, or `null`.
- Uses the shared portrait generator, so `force: true` clears an NPC's current `imageId` before queuing a replacement portrait job.
- Joins and subscribes the invoking client to active portrait jobs or in-progress portrait prompt generation for the same NPC.
- Shares the normal image-generation skip paths from `generatePlayerImage`, including inactive setting, disabled image generation, missing image client, and image-prompt generation failure.
- Allows compatible party portrait prompt requests to batch through `generateImagePromptFromTemplate` when `imagegen.prompt_batching.enabled` is not `false` and `imagegen.prompt_batching.max_items` is greater than `1`. Final portrait image jobs are still queued per NPC.

## Replies

The command replies publicly with a markdown summary headed `## Party Portrait Regeneration` when at least one eligible NPC is processed. The summary includes any non-empty result groups:

- `Queued portraits`
- `Joined existing portrait jobs`
- `Skipped party entries`
- `Failed portraits`

If the party has no NPC members, it replies:

```text
No NPC party members are available for portrait regeneration.
```

When every party entry is skipped before generation, the no-NPC reply also includes a `Skipped party entries` line.
