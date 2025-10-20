# API Routes From `api.js`

This reference catalogs every Express route registered in `api.js`. Each entry lists the accepted arguments and the primary response shapes so you can extend or consume the API without re-reading the source. Unless noted, JSON responses include a `success` boolean and error responses return `{ success: false, error: string }` with an appropriate HTTP status. Older endpoints that omit `success` are called out explicitly.

## Chat & Conversation

| Method & Path | Request Arguments | Response Format |
| --- | --- | --- |
| `POST /api/chat` | Body: `messages` *(required array of chat entries with `role`, `content`, optional metadata)*; optional `clientId`, `requestId`, `travel` (bool), `travelMetadata` object with `exit.{originLocationId, destinationId, direction?, exitId?, destinationRegionId?}`. | 200 returns the resolved turn `{ response, messages, npcTurns?, events?, experienceAwards?, needBarChanges?, debug?, requestId?, streamMeta?, attackCheck?, forcedEvent?, travelMetadata?, corpseRemovals?, corpseCountdownUpdates? }`. Errors 400/408/503/500 respond with `{ error, requestId?, streamMeta? }`. |
| `GET /api/chat/history` | None. | 200 `{ history: ChatEntry[], count: number }` (no `success` flag). |
| `DELETE /api/chat/history` | None. | 200 `{ message: string, count: 0 }` (no `success`). |
| `PUT /api/chat/message` | Body requires `content` string and either `id` or `timestamp`. | 200 `{ success: true, entry }` with edited entry; 400 if content/id missing; 404 if not found. |
| `DELETE /api/chat/message` | Body requires `id` or `timestamp`. | 200 `{ success: true, removed, orphaned: ChatEntry[] }`; 400 missing identifiers; 404 when entry absent. |

## Player Identity & Party

| Method & Path | Request Arguments | Response Format |
| --- | --- | --- |
| `POST /api/player` | Body optional `name`, `attributes` object, `level` number. | 200 `{ success: true, player, message }` with new player stored as current; 400 on validation errors. |
| `GET /api/player` | None. | 200 `{ success: true, player }`; 404 `{ success: false, error: 'No current player found' }`. |
| `GET /api/players` | None. | 200 `{ success: true, players: PlayerSummary[], count, currentPlayer }`. |
| `POST /api/player/set-current` | Body `{ playerId: string }`. | 200 `{ success: true, currentPlayer, message }`; 400 missing id; 404 unknown player; 500 on internal issues. |
| `GET /api/player/party` | None. | 200 `{ success: true, members: PlayerSummary[], count }`; 404 if no current player; 500 on lookup failure. |
| `POST /api/player/party` | Body `{ ownerId: string, memberId: string }`. | 200 `{ success: true, message, members }` (message notes when already present); 400 missing ids; 404 missing players; 500 on failure. |
| `DELETE /api/player/party` | Body `{ ownerId: string, memberId: string }`. | 200 `{ success: true, message, members }`; 400 missing ids; 404 when owner or member not found/in party; 500 on failure. |

## Player Stats & Progression

| Method & Path | Request Arguments | Response Format |
| --- | --- | --- |
| `PUT /api/player/attributes` | Body `{ attributes: Record<string, number> }`. | 200 `{ success: true, player, message }`; 404 when no current player; 400 invalid payload. |
| `PUT /api/player/health` | Body `{ amount: number, reason?: string }`. | 200 `{ success: true, healthChange, player, message }`; 404 when no player; 400 invalid amount. |
| `POST /api/player/levelup` | None. | 200 `{ success: true, player, message }`; 404 no current player; 400 on level-up errors. |
| `GET /api/player/needs` | None. | 200 `{ success: true, needs: NeedBar[], includePlayerOnly, npc: null, player: { id, name } }`; 404 no player; 500 on snapshot failure. |
| `PUT /api/player/needs` | Body `{ needs: Array<{ id: string, value: number }> }`. | 200 `{ success: true, message, needs: NeedBar[], includePlayerOnly, npc: null, player: { id, name }, applied: NeedBar[] }`; 404 no player; 400 invalid payload. |
| `GET /api/attributes` *(first definition)* | None. | 200 `{ success: true, attributes, generationMethods, systemConfig }` (temporary player created when necessary). |
| `POST /api/player/generate-attributes` | Body `{ method?: string }`. | 200 `{ success: true, player, generatedAttributes, method, message }`; 404 no player; 400 invalid method. |
| `POST /api/player/update-stats` | Body supports `name`, `description`, `level`, `health`, `attributes` object, `skills` object, `unspentSkillPoints`. | 200 `{ success: true, player, message, imageNeedsUpdate: boolean }`; 404 no player; 500 on update failure. |
| `POST /api/player/create-from-stats` | Body requires `name`; optional `description`, `level`, `health`, `attributes`, `skills`, `unspentSkillPoints`. | 200 `{ success: true, player, message }`; 400 missing name; 500 on creation failure. |
| `POST /api/player/skills/:skillName/increase` | Path `skillName`; body optional `{ amount }` (defaults to 1). | 200 `{ success: true, player, skill: { name, rank }, amount }`; 404 no current player; 400 invalid skill/amount. |
| `POST /api/player/equip` | Body `{ slotName: string, itemId?: string }`. | 200 `{ success: true, player, message: 'Equipment updated successfully' }`; 404 missing player/item, 400 invalid slot or equip failure, 500 on error. |

