# PlayerActionCompanions

`PlayerActionCompanions.js` owns the exact-identifier contract for characters who accompany the player during a TinyBrain-resolved move.

The module also builds the read-only local character descriptor used by the TinyBrain hidden-contest parser. `collectPlayerActionHiddenContestContext(...)` returns the current player plus living party/local NPCs with canonical ids, names, aliases, NPC identity, and current `hiddenFromPlayer` state. The parser—not free-form prose matching—uses that descriptor to validate reveal and hide plans before code resolves their mechanics.

`resolvePreResolvedPlayerActionHiddenContestToolCall(...)` recognizes a later opposed-check call only when its actor (when supplied), opponent, configured skill, and configured attribute semantics identify one already-resolved hidden contest. Exact canonical names, aliases, ids, and the usual player aliases are accepted. An omitted actor is inferred only when the other mechanics select exactly one contest; ambiguity throws. A match returns a cloned authoritative result marked so the generic check-results recorder does not create a second history row. Unrelated opposed checks continue through the ordinary resolver.

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

## Follow-Up Watch Item

Companion movement may be inferred when the player action and evolving draft reasonably establish that an eligible character travels with the player; explicit agreement is not required. This preserves useful narrative movement and NPC agency. Revisit this policy only if future live prose produces recurring material movement/bookkeeping mismatches, and prefer a structured selection or state-boundary correction over inspecting or mechanically classifying free-form prose.
