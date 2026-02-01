# Attributes API

These routes are both defined in `api.js`. Express binds the **first** definition, so the second is currently unreachable unless the duplication is removed.

## GET /api/attributes (definition 1 - active)
Returns attribute definitions and generation metadata.

Request:
- No params

Response:
- 200: `{ success: true, attributes, generationMethods, systemConfig }`
  - When no current player exists, a temporary `Player` instance is created to supply these values.
- 500 not used here; errors are not explicitly handled.

## GET /api/attributes (definition 2 - unreachable)
Returns a simplified list of attribute definitions.

Request:
- No params

Response:
- 200: `{ success: true, attributes: Array<{ key, label, description, abbreviation }> }`
- 500: `{ success: false, error, details }`

Notes:
- This definition appears later in `api.js`, so it is shadowed by the first route and will not be served unless the duplication is resolved.
