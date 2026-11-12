# Maps (Region + World)

The chat page exposes a Region Map tab, a World Map tab, and a Favorites tab that reuses the shared map-travel helper. The map graph endpoints are read-only; editing, travel, and stub expansion go through the same route groups and inline helpers used by the Adventure UI.

The Relationships tab uses the same Cytoscape vendor stack for character relationship rendering; its behavior is documented separately in `docs/ui/relationships.md`.

## Entry points

- `views/index.njk` defines the Map, World Map, and Favorites tab panels, the floating map-location context menu, the Set Last Seen modal, the shared Route and Travel inspector, tab activation, and `window.openNewExitModalFromMap`.
- `public/js/map.js` owns Region Map Cytoscape rendering and region-map-specific interactions.
- `public/js/world-map.js` owns World Map Cytoscape rendering and world-map-specific interactions.
- `public/js/region-level-colors.js` supplies the shared region-versus-player level palette and request-start player snapshot comparison; it loads before both map scripts.
- `public/js/chat.js` refreshes the active Region Map in response to realtime exit creation/deletion events from other clients and builds `new_exit_discovered` summary rows with map-navigation metadata.

## Region Map

Rendered inside `#mapContainer` in the Map tab.

### Data source

- `GET /api/map/region` returns the active player's region map.
- `GET /api/map/region?regionId=<id>` returns a specific live region without requiring an active player.
- The response shape is `{ success: true, region: { regionId, regionName, controllingFactionId, currentLocationId, playerId, playerLevel, locations } }`. `controllingFactionId` is the controlling faction id or `null`. `playerId` and finite `playerLevel` identify the actual active player, with `null` when unavailable. Each location summary includes `id`, `name`, `isStub`, `isVehicle`, `vehicleIcon`, `visited`, `favorite`, `regionId`, `exits`, and optional `image`.

### Rendering model

- Cytoscape renders location nodes, internal exit edges, region-exit bubbles, and vehicle overlay nodes.
- A controlled region displays its faction emblem as a fixed upper-left map overlay. It is twice the normal NPC-card emblem size, does not move with map pan/zoom, and uses the shared formatted faction tooltip on hover or keyboard focus. Missing emblem art enters the normal lazy image-generation flow. Faction emblem replacement retires its prior native listeners/image binding and hides only its own tooltip through the shared owner token; detached controls cannot replace or dismiss a newer tooltip. Cached navigation retains the live owner, while final unload releases it.
- Location nodes use `current`, `visited`, and `stub` classes. Visited nodes with image URLs render the location image as the node background.
- Internal exits are edges between locations in the loaded region. Reverse edges collapse into one edge with the `bidirectional` class.
- Region exits render as `region-exit-<exitId>` bubbles when an exit has a `destinationRegion` outside the loaded region. Expanded region exits show an arrow symbol and can be tapped to load the target region; unexpanded region exits show a question mark and dashed styling. Bubble/label color uses the actual live `destinationRegionAverageLevel` against the active player level through the shared palette below. Pending regions without an actual level remain neutral; their question mark and dashed border remain.
- Vehicle-capable location nodes get a centered emoji overlay from `vehicleIcon` or the default car icon.
- Vehicle region-exit overlays are only rendered for inbound vehicle exits with explicit icon metadata. Outbound vehicle exits keep the standard region-exit symbol. Ordinary exits inside the same vehicle region suppress the containing-region vehicle icon, matching the Adventure exit list.
- Vehicle exits tied to an underway vehicle or an ETA-reached vehicle with a pending destination are omitted by the map payload.
- `loadRegionMap(regionId, options)` supports focus options such as `focusLocationId`, `destinationId`, `focusExitId`, and `exitId`. After layout, `focusRegionMapNode` centers the matching location or region-exit bubble and applies the `map-focus` class.

### Interactions

