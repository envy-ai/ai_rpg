# Regen Party Images Design

## Goal

Add `/regen_party_images` to queue portrait regeneration for every current party NPC, excluding the player character.

## Design

The command lives in `slashcommands/regen_party_images.js` and follows existing slash-command conventions. It resolves the invoking player from `interaction.currentPlayer` or `interaction.user.id`, reads `getPartyMembers()`, resolves each id through `Globals.playersById`, and keeps only valid NPC party members. It calls the shared portrait generator with `{ force: true, clientId: interaction.clientId }` for each member.

The command does not duplicate portrait prompt or image-job logic. The existing `generatePlayerImage` path already handles force regeneration, in-progress job joining, realtime subscription, and the batched LLM portrait-prompt pathway controlled by `imagegen.prompt_batching`.

## Responses

The command reports queued portraits, joined in-progress jobs, skipped members, and failed members by name. No party members produces a normal non-ephemeral reply.

## Testing

Add focused `node:test` coverage for registration, excluding non-NPC/player ids, passing `force: true` and `clientId`, reporting empty parties, and surfacing missing generator helpers loudly.
