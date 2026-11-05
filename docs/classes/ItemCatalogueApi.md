# ItemCatalogueApi

`ItemCatalogueApi.js` registers `GET /api/item-catalogue` through `api.js`.
It reads the current game's already stored catalogue without scanning live Things,
discovering hidden items, generating definitions, or changing game state.

The response is `{ success: true, generation, definitions, families,
rarityDefinitions }`. Definitions and families are detached copies supplied by
[ItemCatalogue](ItemCatalogue.md); rarity definitions follow the configured native
rarity order. `generation` changes when the catalogue resets or hydrates and lets
the browser discard selections from a replaced game. Responses use `Cache-Control:
no-store`.

No loaded game returns HTTP 409 with `{ success: false, code:
"GAME_NOT_LOADED", error }`. Unexpected read errors return HTTP 500 with the
original `error` and `stack`. There are no catalogue mutation endpoints.

This world reference includes stored definitions independently of player knowledge
and surviving item ownership. It conveys no crafting recipe knowledge. Observed
snapshots retain recorded-level mechanics; standard family variants retain raw
bonuses for the native materialization path.