- Tapping any non-current location opens the shared Route and Travel inspector. Unvisited locations and terminal stubs can be inspected but not fast-traveled to.
- Tapping an expanded region-exit bubble calls `loadRegionMap(targetRegionId)`.
- Right-clicking a hydrated location opens the shared floating location menu with Teleport Player Here, Edit Location, Edit Region, Edit Weather, Edit Calendar, Set Last Seen, Summon NPC, Summon Item/Scenery, Upload Image, Regenerate Image, Regenerate Image +, and Delete Location actions. Explored, non-stub locations additionally expose `Add to Favorites`, or `Remove from Favorites` when already marked; this persists through `PUT /api/locations/:id/favorite`. Teleport Player Here uses the Story Tools teleport path, so it moves immediately without gameplay travel prose or travel-time accounting. `Regenerate Image +` generates the final prompt, opens the shared prompt-edit modal, and only queues image rendering after confirmation. Stub and unexplored locations hide the favorite action. Stub locations also hide region/weather/calendar/regenerate/delete actions in that shared menu and expose Unstub; their teleport action expands the destination before moving the player.
- The Set Last Seen map action opens the shared modal and submits `/set_last_seen <location> <time>` through `AIRPG_CHAT.executeSlashCommand`. Accepted time text matches the slash command guidance: exact `H AM/PM`, exact `H:MM AM/PM`, or relative durations such as `2 hours ago`.
- Right-clicking a stub node in the Region Map opens a compact map menu with Unstub, Teleport player here, Edit stub, and Delete stub. Unstub calls `POST /api/stubs/:id/expand`; Teleport uses the Story Tools path that expands the destination before moving the player; Edit stub opens `window.openStubEditModal(stubId)`; Delete stub calls `DELETE /api/stubs/:id`.
- The shared stub editor exposes vehicle metadata controls (`isVehicle` and `vehicleInfo`) for location stubs and region-entry stubs. Ordinary location stubs also expose a Region selector and can move between live or pending regions. Region-entry stubs hide that selector because their target region is fixed.
- Right-clicking an edge opens a compact menu for deleting the exit. Both internal and cross-region rendered edges retain their authoritative exit id, so deletion calls `DELETE /api/locations/:id/exits/:exitId` for either kind of edge. After a successful local deletion, an orphaned cross-region target bubble and its vehicle-icon overlay are removed with the edge; ordinary location endpoint nodes and region indicators that still have another connected edge remain.
- Shift-dragging from a location enters link mode. Dropping on another location creates an exit with `POST /api/locations/:id/exits` and payload `{ type: "location", locationId }`. Dropping on empty space opens the New Exit modal in map mode with origin/preferred region context; map-mode location creation sends `bidirectional: true`.
- Discovered-exit summary map pills dispatch `airpg:new-exit-summary-selected`; the handler opens the origin region's map and focuses the discovered destination location or `region-exit-<exitId>` bubble.

## World Map

Rendered inside `#worldMapContainer` in the World Map tab.

### Data source

- `GET /api/map/world` returns `{ success: true, world: { currentLocationId, playerId, playerLevel, regions, locations } }` with `cache: "no-store"` on the client.
- `playerId` and finite `playerLevel` identify the actual active player, with `null` when unavailable.
- Region summaries include `id`, `name`, `parentRegionId`, `isVehicle`, `vehicleIcon`, `isStub`, `locationIds`, `locationCount`, `averageLevel`, and computed `childRegionIds`.
- Location summaries use the same map-location shape as the Region Map.

### Rendering model

- Cytoscape renders region label nodes, region group nodes, location nodes, internal location edges, orphan exit bubbles, vehicle overlay nodes, and convex hull overlays.
- Region labels, group colors and convex hull fills/borders use the shared palette below, replacing the previous region-ID colors. Region labels are clickable and positioned over their member locations after layout. Clicking a region label activates the Region Map tab for that region.
- Location nodes use `location-node`, `visited`, `stub`, and `current` classes. Visited nodes with images render those images as node backgrounds.
- Internal location edges collapse reverse edges into one `bidirectional` edge.
- Orphan exit bubbles represent exits from grouped locations to mapped locations whose region is not represented by a world-map group node.
- Vehicle-capable location nodes and vehicle region labels get centered emoji overlays from `vehicleIcon` or the default car icon.
- Convex hull overlays come from `public/js/cytoscape-convex-hull.js`. Hull membership includes parent-region ancestry, and `window.adjustBubblePadding(padding, cornerRadius)` updates hull padding/corner radius and silently reloads the World Map.

### Interactions

- Tapping any non-current location opens the shared Route and Travel inspector. It focuses Adventure only after an eligible Travel action is accepted.
- Right-clicking a location node opens the same shared floating location menu used by the Region Map, including the explored-location Favorites toggle.
- The World Map Reload button calls `window.loadWorldMap()`.

## Region Level Colors

Colors use the exact difference `region average level - player level`. The shared
palette interpolates RGB channels between these stops:

| Difference | Color |
| --- | --- |
| -5 | Blue (`rgb(59, 130, 246)`) |
| -2.5 | Green (`rgb(34, 197, 94)`) |
| 0 | Yellow (`rgb(250, 204, 21)`) |
| +2.5 | Orange (`rgb(249, 115, 22)`) |
| +5 | Red (`rgb(239, 68, 68)`) |

Differences below -5 retain blue; differences above +5 retain red. The actual
levels and difference remain unchanged. Missing/nonfinite region or player levels
use neutral slate (`rgb(148, 163, 184)`); neither `null` nor blank values become
level zero. Hull fills retain their 0.18 alpha, and label backgrounds retain 0.55
alpha with the existing light text and dark outline. Ordinary location/image
nodes, current/visited styling, focus borders, faction emblems, vehicle overlays
and travel interactions retain their existing behavior.

Native `updateChatPlayerPanel` updates publish `airpg:player-level-changed` with
`{playerId, playerLevel}` only when that snapshot changes, excluding NPC updates.
Successful player-stat saves reuse that panel update when it exists. Each loaded
map owns its listener through GraphHost and recolors only when the level changes.
Region Map updates existing exit-node data; World Map updates existing label/group
data and the native hull path options, then redraws the hull canvas. Neither path
fetches per node, polls, replaces graph nodes, or reruns layout. Replacing or
unloading a graph releases its listener.

