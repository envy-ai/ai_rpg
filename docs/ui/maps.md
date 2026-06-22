# Maps (Region + World)

The chat page exposes a Region Map tab, a World Map tab, and a Favorites tab that reuses the shared map-travel helper. The map graph endpoints are read-only; editing, travel, and stub expansion go through the same route groups and inline helpers used by the Adventure UI.

The Relationships tab uses the same Cytoscape vendor stack for character relationship rendering; its behavior is documented separately in `docs/ui/relationships.md`.

## Entry points

- `views/index.njk` defines the Map, World Map, and Favorites tab panels, the floating map-location context menu, the Set Last Seen modal, the fast-travel confirmation modal, tab activation, and `window.openNewExitModalFromMap`.
- `public/js/map.js` owns Region Map Cytoscape rendering and region-map-specific interactions.
- `public/js/world-map.js` owns World Map Cytoscape rendering and world-map-specific interactions.
- `public/js/chat.js` refreshes the active Region Map in response to realtime exit creation/deletion events from other clients and builds `new_exit_discovered` summary rows with map-navigation metadata.

## Region Map

Rendered inside `#mapContainer` in the Map tab.

### Data source

- `GET /api/map/region` returns the active player's region map.
- `GET /api/map/region?regionId=<id>` returns a specific live region without requiring an active player.
- The response shape is `{ success: true, region: { regionId, regionName, currentLocationId, locations } }`. Each location summary includes `id`, `name`, `isStub`, `isVehicle`, `vehicleIcon`, `visited`, `favorite`, `regionId`, `exits`, and optional `image`.

### Rendering model

- Cytoscape renders location nodes, internal exit edges, region-exit bubbles, and vehicle overlay nodes.
- Location nodes use `current`, `visited`, and `stub` classes. Visited nodes with image URLs render the location image as the node background.
- Internal exits are edges between locations in the loaded region. Reverse edges collapse into one edge with the `bidirectional` class.
- Region exits render as `region-exit-<exitId>` bubbles when an exit has a `destinationRegion` outside the loaded region. Expanded region exits show an arrow symbol and can be tapped to load the target region; unexpanded region exits show a question mark and dashed styling.
- Vehicle-capable location nodes get a centered emoji overlay from `vehicleIcon` or the default car icon.
- Vehicle region-exit overlays are only rendered for inbound vehicle exits with explicit icon metadata. Outbound vehicle exits keep the standard region-exit symbol. Ordinary exits inside the same vehicle region suppress the containing-region vehicle icon, matching the Adventure exit list.
- Vehicle exits tied to an underway vehicle or an ETA-reached vehicle with a pending destination are omitted by the map payload.
- `loadRegionMap(regionId, options)` supports focus options such as `focusLocationId`, `destinationId`, `focusExitId`, and `exitId`. After layout, `focusRegionMapNode` centers the matching location or region-exit bubble and applies the `map-focus` class.

### Interactions

- Tapping a visited, non-current location calls `window.travelToAdjacentLocationFromMap(locationId)`.
- Tapping an expanded region-exit bubble calls `loadRegionMap(targetRegionId)`.
- Right-clicking a hydrated location opens the shared floating location menu with Edit Location, Edit Region, Edit Weather, Edit Calendar, Set Last Seen, Summon NPC, Summon Item/Scenery, Upload Image, Regenerate Image, Regenerate Image +, and Delete Location actions. `Regenerate Image +` generates the final prompt, opens the shared prompt-edit modal, and only queues image rendering after confirmation. Stub locations hide region/weather/calendar/regenerate/delete actions in that shared menu and expose Unstub.
- The Set Last Seen map action opens the shared modal and submits `/set_last_seen <location> <time>` through `AIRPG_CHAT.executeSlashCommand`. Accepted time text matches the slash command guidance: exact `H AM/PM`, exact `H:MM AM/PM`, or relative durations such as `2 hours ago`.
- Right-clicking a stub node in the Region Map opens a compact map menu with Unstub, Edit stub, and Delete stub. Unstub calls `POST /api/stubs/:id/expand`; Edit stub opens `window.openStubEditModal(stubId)`; Delete stub calls `DELETE /api/stubs/:id`.
- The shared stub editor exposes vehicle metadata controls (`isVehicle` and `vehicleInfo`) for location stubs and region-entry stubs. Ordinary location stubs also expose a Region selector and can move between live or pending regions. Region-entry stubs hide that selector because their target region is fixed.
- Right-clicking an edge opens a compact menu for deleting the exit. Deletion calls `DELETE /api/locations/:id/exits/:exitId`.
- Shift-dragging from a location enters link mode. Dropping on another location creates an exit with `POST /api/locations/:id/exits` and payload `{ type: "location", locationId }`. Dropping on empty space opens the New Exit modal in map mode with origin/preferred region context; map-mode location creation sends `bidirectional: true`.
- Discovered-exit summary map pills dispatch `airpg:new-exit-summary-selected`; the handler opens the origin region's map and focuses the discovered destination location or `region-exit-<exitId>` bubble.

