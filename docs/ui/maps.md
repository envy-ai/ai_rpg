# Maps (Region + World)

Two map views exist on the chat page: the Region Map and the World Map.

## Region map (public/js/map.js)
Rendered inside `#mapContainer` in the Map tab.

### Data source
- `GET /api/map/region` (optional `?regionId=...`) returns the region, its locations, and exits.

### Rendering model
- Uses Cytoscape for graph rendering.
- Nodes represent locations; classes include:
  - `current` (active location),
  - `visited`,
  - `stub` (unexpanded stub).
- Edges represent exits. Bidirectional edges get a `bidirectional` class.
- Region exits are rendered as separate "exit nodes" with an icon and dashed styling.

### Interactions
- Context menu on nodes and edges for edit/delete actions.
- Link mode for creating new exits (ghost node + edge).
- New exits call `POST /api/locations/:id/exits` with payload:
  - region/location target, optional relative level, optional image data.
- Exit deletions call `DELETE /api/locations/:id/exits/:exitId`.
- Stub expansion hits `/api/stubs/:stubId` (GET/POST) to fill in stub regions/locations.

### Cross-component hooks
- `openNewExitModalFromMap` is provided by the inline script in `views/index.njk`.
- `renderEntityImage` is used for node image overlays when available.

## World map (public/js/world-map.js)
Rendered inside `#worldMapContainer` in the World Map tab.

### Data source
- `GET /api/map/world` returns regions, locations, and edges.

### Rendering model
- Cytoscape graph with:
  - region labels,
  - region group nodes,
  - location nodes,
  - region exit nodes.
- Convex hull overlays are drawn around region groupings using
  `public/js/cytoscape-convex-hull.js`.
- `window.adjustBubblePadding()` can tweak hull padding and corner radius.

## Styling
- Shared container styling is in `public/css/map.css`.
- Per-node styling is in `public/js/map.js` and `public/js/world-map.js`
  (Cytoscape style definitions).