## Travel & Map Control

| Method & Path | Request Arguments | Response Format |
| --- | --- | --- |
| `POST /api/player/move` | Body `{ destinationId?: string, direction?: string }` (one required). | 200 `{ success: true, location, message, direction }` with serialized destination; 404 no player/exit/destination; 400 missing parameters or invalid state; 500 on expansion failures. |
| `GET /api/map/region` | Query optional `regionId`; otherwise uses current player location. | 200 `{ success: true, region: { regionId, regionName, currentLocationId, locations: LocationSummary[] } }`; 404 when player/region missing; 500 on build failure. |
| `POST /api/npcs/:id/teleport` | Path `id`; body `{ locationId: string }`. | 200 `{ success: true, npc, destination, previousLocation, locationIds: string[], message }`; 400 missing ids/destination same as current; 404 NPC/location missing; 500 on relocation failure. |
| `POST /api/things/:id/teleport` | Path `id`; body `{ locationId: string, ownerId?: string, ownerType?: string }`. | 200 `{ success: true, thing, destination, previousLocation, removedOwnerIds: string[], locationIds, message }`; 400 missing IDs or incompatible owner; 404 thing/destination not found; 500 on failure. |

## NPC Management

| Method & Path | Request Arguments | Response Format |
| --- | --- | --- |
| `PUT /api/npcs/:id` | Path `id`; body can include `name`, `description`, `shortDescription`, `race`, `class`, `level`, `health`, `healthAttribute`, `attributes`, `skills`, `abilities`, `unspentSkillPoints`, `currency`, `experience`. | 200 `{ success: true, npc: serializeNpcForClient(npc) }`; 400 invalid payload; 404 NPC missing; 500 on update failure. |
| `POST /api/npcs/:id/equipment` | Path `id`; body `{ itemId: string, action?: 'equip'|'unequip', slotName?: string, slotType?: string }`. | 200 `{ success: true, npc, message }`; 400 invalid slot/action; 404 NPC/item not found; 500 on error. |
| `GET /api/npcs/:id/needs` | Path `id`; optional query none. | 200 `{ success: true, needs: NeedBar[], includePlayerOnly, npc, player }`; 404 NPC missing; 500 on snapshot failure. |
| `PUT /api/npcs/:id/needs` | Path `id`; body `{ needs: Array<{ id: string, value: number }> }`. | 200 `{ success: true, message, needs: NeedBar[], includePlayerOnly, npc, player, applied: NeedBar[] }`; 404 NPC missing; 400 invalid payload; 500 on failure. |
| `GET /api/npcs/:id/dispositions` | Path `id`. | 200 `{ success: true, npc, player, range, dispositions }`; 404 NPC missing; 500 on failure. |
| `PUT /api/npcs/:id/dispositions` | Path `id`; body `{ dispositions: Array<{ key: string, value: number }> }`. | 200 `{ success: true, npc, player, range, dispositions }`; 400 missing player/current player or invalid payload; 404 NPC missing; 500 on failure. |
| `PUT /api/npcs/:id/memories` | Path `id`; body `{ memories: string[] }`. | 200 `{ success: true, npc, message }`; 400 invalid payload/NPC missing; 500 on update failure. |
| `DELETE /api/npcs/:id` | Path `id`. | 200 `{ success: true, message, locationId, regionId }`; errors surfaced from `deleteNpcById` (400 missing id, 404 not found), 500 on unexpected failure. |
| `POST /api/npcs/:id/portrait` | Path `id`; body optional `{ clientId?: string }`. | 200 `{ success: true, npc: { id, name, imageId }, imageGeneration, message }`; 202 when job already exists; 409 when NPC not eligible (with `reason`); 404 missing NPC; 503 when image pipeline disabled; 500 on failure. |

