# RegenPartyImagesCommand

## Purpose

`/regen_party_images` queues portrait regeneration for every current party NPC, excluding the player character.

## Usage

```text
/regen_party_images
```

## Behavior

- Resolves the current player from the slash-command interaction context.
- Reads the current player's party member ids.
- Regenerates portraits only for resolved NPC party members.
- Skips missing entries and non-NPC/player entries.
- Calls the shared portrait generator with `force: true`, so existing NPC portrait references are cleared while new jobs are queued.
- Passes the invoking `clientId` through to the image job path so realtime job updates can attach to the invoking tab.
- Reuses the existing `generatePlayerImage` portrait path. When `imagegen.prompt_batching.enabled` is true, the LLM-authored portrait prompt generation step can batch compatible party portrait requests before the final image jobs are queued individually.

## Replies

The command returns a markdown summary listing queued portraits, joined in-progress portrait jobs, skipped entries, and failed entries.

If the party has no NPC members, it replies:

```text
No NPC party members are available for portrait regeneration.
```
