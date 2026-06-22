# ClearRelationshipsCommand

## Purpose
Slash command `/clear_relationships` removes every currently stored character relationship edge from all loaded player/NPC records.

## Aliases
- None.

## Args
- None.

## Behavior
- Reads all loaded characters from `Player.getAll()`.
- Counts relationship edges from each character's `getRelationships()` result.
- Leaves world state unchanged and skips saving when no relationships exist.
- Calls `setRelationships({})` on each character with at least one relationship edge.
- Persists the cleared relationship state with `performGameSave()`.
- Requests a relationship graph refresh with `relationshipGraphRefreshRequested: true` when the slash-command interaction supports client refresh requests.
- Replies publicly with the number of cleared relationship edges and affected characters.

## Error and Empty States
- If no relationship edges exist, replies publicly: `No current relationships are recorded.`
- If the player registry, relationship accessors, or save helper is unavailable, command execution throws a clear error instead of treating the cleanup as successful.
- The command checks for a save helper before mutating any relationship maps, so it does not knowingly create unsaved relationship changes.

## Registration
- `SlashCommandRegistry` auto-loads the command from `slashcommands/clear_relationships.js`.
- `/help` lists the canonical `/clear_relationships` command.
