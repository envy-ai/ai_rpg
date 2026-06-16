# Attributes API

Read-only metadata for character attributes.

## GET /api/attributes

Returns the attribute definition map and any attribute-generation metadata exposed by the active player definitions.

Request:
- No params
- No body

Response:
- 200:
  ```json
  {
    "success": true,
    "attributes": {
      "strength": {
        "label": "Strength",
        "abbreviation": "STR",
        "description": "A measure of your physical power.",
        "default": 10
      }
    },
    "generationMethods": {},
    "systemConfig": {}
  }
  ```

Fields:
- `attributes`: object keyed by attribute id. Entries come from the loaded `Player` attribute definitions and may include `label`, `abbreviation`, `description`, `default`, and any other definition fields.
- `generationMethods`: `systemConfig.generationMethods` from the attribute definitions, or `{}` when none are defined.
- `systemConfig`: the `system` section from the attribute definitions, or `{}` when none is defined.

Definition source:
- When a current player exists, the route uses `currentPlayer.attributeDefinitions`, `currentPlayer.getGenerationMethods()`, and `currentPlayer.systemConfig`.
- When no current player exists, the route creates a temporary `Player` and returns the same metadata from that instance.
- `Player` loads `defs/attributes.yaml` through `DefinitionLoader.loadMergedDefinitionFile(...)`, so enabled mod definition overlays can affect the returned definitions. The base project definitions are `strength`, `dexterity`, `constitution`, `intelligence`, `wisdom`, `charisma`, and `luck`.

Errors:
- The served handler has no route-specific `try/catch`. Attribute definition load failures inside `Player` are logged and use Player's built-in basic definitions. Other unexpected failures use Express error handling rather than an endpoint-specific JSON error shape.

Compatibility note:
- `api.js` also registers a second `GET /api/attributes` handler later in route order. Express serves the first matching handler, so API clients receive the object-map response documented above.
- The later handler is not reachable through normal routing. If it were served, it would return `{ success: true, attributes: Array<{ key, label, description, abbreviation }> }` and route-specific JSON 500 errors. Clients that need that simplified list should derive it from the active `attributes` object.

Related behavior:
- Player attribute values are returned by player/NPC profile endpoints; this endpoint only returns definitions and generation metadata.
- Player attribute mutation is handled by `/api/player/attributes` and `/api/player/update-stats`.
- Settings hide/perception selectors load the same merged `attributes.yaml` definitions directly and pair them with `defaultExistingSkills` from settings/default-skill flows; `/api/attributes` does not return default skill options.