A map request captures the current public player snapshot before HTTP work. If
the same player's public level changes while the request is pending, rendering
uses the newer public snapshot rather than overwriting it with that response's
older level. An in-flight player identity change leaves an old identity's response
neutral. Otherwise the response's actual player level remains authoritative.

## Shared Route Inspection And Travel

Region Map, World Map, Favorites, and completed route-knowledge rewards use `window.openMapRouteInspector(destinationId)` from `views/index.njk`; the legacy-named `window.travelToAdjacentLocationFromMap(...)` entry point delegates to the same flow.

Flow:
- Fetch `GET /api/player/fast-travel-preview?destinationId=<id>` to compute the player-known directed route and current travel eligibility without mutation.
- Open `#mapFastTravelConfirmModal`, display origin/destination, total time or explicit no-known-route state, an ordered semantic step list, and any blocking reason. Step rows include endpoint names, optional description, minutes, vehicle metadata, and a stub marker. Internal exit direction/name keys are neither returned by this preview nor displayed.
- Show the action textarea and enabled Travel button only when `canFastTravel` is true. Otherwise Travel remains visibly disabled and linked to the blocker for assistive technology; inspection stays available.
- Focus the Adventure tab as soon as the Travel confirmation is accepted.
- If the confirmed action text is nonblank, dispatch it through `AIRPG_CHAT.dispatchAutomatedMessage(actionText, { travel: true, travelMetadata, suppressTravelCompletionSound: true })`.
- For nonblank prompts, send `travelMetadata.mode: "fast-travel"` and `eventDriven: false` so `/api/chat` resolves origin/destination without requiring a single adjacent exit.
- If the confirmed action text is blank, skip the player-action prompt and dispatch only a comment-style travel log (`# <player> moved to <destination>.`) like ordinary explored-exit clicks.
- After the prompt-backed action or comment log succeeds, call the player teleport helper with `accountTravelTime: true`.
- Refresh the active Region Map after teleport.

The modal traps focus, closes through Close, Escape, or backdrop, restores focus to its trigger, and uses a single-column scrollable route layout on narrow screens. The client validates the preview contract, route chain, and summed duration before rendering it.

Route policy is player-safe: hidden exits are never considered, temporarily unavailable vehicle exits are excluded, and stubs are allowed only as the terminal destination. An unreachable result uses generic `No known route` language and does not disclose whether an undiscovered edge exists.

This path is gameplay travel, not a story-tool teleport. The server still applies travel-time accounting, arrival processing, hidden-NPC checks, NPC sighting updates, event summaries, and world-time payload updates.

## Favorites

The Favorites tab fetches `GET /api/locations?scope=favorites`, renders favorite location cards with computed shortest-route travel times, and opens the shared inspector when a card is selected. Eligible Travel uses the same optional nonblank `/api/chat` fast-travel prompt, blank-prompt comment logging, and travel-time-accounting teleport as the Region Map and World Map.

## API and Mutation Paths

- Read-only map payloads: `GET /api/map/region`, `GET /api/map/world`.
- Travel preview: `GET /api/player/fast-travel-preview`.
- Gameplay movement after confirmed map travel: `POST /api/npcs/:id/teleport` with `accountTravelTime: true` for the player.
- Exit creation/deletion: `POST /api/locations/:id/exits`, `DELETE /api/locations/:id/exits/:exitId`.
- Stub read/edit/delete/expand: `GET /api/stubs/:id`, `PUT /api/stubs/:id`, `DELETE /api/stubs/:id`, `POST /api/stubs/:id/expand`.
- Explored-location Favorites toggle: `PUT /api/locations/:id/favorite`.
- Hydrated location deletion from the map menu: `DELETE /api/locations/:id`, followed by Region Map and World Map refresh attempts.

## Styling

- `public/css/map.css` styles the map containers and map error state.
- `public/css/main.scss` contains the tab-panel sizing, World Map reload button, Favorites tab, responsive route inspector, floating context menu, stub/location edit, and vehicle editor styles used by map workflows.
- Cytoscape node/edge styles live in `public/js/map.js` and `public/js/world-map.js`.

## Shared graph-host ownership

Region and World Map now compose [GraphHost](../classes/GraphHost.md) for engine
replacement, loading/error status and explicit resources. Region's per-render
container pointer/contextmenu listeners and edge popup are released before the
old engine; link-mode reset and captured-generation layout completion preserve the
active graph boundary. World owns layout/hull teardown before engine destruction,
with captured signals preventing late hull assignment. Existing topology, layout
options, plugin registration, vehicle/faction overlays, route/stub/favorite actions
and World request IDs remain app-owned. Cached pagehide preserves live hosts;
real unload disposes them.

Graph loader failures retain inline status and open persistent PageFeedback with
the original error/backtrace. JSON parse errors are preserved, unsuccessful API
payloads enter that common failure path, and loading-state teardown/factory errors
are reported as well. World stale-request guards remain; endpoints and request
options are unchanged. Error-state cleanup attempts retain their original cause
and do not prevent diagnostic presentation.