## Locations & Regions

| Method & Path | Request Arguments | Response Format |
| --- | --- | --- |
| `GET /api/regions` | Query optional `scope` (`current` to return only the active region). | 200 `{ success: true, regions: Array<{ id, name?, parentRegionId?, averageLevel? }> }` for list requests; 200 `{ success: true, region, parentOptions }` when `scope=current`; 404 when no active region is set; 500 when serialization fails. |
| `GET /api/regions/:id` | Path `id`. | 200 `{ success: true, region: { id, name, description, parentRegionId, parentRegionName, averageLevel }, parentOptions }`; 400 missing id; 404 unknown region; 500 on error. |
| `PUT /api/regions/:id` | Path `id`; body `{ name: string, description: string, parentRegionId?: string|null, averageLevel?: number|null }`. | 200 `{ success: true, message, region: { ...updated fields... }, parentOptions }`; 400 validation errors (e.g., cyclic parents, bad values); 404 region/parent missing; 500 on failure. |
| `GET /api/locations` | Query optional `scope` (`named`/`names` to filter, `current` to return only the active location). | 200 `{ success: true, locations: Array<{ id, name?, regionId?, regionName, label }> }` for list requests; 200 `{ success: true, location }` when `scope=current`; 404 when no active location is set; 500 when serialization fails. |
| `GET /api/locations/:id` | Path `id`. | 200 `{ success: true, location }` with expanded stub data when needed; 404 location missing; 500 when expansion/serialization fails. |
| `PUT /api/locations/:id` | Path `id`; body must include `description` and `level`, optional `name` (string or null) plus other editable fields mirrored from location schema. | 200 `{ success: true, location, message }`; 400 validation issues; 404 unknown location; 500 on failure. |
| `GET /api/exits/options` | Query optional `originLocationId`. | 200 `{ success: true, regions: RegionOption[], locations: LocationOption[], originRegionId?, originLocationId? }`; 500 on failure. |
| `POST /api/locations/:id/exits` | Path `id`; body supports `type` (`location`/`region`), `name`, `description`, `regionId`, `locationId`, `parentRegionId`, `vehicleType`, `clientId`. | 200 `{ success: true, message, location, created: {...exit metadata...} }`; 400 validation errors; 404 destination missing; 500 on failure. |
| `DELETE /api/locations/:id/exits/:exitId` | Path `id`, `exitId`; body optional `{ requestId?, initiatorClientId? }`. | 200 `{ success: true, message, location, removed, reverseRemoved?, deletedStub?, preservedStub? }`; 404 exit/location missing; 500 on failure. |
| `POST /api/locations/:id/npcs` | Path `id`; body optional seed fields (`name`, `description`, `shortDescription`, `role`, `class`, `race`, `currency`, `level`). | 200 `{ success: true, npc, location, message }`; 400 missing name or validation failure; 404 location missing; 500 on generation failure. |
| `POST /api/locations/:id/things` | Path `id`; body `{ seed: { name, description?, type?, slot?, rarity?, itemOrScenery?, value?, weight?, level?, relativeLevel? }, level? }`. | 200 `{ success: true, thing, location, message }`; 400 duplicate name/missing seed; 404 location missing; 500 on generation failure. |
| `POST /api/regions/generate` | Body includes generation parameters, `clientId?`, `requestId?`. | 202/200 stream-backed response `{ success: true, region, events?, requestId?, streamMeta? }` when AI call succeeds; errors propagate with `{ success: false, error }` (status 400/408/503/500 depending on failure). |
| `POST /api/locations/generate` | Body includes generation prompt inputs, `clientId?`, `requestId?`. | 200 `{ success: true, location, stream?: {...}, requestId? }` on success; timeout/connection/API failures return status 408/503/custom with `{ success: false, error, details? }`. |

## Things & Inventory

