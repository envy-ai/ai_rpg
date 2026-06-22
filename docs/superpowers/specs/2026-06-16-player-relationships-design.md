# Player Relationships Design

## Goal

Add sparse, persisted character-to-character relationship labels to `Player` so the game can track semantic relationship edges and later render a Cytoscape relationship web.

## Data Shape

Each `Player` stores `relationships` as an object map keyed by another character's stable id:

```json
{
  "char_2": "old rival",
  "char_7": "trusted patron"
}
```

The value is a non-empty string with at most six whitespace-delimited words. Invalid shapes, empty target ids, self-references, non-string labels, and labels over six words raise explicit errors. Missing data hydrates as an empty map for old saves.

## Model Behavior

`Player` owns normalization and mutation helpers:

- `get relationships`
- `getRelationships()`
- `getRelationship(targetCharacter)`
- `setRelationships(mapOrObject)`
- `setRelationship(targetCharacter, label)`
- `removeRelationship(targetCharacter)`

Relationship keys use `Player.resolvePlayerId(...)`, matching existing actor-reference helpers. Returned objects are clones so callers cannot mutate private state by reference.

## Runtime Surfaces

`relationships` is included in `Player.toJSON()`, `Player.fromJSON(...)`, `Player.getStatus()`, and `serializeNpcForClient(...)`. The existing `updateCharacterFields` and `updateObjectFields` character path can update `relationships` as a whole-field replacement.

This design does not add the graph UI yet. It prepares a clean data source for a future Cytoscape relationship web using the same graph library as the map.

## Testing

Add focused Node tests for model persistence, cloning, mutation helpers, validation failures, client serialization exposure, and chat-tool mutation.

## Documentation

Update `docs/classes/Player.md`, `docs/api/players.md`, and `docs/README.md`.
