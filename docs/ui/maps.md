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
- Vehicle-capable location nodes get a centered emoji overlay from `vehicleInfo.icon` (fallback `🚗`).
- Edges represent exits. Bidirectional edges get a `bidirectional` class.
- Region exits are rendered as separate "exit nodes" with an icon and dashed styling.
  - Only inbound vehicle region-exit nodes get a centered vehicle emoji overlay.
  - Outbound vehicle exits (leaving a vehicle context) keep the standard region-exit symbol and do not get a fallback car overlay when icon metadata is missing.

### Interactions
- Context menu on nodes and edges for edit/delete actions.
- Tapping a location node fast-travels the player there through the existing player-teleport flow, but now also advances world time by the shortest directed route cost computed from stored exit `travelTimeMinutes`; when minutes advance, the chat history gets an event-summary entry reading `Traveled from X to Y. Z passed.`. When no route exists, the map fast travel still completes with `0` minutes elapsed.
- Stub node `Edit stub` opens the shared location-stub editor, including vehicle metadata controls (`isVehicle` + `vehicleInfo`) for both location stubs and region-entry stubs; the vehicle-exit field is a select labeled `inside -> outside`.
- Hydrated location node context menu includes `Delete Location`, which confirms a destructive warning and then calls location cascade deletion (items/NPCs, exits to/from, then location).
- Link mode for creating new exits (ghost node + edge).
- New exits call `POST /api/locations/:id/exits` with payload:
  - region/location target, optional relative level, optional image data.
  - Shift-drag map creation for new location stubs requests `bidirectional: true` so the created connection is two-way.
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
- Vehicle-capable location nodes and vehicle region labels get centered emoji overlays from vehicle icon metadata.
- Convex hull overlays are drawn around region groupings using
  `public/js/cytoscape-convex-hull.js`.
- `window.adjustBubblePadding()` can tweak hull padding and corner radius.

## Styling
- Shared container styling is in `public/css/map.css`.
- Per-node styling is in `public/js/map.js` and `public/js/world-map.js`
  (Cytoscape style definitions).
