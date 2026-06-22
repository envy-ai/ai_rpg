# base_context_relationships.js

`base_context_relationships.js` builds prompt-facing relationship summaries for characters included in base context. It converts persisted `Player.relationships` maps from id-keyed storage into short name-keyed lines that are easier for prompts to use.

## Exported Helpers

- `buildActorRelationshipPromptContext({ actor, playersById, listedCharacterIds })`: returns `{ relationships, reciprocalRelationships }` for one actor.

## Output Shape

- `relationships`: outgoing directed labels from the actor to other characters. Each entry contains `targetId`, resolved `name`, and `label`.
- `reciprocalRelationships`: incoming directed labels from characters outside the current listed prompt cast. Each entry contains `sourceId`, resolved `name`, and `label`.

Missing target ids are rendered with the raw id as the name so bad or stale relationship data is visible during prompt review rather than hidden.

## Base-Context Rules

`server.js` calls the helper while building `currentPlayer`, current-location NPCs, and party members for `prompts/base-context.xml.njk`.

The template renders non-empty sections as:

```xml
<relationships>
  <!-- This is how this character relates to other characters -->
  Bob: father
</relationships>
<reciprocalRelationships>
  <!-- This is how other characters relate to this character -->
  Alice: bitter rival
</reciprocalRelationships>
```

Empty relationship sections are omitted. Reciprocal relationships from characters already listed in the scene, party, or player record are also omitted because those characters render their own outgoing relationship sections.

## Validation

The helper expects `playersById` to be a `Map`. Relationship entries must have non-empty string ids and labels; malformed relationship payloads throw instead of silently disappearing.
