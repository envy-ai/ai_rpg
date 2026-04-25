# Common Shapes & Conventions

This file collects shared response shapes referenced by multiple endpoints in `api.js`. When a route includes a serialized object, its fields appear here so you do not have to chase helper implementations.

## Conventions
- Unless a route explicitly says otherwise, JSON responses include a `success` boolean.
- Error responses are usually `{ success: false, error: string }` with an appropriate HTTP status.
- Timestamps are ISO 8601 strings unless noted.
- Optional fields are only present when the underlying data exists.

## ChatEntry
Normalized via `normalizeChatEntry` and enriched by `pushChatEntry`.

Fields:
- `id`: string (generated if missing)
- `role`: string (`user`, `assistant`, `system`, or custom)
- `content`: string
- `timestamp`: ISO string (generated if missing)
- `parentId`: string | null
- `locationId`: string (required; enforced by `pushChatEntry`)
- `type`: string | null (examples: `player-action`, `user-question`, `storyteller-answer`, `user-generic-prompt`, `generic-prompt-response`, `event-summary`, `quest-reward`, `status-summary`, visible assistant prose such as `while-you-were-away-player`, and hidden server-only story-note attachments such as `supplemental-story-info`, `while-you-were-away`, `plot-summary`, `plot-expander`, `offscreen-npc-activity-daily`, `offscreen-npc-activity-weekly`)
- `summary`: string | null
- `summaryTitle`: string | null (event summaries)
- `summaryItems`: array | null (event/status summary rows; new rows use the SummaryItem shape below)
- `travel`: boolean | undefined
- `lastEditedAt`: ISO string | undefined (edited messages)
- `ephemeral`: boolean | undefined (system-only entries)
- `metadata`: object (always includes `locationId`; may include `requestId`, `npcNames`, `traveledToLocationId` for travel turns, quest metadata, etc.)

## SummaryItem
Rows inside `ChatEntry.summaryItems` for `event-summary` and `status-summary` entries.

Fields:
- `icon`: string
- `text`: string
- `category`: string (exact drawer grouping value: `inventory`, `needs`, `quest_reward`, `time`, `travel`, `disposition`, `faction_relationship`, `location_world`, `character`, `npc_party`, `status`, or `other`)
- `severity`: string (`normal`, `important`, or `critical`)
- `sourceType`: string | null (server/live event source such as `pick_up_item`, `harvest_gather`, `time_passed`, `need_bar_change`, `disposition_change`, `quest_received`, `completed_quest_objective`, `status_effect_change`, or `environmental_damage`)
- `entityRefs`: array of `{ type, id, name }` references. `type` is a lowercase domain label such as `npc`, `thing`, `scenery`, `location`, `quest`, or `faction`; `id` and `name` may be null when unknown, but at least one is present.

Legacy summaries may omit `severity`, `sourceType`, and `entityRefs`; the client treats them as normal-severity uncited rows and keeps legacy uncategorized event rows under `Other`.

## ActionResolution (resolveActionOutcome)
Used by `/api/chat` (`actionResolution`) and `/api/craft` (`outcome`).

Base shape:
- `label`: string
- `degree`: string (examples: `automatic_success`, `success`, `failure`, `implausible_failure`)
- `success`: boolean
- `type`: string (plausibility type)
- `reason`: string | null
- `roll`: object | null
- `difficulty`: object | null
- `skill`: string | null
- `attribute`: string | null
- `margin`: number | null
- `circumstanceModifier`: number | undefined
- `circumstanceModifiers`: array | undefined
- `circumstanceReason`: string | null | undefined

When `type` is `trivial` or `implausible`, `roll`, `difficulty`, `skill`, `attribute`, and `margin` are `null`.

`roll` fields (when present):
- `die`: number
- `detail`: string
- `skillValue`: number
- `attributeBonus`: number
- `circumstanceModifier`: number
- `circumstanceModifiers`: array of `{ amount, reason }`
- `circumstanceReason`: string | null
- `total`: number

`difficulty` fields (when present):
- `label`: string | null
- `dc`: number | null

## StatusEffect
Serialized via `StatusEffect.toJSON()`.