## World Map

Rendered inside `#worldMapContainer` in the World Map tab.

### Data source

- `GET /api/map/world` returns `{ success: true, world: { currentLocationId, regions, locations } }` with `cache: "no-store"` on the client.
- Region summaries include `id`, `name`, `parentRegionId`, `isVehicle`, `vehicleIcon`, `isStub`, `locationIds`, `locationCount`, `averageLevel`, and computed `childRegionIds`.
- Location summaries use the same map-location shape as the Region Map.

### Rendering model

- Cytoscape renders region label nodes, region group nodes, location nodes, internal location edges, orphan exit bubbles, vehicle overlay nodes, and convex hull overlays.
- Region labels are clickable and positioned over their member locations after layout. Clicking a region label activates the Region Map tab for that region.
- Location nodes use `location-node`, `visited`, `stub`, and `current` classes. Visited nodes with images render those images as node backgrounds.
- Internal location edges collapse reverse edges into one `bidirectional` edge.
- Orphan exit bubbles represent exits from grouped locations to mapped locations whose region is not represented by a world-map group node.
- Vehicle-capable location nodes and vehicle region labels get centered emoji overlays from `vehicleIcon` or the default car icon.
- Convex hull overlays come from `public/js/cytoscape-convex-hull.js`. Hull membership includes parent-region ancestry, and `window.adjustBubblePadding(padding, cornerRadius)` updates hull padding/corner radius and silently reloads the World Map.

### Interactions

- Tapping a visited, non-current location starts the shared map fast-travel flow and focuses Adventure as soon as the Travel confirmation is accepted.
- Right-clicking a location node opens the same shared floating location menu used by the Region Map.
- The World Map Reload button calls `window.loadWorldMap()`.

## Shared Map Travel

Region Map, World Map, and Favorites use `window.travelToAdjacentLocationFromMap(locationId)` from `views/index.njk`.

Flow:
- Fetch `GET /api/player/fast-travel-preview?destinationId=<id>` to compute shortest-route travel time without moving the player.
- Open `#mapFastTravelConfirmModal`, display the destination and travel time, and leave the editable player-action prompt blank by default.
- Focus the Adventure tab as soon as the Travel confirmation is accepted.
- If the confirmed action text is nonblank, dispatch it through `AIRPG_CHAT.dispatchAutomatedMessage(actionText, { travel: true, travelMetadata, suppressTravelCompletionSound: true })`.
- For nonblank prompts, send `travelMetadata.mode: "fast-travel"` and `eventDriven: false` so `/api/chat` resolves origin/destination without requiring a single adjacent exit.
- If the confirmed action text is blank, skip the player-action prompt and dispatch only a comment-style travel log (`# <player> moved to <destination>.`) like ordinary explored-exit clicks.
- After the prompt-backed action or comment log succeeds, call the player teleport helper with `accountTravelTime: true`.
- Refresh the active Region Map after teleport.

This path is gameplay travel, not a story-tool teleport. The server still applies travel-time accounting, arrival processing, hidden-NPC checks, NPC sighting updates, event summaries, and world-time payload updates.

## Favorites

The Favorites tab fetches `GET /api/locations?scope=favorites`, renders favorite location cards with computed shortest-route travel times, and calls the shared map-travel helper when a card is selected. Favorite-card travel uses the same preview, confirmation modal, optional nonblank `/api/chat` fast-travel prompt, blank-prompt comment logging, and travel-time-accounting teleport as the Region Map and World Map.

## API and Mutation Paths

- Read-only map payloads: `GET /api/map/region`, `GET /api/map/world`.
- Travel preview: `GET /api/player/fast-travel-preview`.
- Gameplay movement after confirmed map travel: `POST /api/npcs/:id/teleport` with `accountTravelTime: true` for the player.
- Exit creation/deletion: `POST /api/locations/:id/exits`, `DELETE /api/locations/:id/exits/:exitId`.
- Stub read/edit/delete/expand: `GET /api/stubs/:id`, `PUT /api/stubs/:id`, `DELETE /api/stubs/:id`, `POST /api/stubs/:id/expand`.
- Hydrated location deletion from the map menu: `DELETE /api/locations/:id`, followed by Region Map and World Map refresh attempts.

## Styling

- `public/css/map.css` styles the map containers and map error state.
- `public/css/main.scss` contains the tab-panel sizing, World Map reload button, Favorites tab, fast-travel modal, floating context menu, stub/location edit, and vehicle editor styles used by map workflows.
- Cytoscape node/edge styles live in `public/js/map.js` and `public/js/world-map.js`.