| Method & Path | Request Arguments | Response Format |
| --- | --- | --- |
| `POST /api/things` | Body supports `name`, `description`, `thingType`, `imageId`, `rarity`, `itemTypeDetail`, `metadata`, `slot`, `attributeBonuses`, `causeStatusEffect`, `level`, `relativeLevel`, `statusEffects`. | 200 `{ success: true, thing, message, imageNeedsGeneration: boolean }`; 400 invalid data. |
| `GET /api/things` | Query optional `type`. | 200 `{ success: true, things: Thing[], count }`; 400 invalid `type`. |
| `GET /api/things/:id` | Path `id`. | 200 `{ success: true, thing }`; 404 `{ success: false, error }`. |
| `PUT /api/things/:id` | Path `id`; body can update identity, type, rarity, metadata, slot, attribute bonuses, status effects, levels, image overrides. | 200 `{ success: true, thing, message, imageNeedsUpdate: boolean }`; 400 validation errors; 404 unknown thing. |
| `DELETE /api/things/:id` | Path `id`. | 200 `{ success: true, message, affectedLocationIds: string[], affectedPlayerIds: string[], affectedNpcIds: string[] }`; 400 missing id; 404 not found; 500 on failure. |
| `GET /api/things/scenery` | None. | 200 `{ success: true, things: Thing[], count }`. |
| `GET /api/things/items` | None. | 200 `{ success: true, things: Thing[], count }`. |
| `GET /api/gear-slots` | None. | 200 `{ success: true, slotTypes: string[] }`; 500 on lookup failure. |
| `GET /api/attributes` *(second definition)* | None. | 200 `{ success: true, attributes: Array<{ key, label, description, abbreviation }> }`; 500 on failure. *(Unreachable while the earlier definition remains.)* |
| `POST /api/things/:id/give` | Path `id`; body `{ ownerId: string, ownerType?: string, locationId?: string }`. | 200 `{ success: true, thing, owner: PlayerSummary, location?: LocationSummary, message }`; 400 missing owner/invalid type; 404 thing/owner not found; 409 when requested location mismatch; 500 on failure. |
| `POST /api/things/:id/drop` | Path `id`; body optional `{ ownerId?, ownerType?, locationId? }`. | 200 `{ success: true, thing, owner?: PlayerSummary, location, message }`; 400 missing drop target; 404 thing not found; 500 on failure. |
| `POST /api/things/:id/teleport` | Covered under Travel & Map; see that section for responses. |
| `POST /api/things/:id/image` | Path `id`; body optional `{ clientId?: string, force?: boolean }`. | 200 `{ success: true, thing, imageGeneration, message }`; 202 if job already queued; 409 when generation skipped with `reason`; 500 on failure. |

## Settings

| Method & Path | Request Arguments | Response Format |
| --- | --- | --- |
| `GET /api/settings` | None. | 200 `{ success: true, settings: SettingInfo[], count }`; 500 on failure. |
| `POST /api/settings` | Body requires `name` plus optional setting fields. | 201 `{ success: true, setting, message }`; 400 invalid payload; 409 duplicate name. |
| `POST /api/settings/fill-missing` | Body `{ sourceId?: string, genre?, tone?, theme?, ... }`. | 200 `{ success: true, setting: FilledSetting, message? }`; 400 invalid requests; 500 on failure. |
| `GET /api/settings/:id` | Path `id`. | 200 `{ success: true, setting }`; 404 not found; 500 on failure. |
| `PUT /api/settings/:id` | Path `id`; body with normalized setting fields (strings, lists, numbers). | 200 `{ success: true, setting, message }`; 400 validation errors; 404 not found; 500 on failure. |
| `DELETE /api/settings/:id` | Path `id`. | 200 `{ success: true, message }`; 404 not found; 500 on failure. |
| `POST /api/settings/:id/clone` | Path `id`; body optional overrides `{ name?, id? }`. | 200 `{ success: true, setting, message }`; 404 source missing; 500 on failure. |
| `POST /api/settings/save` | Body optional filters `{ ids?: string[] }`. | 200 `{ success: true, saved: { paths: string[] }, message }`; 500 on failure. |
| `POST /api/settings/load` | None or body specifying filters. | 200 `{ success: true, settings: SettingInfo[], message }`; 500 on failure. |
| `GET /api/settings/saved` | None. | 200 `{ success: true, savedSettings: FileDescriptor[], count }`; 500 on failure. |
| `POST /api/settings/:id/save` | Path `id`. | 200 `{ success: true, filepath, message }`; 404 setting missing; 500 on failure. |
| `POST /api/settings/:id/apply` | Path `id`. | 200 `{ success: true, setting, message, promptVariables }`; 404 not found; 500 on failure. |
| `GET /api/settings/current` | None. | 200 `{ success: true, setting: SettingInfo|null, promptVariables? }`. |
| `DELETE /api/settings/current` | None. | 200 `{ success: true, message, previousSetting: SettingInfo|null }`; 500 on failure. |