Fields:
- `name`: string
- `description`: string
- `attributes`: array of `{ attribute, modifier }`
- `skills`: array of `{ skill, modifier }`
- `needBars`: array of `{ name, delta }`
- `duration`: number | null (minutes; `-1` = permanent)
- `appliedAt`: number | null (world-time minutes when the effect was last applied/ticked)
- Modifier arrays are only included when non-empty.

## VehicleInfo (VehicleInfo.toJSON)
Fields:
- `terrainTypes` (string | null)
- `icon` (string | null)
- `currentDestination` (string | null)
- `pendingDestination` (`{ rawText, regionName, locationName, regionId, locationId } | null`)
- `destinations` (`string[]`; entries are concrete location ids or `pending-region:<region name>` fixed-route tokens for unresolved new-region targets)
- `ETA` (number | null)
- `departureTime` (number | null)
- `vehicleExitId` (string | null)

When `vehicleInfo` is embedded in location/region response payloads, the server also enriches it with derived display fields:
- `isUnderway` (boolean)
- `hasArrived` (boolean)
- `isArriving` (boolean)
- `minutesToDestination` (number | null)
- `timeToDestination` (string | null)
- `tripCompleteFraction` (number)
- `destinationResolved` (boolean)
- `displayDestination` (string | null)

## NpcProfile (serializeNpcForClient)
Returned in many player/NPC endpoints and location responses.

Fields:
- `id`, `name`, `description`, `shortDescription`
- `class`, `race`, `level`
- `resistances`, `vulnerabilities` (strings)
- `health`, `maxHealth`, `healthAttribute` (`health` may be fractional; clients display health readouts rounded upward)
- `imageId`
- `isNPC`, `isPlayer`, `isHostile`, `isDead`
- `persistWhenDead`
- `isInPlayerParty`, `wasEverInPlayerParty`, `isHostileToPlayer`
- `locationId`
- `last_seen_time` (absolute world-minute timestamp | null), `last_seen_location` (location id | null), `was_in_player_location_previous_round` (boolean)
- `corpseCountdown`
- `attributes` (object)
- `skills` (object)
- `abilities` (array)
- `importantMemories` (array of strings)
- `statusEffects` (array of StatusEffect)
- `intrinsicStatusEffects` (array of StatusEffect)
- `unspentSkillPoints` (number | null)
- `unspentAttributePoints` (number | null)
  - These are derived values computed from current level/attributes/skills and configured formulas.
- `inventory` (array of Thing JSON with equip info: `isEquipped`, `equippedSlot`)
- `currency` (number | null)
- `experience` (number | null)
- `needBars` (array of NeedBar)
- `needBarApplicability` (object map of `needBarId -> boolean`)
- `thingListViewPreferences` (object map of shared thing-list panel key -> view mode)
- `factionId` (string | null)
- `factionStandings` (object map of `factionId -> number`)
- `personality` (object | null)
- `personalityType`, `personalityTraits`, `personalityNotes`
- `createdAt`, `lastUpdated`
- `dispositionsTowardPlayer` (object map)
- `quests` (array of Quest) when available
- `completedQuests` (array of Quest) when available
- `partyMembers` (array of NpcProfile) **only** when `includePartyMembers` is true

## PlayerStatus / NPC Status (Player.getStatus)
Used by `GET /api/npcs/:id` for full status.

Highlights beyond `Player.toJSON()`:
- `alive` (boolean)
- `modifiers`, `attributeInfo`, `attributeDefinitions`, `systemConfig`
- `inventory` is expanded into full Thing JSON (with equip flags), plus `inventoryIds`
- `partyMembers` (ids) and `partyMemberIds` (same list)
- `dispositions`, `dispositionDefinitions`
- `skills`, `abilities`, `unspentSkillPoints`, `unspentAttributePoints`
- `statusEffects` (active effects), `intrinsicStatusEffects` may be added by the route
- `gear`, `gearSlotsByType`, `gearSlotDefinitions`
- `needBars`, `needBarApplicability`, `corpseCountdown`, `persistWhenDead`, `wasEverInPlayerParty`, `last_seen_time`, `last_seen_location`, `was_in_player_location_previous_round`, `importantMemories`
- `resistances`, `vulnerabilities`
- `quests`, `personality`, `goals`, `characterArc`

