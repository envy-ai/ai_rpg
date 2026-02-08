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
- `type`: string | null (examples: `player-action`, `event-summary`, `quest-reward`, `status-summary`, hidden server-only story-note attachments such as `supplemental-story-info`, `offscreen-npc-activity-daily`, `offscreen-npc-activity-weekly`)
- `summary`: string | null
- `summaryTitle`: string | null (event summaries)
- `summaryItems`: array | null (event summaries)
- `travel`: boolean | undefined
- `lastEditedAt`: ISO string | undefined (edited messages)
- `ephemeral`: boolean | undefined (system-only entries)
- `metadata`: object (always includes `locationId`; may include `requestId`, `npcNames`, `traveledToLocationId` for travel turns, quest metadata, etc.)

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
- `duration`: number | null (1 = instant, -1 = permanent)
- Modifier arrays are only included when non-empty.

## NpcProfile (serializeNpcForClient)
Returned in many player/NPC endpoints and location responses.

Fields:
- `id`, `name`, `description`, `shortDescription`
- `class`, `race`, `level`
- `health`, `maxHealth`, `healthAttribute`
- `imageId`
- `isNPC`, `isPlayer`, `isHostile`, `isDead`
- `isInPlayerParty`, `isHostileToPlayer`
- `locationId`
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
- `needBars`, `corpseCountdown`, `importantMemories`
- `quests`, `personality`, `goals`, `characterArc`

## Thing (Thing.toJSON)
Fields:
- `id`, `name`, `description`, `shortDescription`
- `thingType` (`item` or `scenery`)
- `imageId`, `createdAt`, `lastUpdated`
- `rarity`, `itemTypeDetail`, `slot`
- `attributeBonuses` (array)
- `causeStatusEffectOnTarget`, `causeStatusEffectOnEquipper`
- `causeStatusEffect` (legacy field)
- `level`, `relativeLevel`
- Boolean flags: `isVehicle`, `isCraftingStation`, `isProcessingStation`, `isHarvestable`, `isSalvageable`
- `flags` (string array) and `metadata` (object)
- `statusEffects` (array of StatusEffect)

Optional fields may be omitted when empty/undefined.

## ThingProfile (buildThingProfiles)
Included in `LocationResponse.things`.

Fields:
- `id`, `name`, `description`, `thingType`, `imageId`
- `rarity`, `itemTypeDetail`, `slot`, `attributeBonuses`
- `causeStatusEffectOnTarget`, `causeStatusEffectOnEquipper`
- `metadata`, `statusEffects`
- Boolean flags: `isVehicle`, `isCraftingStation`, `isProcessingStation`, `isHarvestable`, `isSalvageable`

## LocationExit (LocationExit.toJSON)
Fields:
- `id`, `description`, `destination`, `destinationRegion`
- `name`, `bidirectional`, `imageId`
- `isVehicle`, `vehicleType`, `type` (`two-way`/`one-way`)
- `createdAt`, `lastUpdated`

## LocationDetails (Location.getDetails)
Fields:
- `id`, `name`, `description`, `shortDescription`
- `baseLevel`, `imageId`, `visited`
- `exits`: object keyed by direction; each entry includes
  - `id`, `description`, `destination`, `destinationRegion`
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
- `region` (object: `id`, `name`, `description`, `parentRegionId`, `averageLevel`)
- `regionPath` (array of `{ id, name }`)
- `exits` entries gain:
  - `destinationName`, `destinationRegionName`, `destinationRegionExpanded`
  - `destinationIsStub`, `destinationIsRegionEntryStub`
  - `relativeLevel` (when known)
- `npcs` (NpcProfile[])
- `things` (ThingProfile[])

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
- `min`, `max`, `value`, `changePerTurn`, `initialValue`
- `playerOnly`
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
- `defaultExistingSkills`, `availableClasses`, `availableRaces`
- `createdAt`, `lastUpdated`

## Quest (Quest.toJSON)
Fields:
- `id`, `name`, `description`
- `objectives` (array of `{ id, description, completed, optional }`)
- `rewardItems`, `rewardCurrency`, `rewardXp`
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
- `exits`: array of
  - `id`, `destination`, `destinationRegion`, `destinationRegionName`, `destinationRegionExpanded`
  - `destinationName`, `bidirectional`, `isVehicle`, `vehicleType`
  - `destinationIsStub`, `destinationIsRegionEntryStub`
- `image` (optional): `{ id, url }`

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
