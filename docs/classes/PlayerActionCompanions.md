# PlayerActionCompanions

`PlayerActionCompanions.js` owns the exact-identifier contract for characters who accompany the player during a TinyBrain-resolved move.

## Candidate collection

`collectPlayerActionAccompanyingCharacters({ currentPlayer, location, players })` returns living NPCs eligible to leave the movement origin with the player:

- current party members, including the normal off-location party representation;
- living NPCs registered in the origin location's `npcIds` list.

The player, dead characters, remote non-party NPCs, and missing actor records are excluded or rejected. Each candidate is represented as `{ name, aliases }`. Canonical names and aliases are compared as trimmed, case-insensitive, complete identifiers. Partial-name matching is not used. Distinct candidates must have distinct canonical names, but shared aliases are allowed in the candidate list so unrelated NPCs with a naturally duplicated alias cannot prevent the player-action prompt from rendering.

Player-action base prompt records retain an authoritative `isDead` flag for local NPCs and party members. Both the staged TinyBrain and monolithic player-action templates exclude dead actors from the “present and aware” response roster and its character-AI-note list. This does not remove them from the base world/party context: a persistent dead party member remains available as dead-state context but cannot be proposed as a responding actor. The separate movement-candidate collector continues to enforce the same living-only rule before parsing an accompanying-character selection.

## Selection normalization

`normalizePlayerActionAccompanyingCharacterSelection(characterNames, allowedCharacters)` accepts an array of exact canonical names or aliases and returns canonical names. Unknown identifiers, an alias shared by multiple candidates, and selecting the same character more than once—such as once by name and once by alias—throw before movement is applied. A shared alias therefore fails only when the model actually selects that ambiguous alias; either candidate remains selectable by its full canonical name.

## Movement

`movePlayerActionAccompanyingCharacters(...)` validates the entire selection against the original movement location before mutating state. It then removes every selected actor from location NPC lists and applies the destination according to existing party invariants:

- selected party members retain party membership, keep `currentLocation` cleared, and are not inserted into the destination `npcIds` list;
- selected non-party NPCs retain non-party status, receive the player's destination as `currentLocation`, and are added to the destination `npcIds` list.

This module deliberately does not recruit or dismiss anyone. Player-action event checks remain the authority for party-membership changes.