## Thing (Thing.toJSON)
Fields:
- `id`, `name`, `description`, `shortDescription`
- `thingType` (`item` or `scenery`)
- `count` (persisted integer quantity; defaults to `1`)
- `imageId`, `createdAt`, `lastUpdated`
- `rarity`, `itemTypeDetail`, `slot`
- `attributeBonuses` (array)
- `causeStatusEffectOnTarget`, `causeStatusEffectOnEquipper`
- `causeStatusEffect` (legacy field)
- `level`, `relativeLevel`
- Boolean flags: `isVehicle`, `isCraftingStation`, `isProcessingStation`, `isHarvestable`, `isSalvageable`, `isContainer`
- `containedThingIds` (array of item ids held by this thing when `isContainer` is true)
- `flags` (string array) and `metadata` (object)
- `statusEffects` (array of StatusEffect)

Optional fields may be omitted when empty/undefined.

## ThingProfile (buildThingProfiles)
Included in `LocationResponse.things`.

`buildThingProfiles(...)` now returns the direct [Thing (Thing.toJSON)](#thing-thingtojson) shape for each location thing instead of maintaining a separate trimmed serializer.

## LocationExit (LocationExit.toJSON)
Fields:
- `id`, `description`, `destination`, `destinationRegion`, `travelTimeMinutes`
- `name`, `bidirectional`, `imageId`
- `isVehicle`, `vehicleType`, `type` (`two-way`/`one-way`)
- `createdAt`, `lastUpdated`

## LocationDetails (Location.getDetails)
Fields:
- `id`, `name`, `description`, `shortDescription`
- `baseLevel`, `imageId`, `visited`
- `exits`: object keyed by direction; each entry includes
  - `id`, `description`, `destination`, `destinationRegion`, `travelTimeMinutes`
  - `bidirectional`, `isVehicle`, `name`, `relativeName`, `vehicleType`
  - `exitObject` (LocationExit JSON)
- `regionId`
- `controllingFactionId` (string | null)
- `createdAt`, `lastUpdated`
- `isStub`, `hasGeneratedStubs`, `stubMetadata`
- `npcIds`, `thingIds`
- `randomEvents`, `statusEffects`, `characterConcepts`, `enemyConcepts`

## LocationResponse (buildLocationResponse)
Extends `LocationDetails` with:
- `pendingImageJobId`
- `regionName` (resolved name)
- `region` (object: `id`, `name`, `description`, `parentRegionId`, `averageLevel`, `isVehicle`, `vehicleInfo`)
- `regionPath` (array of `{ id, name }`)
- `exits` entries gain:
  - `travelTimeMinutes` (integer minutes for non-vehicle traversal time; `0` may indicate an unpopulated legacy exit time awaiting backfill)
  - `destinationName`, `destinationRegionName`, `destinationRegionExpanded`
  - `destinationIsStub`, `destinationIsRegionEntryStub`, `destinationVisited`
  - `destinationIsVehicle` (boolean; derived only from destination location/region/pending-stub vehicle state, never from `exit.isVehicle`/`exit.vehicleType`)
  - `destinationVehicleType` (string | null; destination vehicle type hint when known; never inferred solely from `exit.vehicleType`)
  - `vehicleIcon` (string | null; populated when the destination location/region is a vehicle; falls back to `🚗` when metadata is missing)
  - `isVehicleOutbound` (boolean; true when the current location context is a vehicle and the exit leaves it)
  - `isVehicleInbound` (boolean; true when the exit enters a vehicle destination from a non-vehicle context)
  - `relativeLevel` (when known)
  - vehicle exits tied to vehicle transit are omitted from the payload: boarding exits into a destination vehicle that is in transit or still finalizing arrival after `ETA`, and the active outside/disembark exit from a source vehicle in the same state
- `vehicleCurrentLocationName` (string | undefined; present when current location/region is a vehicle and the active vehicle exit resolves)
- `npcs` (NpcProfile[])
- `things` (Thing[])

## Region (Region.toJSON)
Fields:
- `id`, `name`, `description`, `shortDescription`
- `locationBlueprints`, `locationIds`, `entranceLocationId`
- `parentRegionId`, `createdAt`, `lastUpdated`
- `controllingFactionId` (string | null)
- `statusEffects`, `averageLevel`, `numImportantNPCs`
- `randomEvents`, `characterConcepts`, `enemyConcepts`, `secrets`

## NeedBar (normalizeNeedBarResponse)
Fields:
- `id`, `name`, `description`, `icon`, `color`
- `min`, `max`, `value`, `changePerMinute`, `initialValue`
- `player`, `party`, `nonParty`
- `currentThreshold` (`{ threshold, name, effect }` | null)
- `effectThresholds` (array)
- `increases`: `{ small, large, fill }`
- `decreases`: `{ small, large }`
- `relatedAttribute`, `relativeToLevel`

## DispositionSnapshot (buildNpcDispositionSnapshot)
Fields:
- `npc`: `{ id, name, isNPC }`
- `player`: `{ id, name }` | null
- `range`: `{ min, max, typicalStep, typicalBigStep }`
- `dispositions`: array of
  - `key`, `label`, `description`, `value`, `intensity`
  - `thresholds`, `moveUp`, `moveDown`, `moveWayDown`

## SettingInfo (SettingInfo.toJSON)
Core fields:
- `id`, `name`, `description`, `theme`, `genre`
- `startingLocationType`, `magicLevel`, `techLevel`, `tone`, `difficulty`
- `currencyName`, `currencyNamePlural`, `currencyValueNotes`
- `writingStyleNotes`, `baseContextPreamble`, `characterGenInstructions`
- `imagePromptPrefixCharacter`, `imagePromptPrefixLocation`, `imagePromptPrefixItem`, `imagePromptPrefixScenery`
- `playerStartingLevel`, `defaultStartingCurrency`
- `defaultPlayerName`, `defaultPlayerDescription`, `defaultStartingLocation`
- `defaultExistingSkills`, `availableClasses`, `availableRaces`, `customSlopWords`
- `createdAt`, `lastUpdated`

## Quest (Quest.toJSON)
Fields:
- `id`, `name`, `description`
- `objectives` (array of `{ id, description, completed, optional }`)
- `rewardItems`, `rewardCurrency`, `rewardXp`
- `rewardFactionReputation` (object map of `factionId -> integerDelta`, may include negative values)
- `secretNotes`, `rewardClaimed`, `paused`
- `giverId`, `giverName`, `giver`
- `completed`

## Skill (Skill.toJSON)
Fields:
- `name`, `description`, `attribute`

## MapLocationSummary (buildMapLocationSummary)
Used by map endpoints.

Fields:
- `id`, `name`, `isStub`, `visited`, `regionId`
- `isVehicle` (boolean)
- `vehicleIcon` (string | null; when `isVehicle` is true)
- `exits`: array of
  - `id`, `destination`, `destinationRegion`, `destinationRegionName`, `destinationRegionExpanded`
  - `destinationName`, `bidirectional`, `isVehicle`, `vehicleType`
  - `isVehicle`/`vehicleType` describe the travel edge only; they do not imply destination vehicle status
  - `isVehicleOutbound`, `isVehicleInbound` (booleans)
  - `vehicleIcon` (string | null; populated from destination vehicle metadata, or `🚗` fallback when destination is a vehicle but icon metadata is missing)
  - `destinationIsStub`, `destinationIsRegionEntryStub`, `destinationVisited`
  - vehicle exits tied to vehicle transit are omitted: boarding exits into a destination vehicle that is in transit or still finalizing arrival after `ETA`, and the active outside/disembark exit from a source vehicle in the same state
- `image` (optional): `{ id, url }`

## MapRegionSummary (`/api/map/world`)
Fields:
- `id`, `name`, `parentRegionId`
- `isStub` (boolean)
- `isVehicle` (boolean)
- `vehicleIcon` (string | null; when `isVehicle` is true)
- `locationIds` (string[])
- `locationCount` (number)
- `averageLevel` (number | null)
- `childRegionIds` (string[])

## Image Job
`GET /api/jobs` returns `JobSummary[]`:
- `id`, `status`, `progress`, `message`
- `createdAt`, `startedAt`, `completedAt`
- `prompt` (truncated preview)

`GET /api/jobs/:jobId` returns:
- `job`: same fields as summary
- `result` (when completed): `{ imageId, images, metadata }`
- `error` (when failed/timeout)

## Save Metadata
`GET /api/saves` returns entries seeded with:
- `saveName`, `timestamp`, `playerName`, `playerLevel`, `source`, `isAutosave`
- Additional fields from each save's `metadata.json` are merged in when present.
