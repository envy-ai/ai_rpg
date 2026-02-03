# ShortDescriptionCheckCommand

## Purpose
Slash command `/short_description_check` to list regions, locations, things, and character abilities missing short descriptions.

## Args
- None.

## Behavior
- Collects all regions, locations (including stubs), things, and player/NPC abilities.
- Reports entries whose `shortDescription` is empty or missing.
- Outputs full names, marking stubs and including owner names for abilities.

## Notes
- Uses location `stubMetadata.shortDescription` when present to avoid flagging stubbed locations that already have a short description.