## Game Lifecycle & Saves

| Method & Path | Request Arguments | Response Format |
| --- | --- | --- |
| `POST /api/new-game` | Body includes player seeds (`playerName`, `playerDescription`, `playerClass`, `playerRace`, `startingLocation`, `numSkills`, `existingSkills`, `startingCurrency`, `clientId?`, `requestId?`). | 200 `{ success: true, player, location, region, messages?, streamMeta?, requestId?, events? }`; 400 when no active setting or invalid input; 500/503 for AI failures; streaming status emitted via realtime hub. |
| `POST /api/save` | Body `{ saveName?: string, includeAssets?: boolean }`. | 200 `{ success: true, saveName, path, message }`; 500 on serialization failure. |
| `POST /api/load` | Body `{ saveName: string }`. | 200 `{ success: true, message, saveName, players, locations, regions, setting? }`; 404 missing save; 500 on load failure. |
| `GET /api/saves` | None. | 200 `{ success: true, saves: SaveMetadata[], count, message }`; 500 on failure. |
| `DELETE /api/save/:saveName` | Path `saveName`. | 200 `{ success: true, saveName, message }`; 404 missing save; 500 on failure. |

## Image Generation & Jobs

| Method & Path | Request Arguments | Response Format |
| --- | --- | --- |
| `POST /api/images/request` | Body `{ entityType: 'player'|'npc'|'location'|'exit'|'location-exit'|'thing'|'item'|'scenery', entityId: string, force?: boolean, clientId?: string }`. | 200 `{ success: true, jobId?, imageId?, entity: { ... }, message }`; 202 when existing job; 404 entity missing; 400 unsupported type; 500 when generator absent. |
| `POST /api/generate-image` | Body with raw prompt payload for legacy generator. | 200 `{ success: true, jobId, request, response }`; error responses propagate from generator (400/408/503/500). |
| `POST /api/players/:id/portrait` | Path `id`; body optional `{ force?: boolean }`. | 200 `{ success: true, player: { id, name, imageId }, imageGeneration, message }`; 202 when job already pending; 409 when skipped; 404 player missing; 503 when disabled; 500 on failure. |
| `POST /api/npcs/:id/portrait` | See NPC Management row; behaves the same as the player variant but enforces party/location eligibility. |
| `POST /api/things/:id/image` | Path `id`; body optional `{ force?: boolean, clientId?: string }`. | 200 `{ success: true, thing, imageGeneration, message }`; 202 job already queued; 409 skipped with reason; 404 thing missing; 500 on failure. |
| `GET /api/jobs/:jobId` | Path `jobId`. | 200 `{ success: true, job: { id, status, progress, message, createdAt, startedAt, completedAt }, result?, error? }`; 404 job missing. |
| `DELETE /api/jobs/:jobId` | Path `jobId`. | 200 `{ success: true, message }`; 404 job missing; 400 when job already finished. |
| `GET /api/jobs` | None. | 200 `{ success: true, jobs: JobSummary[], queue: { pending: number, processing: 0|1 } }`. |
| `GET /api/images/:imageId` | Path `imageId`. | 200 `{ success: true, metadata }`; 404 when not recorded. |
| `GET /api/images` | None. | 200 `{ success: true, images: ImageMetadata[], count }`. |

## Diagnostics & Miscellaneous

| Method & Path | Request Arguments | Response Format |
| --- | --- | --- |
| `GET /player-stats` | Query optional UI parameters. | 200 renders the stats HTML view *(server-side render, not JSON)*; used by the admin UI. |
| `GET /debug` | None. | 200 renders the debug HTML view summarizing world state. |
| `GET /api/hello` | None. | 200 `{ message: 'Hello World!', timestamp, port }`. |
| `POST /api/test-config` | Body `{ endpoint: string, apiKey: string, model: string }`. | 200 `{ success: true, message: 'Configuration test successful' }`; 400 missing fields; 408 timeout; 503 connection errors; 500 other failures with `{ error }`. |

## Duplicate Route Warning

`GET /api/attributes` is defined twice. Express attaches the first implementation (listed under “Player Stats & Progression”), making the later definition in the “Things & Inventory” section unreachable until the duplication is resolved.
