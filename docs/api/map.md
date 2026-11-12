# Map API

Map routes are read-only graph-data endpoints registered in `api.js`. They feed the Region Map (`public/js/map.js`), the World Map (`public/js/world-map.js`), vehicle-exit selectors, and map focus helpers. Map edits, stub expansion, player movement, and the shared route/travel inspector use other endpoint groups.

Shared field conventions for `LocationExit`, `LocationResponse`, `VehicleInfo`, `MapLocationSummary`, and `MapRegionSummary` are also listed in `docs/api/common.md`.

## GET /api/map/region

Returns one region's map payload.

Request:
- Query: `regionId` (optional live region id)

Region selection:
- When `regionId` is provided, the endpoint loads that live `Region` and does not require an active player.
- When `regionId` is omitted, the endpoint requires an active player and resolves the active region from the player's active location. Stub-region metadata is preferred when it points at a live region; otherwise the route finds the live region whose `locationIds` includes the active location id.

Response:
- 200: `{ success: true, region }`
  - `region`: `{ regionId, regionName, controllingFactionId, currentLocationId, playerId, playerLevel, locations }`
  - `currentLocationId` is the active player's location id, or `null` when the request supplied `regionId` and no active player exists.
  - `playerId` identifies the active player, or `null`; `playerLevel` is that player's finite actual level, or `null` when unavailable.
  - `locations` contains summaries for existing location records listed in the region's `locationIds`.
- 404: `{ success: false, error }`
  - No active player and no `regionId` query.
  - Requested `regionId` does not match a live region.
  - Active-player lookup has no active location.
  - No region can be resolved for the map.
- 500: `{ success: false, error }`

## GET /api/map/world

Returns a world-level map payload containing all live regions and all locations with a region id.

Response:
- 200: `{ success: true, world }`
  - `world`: `{ currentLocationId, playerId, playerLevel, regions, locations }`
  - `currentLocationId` is the active player's location id, or `null` when there is no active player.
  - `playerId` identifies the active player, or `null`; `playerLevel` is that player's finite actual level, or `null` when unavailable.
  - `regions` contains one `MapRegionSummary` per live `Region`.
  - `locations` contains `MapLocationSummary` records for all game locations with a non-empty `regionId`.
- 404: `{ success: false, error }`
  - No live regions are registered.
  - No game locations are registered.
  - No location summaries have a region id.
- 500: `{ success: false, error }`

`regions` entries include:
- `id`, `name`, `parentRegionId`
- `isVehicle`, `vehicleIcon`
- `isStub`
- `locationIds`, `locationCount`
- `averageLevel`
- `childRegionIds`

`childRegionIds` contains direct children whose `parentRegionId` points at another region included in the same world payload.

## Location Summaries

Both map endpoints serialize locations through `buildMapLocationSummary(location)`.

Fields:
- `id`, `name`
- `isStub`
- `isVehicle`
- `vehicleIcon`
- `visited`
- `favorite`
- `regionId`
- `exits`
- `image` (optional `{ id, url }`)

Name resolution uses the location name when present, then stub presentation fields, then the location description, then the id. `regionId` comes from `location.regionId` or stub metadata. `isVehicle` is true when the `Location` has vehicle info, and `vehicleIcon` uses `vehicleInfo.icon` or the default car icon for vehicle locations.

`image` is present when `location.imageId` exists. The URL comes from the first generated-image metadata entry when available; otherwise the route returns `{ id, url: null }`.

## Exit Summaries

Each location summary includes an `exits` array. Entries include:
- `id`
- `destination`
- `destinationRegion`
- `travelTimeMinutes`
- `destinationRegionName`
- `destinationRegionExpanded`
- `destinationRegionAverageLevel`
- `destinationName`
- `bidirectional`
- `isVehicle`
- `isVehicleOutbound`
- `isVehicleInbound`
- `vehicleType`
- `vehicleIcon`
- `destinationIsStub`
- `destinationIsRegionEntryStub`
- `destinationVisited`

Exit notes:
- `destinationRegionExpanded` is true when `destinationRegion` resolves to a live `Region`; pending region stubs can still provide `destinationRegionName`.
- `destinationRegionAverageLevel` is the finite actual average level of the live destination region, or `null` for an unresolved/pending region or unavailable level. It never substitutes a default level.
- `travelTimeMinutes` is the integer stored on the exit, or `0` when the value is not populated.
- `bidirectional` is false only when the exit explicitly sets `bidirectional` to `false`.
- `isVehicle` and `vehicleType` describe the exit edge. Destination vehicle status comes from the destination location, live region, pending region stub, or destination stub vehicle metadata.
- `vehicleIcon` is populated from destination vehicle metadata, with the default car icon when the destination represents a vehicle but has no icon. Ordinary exits between locations inside the same vehicle region suppress the containing-region vehicle icon.
- Vehicle exits tied to a vehicle that is underway, or a vehicle that has reached ETA but still has a pending destination, are omitted from map payloads.

## UI Consumers

Region Map:
- Fetches `GET /api/map/region`, optionally with `regionId`.
- Renders location nodes, internal edges, and region-exit bubbles with Cytoscape.
- Uses `currentLocationId`, `visited`, `isStub`, `isVehicle`, and vehicle-icon fields for node classes and overlays.
- Treats exits with `destinationRegion` pointing outside the region payload as region-exit bubbles. Expanded regions use the live target region name; pending region stubs render as unresolved targets. Bubble colors compare `destinationRegionAverageLevel` with `playerLevel`; unknown values stay neutral.

World Map:
- Fetches `GET /api/map/world` with `cache: "no-store"`.
- Renders region labels, region grouping nodes, location nodes, internal location edges, orphan exit bubbles, vehicle overlays, and convex hulls.
- Uses region `parentRegionId` and computed `childRegionIds` for region hierarchy/grouping behavior.
- Compares actual region `averageLevel` with actual `playerLevel` for label/group/hull colors: blue at -5, green at -2.5, yellow at zero, orange at +2.5 and red at +5, with endpoint colors beyond that range. Missing levels stay neutral. See [map UI](../ui/maps.md#region-level-colors) for the shared palette and in-place player-level refresh contract.

Travel and editing:
- Tapping any non-active location node opens the shared route/travel inspector. The inspector uses `GET /api/player/fast-travel-preview`; reachable, visited, hydrated destinations may continue through `/api/chat` and player teleport with travel-time accounting, while other destinations remain inspect-only.
- Map context menus and link mode use location, stub, image, weather, NPC, thing, and exit endpoints. The map endpoints themselves do not mutate world state, expand stubs, advance time, or move actors.
