[./developer_overview.md]
# Developer Overview

This doc is a quick-start map to catch up at the beginning of a session. It summarizes the game, the server architecture, and where to look next for details.

## What this game is

- Server-driven, setting-agnostic, LLM-assisted RPG with persistent world state, where the LLM generates the game setting, regions, locations, NPCs, items, and so on, with varying amounts of input from the user, and then acts as the game master.
- Core entities include players/NPCs, locations/regions, items/scenery, quests, factions, skills, and status effects.
- Optional image generation via ComfyUI, NanoGPT, or OpenAI clients.

## Runtime architecture (high level)

- `server.js` bootstraps config, `Globals`, Express + HTTP, `RealtimeHub`, `ModLoader`, and Nunjucks prompt environments, then wires up core helpers.
- `api.js` registers routes; `/api/chat` is the main turn handler (prompt rendering, LLM call, parsing, autosave, and response shaping).
- `Events.js` runs structured LLM event checks and applies world mutations (locations, NPCs, items, quests, status effects).
- `LLMClient.js` owns chat completions: concurrency limits, streaming progress, retries, and prompt logging to `logs/`.

## Core domain models

- `Player` models players/NPCs, with attributes, inventory, gear, quests, dispositions, needs, and progression.
- `Location` and `Region` model the world; `LocationExit` defines travel links.
- `Thing` models items/scenery with rarity, bonuses, and status effects.
- `Faction`, `Quest`, `StatusEffect`, and `Skill` define game systems.
- `Globals` provides access to current player/location/region, config, prompt env, and realtime emit helpers.
- `SceneSummaries`, `SettingInfo`, and `LorebookManager` support memory, settings, and lorebook injection.

## Turn flow mental model

1. Client sends a chat/action to `/api/chat`.
2. Server applies state ticks (status effects, travel metadata) and renders prompt templates.
3. `LLMClient.chatCompletion` runs; progress is broadcast via `RealtimeHub` and prompts are logged.
4. Responses are parsed; `Events.runEventChecks` may apply structured outcomes.
5. Slop/repetition handling runs where applicable; autosaves and response payloads are emitted.

## API + command surface

- High-level API index: `docs/API_README.md`; detailed endpoints: `docs/api/*`.
- Shared response shapes: `docs/api/common.md`.
- Slash command pipeline: `docs/slash_commands.md` and `docs/slashcommands/*`.

## Where to look first (session warm-up)

- `AGENTS.md` for repo-specific constraints and coding rules.
- `docs/README.md` for the full documentation map.
- `docs/server_llm_notes.md` for the end-to-end server + LLM flow.
- `docs/classes/LLMClient.md` and `docs/classes/Events.md` for generation and event-check details.
- `docs/classes/Player.md`, `docs/classes/Location.md`, `docs/classes/Region.md`, `docs/classes/Thing.md` for world state.

## Known quirks

- `/api/attributes` is defined twice; Express binds the first definition (see `docs/api/attributes.md`).


[./README.md]
# Docs Table of Contents

This index lists every other Markdown file under `docs/` with a brief description.

## Root docs

- [API_README.md](API_README.md) — High-level index of Express routes registered in `api.js`, pointing to detailed endpoint docs in `docs/api/`.
- [developer_overview.md](developer_overview.md) — Quick-start developer overview of the game, architecture, and where to look first.
- [potential_redundancies.md](potential_redundancies.md) — List of potential redundancies/inconsistencies found across docs and code, with suggested fixes.
- [server_llm_notes.md](server_llm_notes.md) — Deep notes on `server.js`, `api.js`, `Events.js`, and `LLMClient.js` responsibilities and flow.
- [slash_commands.md](slash_commands.md) — Quick guide to slash command lifecycle, shape, arg parsing, interaction API, best practices, example, and testing.
- [slop_and_repetition.md](slop_and_repetition.md) — Overview of slop checking and repetition-busting systems, detection logic, and key files.

## UI docs (`docs/ui`)

- [ui/README.md](ui/README.md) — UI documentation index and scope.
- [ui/pages.md](ui/pages.md) — Route-to-template map with scripts and injected data.
- [ui/chat_interface.md](ui/chat_interface.md) — Main chat UI layout, behavior, data flow, and LLM modal submit behavior.
- [ui/modals_overlays.md](ui/modals_overlays.md) — Inventory of chat-page modals/overlays, including immediate-close LLM modals.
- [ui/maps.md](ui/maps.md) — Region and world map rendering and interactions.
- [ui/assets_styles.md](ui/assets_styles.md) — Styling, assets, and vendor libraries.

## API reference (`docs/api`)

- [api/attributes.md](api/attributes.md) — Attributes endpoints; notes the duplicate route definitions in `api.js` and that only the first binds.
- [api/chat.md](api/chat.md) — Chat endpoints, sorted by path; references shared payloads in `docs/api/common.md`.
- [api/common.md](api/common.md) — Shared response shapes and conventions referenced by multiple endpoints.
- [api/crafting.md](api/crafting.md) — Crafting endpoints; references shared payloads in `docs/api/common.md`.
- [api/factions.md](api/factions.md) — Faction listing and player standings endpoints.
- [api/game.md](api/game.md) — Game lifecycle endpoints; references shared payloads in `docs/api/common.md`.
- [api/images.md](api/images.md) — Image generation and job endpoints; references job shapes in `docs/api/common.md`.
- [api/locations.md](api/locations.md) — Location and exit endpoints; references shared shapes in `docs/api/serialization.md`.
- [api/lorebooks.md](api/lorebooks.md) — Lorebook listing endpoints with metadata details.
- [api/map.md](api/map.md) — Legacy index for map endpoints; points to newer docs.
- [api/misc.md](api/misc.md) — Misc/utility endpoints (currently the image-gen feature flag).
- [api/npcs.md](api/npcs.md) — NPC endpoints; references shared payloads in `docs/api/common.md`.
- [api/players.md](api/players.md) — Player and party endpoints; references shared payloads in `docs/api/common.md`.
- [api/quests.md](api/quests.md) — Quest endpoints; references shared payloads in `docs/api/common.md`.
- [api/regions.md](api/regions.md) — Region endpoints; references shared payloads in `docs/api/common.md`.
- [api/serialization.md](api/serialization.md) — Legacy index for shared shapes; points to `docs/api/common.md` as authoritative.
- [api/settings.md](api/settings.md) — Settings endpoints; references shared payloads in `docs/api/common.md`.
- [api/things.md](api/things.md) — Things and inventory endpoints; references shared payloads in `docs/api/common.md`.

## Class reference (`docs/classes`)

- [classes/ComfyUIClient.md](classes/ComfyUIClient.md) — Client for ComfyUI servers: queue workflows, poll status, download images, and save results.
- [classes/Events.md](classes/Events.md) — LLM-based event checks that parse structured outcomes and apply world mutations.
- [classes/Faction.md](classes/Faction.md) — Faction model with goals/tags/relations/assets/reputation and static indexes.
- [classes/Globals.md](classes/Globals.md) — Centralized static state/helpers for current player, locations, regions, and prompt wiring.
- [classes/LLMClient.md](classes/LLMClient.md) — LLM chat client with concurrency, streaming, retries, prompt logging, and cancellation utilities.
- [classes/Location.md](classes/Location.md) — Location model (description, exits, NPCs, items, status effects) with stub promotion support.
- [classes/LocationExit.md](classes/LocationExit.md) — Connection between locations/regions, with optional vehicle semantics and bidirectional travel.
- [classes/LorebookManager.md](classes/LorebookManager.md) — Lorebook manager for JSON lorebooks: load, enable/disable, keyword match, and prompt injection.
- [classes/ModLoader.md](classes/ModLoader.md) — Mod loader for `mods/` with per-mod scope helpers, configs, and client asset discovery.
- [classes/NanoGPTImageClient.md](classes/NanoGPTImageClient.md) — NanoGPT image generation client that saves returned base64 images to disk.
- [classes/OpenAIImageClient.md](classes/OpenAIImageClient.md) — OpenAI image generation client that saves returned base64 images to disk.
- [classes/Player.md](classes/Player.md) — Player/NPC model (attributes, skills, inventory, gear, needs, quests) with shared definitions.
- [classes/Quest.md](classes/Quest.md) — Quest model with objectives/rewards/giver info, completion state, and static indexes.
- [classes/QuestConfirmationManager.md](classes/QuestConfirmationManager.md) — Manages async quest confirmations per client via `Globals.emitToClient`.
- [classes/RealtimeHub.md](classes/RealtimeHub.md) — WebSocket hub for realtime updates with targeted send, broadcast, and typed emits.
- [classes/Region.md](classes/Region.md) — Region model containing locations, metadata, random events, and status effects.
- [classes/SanitizedStringMap.md](classes/SanitizedStringMap.md) — Map wrapper that normalizes string keys for case/punctuation-insensitive lookup.
- [classes/SanitizedStringSet.md](classes/SanitizedStringSet.md) — Set wrapper that normalizes string values for case/punctuation-insensitive lookup.
- [classes/SceneSummaries.md](classes/SceneSummaries.md) — Stores scene summaries from chat history and tracks scene ranges and NPC names.
- [classes/SettingInfo.md](classes/SettingInfo.md) — Game setting/world configuration (theme/genre/prompts/defaults) with persistence support.
- [classes/Skill.md](classes/Skill.md) — Skill model with name, description, and optional attribute association.
- [classes/StatusEffect.md](classes/StatusEffect.md) — Status effect model for modifiers, need-bar deltas, and duration semantics.
- [classes/Thing.md](classes/Thing.md) — Item/scenery model with rarity, bonuses, status effects, placement, and indexes.
- [classes/Utils.md](classes/Utils.md) — Utility helpers (set math, text similarity, XML parsing, serialization, stub maintenance).

## Design ideas (`docs/ideas`)

- [ideas/DayNightCycle.md](ideas/DayNightCycle.md) — Design draft for a day/night cycle affecting danger, services, and NPC behavior.
- [ideas/Factions.md](ideas/Factions.md) — Design draft for faction systems and emergent conflict/cooperation.
- [ideas/dramatis_personae.md](ideas/dramatis_personae.md) — Brainstorm for a nemesis-style, setting-agnostic recurring NPC cast system.
- [ideas/Vechicles2.md](ideas/Vechicles2.md) — Setting-agnostic vehicle brainstorm across items, scenery, NPCs, locations, and regions.
- [ideas/vehicles.md](ideas/vehicles.md) — Brainstorm of vehicle concepts spanning items, scenery, NPCs, locations, and regions.

## Slash command reference (`docs/slashcommands`)

- [slashcommands/Command.md](slashcommands/Command.md) — `/awardxp` command to grant experience points.
- [slashcommands/ExportHistoryCommand.md](slashcommands/ExportHistoryCommand.md) — `/export_history` command to export chat history to text/HTML.
- [slashcommands/GetConfigCommand.md](slashcommands/GetConfigCommand.md) — `/get` command to retrieve a nested config value.
- [slashcommands/HealCommand.md](slashcommands/HealCommand.md) — `/heal` (alias `/resurrect`) command to restore NPC health and clear death.
- [slashcommands/HelpCommand.md](slashcommands/HelpCommand.md) — `/help` command to list available slash commands and usage.
- [slashcommands/IncapacitateCommand.md](slashcommands/IncapacitateCommand.md) — `/incapacitate` command to drop an NPC to zero health without killing.
- [slashcommands/KillCommand.md](slashcommands/KillCommand.md) — `/kill` command to immediately kill an NPC by name.
- [slashcommands/RandomCommand.md](slashcommands/RandomCommand.md) — `/random` command to trigger a random event by type.
- [slashcommands/RegexReplaceCommand.md](slashcommands/RegexReplaceCommand.md) — `/regex_replace` command to run regex replacement across chat history.
- [slashcommands/ReloadConfigCommand.md](slashcommands/ReloadConfigCommand.md) — `/reload_config` command to reload config files and definition caches.
- [slashcommands/ReloadLorebooksCommand.md](slashcommands/ReloadLorebooksCommand.md) — `/reload_lorebooks` command to reload lorebooks from disk.
- [slashcommands/RespecAbilitiesCommand.md](slashcommands/RespecAbilitiesCommand.md) — `/respec_abilities` command to regenerate abilities from a start level.
- [slashcommands/RpCommand.md](slashcommands/RpCommand.md) — `/rp` command to toggle roleplay mode and related config checks.
- [slashcommands/SceneSummaryCommand.md](slashcommands/SceneSummaryCommand.md) — `/summarize` (alias `/scene_summary`) command to export scene summaries.
- [slashcommands/ShortDescriptionCheckCommand.md](slashcommands/ShortDescriptionCheckCommand.md) — `/short_description_check` command to list missing short descriptions for regions, locations, things, and abilities.
- [slashcommands/SetConfigCommand.md](slashcommands/SetConfigCommand.md) — `/set` command to update a nested config value at runtime.
- [slashcommands/SlashCommandBase.md](slashcommands/SlashCommandBase.md) — Base class for slash commands: metadata, arg validation, and listing.
- [slashcommands/SlopwordsCommand.md](slashcommands/SlopwordsCommand.md) — `/slopwords` command to report slop words over ppm thresholds.
- [slashcommands/TeleportCommand.md](slashcommands/TeleportCommand.md) — `/teleport` command to move the player to a location by id or name.
- [slashcommands/WorldOutlineCommand.md](slashcommands/WorldOutlineCommand.md) — `/world_outline` command to list regions, locations, and pending stubs.


[./api/attributes.md]
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


[./api/chat.md]
# Chat API

Entries are sorted by path. Common payloads (ChatEntry, ActionResolution, etc.) are defined in `docs/api/common.md`.

## POST /api/chat
Primary turn-resolution endpoint.

Request:
- Body:
  - `messages` (required): array of chat messages; at minimum the last entry should be `{ role, content }`.
  - `clientId` (optional string): enables realtime streaming events.
  - `requestId` (optional string): echoed back in `streamMeta` and chat metadata.
  - `travel` (optional boolean): marks the user message as a travel action.
  - `travelMetadata` (optional object): required for event-driven travel; normalized to:
    - `mode` (string | null)
    - `eventDriven` (boolean)
    - `exit` object:
      - `originLocationId` (string, required)
      - `destinationId` (string, required)
      - `exitId` (string | null)
      - `direction` (string | null)
      - `destinationRegionId` (string | null)
      - `destinationIsStub` (boolean)
      - `destinationIsRegionEntryStub` (boolean)
      - `isVehicle` (boolean)
      - `vehicleType` (string | null)
      - `destinationName` (string | null)
      - `regionName` (string | null)

Response (200):
- Base fields:
  - `response`: string (final prose)
  - `messages`: ChatEntry[] (new entries appended this request)
- Optional fields (present when relevant):
  - `summary`: string
  - `aiUsage`: object (token usage metrics)
  - `slopRemoval`: `{ slopWords: string[], slopNgrams: string[] }`
  - `debug`: object (debug payload, when enabled)
  - `actionResolution`: ActionResolution
  - `attackCheck`: object (attack roll details)
  - `attackSummary`: string
  - `attackDamage`: object
  - `plausibility`: `{ type, reason }`
  - `eventChecks`: string (HTML summary)
  - `events`: object | array
  - `experienceAwards`, `currencyChanges`, `environmentalDamageEvents`, `needBarChanges`: arrays
  - `questsAwarded`, `questRewards`, `questObjectivesCompleted`, `followupEventChecks`: arrays
  - `npcTurns`: array (NPC turn payloads)
  - `npcUpdates`: `{ added: string[], departed: string[], movedLocations: string[] }`
  - `locationRefreshRequested`: boolean
  - `corpseRemovals`, `corpseCountdownUpdates`: arrays
  - `requestId`: string (when supplied)
  - `streamMeta`: object (streaming metadata when realtime is enabled)
  - `commentLogged`: boolean (comment-only actions)

Variants:
- Comment-only action: if the user message begins with `#`, the response is `{ response: '', commentLogged: true, messages: [...] }` (no turn resolution).
- Forced-event action: user message begins with `!!`; creative action begins with `!`. These alter processing but do not change the base response shape.
- When realtime streaming is enabled, the final response may omit `eventChecks`, `events`, and other event artifacts (they are stripped for streaming clients).

Errors:
- 400: `{ error: string, requestId?, streamMeta? }` (missing `messages`, invalid `travelMetadata`, etc.)
- 408: `{ error: string, requestId?, streamMeta? }` (timeout)
- 503: `{ error: string, requestId?, streamMeta? }` (connection issues)
- 500: `{ error: string, requestId?, streamMeta? }`

## GET /api/chat/history
Returns pruned chat history (system entries and some summaries filtered).

Response (200):
- `{ history: ChatEntry[], count: number }` (no `success` flag)

## DELETE /api/chat/history
Clears chat history.

Response (200):
- `{ message: 'Chat history cleared', count: 0 }` (no `success` flag)

## PUT /api/chat/message
Edits a single chat entry by id or timestamp.

Request:
- Body: `{ content: string, id?: string, timestamp?: string }` (must include `content` and either `id` or `timestamp`)

Response:
- 200: `{ success: true, entry }`
- 400: `{ success: false, error }` (missing content/id)
- 404: `{ success: false, error: 'Message not found' }`

Notes:
- Editing an `event-summary` entry clears `summaryItems` and normalizes `summaryTitle`.

## DELETE /api/chat/message
Deletes a chat entry by id or timestamp and removes orphaned children.

Request:
- Body: `{ id?: string, timestamp?: string }`

Response:
- 200: `{ success: true, removed: ChatEntry, orphaned: ChatEntry[] }`
- 400: `{ success: false, error }`
- 404: `{ success: false, error: 'Message not found' }`


[./api/common.md]
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
- `type`: string | null (examples: `player-action`, `event-summary`, `quest-reward`, `status-summary`)
- `summary`: string | null
- `summaryTitle`: string | null (event summaries)
- `summaryItems`: array | null (event summaries)
- `travel`: boolean | undefined
- `lastEditedAt`: ISO string | undefined (edited messages)
- `ephemeral`: boolean | undefined (system-only entries)
- `metadata`: object (always includes `locationId`; may include `requestId`, `npcNames`, quest metadata, etc.)

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
- `skills`, `abilities`, `unspentSkillPoints`
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
- `defaultNumSkills`, `defaultExistingSkills`, `availableClasses`, `availableRaces`
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


[./api/crafting.md]
# Crafting API

Common payloads: see `docs/api/common.md` (ActionResolution, Thing).

## POST /api/craft
Resolve crafting/processing/salvage/harvest actions.

Request:
- Body:
  - `slots` (required): array of `{ thingId: string, slotIndex?: number }`
  - `mode`: `craft` | `process` | `salvage` | `harvest` (default `craft`)
  - `actionType`: optional alias for `mode`
  - `craftTargetType`: `item` | `scenery` (used only for craft mode)
  - `intendedItemName`, `notes` (string)
  - Station info: `stationThingId`, `stationName`
  - Salvage info (used for salvage): `salvageItemId`, `salvageItemName`, `salvageItemDescription`, `salvageNotes`
  - Harvest info (used for harvest): `harvestItemId`, `harvestItemName`, `harvestItemDescription`, `harvestNotes`

Response:
- 200: `{ success: true, outcome, resultLevel, craftedItem, craftedItems, recoveredItems, consumedThingIds, narrative, plausibility, unmatchedConsumedNames }`
  - `outcome`: ActionResolution
  - `resultLevel`: string mapping the success degree (e.g., `success`, `failure`, `major_success`)
  - `craftedItem`: Thing | null
  - `craftedItems`: Thing[]
  - `recoveredItems`: Thing[] (salvage/harvest)
  - `consumedThingIds`: string[]
  - `narrative`: `{ description: string, otherEffect: string | null }`
  - `plausibility`: `{ type, reason }`
  - `unmatchedConsumedNames`: string[]
- 400: `{ success: false, error }` (invalid payload, implausible crafting, missing slots)
- 500: `{ success: false, error }`

Notes:
- Salvage/harvest require exactly one slot item.
- When `actionType` is supplied, it overrides `mode` in some cases.


[./api/factions.md]
# Factions API

## GET /api/factions
List all factions and current player standings.

Response:
- 200: `{ success: true, factions: Faction[], playerStandings: Record<factionId, number>, playerId }`
- 500: `{ success: false, error }`

## POST /api/factions
Create a new faction.

Request:
- Body: `{ name: string, shortDescription?: string|null, description?: string|null, tags?: string[]|string, goals?: string[]|string, homeRegionName?: string, assets?: Array<{ name: string, type?: string, description?: string }>, relations?: Record<factionId, { status: 'allied'|'neutral'|'hostile'|'rival', notes: string }>, reputationTiers?: Array<{ threshold: number, label?: string, perks?: string[]|string, penalties?: string[]|string }> }`

Response:
- 201: `{ success: true, faction: Faction }`
- 400: `{ success: false, error }`
- 500: `{ success: false, error }`

Notes:
- Faction name `"None"` is reserved and cannot be created.

## PUT /api/factions/:id
Update a faction.

Request:
- Path: `id` (faction id)
- Body supports: `name`, `shortDescription`, `description`, `tags`, `goals`, `homeRegionName`, `assets`, `relations`, `reputationTiers`

Response:
- 200: `{ success: true, faction: Faction }`
- 400/404/500 with `{ success: false, error }`

Notes:
- Faction name `"None"` is reserved and cannot be set.

## DELETE /api/factions/:id
Delete a faction, remove relations pointing to it, and clear affiliations/standings.

Response:
- 200: `{ success: true, removed: Faction }`
- 400/404/500 with `{ success: false, error }`

## PUT /api/player/factions/:id/standing
Set or clear the current player's standing with a faction.

Request:
- Path: `id` (faction id)
- Body: `{ value: number | null }` (`null` removes the standing entry)

Response:
- 200: `{ success: true, factionId, standings: Record<factionId, number> }`
- 400/404/500 with `{ success: false, error }`


[./api/game.md]
# Game Lifecycle API

Common payloads: see `docs/api/common.md`.

## POST /api/new-game
Start a new game session.

Request:
- Body supports: `playerName`, `playerDescription`, `playerClass`, `playerRace`, `startingLocation`, `numSkills`, `existingSkills`, `startingCurrency`, `clientId`, `requestId`

Response:
- 200: `{ success: true, message, player, startingLocation, region, skills, gameState }`
  - `player`: `Player.toJSON()` (not NpcProfile)
  - `startingLocation`: LocationDetails + `pendingImageJobId` + `npcs`
  - `region`: Region JSON
  - `skills`: Skill[]
  - `factions`: Faction[]
  - `gameState`: `{ totalPlayers, totalLocations, currentLocation, regionEntranceId }`
- 400: `{ success: false, error }` (no active setting)
- 500: `{ success: false, error, details }`

Notes:
- When `clientId` is provided, realtime status events are emitted during generation.

## POST /api/save
Save the current game.

Response:
- 200: `{ success: true, saveName, saveDir, metadata, message }`
- 400/500 with `{ success: false, error }`

## POST /api/load
Load a saved game.

Request:
- Body: `{ saveName: string, saveType?: 'autosaves'|'saves', clientId?: string }`

Response:
- 200: `{ success: true, saveName, source, metadata, loadedData, message }`
  - `loadedData`: `{ currentPlayer: NpcProfile|null, totalPlayers, totalThings, totalLocations, totalLocationExits, chatHistoryLength, totalGeneratedImages, currentSetting }`
- 400/404/500 with `{ success: false, error }`

## GET /api/saves
List available saves.

Request:
- Query: `type` (`saves` or `autosaves`, default `saves`)

Response:
- 200: `{ success: true, type, saves, count, message }`
  - `saves` entries include baseline metadata and fields from each save's `metadata.json`.
- 400/500 with `{ success: false, error }`

## DELETE /api/save/:saveName
Delete a save.

Response:
- 200: `{ success: true, saveName, message }`
- 404/500 with `{ success: false, error }`

## POST /api/summaries/style
Update summary style in save metadata.

Request:
- Body: `{ style: 'line' | 'scene' }`

Response:
- 200: `{ success: true, summaryStyle, persisted }`
- 400/500 with `{ success: false, error }`

## GET /api/short-descriptions/pending
Check for pending short-description backfill work.

Request:
- Query: `clientId` (required)

Response:
- 200: `{ success: true, pending, plan }`
  - `plan` includes counts/prompts/batch size per entity type.
- 400/500 with `{ success: false, error }`

## POST /api/short-descriptions/process
Run or skip short-description backfill.

Request:
- Body: `{ clientId: string, action: 'run'|'process'|'skip'|'dismiss' }`

Response:
- 200: `{ success: true, processed: true }` or `{ success: true, skipped: true }`
- 400/404/409/500 with `{ success: false, error }`


[./api/images.md]
# Images & Jobs API

Common payloads: see `docs/api/common.md` (Job shapes).

## POST /api/images/request
Unified image generation entry point.

Request:
- Body: `{ entityType: 'player'|'npc'|'location'|'exit'|'location-exit'|'thing'|'item'|'scenery', entityId: string, force?: boolean, clientId?: string }`

Response:
- 200: `{ success, entityType, entityId, jobId?, job?, imageId?, skipped, reason, message, existingJob }`
- 202: same payload when `skipped` is true
- 409: same payload when generation failed and no existing job
- 400/404/500 with `{ success: false, error }`

Notes:
- If an existing job is found, the endpoint returns 200 with `success: false` and `existingJob: true`.

## POST /api/generate-image
Legacy custom image generation endpoint.

Request:
- Body: `{ prompt: string, width?, height?, seed?, negative_prompt?, async?: boolean, clientId?: string }`

Response:
- 200 (async, default): `{ success: true, jobId, status, message, estimatedTime }`
- 200 (sync, legacy mode when `async=false`): `{ success: true, imageId, images, metadata, processingTime }`
- 400/500 with `{ success: false, error }`

Notes:
- The sync mode is explicitly marked as legacy in code.

## GET /api/jobs/:jobId
Fetch job status.

Response:
- 200: `{ success: true, job, result?, error? }`
- 404: `{ success: false, error }`

## DELETE /api/jobs/:jobId
Cancel a job.

Response:
- 200: `{ success: true, message }`
- 400: `{ success: false, error }` (job already completed/failed)
- 404: `{ success: false, error }`

## GET /api/jobs
List all jobs.

Response:
- 200: `{ success: true, jobs: JobSummary[], queue: { pending, processing } }`

## GET /api/images/:imageId
Fetch image metadata.

Response:
- 200: `{ success: true, metadata }`
- 404: `{ success: false, error }`

## GET /api/images
List all generated images.

Response:
- 200: `{ success: true, images, count }`


[./api/locations.md]
# Location & Exit API (from api.js)

See `docs/api/serialization.md` for shared shapes.

## GET /api/exits/options

Request:
- Query: `originLocationId` (optional)

Responses:
- 200: `{ success: true, regions, originRegionId? }`
  - `regions` is a list of region option groups:
    - `{ id, name, isStub, locations: Array<{ id, name, isStub, regionId, isRegionEntryStub }> }`
- 500: `{ success: false, error }`

## GET /api/locations

Request:
- Query: `scope=current|named|names` (optional)

Responses:
- 200 (scope=current): `{ success: true, location: LocationResponse }`
- 200 (default list): `{ success: true, locations: Array<{ id, name, regionId, regionName, label }> }`
- 404: `{ success: false, error }` (scope=current with no current location)
- 500: `{ success: false, error }`

## POST /api/locations/generate

Request:
- Body: `{ clientId?, requestId?, locationStyle? }` plus optional generation inputs.

Responses:
- 200: `{ success: true, location, locationId, locationName, gameWorldStats, generationInfo, message, requestId? }`
  - `location` matches `LocationResponse` with `pendingImageJobId`, `npcs`, and `things` populated.
- 408: `{ success: false, error, details, requestId? }` (AI timeout)
- 503: `{ success: false, error, details, requestId? }` (AI connection failure)
- 500: `{ success: false, error, details, requestId? }`

Notes:
- Emits realtime events when `clientId` is provided (`generation_status`, `location_generated`).

## GET /api/locations/:id

Request:
- Path: `id`
- Query: `expandStubs` (default true; `0|false|no|off` disables)

Responses:
- 200: `{ success: true, location: LocationResponse }`
- 404: `{ success: false, error }`
- 500: `{ success: false, error, trace? }` (stub expansion failures may include `trace`)

## PUT /api/locations/:id

Request:
- Body:
  - `description` (required string)
  - `level` (required number)
  - `name` (string or null, optional)
  - `shortDescription` (string or null, optional)
  - `controllingFactionId` (string or null, optional)
  - `statusEffects` (array or null, optional)

Responses:
- 200: `{ success: true, message, location: LocationResponse, imageCleared: boolean, changes: { name, description, level } }`
- 400/404/500: `{ success: false, error }`

Notes:
- `controllingFactionId` must reference an existing faction id or be `null` to clear.

## POST /api/locations/:id/exits

Request:
- Body supports:
  - `type` (`location` or `region`)
  - `name`, `description`
  - `regionId` (target region id), `locationId` (target location id)
  - `parentRegionId` (for region stubs)
  - `vehicleType` (string)
  - `relativeLevel` (number, -10..10)
  - `clientId` (for realtime notifications)
  - `imageDataUrl`, `imageDataUrlOriginal` (PNG data URLs for reference images; only for new stubs)

Responses:
- 200: `{ success: true, message, location: LocationResponse, created }`
  - `created` varies:
    - Region stub: `{ type: 'region', stubId, regionId, name, parentRegionId, isVehicle, vehicleType }`
    - Existing location: `{ type: 'location', destinationId, name, isStub, existing: true, isVehicle, vehicleType }`
    - New location stub: `{ type: 'location', destinationId, name, isStub, isVehicle, vehicleType }`
- 400/404/500: `{ success: false, error }`

## DELETE /api/locations/:id/exits/:exitId

Request:
- Optional Body or Query: `clientId`, `requestId` (used for realtime notifications)

Responses:
- 200: `{ success: true, message, location: LocationResponse, removed, reverseRemoved?, deletedStub?, preservedStub? }`
  - `removed`: `{ exitId, direction }`
  - `reverseRemoved`: `{ exitId, direction }` when a reverse exit is removed
  - `deletedStub`: stub deletion info when removing the last exit of a stub
  - `preservedStub`: stub info when stub remains but loses this exit
- 400/404/500: `{ success: false, error }`

## POST /api/locations/:id/npcs

Request:
- Body supports seed fields: `name` (required), `description`, `shortDescription`, `role`, `class`, `race`,
  `currency`, `level`, `isHostile`, `notes`, plus optional `imageDataUrl` + `imageDataUrlOriginal` (PNG data URLs)

Responses:
- 200: `{ success: true, npc: NpcProfile, location: LocationResponse, message }`
- 400/404/500: `{ success: false, error }`

## POST /api/locations/:id/things

Request:
- Body: `{ seed: { name (required), description?, shortDescription?, type?, slot?, rarity?, itemOrScenery?, value?, weight?, level?, relativeLevel?, isVehicle?, isHarvestable?, isCraftingStation?, isProcessingStation?, isSalvageable?, notes? }, level? }`

Responses:
- 200: `{ success: true, thing: ThingJson, location: LocationResponse, message }`
- 400/404/500: `{ success: false, error }`

## GET /api/stubs/:id

Responses:
- 200: `{ success: true, stub: { id, name, isRegionEntryStub, targetRegionId, targetRegionName, controllingFactionId, npcs } }`
- 400/404/500: `{ success: false, error }`

## PUT /api/stubs/:id

Request:
- Body: `name` (required), `description` (required), `relativeLevel?` (number), `controllingFactionId?` (string or null)

Responses:
- 200: `{ success: true, stub: { id, name, description, relativeLevel, isRegionEntryStub, targetRegionId, targetRegionName, controllingFactionId } }`
- 400/404/500: `{ success: false, error }`

Notes:
- `controllingFactionId` must reference an existing faction id or be `null` to clear.

## DELETE /api/stubs/:id

Responses:
- 200: `{ success: true, stubId, targetRegionId, removedExitIds, deletedNpcIds, npcSummaries }`
- 400/404/500: `{ success: false, error }`


[./api/lorebooks.md]
# Lorebooks API

## GET /api/lorebooks
List all lorebooks with metadata.

Response:
- 200: `{ success: true, lorebooks }`
  - `lorebooks` entries: `{ filename, name, entryCount, tokenEstimate, enabled }`
- 503/500 with `{ success: false, error }`

## GET /api/lorebooks/:filename
Fetch a lorebook with entries.

Response:
- 200: `{ success: true, lorebook }`
  - `lorebook` fields: `filename`, `name`, `entryCount`, `tokenEstimate`, `enabled`, `entries`
  - `entries` elements: `{ uid, key, content, comment, enabled, constant, priority, insertion_order }`
- 404/503/500 with `{ success: false, error }`

## POST /api/lorebooks/:filename/enable
Enable a lorebook.

Response:
- 200: `{ success: true, message, activeEntries }`
- 404/503/500 with `{ success: false, error }`

## POST /api/lorebooks/:filename/disable
Disable a lorebook.

Response:
- 200: `{ success: true, message, activeEntries }`
- 503/500 with `{ success: false, error }`

## DELETE /api/lorebooks/:filename
Delete a lorebook.

Response:
- 200: `{ success: true, message }`
- 404/503/500 with `{ success: false, error }`

## POST /api/lorebooks/upload
Upload a new lorebook.

Request:
- Body: `{ filename: string, content: string }`

Response:
- 200: `{ success: true, message, entryCount }`
- 400/503 with `{ success: false, error }`


[./api/map.md]
# Map API (legacy index)

Map endpoints are documented under:
- `docs/api/locations.md` (see the Map API section)
- Shared shapes used by map responses are in `docs/api/common.md`

This file is retained for backward references and intentionally contains no duplicated schemas.


[./api/misc.md]
# Misc & Utility API

## GET /api/features/location-image-generation
Return image-generation feature flag.

Response:
- 200: `{ enabled: boolean }` (no `success` flag)
- 500: `{ error }`

## GET /api/hello
Simple health check.

Response:
- 200: `{ message: 'Hello World!', timestamp, port }` (no `success` flag)

## POST /api/test-config
Test AI endpoint configuration.

Request:
- Body: `{ endpoint: string, apiKey: string, model: string }`

Response:
- 200: `{ success: true, message: 'Configuration test successful' }`
- 400/408/503/500: `{ error }` (no `success` flag)

## POST /api/prompts/:promptId/cancel
Cancel an in-flight LLM prompt.

Response:
- 200: `{ success: true, message }`
- 400/404: `{ success: false, error }`

## POST /api/slash-command
Execute a registered slash command.

Request:
- Body: `{ command: string, args?: object, argsText?: string, userId?: string }`

Response:
- 200: `{ success: true, replies: array }`
- 400/404/500 with `{ success: false, error | errors }`


[./api/npcs.md]
# NPC API

Common payloads: see `docs/api/common.md`.

## GET /api/npcs/:id
Fetch full NPC status (uses `Player.getStatus()`).

Response:
- 200: `{ success: true, npc }` (PlayerStatus shape; may include `intrinsicStatusEffects`)
- 400/404/500 with `{ success: false, error }`

## PUT /api/npcs/:id
Update an NPC's core data.

Request:
- Path: `id`
- Body supports: `name`, `description`, `shortDescription`, `race`, `class`, `factionId`, `level`, `health`, `healthAttribute`, `attributes`, `skills`, `abilities`, `unspentSkillPoints`, `currency`, `experience`, `isDead`, `personalityType`, `personalityTraits`, `personalityNotes`, `statusEffects`

Response:
- 200: `{ success: true, npc: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

Notes:
- Unknown skills may trigger skill generation; canonical names are normalized before assignment.
- `factionId` must reference an existing faction id or be `null` to clear membership.

## POST /api/npcs/:id/equipment
Equip or unequip an item in an NPC's inventory.

Request:
- Body: `{ itemId: string, action?: 'equip'|'unequip'|false, slotName?: string, slotType?: string }`

Response:
- 200: `{ success: true, npc: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

## GET /api/npcs/:id/needs
Fetch need bars for an NPC.

Response:
- 200: `{ success: true, needs: NeedBar[], includePlayerOnly, npc, player? }`
- 400/404/500 with `{ success: false, error }`

## PUT /api/npcs/:id/needs
Update need bars for an NPC.

Request:
- Body: `{ needs: Array<{ id: string, value: number }> }`

Response:
- 200: `{ success: true, message, needs: NeedBar[], includePlayerOnly, npc, applied: NeedBar[] }`
- 400/404/500 with `{ success: false, error }`

## GET /api/npcs/:id/dispositions
Fetch disposition values toward the current player.

Response:
- 200: `{ success: true, npc, player, range, dispositions }`
- 400/404/500 with `{ success: false, error }`

## PUT /api/npcs/:id/dispositions
Update disposition values.

Request:
- Body: `{ dispositions?: Array<{ key, value }> }`

Response:
- 200: `{ success: true, message, npc, player, range, dispositions, applied }`
- 400/404/500 with `{ success: false, error }`

Notes:
- If `dispositions` is omitted, the endpoint returns the snapshot with an empty `applied` array.

## PUT /api/npcs/:id/memories
Replace important memories.

Request:
- Body: `{ memories: string[] }`

Response:
- 200: `{ success: true, npc: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

## PUT /api/npcs/:id/goals
Replace NPC goals.

Request:
- Body: `{ goals: string[] }`

Response:
- 200: `{ success: true, npc: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

## POST /api/npcs/:id/teleport
Teleport an NPC to another location.

Request:
- Body: `{ locationId: string }`

Response:
- 200: `{ success: true, npc: NpcProfile, destination: LocationResponse, previousLocation: LocationResponse, locationIds: string[], message }`
- 400/404/500 with `{ success: false, error }`

## DELETE /api/npcs/:id
Delete an NPC.

Response:
- 200: `{ success: true, message, locationId, regionId }`
- 400/404/500 with `{ success: false, error }`

## POST /api/npcs/:id/portrait
Trigger portrait generation for an NPC.

Request:
- Path: `id`
- Body: `{ clientId?: string }`

Response:
- 200: `{ success: true, npc: { id, name, imageId }, imageGeneration, message }`
- 202: `{ success: false, npc: { ... }, imageGeneration, message }` (existing job)
- 409: `{ success: false, error, reason, npc: { ... } }` (skipped)
- 503: `{ success: false, error }`
- 404/500 with `{ success: false, error }`


[./api/players.md]
# Players & Party API

Common payloads: see `docs/api/common.md`.

## POST /api/player
Create a new player and set as current.

Request:
- Body (optional): `{ name?: string, attributes?: object, level?: number }`

Response:
- 200: `{ success: true, player: NpcProfile, message }`
- 400: `{ success: false, error }`

## GET /api/player
Get the current player.

Response:
- 200: `{ success: true, player: NpcProfile }`
- 404: `{ success: false, error: 'No current player found' }`

## GET /api/players
List all players.

Response:
- 200: `{ success: true, players: NpcProfile[], count, currentPlayer }`

## POST /api/player/set-current
Set the current player.

Request:
- Body: `{ playerId: string }`

Response:
- 200: `{ success: true, currentPlayer: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

## GET /api/player/party
List party members for current player.

Response:
- 200: `{ success: true, members: NpcProfile[], count }`
- 404: `{ success: false, error }`

## POST /api/player/party
Add a party member by id.

Request:
- Body: `{ ownerId: string, memberId: string }`

Response:
- 200: `{ success: true, message, members }`
  - `members` is an array of **member ids** (not profiles).
- 400/404/500 with `{ success: false, error }`

## DELETE /api/player/party
Remove a party member by id.

Request:
- Body: `{ ownerId: string, memberId: string }`

Response:
- 200: `{ success: true, message, members }` (`members` is an array of ids)
- 400/404/500 with `{ success: false, error }`

## PUT /api/player/attributes
Update player attributes.

Request:
- Body: `{ attributes: Record<string, number> }`

Response:
- 200: `{ success: true, player: NpcProfile, message }`
- 400/404 with `{ success: false, error }`

## PUT /api/player/health
Modify player health.

Request:
- Body: `{ amount: number, reason?: string }`

Response:
- 200: `{ success: true, healthChange, player: NpcProfile, message }`
- 400/404 with `{ success: false, error }`

## POST /api/player/levelup
Level up the current player.

Response:
- 200: `{ success: true, player: NpcProfile, message }`
- 400/404 with `{ success: false, error }`

## GET /api/player/needs
Get need bars for the current player.

Response:
- 200: `{ success: true, needs: NeedBar[], includePlayerOnly, player }`
- 404/500 with `{ success: false, error }`

## PUT /api/player/needs
Update need bars.

Request:
- Body: `{ needs: Array<{ id: string, value: number }> }`

Response:
- 200: `{ success: true, message, needs: NeedBar[], includePlayerOnly, player, applied: NeedBar[] }`
- 400/404 with `{ success: false, error }`

## POST /api/player/generate-attributes
Generate new attributes for current player.

Request:
- Body: `{ method?: string }`

Response:
- 200: `{ success: true, player: NpcProfile, generatedAttributes, method, message }`
- 400/404 with `{ success: false, error }`

## POST /api/player/update-stats
Update player stats (admin-style edit).

Request:
- Body supports: `name`, `description`, `level`, `health`, `attributes`, `skills`, `unspentSkillPoints`, `statusEffects`

Response:
- 200: `{ success: true, player: NpcProfile, message, imageNeedsUpdate }`
- 400/404/500 with `{ success: false, error }`

## PUT /api/player/status
Update player status effects directly.

Request:
- Body: `{ statusEffects: array | null }` (required)

Response:
- 200: `{ success: true, message, player: NpcProfile }`
- 400/404 with `{ success: false, error }`

## POST /api/player/create-from-stats
Create a new player from a stats form and set as current.

Request:
- Body requires `name`; supports `description`, `level`, `health`, `attributes`, `skills`, `unspentSkillPoints`, `statusEffects`

Response:
- 200: `{ success: true, player: NpcProfile, message }`
- 400/500 with `{ success: false, error }`

## POST /api/player/skills/:skillName/increase
Increase a skill rank.

Request:
- Path: `skillName`
- Body: `{ amount?: number }` (defaults to 1)

Response:
- 200: `{ success: true, player: NpcProfile, skill: { name, rank }, amount }`
- 400/404 with `{ success: false, error }`

## POST /api/player/equip
Equip/unequip an item in a specific slot for the current player.

Request:
- Body: `{ slotName: string, itemId?: string }`
  - If `itemId` is omitted, the slot is cleared (unequipped).

Response:
- 200: `{ success: true, player: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

## POST /api/players/:id/portrait
Trigger portrait generation for a player.

Request:
- Path: `id`

Response:
- 200: `{ success: true, player: { id, name, imageId }, imageGeneration, message }`
- 202: `{ success: false, player: { ... }, imageGeneration, message: 'Portrait job already in progress' }`
- 409: `{ success: false, error, reason, player: { ... } }` (skipped)
- 503: `{ success: false, error }` (image generation disabled/unavailable)
- 404/500 with `{ success: false, error }`

## GET /api/gear-slots
List gear slot types.

Response:
- 200: `{ success: true, slotTypes: string[] }`
- 500: `{ success: false, error, details }`


[./api/quests.md]
# Quest API

Common payloads: see `docs/api/common.md`.

## POST /api/quests/confirm
Resolve a quest confirmation prompt.

Request:
- Body:
  - `confirmationId` (string, required)
  - `clientId` (string, required)
  - decision (one of):
    - `accepted` (boolean)
    - `decision` (string: accept/decline, yes/no, true/false)
    - `accept` (string: true/false/yes/no)

Response:
- 200: `{ success: true, accepted: boolean }`
- 400: `{ success: false, error }`
- 503: `{ success: false, error }` (confirmation service unavailable)

## POST /api/quest/edit
Edit a quest on the current player.

Request:
- Body:
  - `questId` (required)
  - Optional: `name`, `description`, `secretNotes`, `rewardCurrency`, `rewardXp`, `rewardItems`, `objectives`, `rewardClaimed`, `paused`, `giverName`
  - `objectives` entries must include `{ description }` and may include `id`, `completed`, `optional`

Response:
- 200: `{ success: true, quest: Quest, player: NpcProfile }`
- 400/404 with `{ success: false, error }`

## DELETE /api/player/quests/:questId
Remove a quest from the current player.

Response:
- 200: `{ success: true, message, player: NpcProfile }`
- 400/404 with `{ success: false, error }`


[./API_README.md]
# API Routes From `api.js`

This is the high-level index for every Express route registered in `api.js`. The detailed, low-level reference lives in `docs/api/` and is intended to give an accurate picture of request/response shapes and variants without scanning the source.

## How This Reference Is Organized
- High-level index (this file): quick map of endpoints by domain.
- Low-level docs (`docs/api/`): per-domain route specs, sorted by path, with response variants and edge cases.
- Common shapes: shared payloads such as `NpcProfile`, `LocationResponse`, `ActionResolution`, etc.

## Low-Level Index
- `docs/api/common.md` - shared payload shapes and conventions
- `docs/api/serialization.md` - legacy pointer to shared shapes
- `docs/api/attributes.md` - duplicate `/api/attributes` definitions
- `docs/api/chat.md` - chat endpoints
- `docs/api/crafting.md` - crafting/salvage/harvest
- `docs/api/game.md` - new game, save/load, summaries, short-description backfill
- `docs/api/factions.md` - factions CRUD, relations, and player standings
- `docs/api/images.md` - image generation and job tracking
- `docs/api/locations.md` - locations, exits, stubs, map data, player move
- `docs/api/map.md` - legacy pointer to map endpoints
- `docs/api/lorebooks.md` - lorebook management
- `docs/api/npcs.md` - NPC CRUD and state
- `docs/api/players.md` - player CRUD, party, gear
- `docs/api/quests.md` - quest edits/confirmations
- `docs/api/regions.md` - region CRUD and generation
- `docs/api/settings.md` - setting CRUD and AI fill-missing
- `docs/api/things.md` - items/scenery CRUD and inventory transfers
- `docs/api/misc.md` - feature flags, health check, slash commands, prompt cancel, config test

## Duplicate / Legacy Notes
- Duplicate route: `GET /api/attributes` is defined twice. Express binds the first definition (attribute definitions + generation methods). The later definition is unreachable until the duplication is removed; both behaviors are documented in `docs/api/attributes.md`.
- Legacy behavior: `POST /api/generate-image` includes a legacy sync mode when `async=false`. See `docs/api/images.md`.

## Conventions
- Most JSON responses include a `success` boolean. Some endpoints do not (noted in the low-level docs).
- Error responses typically follow `{ success: false, error: string }`, but a few endpoints return `{ error }` without `success`.


[./api/regions.md]
# Regions API

Common payloads: see `docs/api/common.md`.

## GET /api/regions
List regions or fetch current region details.

Request:
- Query: `scope=current` to return the active region with parent options.

Response (list):
- 200: `{ success: true, regions: Array<{ id, name, parentRegionId, averageLevel }> }`

Response (scope=current):
- 200: `{ success: true, region, parentOptions }`
  - `region`: `{ id, name, description, shortDescription, parentRegionId, parentRegionName?, averageLevel, controllingFactionId, secrets }`
  - `parentOptions`: array of `{ id, name, description, parentRegionId }`
- 404: `{ success: false, error }` if no current region

## GET /api/regions/:id
Fetch a region by id.

Response:
- 200: `{ success: true, region, parentOptions }`
  - `region`: `{ id, name, description, shortDescription, parentRegionId, parentRegionName?, averageLevel, controllingFactionId, secrets }`
- 400/404/500 with `{ success: false, error }`

## PUT /api/regions/:id
Update a region.

Request:
- Body: `{ name: string, description: string, shortDescription?: string|null, parentRegionId?: string|null, averageLevel?: number|null, controllingFactionId?: string|null }`

Response:
- 200: `{ success: true, message, region, parentOptions }`
- 400/404/500 with `{ success: false, error }`

Notes:
- Parent cycles are rejected.
- `averageLevel` accepts numeric values or `null`/empty string to clear.
- `controllingFactionId` must reference an existing faction id or be `null` to clear.

## POST /api/regions/generate
Generate a region using AI.

Request:
- Body: `{ regionName?, regionDescription?, regionNotes?, clientId?, requestId? }`

Response:
- 200: `{ success: true, region: Region, createdLocationIds, createdLocations, entranceLocationId, message, requestId? }`
- 500: `{ success: false, error, requestId? }`

Notes:
- When `clientId` is provided, realtime events are emitted during generation.


[./api/serialization.md]
# Serialization & Shared Shapes (legacy index)

This file is kept for backward references. The authoritative, up-to-date shared shapes now live in:
- `docs/api/common.md`

If you are looking for:
- ChatEntry, NpcProfile, LocationResponse, NeedBar, etc. -> `docs/api/common.md`
- Map endpoint responses -> `docs/api/locations.md`

This file intentionally avoids duplicating the full schemas to prevent drift.


[./api/settings.md]
# Settings API

Common payloads: see `docs/api/common.md`.

## GET /api/settings
List all settings.

Response:
- 200: `{ success: true, settings: SettingInfo[], count }`
- 500: `{ success: false, error }`

## POST /api/settings
Create a new setting.

Request:
- Body: SettingInfo fields (at minimum `name`)

Response:
- 201: `{ success: true, setting: SettingInfo, message }`
- 400/409 with `{ success: false, error }`

## POST /api/settings/fill-missing
Fill missing setting fields via AI.

Request:
- Body:
  - `setting` (required object)
  - `instructions` (optional string)
  - `imageDataUrl` (optional base64 data URL)

Response:
- 200: `{ success: true, setting, raw }` (merged setting values and raw AI XML)
- 400/500 with `{ success: false, error }`

## GET /api/settings/current
Return the current applied setting.

Response:
- 200: `{ success: true, setting: SettingInfo | null, promptVariables?, message? }`
- 500: `{ success: false, error }`

## GET /api/settings/:id
Fetch a setting by id.

Response:
- 200: `{ success: true, setting: SettingInfo }`
- 404/500 with `{ success: false, error }`

## PUT /api/settings/:id
Update a setting.

Request:
- Body: SettingInfo fields

Response:
- 200: `{ success: true, setting: SettingInfo, message }`
- 201: `{ success: true, setting: SettingInfo, created: true, message }` (if not found; new setting created)
- 400/404/409 with `{ success: false, error }`

## DELETE /api/settings/:id
Delete a setting.

Response:
- 200: `{ success: true, message }`
- 404/500 with `{ success: false, error }`

## POST /api/settings/:id/clone
Clone a setting.

Request:
- Body: `{ newName?: string }`

Response:
- 201: `{ success: true, setting: SettingInfo, message }`
- 400/404/409 with `{ success: false, error }`

## POST /api/settings/save
Save all settings to disk.

Response:
- 200: `{ success: true, result, message }`
  - `result`: `{ count, files, directory }`
- 500: `{ success: false, error }`

## POST /api/settings/load
Load all settings from disk.

Response:
- 200: `{ success: true, result, message }`
  - `result`: `{ count, settings, directory, files }`
- 500: `{ success: false, error }`

## GET /api/settings/saved
List saved setting files.

Response:
- 200: `{ success: true, savedSettings, count }`
  - `savedSettings` entries include: `filename`, `filepath`, `name`, `theme`, `genre`, `lastModified`, `size`, `error?`
- 500: `{ success: false, error }`

## POST /api/settings/:id/save
Save a single setting to disk.

Response:
- 200: `{ success: true, filepath, message }`
- 404/500 with `{ success: false, error }`

## POST /api/settings/:id/apply
Apply a setting as current.

Response:
- 200: `{ success: true, setting: SettingInfo, message, promptVariables }`
- 404/500 with `{ success: false, error }`

## DELETE /api/settings/current
Clear the current setting.

Response:
- 200: `{ success: true, message, previousSetting: SettingInfo | null }`
- 500: `{ success: false, error }`


[./api/things.md]
# Things & Inventory API

Common payloads: see `docs/api/common.md`.

## POST /api/things
Create a new thing.

Request:
- Body supports: `name`, `description`, `shortDescription`, `thingType`, `imageId`, `rarity`, `itemTypeDetail`, `metadata`, `slot`, `attributeBonuses`, `causeStatusEffect`, `causeStatusEffectOnTarget`, `causeStatusEffectOnEquipper`, `level`, `relativeLevel`, `statusEffects`, plus boolean flags (`isVehicle`, `isCraftingStation`, `isProcessingStation`, `isHarvestable`, `isSalvageable`).

Response:
- 200: `{ success: true, thing: Thing, message, imageNeedsGeneration }`
- 400: `{ success: false, error }`

Notes:
- When `causeStatusEffectOnTarget`/`causeStatusEffectOnEquipper` are supplied, `causeStatusEffect` is treated as legacy input.

## GET /api/things
List all things (optionally by type).

Request:
- Query: `type` (`item` or `scenery`)

Response:
- 200: `{ success: true, things: Thing[], count }`
- 400/500 with `{ success: false, error }`

## GET /api/things/:id
Fetch a thing by id.

Response:
- 200: `{ success: true, thing: Thing }`
- 404: `{ success: false, error }`

## PUT /api/things/:id
Update a thing.

Request:
- Body supports: `name`, `description`, `shortDescription`, `thingType`, `imageId`, `rarity`, `itemTypeDetail`, `metadata`, `slot`, `attributeBonuses`, `causeStatusEffect`, `causeStatusEffectOnTarget`, `causeStatusEffectOnEquipper`, `level`, `relativeLevel`, `statusEffects`, plus boolean flags.

Response:
- 200: `{ success: true, thing: Thing, message, imageNeedsUpdate }`
- 400/404 with `{ success: false, error }`

Notes:
- `causeStatusEffect` is treated as a legacy payload and mapped internally when provided.

## POST /api/things/:id/give
Move an item into an inventory.

Request:
- Body: `{ ownerId: string, ownerType?: string, locationId?: string }`

Response:
- 200: `{ success: true, thing: Thing, owner: NpcProfile, location?: LocationResponse, message }`
- 400/404/409/500 with `{ success: false, error }`

## POST /api/things/:id/drop
Drop an item into a location.

Request:
- Body: `{ ownerId?: string, ownerType?: string, locationId?: string }`

Response:
- 200: `{ success: true, thing: Thing, location: LocationResponse, message, owner?: NpcProfile }`
- 400/404/500 with `{ success: false, error }`

## POST /api/things/:id/teleport
Teleport a thing to a location (removing from inventories).

Request:
- Body: `{ locationId: string }`

Response:
- 200: `{ success: true, thing: Thing, destination: LocationResponse, previousLocation: LocationResponse, removedOwnerIds: string[], locationIds: string[], message }`
- 400/404/500 with `{ success: false, error }`

## DELETE /api/things/:id
Delete a thing.

Response:
- 200: `{ success: true, message, locationIds, playerIds, npcIds }`
- 400/404/500 with `{ success: false, error }`

## GET /api/things/scenery
List all scenery things.

Response:
- 200: `{ success: true, things: Thing[], count }`
- 500: `{ success: false, error }`

## GET /api/things/items
List all item things.

Response:
- 200: `{ success: true, things: Thing[], count }`
- 500: `{ success: false, error }`

## POST /api/things/:id/image
Trigger image generation for a thing.

Response:
- 200: `{ success: true, thing: Thing, imageGeneration, message }`
- 202: `{ success: false, thing: Thing, imageGeneration, message }` (existing job)
- 409: `{ success: false, error, reason?, thing }` (not eligible or skipped)
- 404/500 with `{ success: false, error }`


[./classes/ComfyUIClient.md]
# ComfyUIClient

## Purpose
Client for a ComfyUI server. Queues workflows, polls status, downloads images, and saves them locally.

## Construction
- `new ComfyUIClient(config)`: reads `config.imagegen.server.host`/`port` and builds base URL.

## Instance API
- `generatePromptId()`: UUID for prompts.
- `queuePrompt(workflow, promptId)`: POSTs to `/prompt`, returns `{ success, promptId, data|error }`.
- `getHistory(promptId)`: GETs `/history/:id`, returns `{ success, data, isComplete }`.
- `getImage(filename, subfolder, folderType)`: GETs `/view`, returns `Buffer`.
- `waitForCompletion(promptId, maxWaitTime, pollInterval)`: polls until outputs are available or times out; returns image list.
- `testConnection()`: GETs `/queue`, returns boolean (note: uses `baseTimeoutMilliseconds`, which must exist in scope).
- `sleep(ms)`: Promise-based delay helper.
- `saveImage(imageData, imageId, originalFilename, saveDirectory)`: writes file and returns `{ success, filename, filepath, size }`.

## Notes
- `queuePrompt` and `getHistory` catch and return errors instead of throwing.
- `saveImage` ensures output directory exists.


[./classes/Events.md]
# Events

## Purpose
Runs LLM-based event checks on narrative text, parses structured outcomes, and applies those outcomes to the game world (locations, items, NPCs, quests, and status effects). Tracks discovered/altered entities to avoid duplicates.

## Key State (Static)
- Dependency container: `_deps` (promptEnv, parseXMLTemplate, prepareBasePromptContext, Location, players, things, findRegionByLocationId, config accessors, etc).
- Parsers/aggregators/handlers: `_parsers`, `_aggregators`, `_handlers`.
- Tracking sets: `animatedItems`, `alteredItems`, `newItems`, `obtainedItems`, `destroyedItems`, `droppedItems`, `alteredCharacters`, `newCharacters`, `arrivedCharacters`, `departedCharacters`, `defeatedEnemies`, `movedLocations`.
- Timeouts and durations: `_baseTimeout`, `DEFAULT_STATUS_DURATION`, `MAJOR_STATUS_DURATION`.

## Public API (Static)
- `initialize(deps)`: registers dependencies and builds parsers/aggregators/handlers.
- `runEventChecks({ textToCheck, stream, allowEnvironmentalEffects, isNpcTurn, _depth, followupQueue })`:
    - Renders event-check prompts, calls `LLMClient.chatCompletion`, parses `<final>` block responses, applies results.
- `runQuestChecks({ allowWithoutEventChecks })`: LLM check for quest objective completion.
- `applyEventOutcomes(parsedEvents, context)`: applies structured changes to world state.
- `processQuestObjectiveCompletionEntries(entries, context)`: applies quest objective completion and rewards.
- `mergeQuestOutcomesIntoStructured(parsedEvents, questOutcomes)`.
- `extractItemAndSceneryNames(rawEvents)`.
- `resolveLocationCandidate(candidate)`.
- `addThingToLocation(thing, candidate)` / `removeThingFromLocation(thing, candidate)`.
- `cleanEventResponseText(text)` / `escapeHtml(text)`.
- `logEventCheck({ systemPrompt, generationPrompt, responseText, label, requestPayload, responsePayload })`.

## Accessors (Static)
- `get config()`.
- `get currentPlayer()`.
- `get players()` / `get things()`.

## Private Helpers (Grouped)
- Tracking helpers: `_resetTrackingSets`, `_isItemAlreadyTracked`, `_trackItemsFromParsing`, `_pruneExcludedItemEntries`.
- Prompt helpers: `_enqueueFollowupEventCheck`, `_runEventChecksForRewardProse`.
- Parser helpers: `_buildParsers`, `_parseEventPromptResponse`, `_extractNumberedResponses`.
- NPC ensuring: `_ensureNpcMentions`.
- Aggregation/handler builders: `_buildAggregators`, `_buildHandlers`.
- Location alteration: `_parseLocationAlterXml`, `_applyLocationAlteration`, `_logAlterLocation`, `_clearLocationImage`.
- Quest generation: `_parseQuestXml`, `_logQuestGeneration`, `_generateQuestName`, `parseQuestObjectiveStatusXml`.
- NPC/character alteration: `_parseCharacterAlterXml`, `_applyCharacterAlteration`, `_handleAlterNpcEvents`.
- Items: `_generateItemsIntoWorld`, `_ensureItemsExist`, `_removeItemFromInventories`, `_detachThingFromKnownLocation`, `_detachThingFromWorld`, `_createPlaceholderThingForAlter`.
- Combat/healing helpers: `_estimateHealingAmount`, `_severityToDamage`.
- Attribute normalization: `_mapAttributeRatingToValue`, `_clampAttributeValue`, `_clampLevel`, `_resolveNpcBaseLevelReference`.
- Scene helpers: `_buildSceneItemNameSet`.

## Notes
- Event prompts are grouped (locations, items, NPCs, misc) and run sequentially with structured parsing.
- Event check responses must include a `<final>` block; `runEventChecks` enforces this via `requiredRegex` so the LLM client retries when it is missing.
- Combined answers across groups are stitched into a single numbered list and parsed as the final block text (no extra `<final>` wrapper).
- Before applying outcomes, event checks ensure referenced NPCs exist (excluding death/incapacitation and defeated-enemy mentions), so downstream handlers can resolve actors; ensured NPCs are title-cased when their source name contains no capital letters.
- `LLMClient.logPrompt` is always used for event-check logging; failures should surface loudly.
- Many helpers are defensive and throw on missing dependencies to avoid silent corruption.
- Item alteration updates `Thing.shortDescription` when provided by the alteration prompt, otherwise preserving the existing value.


[./classes/Faction.md]
# Faction

## Purpose
Represents a faction with goals, tags, relations to other factions, assets, and reputation tiers. Maintains static indexes for lookup by id and name.

## Key State
- `#id`, `#name`.
- `#tags`, `#goals`.
- `#description`, `#shortDescription`.
- `#homeRegionName` (free-form region label).
- `#relations`: `Map<factionId, { status, notes }>` where status is `allied|neutral|hostile|rival`.
- `#assets`: array of asset objects.
- `#reputationTiers`: array of `{ threshold, label, perks, penalties }`.
- `#createdAt`, `#lastUpdated`.
- Static indexes: `#indexById`, `#indexByName`.

## Construction
- `new Faction({ id, name, tags, goals, description, shortDescription, homeRegionName, relations, assets, reputationTiers })`.

## Accessors
- Getters: `id`, `name`, `tags`, `goals`, `description`, `shortDescription`, `homeRegionName`, `relations`, `assets`, `reputationTiers`, `createdAt`, `lastUpdated`.
- Setters: `name`, `tags`, `goals`, `description`, `shortDescription`, `homeRegionName`, `relations`, `assets`, `reputationTiers`.

## Instance API
- `update(updates)`: applies updates via setters (skips id/timestamps).
- `getRelation(factionId)` returns `{ status, notes }` or `null`.
- `setRelation(factionId, relation)` expects `{ status, notes }`.
- `removeRelation(factionId)`.
- `resolveReputationTier(value)`: returns the tier matching a standing value.
- `toJSON()`.

## Static API
- `fromJSON(data)`.
- `create(options)`.
- `getById(id)` / `getByName(name)` / `getAll()`.
- `exists(id)` / `delete(id)` / `clear()`.
- `indexById` / `indexByName` getters.

## Notes
- Relations are normalized and validated against `allied|neutral|hostile|rival` and require notes.
- `reputationTiers` are sorted by threshold ascending.


[./classes/Globals.md]
# Globals

## Purpose
Centralized static state and helpers used across the server. Provides access to the current player, locations, regions, realtime hub, and prompt/context wiring.

## Key State (Static)
- `config`, `baseDir`, `gameLoaded`, `inCombat`, `realtimeHub`.
- `currentSaveVersion`, `saveFileSaveVersion`.
- `sceneSummaries`, `saveMetadata`, `currentSaveInfo`.
- `travelHistory`, `slopWords`, `slopTrigrams`.
- `#currentPlayerOverride` (private override for `currentPlayer`).

## Static API
- `setSaveMetadata(metadata)` / `getSaveMetadata()`.
- `setCurrentSaveInfo(info)` / `getCurrentSaveInfo()`.
- `getBasePromptContext`, `getPromptEnv`, `parseXMLTemplate`: placeholders that must be assigned.
- `getSceneSummaries()`: throws if not initialized.
- `get currentPlayer()` / `set currentPlayer(player)`: resolves through `Player` unless overridden.
- `set processedMove(value)` / `get processedMove()`.
- `setInCombat(value)` / `isInCombat()`.
- `get location()` / `get region()` / `get elapsedTime()` / `set elapsedTime(value)`.
- `locationById(id)` / `regionsById(id)`.
- `get locationsById()` / `get regionsById()` / `get locationsByName()` / `get regionsByName()`.
- `get playersById()` / `get playersByName()`.
- `emitToClient(clientId, type, payload, { includeServerTime, requestId })`:
  - Validates types and uses `realtimeHub.emit`.
- `updateSpinnerText({ clientId, message, scope, requestId, includeServerTime })`: emits chat spinner updates.

## Notes
- Many getters warn if `Globals.config` is missing to avoid silent failures.
- `currentPlayer` setter also installs a resolver in `Player` when available.


[./classes/LLMClient.md]
# LLMClient

## Purpose
Centralized client for LLM chat completions with concurrency limits, streaming progress reporting, retry logic, prompt logging, and optional image preprocessing. Also exposes prompt cancellation and log utilities.

## Internal Class: Semaphore
- `constructor(maxConcurrent)`: sets concurrency limit.
- `acquire()` / `release()`: manage async access.
- `setLimit(newLimit)` / `dispatch()`: adjust and drain queued acquisitions.

## Key State (Static)
- `#semaphores`: per-key Semaphore instances.
- `#semaphoreLimit`: current global limit.
- `#streamProgress`: active stream tracking and ticker state.
- `#abortControllers`: map of in-flight requests by stream id.
- `#canceledStreams`: set of canceled stream ids.

## Public API (Static)
- `cancelPrompt(streamId, reason)`: aborts an in-flight request.
- `ensureAiConfig()`: validates `Globals.config.ai`.
- `getMaxConcurrent(aiConfigOverride)`: reads `max_concurrent_requests`.
- `writeLogFile({ prefix, metadataLabel, payload, serializeJson, onFailureMessage, error, append })`: writes error logs.
- `formatMessagesForErrorLog(messages)`: formats messages into a readable log.
- `logPrompt({...})`: writes prompt/response logs to `logs/`.
- `baseTimeoutMilliseconds()` / `resolveTimeout(timeoutMs, multiplier)`.
- `resolveChatEndpoint(endpoint)` / `resolveTemperature(explicit, fallback)` / `resolveOutput(output, fallback)`.
- `chatCompletion({ messages, metadataLabel, timeoutMs, temperature, stream, ... })`:
  - Handles retries, streaming, logging, and optional image preprocessing.
  - Uses `LLMClient.logPrompt` and emits prompt progress via `Globals.realtimeHub`.

## Private Helpers (Selected)
- Stream tracking: `#isInteractive`, `#renderStreamProgress`, `#ensureProgressTicker`, `#trackStreamStart`, `#trackStreamBytes`, `#trackStreamEnd`, `#broadcastProgress`.
- Concurrency: `#ensureSemaphore`.
- Formatting: `#formatMessageContent`, `#cloneAiConfig`.
- Parsing/validation: `#resolveBoolean`, `#generateSeed`.
- Image handling: `#getSharp`, `#parseImageDataUrl`, `#convertImageDataUrlToWebp`, `#convertMessagesToWebp`.

## Notes
- Streaming progress is broadcast through `Globals.realtimeHub` when available.
- Retries are built in; stream timeouts are incrementally increased on retry.
- `logPrompt` is the standard logging path for prompts throughout the codebase.


[./classes/LocationExit.md]
# LocationExit

## Purpose
Represents a connection between locations (or regions), with optional vehicle semantics and bidirectional travel.

## Key State
- `#id`, `#description`, `#destination`, `#destinationRegion`.
- `#bidirectional`, `#isVehicle`, `#vehicleType`.
- `#imageId`, `#createdAt`, `#lastUpdated`.

## Construction
- `new LocationExit({ description, destination, destinationRegion, bidirectional, id, imageId, isVehicle, vehicleType })`.

## Accessors
- Getters: `id`, `description`, `destination`, `destinationRegion`, `associatedRegionStub`, `region`, `location`, `name`, `relativeName`, `bidirectional`, `isVehicle`, `vehicleType`, `createdAt`, `imageId`, `lastUpdated`.
- Setters: `description`, `destination`, `destinationRegion` (no-op with warning), `bidirectional`, `imageId`, `isVehicle`, `vehicleType`.

## Instance API
- `isReversible()`: alias of `bidirectional`.
- `createReverse(reverseDescription)`: creates a reverse exit (requires caller to supply source id).
- `update({ description, destination, destinationRegion, bidirectional, isVehicle, vehicleType })`.
- `getSummary()` / `getDetails()`: returns a detail object.
- `toJSON()`: alias of `getDetails()`.
- `toString()`: human-readable representation.

## Static API
- `createBidirectionalPair({ location1Id, location2Id, description1to2, description2to1 })`.
- `createOneWay({ description, destination })`.

## Notes
- `destinationRegion` is derived from the destination location; direct setting is intentionally disabled.
- `associatedRegionStub` and `location` fall back to server stub data when full objects are not yet generated.


[./classes/Location.md]
# Location

## Purpose
Represents a game location, including description, exits, NPCs, items/scenery, and status effects. Supports stub locations that can be promoted to fully generated locations.

## Key State
- Core fields: `#id`, `#name`, `#description`, `#shortDescription`, `#baseLevel`, `#imageId`.
- Region linkage: `#regionId`, `#controllingFactionId`.
- Exits: `#exits` (Map of direction -> LocationExit).
- NPC/Thing references: `#npcIds`, `#thingIds`.
- Status effects: `#statusEffects`.
- Stub support: `#isStub`, `#stubMetadata`, `#hasGeneratedStubs`, `#generationHints`.
- Random events: `#randomEvents`.
- Visit tracking: `#visited`, `#lastVisitedTime`.
- Concept tags: `#characterConcepts`, `#enemyConcepts`.
- Static indexes: `#indexById`, `#indexByName`.

## Construction
- `new Location({...})` validates required fields, links to a `Region`, initializes indexes, and normalizes status effects and hints.
- `static fromXMLSnippet(xmlSnippet, options)` parses XML and constructs a Location with normalized hints and events.

## Static API
- `get(id)` / `getById(id)` / `getByName(name)` / `findByName(name)`.
- `getAll()`.
- `get indexById()` / `get indexByName()`.
- `removeFromIndex(locationOrId)` to prevent stale lookups.

## Accessors
- `regionId` (get/set) and `region` (get).
- `controllingFactionId` (get/set).
- Basic fields: `id`, `name`, `description`, `shortDescription`, `baseLevel`, `imageId`, `createdAt`, `lastUpdated`.
- Visit tracking: `visited` (get/set), `lastVisitedTime` (get/set), `hoursSinceLastVisit()`.
- Stub metadata: `isStub`, `stubMetadata` (get/set), `hasGeneratedStubs` (get/set).
- `generationHints` (get/set).
- Random events: `randomEvents` (get/set).
- Entities: `npcIds`, `npcs`, `thingIds`, `things`, `items`, `scenery`.
- Concepts: `characterConcepts` (get/set), `enemyConcepts` (get/set).

## Instance API
- Stub lifecycle: `promoteFromStub(...)`, `markStubsGenerated()`, `resetStubGeneration()`.
- Exit management: `addExit(direction, exit)`, `removeExit(direction)`, `getExit(direction)`, `getAvailableDirections()`, `hasExit(direction)`, `clearExits()`.
- Summaries: `getSummary()`, `getDetails()`, `toJSON()`.
- Random events: `addRandomEvent(event)`, `removeRandomEvent(event)`.
- NPC helpers: `getNPCIds()`, `getNPCs()`, `getNPCNames()`, `addNpcId(id)`, `removeNpcId(id)`, `setNpcIds(ids)`, `clearNpcIds()`.
- Thing helpers: `addThingId(id)`, `removeThingId(id)`, `setThingIds(ids)`, `clearThingIds()`.
- Status effects: `getStatusEffects()`, `setStatusEffects(effects)`, `addStatusEffect(effect, defaultDuration)`, `removeStatusEffect(description)`, `tickStatusEffects()`, `clearExpiredStatusEffects()`.
- `toString()`.

## Private/Static Helpers
- `#generateId()`.
- `#normalizeStatusEffects(effects)`.
- `#normalizeRandomEvents(events)`.
- `#normalizeGenerationHints(hints)`.

## Notes
- Stub locations seed `shortDescription` from stub metadata at creation, and that value persists through promotion unless overwritten by generated output.
- Adding/removing thing ids updates Thing metadata (location ownership) and removes from other locations via `Thing.removeFromWorldById`.
- Status effects are stored as `StatusEffect` instances; getters return JSON snapshots.


[./classes/LorebookManager.md]
# LorebookManager

## Purpose
Manages SillyTavern-compatible lorebooks stored as JSON files. Handles loading, enabling/disabling, keyword matching, and prompt injection formatting.

## Key State
- `lorebooksPath`, `stateFile`.
- `lorebooks`: `Map<filename, normalizedLorebook>`.
- `enabledBooks`: `Set<filename>`.
- `allEntries`: flattened list of entries from enabled books.

## Construction
- `new LorebookManager(lorebooksPath = './lorebooks')`.

## Instance API
- `initialize()`: ensures directory, loads state, loads all lorebooks.
- `ensureDirectory()`: creates lorebook directory if missing.
- `loadState()` / `saveState()`: read/write `lorebook-state.json` for enabled books.
- `loadAllLorebooks()`: loads all `.json` files, normalizes, rebuilds flattened entries.
- `normalizeLorebook(lorebook, filename)`: converts to internal shape and calculates token estimate.
- `normalizeKeys(keys)`: coerces key list to array of strings.
- `rebuildEntriesList()`: rebuilds `allEntries` from enabled books.
- `enableLorebook(filename)` / `disableLorebook(filename)`.
- `isEnabled(filename)`.
- `getLorebookList()`: metadata list for all lorebooks.
- `getLorebookDetails(filename)`: full details including entries.
- `findMatchingEntries(contextText, { maxTokens })`: returns constant + keyword-matched entries, sorted and trimmed.
- `getConstantEntries(maxTokens)`.
- `trimToTokenBudget(entries, maxTokens)`.
- `formatEntriesForPrompt(entries)`: joins content blocks for prompt injection.
- `deleteLorebook(filename)` / `saveLorebook(filename, content)`.
- `reload()`: re-reads state and lorebooks.

## Module Helpers
- `getLorebookManager()`: returns the singleton instance (or null).
- `initializeLorebookManager(lorebooksPath)`: creates and initializes the singleton.

## Notes
- Normalization uses an estimated 4 chars per token to manage token budgets.
- All matching is simple substring match with optional case sensitivity per entry.


[./classes/ModLoader.md]
# ModLoader

## Purpose
Loads and initializes mods from the `mods/` directory. Provides per-mod scope helpers, exposes mod configs, and supports client asset discovery.

## Key State
- `baseDir`, `modsDir`.
- `loadedMods`: `Map<modName, { name, dir, mod, meta }>`.
- `modPromptEnvs`: `Map<modName, NunjucksEnvironment>` for mod prompt templates.

## Construction
- `new ModLoader(baseDir)`: sets base paths and initializes internal maps.

## Instance API
- `getModDirectories()`: returns valid mod directory names (must contain `mod.js`).
- `loadMods(scope)`: loads all mods, calls `register`, returns `{ loaded, failed, total }`.
- `loadMod(modName, scope)`: loads a single mod, validates `register` exists, stores metadata.
- `createModScope(modName, modDir, scope)`: builds a per-mod scope with helpers:
  - `getModPublicUrl(filePath)`
  - `renderModPrompt(templateName, context)`
  - `registerModRoute(method, path, handler)`
  - `modConfig` (resolved config)
- `getModConfig(modName)`: loads `config.json` and applies `configSchema` defaults.
- `getModConfigs()`: returns list of `{ name, displayName, schema, config }`.
- `saveModConfig(modName, newConfig)`: persists config to `config.json`.
- `setupStaticServing(app, express)`: serves `/mods/<name>` public assets.
- `getModClientScripts()`: returns mod public JS file paths.
- `getModClientStyles()`: returns mod public CSS file paths.

## Notes
- `loadMod` clears the require cache to allow hot reload during development.
- `registerModRoute` namespaces routes under `/api/mods/<modName>/...`.


[./classes/NanoGPTImageClient.md]
# NanoGPTImageClient

## Purpose
Calls the NanoGPT image generation API and saves returned base64 images to disk.

## Construction
- `new NanoGPTImageClient(config)`:
  - Reads `imagegen.apiKey` or `NANOGPT_API_KEY`.
  - Reads `imagegen.endpoint` (defaults to `https://nano-gpt.com/`).
  - Requires `imagegen.model`.

## Instance API
- `generatePromptId()`: UUID for request tracking.
- `generateImage({ prompt, negativePrompt, width, height, seed })`:
  - POSTs to `/api/generate-image` with model, prompts, size, and optional seed.
  - Returns `{ requestId, imageBuffer, mimeType }` or throws on errors.
- `saveImage(imageBuffer, imageId, originalFilename, saveDirectory)`:
  - Validates inputs and writes image to disk, returning `{ filename, filepath, size }`.

## Notes
- Unlike OpenAI, `saveImage` does not create the directory; callers should ensure it exists.


[./classes/OpenAIImageClient.md]
# OpenAIImageClient

## Purpose
Calls OpenAI image generation API and saves returned base64 images to disk.

## Construction
- `new OpenAIImageClient(config)`:
  - Reads `imagegen.apiKey` or `OPENAI_API_KEY`.
  - Reads `imagegen.endpoint` (defaults to `https://api.openai.com/v1/images/generations`).
  - Requires `imagegen.model`.

## Instance API
- `generateRequestId()`: UUID for request tracking.
- `generateImage({ prompt, negativePrompt, width, height })`:
  - Sends a generation request; returns `{ requestId, imageBuffer, mimeType }`.
  - Throws on API errors or missing image payloads.
- `saveImage(imageBuffer, imageId, originalFilename, saveDirectory)`:
  - Validates inputs, ensures directory exists, writes image, returns `{ filename, filepath, size }`.

## Notes
- Prompts are combined with a `Negative prompt:` suffix when provided.


[./classes/Player.md]
# Player

## Purpose
Represents a player or NPC with attributes, skills, inventory, gear, status effects, need bars, dispositions, party membership, quests, and progression. Maintains static indexes and shared definitions (gear slots, dispositions, need bars).

## Key State
- Identity: `#id`, `#name`, `#description`, `#shortDescription`, `#imageId`, `#class`, `#race`, `#gender`, `#isNPC`.
- Core stats: `#attributes`, `#level`, `#experience`, `#health`, `#healthAttribute`.
- Inventory/gear: `#inventory`, `#gearSlots`, `#gearSlotsByType`, `#gearSlotNameIndex`.
- Skills/abilities: `#skills`, `#abilities`, `#unspentSkillPoints`.
- Status/needs: `#statusEffects`, `#needBars`.
- Social: `#dispositions`, `#personalityType`, `#personalityTraits`, `#personalityNotes`.
- Factions: `#factionId`, `#factionStandings` (map of `factionId -> number`).
- Party/quests: `#partyMembers`, `#quests`, `#goals`, `#characterArc`.
- Movement/turns: `#currentLocation`, `#previousLocationId`, `#elapsedTime`, `#lastVisitedTime`, `#inCombat`, `#lastActionWasTravel`, `#consecutiveTravelActions`.
- Lifecycle: `#isDead`, `#corpseCountdown`.
- Static indexes: `#indexById`, `#indexByName`.

## Construction
- `new Player(options)` loads definitions, validates input, initializes attributes, inventory, gear, skills, dispositions, need bars, and registers in indexes.

## Static API
- Lookup and registry:
  - `getAll()`, `getById(id)`, `get(id)`, `getByName(name)`, `getByNames(names)`, `unregister(target)`.
  - `resolvePlayerId(playerLike)`.
- Current player helpers:
  - `setCurrentPlayerResolver(resolver)`, `getCurrentPlayer()`, `getCurrentPlayerId()`.
- Definitions:
  - `getDispositionDefinitions()`, `getDispositionDefinition(name)`, `resolveDispositionIntensity(type, value)`.
  - `getNeedBarDefinitionsForContext()`.
  - `setAvailableSkills(skillsInput)`, `getAvailableSkills()`.
- Global behaviors:
  - `applyStatusEffectNeedBarsToAll()`.
  - `updatePreviousLocationsForAll()`.
  - `setExperienceRolloverMultiplier(value)`.
- Handlers:
  - `setNpcInventoryChangeHandler(handler)`, `setLevelUpHandler(handler)`.

## Accessors (Grouped)
- Identity and descriptors: `id`, `name`, `description`, `shortDescription`, `imageId`, `class`, `race`, `gender`, `personalityType`, `personalityTraits`, `personalityNotes`.
- Factions: `factionId`.
- State: `level`, `experience`, `health`, `maxHealth`, `healthAttribute`, `isDead`, `isDisabled`, `inCombat`, `isHostile`, `corpseCountdown`, `elapsedTime`, `createdAt`, `lastUpdated`.
- Locations: `currentLocation`, `location`, `previousLocationId`, `previousLocation`, `currentLocationObject`, `lastVisitedTime`.
- Social/party: `partyMembers`, `isInPlayerParty`, `partyMembershipChangedThisTurn`, `partyMembersAddedThisTurn`, `partyMembersRemovedThisTurn`.
- Quests/goals: `goals`, `characterArc`, `currentQuests`, `completedQuests`.
- Need bars/memory: `turnsSincePartyMemoryGeneration`, `importantMemories`.

## Instance API (Highlights)
- Quests/goals:
  - `addGoal(goal)`, `removeGoal(goal)`.
  - `addQuest(quest)`, `removeQuest(questId)`, `getQuestById(questId)`.
  - `getCurrentQuests()`, `getCompletedQuests()`.
- Party management:
  - `addPartyMember(memberId)`, `removePartyMember(memberId)`, `clearPartyMembers()`, `getPartyMembers()`.
  - Party memory helpers: `addPartyMemoryHistorySegment(...)`, `getPartyMemoryHistorySegments(...)`, `clearPartyMemoryHistory()`.
  - `markPartyMembershipChangedThisTurn()`, `clearPartyMembershipChangeTracking()`.
- Dispositions:
  - `getDisposition(targetId, type)`, `setDisposition(...)`, `increaseDisposition(...)`, `decreaseDisposition(...)`.
  - `getDispositionTowards(player, type)`, `setDispositionTowards(...)`.
  - `getDispositionIntensityTowards(...)`, `getDispositionTowardsCurrentPlayer(...)`, `setDispositionTowardsCurrentPlayer(...)`.
- Factions:
  - `getFactionStandings()`, `setFactionStandings(mapOrObject)`.
  - `getFactionStanding(factionId)`, `setFactionStanding(factionId, value)`, `removeFactionStanding(factionId)`.
- Attributes/skills/abilities:
  - `getAttributeNames()`, `getAttributeDefinition(name)`, `getAttributeModifier(name)`, `getAttributeModifiers()`.
  - `setAttribute(name, value)`.
  - `getSkills()`, `getSkillValue(name)`, `setSkillValue(name, value)`.
  - `getSkillModifiers(name, { includeEquipped })`.
  - `increaseSkill(name, amount)`, `syncSkillsWithAvailable()`.
  - `getAbilities()`, `setAbilities(list)`, `addAbility(ability)`.
- Progression:
  - `levelUp(count)`.
  - `addExperience(amount, raw)`, `addRawExperience(amount)`, `setExperience(value)`.
- Health/combat:
  - `modifyHealth(amount, reason)`, `setHealthAttribute(attributeName)`.
  - `isAlive()`, `updateCorpseCountdown()`.
- Status effects:
  - `getStatusEffects()`, `getIntrinsicStatusEffects()`.
  - `setStatusEffects(effects)`, `addStatusEffect(effect, defaultDuration)`, `removeStatusEffect(description)`.
  - `tickStatusEffects()`, `clearExpiredStatusEffects()`.
- Need bars:
  - `getNeedBars(options)`, `getNeedBarValue(identifier)`.
  - `setNeedBars(list)`, `setNeedBarValue(identifier, value)`.
  - `applyNeedBarChange(identifier, options)`, `applyNeedBarTurnChange(multiplier)`.
  - `getNeedBarsForContext(options)`, `getNeedBarPromptContext(options)`.
- Inventory/gear:
  - Inventory: `addInventoryItem(...)`, `removeInventoryItem(...)`, `hasInventoryItem(...)`, `getInventoryItems()`, `clearInventory()`, `setInventory(items)`.
  - Gear: `getGear()`, `getGearSlotsByType()`, `getEquippedSlotForThing(...)`, `hasEquippedThing(...)`, `getEquippedItemIdForType(slotType)`.
  - Equip flows: `equipItem(...)`, `equipItemInSlot(...)`, `unequipItemId(...)`, `unequipSlot(...)`.
  - `dropAllInventoryItems()`.
- Currency:
  - `getCurrency()`, `setCurrency(value)`, `adjustCurrency(delta)`.
- Movement:
  - `setLocationByName(name)`, `setLocation(location)`, `moveToLocation(direction, locationMap)`.
  - `getCurrentLocationName()`, `getCurrentLocationInfo(locationMap)`, `getAvailableExits(locationMap)`.
  - `updatePreviousLocation()`.
- Serialization:
  - `getStatus()`, `toJSON()`, `static fromJSON(data)`.
- Misc:
  - `generateAttributes(method, diceModule)`, `getGenerationMethods()`.
  - `finalizeTurn()`.
  - `toString()`.

## Private Helpers (Selected)
- Initialization: `#loadDefinitions`, `#initializeAttributes`, `#initializeInventory`, `#initializeGear`, `#initializeSkills`, `#initializeDispositions`, `#initializeNeedBars`.
- Gear helpers: `#resolveItemIdFromGearValue`, `#normalizeSlotType`, `#resolveSlotName`, `#syncGearWithInventory`, `#preserveHealthRatioAfterGearChange`.
- Need bar helpers: `#normalizeNeedBarChangeList`, `#normalizeNeedMagnitudeKey`, `#normalizeNeedValueMap`, `#buildNeedBarDefinition`, `#cloneNeedBarDefinition`, `#formatNeedBarForContext`, `#resolveNeedBarByIdentifier`, `#resolveNeedBarMagnitudeDelta`, `#resolveNeedBarThreshold`, `#applyNeedBarValue`.
- Attributes/health: `#defaultHealthAttribute`, `#resolveHealthAttribute`, `#calculateBaseHealth`, `#validateAttributeValue`, `#calculateAttributeModifier`.
- Status/abilities: `#normalizeStatusEffects`, `#normalizeAbilities`, `#getIntrinsicStatusEffects`.
- Dispositions: `#normalizeDispositionType`, `#sanitizePersonalityValue`, `#applyHostileDispositionsToCurrentPlayer`.
- Inventory helpers: `#resolveThing`, `#addInventoryThing`, `#removeInventoryThing`, `#notifyNpcInventoryChange`.
- XP: `#skillPointsPerLevel`, `#processExperienceOverflow`.

## Notes
- The class supports NPCs and players; many behaviors are shared with `isNPC` gating certain flows.
- Gear and inventory are tightly coupled; equip/unequip flows update health and modifiers.
- Need bar logic includes per-turn decay and magnitude-based adjustments.


[./classes/QuestConfirmationManager.md]
# QuestConfirmationManager

## Purpose
Manages async quest confirmation prompts and responses per client. Emits requests through `Globals.emitToClient` and resolves or rejects pending promises.

## Construction
- `new QuestConfirmationManager({ timeoutMs })`: sets a global timeout (null or 0 disables). Initializes `pending` map.

## Instance API
- `requestConfirmation({ clientId, quest, requestId })`:
  - Validates inputs, normalizes quest payload, emits `quest_confirmation_request`.
  - Returns a Promise that resolves to `true/false` on acceptance or rejects on timeout or delivery failure.
- `resolveConfirmation({ confirmationId, clientId, accepted })`:
  - Validates the pending request and resolves it, clearing timers.
- `rejectAllForClient(clientId, reason)`: rejects all pending confirmations for a client (e.g. disconnect).

## Private Helpers
- `#normalizeQuestPayload(quest)`: sanitizes quest fields into a safe, minimal payload for the client.

## Notes
- The manager stores pending confirmations as `{ resolve, reject, timeout, clientId }` keyed by a UUID.
- Errors are explicit and descriptive to surface mismatches early.


[./classes/Quest.md]
# Quest

## Purpose
Tracks a quest with objectives, rewards, giver info, and completion state. Maintains static indexes for lookup by id and name.

## Key State
- `#id`: quest id (generated if not provided).
- `objectives`: array of QuestObjective instances.
- `name`, `description`, `secretNotes`.
- `rewardItems`, `rewardCurrency`, `rewardXp`, `rewardClaimed`.
- `giverId`, `giverName`.
- `paused`: whether the quest is paused.

## Construction
- `new Quest(options)` validates name and normalizes objectives and reward fields. Adds to static indexes by id and name.

## Instance API
- `get id()`: returns quest id.
- `get giver()`: resolves giver via `Player.getById`.
- `set giver(player)`: updates `giverId`/`giverName`.
- `get completed()`: true when all objectives are completed or optional.
- `addObjective(description, optional)`: appends a new QuestObjective.
- `completeObjective(index)`: marks objective completed or throws on invalid index.
- `toJSON()`: serializes quest state.

## Static API
- `getByName(name)`, `getById(id)`: lookup from indexes.
- `fromJSON(data)`: validates, normalizes, and constructs a Quest, then hydrates objectives.
- `filterActiveQuests(quests, { includePaused })`: filters out completed quests and optionally paused ones.

## Internal Class: QuestObjective
- `new QuestObjective(description, optional)`: creates an objective with generated id.
- `static generateId()`: generates objective ids.
- `toJSON()` / `fromJSON(data)`: serialization helpers.
- `get id()`: returns objective id.

## Notes
- `Quest.QuestObjective` is assigned for external access to the helper class.
- The class uses `SanitizedStringMap` for case-insensitive name lookups.


[./classes/RealtimeHub.md]
# RealtimeHub

## Purpose
Manages WebSocket connections for real-time client updates. Tracks clients by `clientId`, supports targeted send, broadcast, and typed emits.

## Key State
- `path`: WebSocket path (default `/ws`).
- `wss`: WebSocketServer instance.
- `clients`: `Map<clientId, Set<WebSocket>>`.

## Construction
- `new RealtimeHub({ logger, path })`.

## Instance API
- `attach(server, { path })`: attaches a WebSocket server to an HTTP server, handles connect/ping/close.
- `extractClientId(requestUrl)`: parses `clientId` query param.
- `registerClient(clientId, socket)` / `unregisterClient(clientId, socket)`.
- `handleIncomingMessage(clientId, socket, data)`: handles `ping` -> `pong`.
- `safeSend(socket, payload)`: sends JSON safely; returns success.
- `sendToClient(clientId, payload)`: sends to all sockets for a client.
- `broadcast(payload)`: sends to all sockets.
- `emit(clientId, type, payload)`: convenience wrapper around send/broadcast.

## Notes
- `emit` with `clientId = null` broadcasts to all clients.
- Clients without a provided id get an auto-generated id.


[./classes/Region.md]
# Region

## Purpose
Represents a region containing multiple locations, with metadata like average level, random events, and status effects. Maintains static indexes for lookup by id and name.

## Key State
- `#id`, `#name`, `#description`, `#shortDescription`.
- `#locationBlueprints`: blueprint definitions for generated locations.
- `#locationIds`: ids for instantiated locations in the region.
- `#entranceLocationId`, `#parentRegionId`, `#controllingFactionId`.
- `#statusEffects`, `#randomEvents`, `#averageLevel`, `#relativeLevel`.
- `#numImportantNPCs`, `#characterConcepts`, `#enemyConcepts`, `#secrets`.
- `#lastVisitedTime`.

## Construction
- `new Region({...})` validates name/description and normalizes blueprints, events, levels, and status effects. Adds to static indexes.

## Static API
- `get(id)` / `getByName(name)` / `getAll()`.
- `get indexById()` / `get indexByName()` / `getIndexById()` / `getIndexByName()`.
- `clear()`.
- `fromJSON(data)` / `fromXMLSnippet(xmlSnippet)`.
- `get stubRegionCount()`: count of regions without location ids.

## Accessors
- `name`, `description`, `shortDescription` (get/set).
- `locationBlueprints`, `locationIds` (get/set).
- `entranceLocationId`, `parentRegionId` (get/set).
- `controllingFactionId` (get/set).
- `randomEvents` (get/set), `addRandomEvent`, `removeRandomEvent`.
- `numImportantNPCs` (get/set).
- `relativeLevel` (get/set), `averageLevel` (get) with `setAverageLevel(level)`.
- `characterConcepts`, `enemyConcepts`, `secrets` (get/set).
- `lastVisitedTime` (get/set), `hoursSinceLastVisit(currentTime)`.
- Relationship helpers: `childRegions`, `siblingRegions`, `parentRegion`, `parentHierarchy`.

## Instance API
- `toJSON()`: serializes region state.
- Status effects: `getStatusEffects()`, `setStatusEffects(effects)`, `addStatusEffect(effect, defaultDuration)`, `removeStatusEffect(description)`, `tickStatusEffects()`, `clearExpiredStatusEffects()`.
- NPC discovery: `getNPCs()`, `getNPCIds()`, `get locations()`.
- Location tracking: `addLocationId(id)` / `addLocation(id)`.

## Private Helpers
- `#generateId()`.
- `#normalizeBlueprint(blueprint)`.
- `#normalizeImportantNpcCount(value)`.
- `#normalizeStatusEffects(effects)`.

## Notes
- Region stub expansion expects a `<shortDescription>` in the stub response and persists it on the generated `Region`.
- `fromXMLSnippet` accepts both `<region>` and mixed tag variants (name/description/shortDescription).
- `parentHierarchy` throws on circular references to surface data errors early.


[./classes/SanitizedStringMap.md]
# SanitizedStringMap

## Purpose
A Map wrapper that normalizes string keys so lookups are case- and punctuation-insensitive. Keys are normalized by replacing punctuation/underscores with spaces, collapsing whitespace, trimming, and lowercasing.

## Construction
- `new SanitizedStringMap()`: creates an empty map.

## Static Helpers
- `#sanitizeKey(key)`: validates input is a string, normalizes it, and throws on non-strings.

## Instance API
- `set(key, value)`: normalizes the key before storing.
- `get(key)`: normalized lookup.
- `has(key)`: normalized existence check.
- `delete(key)`: normalized delete.

## Notes
- All key access passes through sanitization; non-string keys raise errors.


[./classes/SanitizedStringSet.md]
# SanitizedStringSet

## Purpose
A Set wrapper that normalizes string values so lookups are case- and punctuation-insensitive. Values are normalized by replacing punctuation/underscores with spaces, collapsing whitespace, trimming, and lowercasing.

## Construction
- `new SanitizedStringSet()`: creates an empty set.

## Static Helpers
- `#sanitizeValue(value)`: validates input is a string, normalizes it, and throws on non-strings.
- `fromArray(arr)`: builds a new set by calling `add` on each array entry.

## Instance API
- `add(value)`: normalizes and stores a string; ignores non-strings.
- `has(value)`: normalized lookup; returns false for non-strings.
- `delete(value)`: normalized delete; returns false for non-strings.
- `keys()`: returns an array copy of the set contents.

## Notes
- Sanitization is always applied; the original string value is not stored.


[./classes/SceneSummaries.md]
# SceneSummaries

## Purpose
Stores and manages scene summaries extracted from chat history. Tracks scene ranges, entry id mappings, and per-entry NPC names to support gap detection and absence checks.

## Key State
- `_scenes`: list of normalized scene objects `{ startIndex, endIndex, startEntryId, endEntryId, summary, quotes }`.
- `_entryIdToIndex`: map from entry id to index.
- `_entryIdToNpcNames`: map from entry id to NPC names.
- `_metadata`: `{ version, updatedAt, lastSummarizedRange }`.

## Instance API
- `clear()`: resets all stored data.
- `addSummaryResult(summaryResult)`: validates and merges a summary payload (scenes + entryIndexMap).
- `containsEntry(entryId)`: checks if an entry index falls within any scene range.
- `getFirstUnsummarizedIndex(totalEntries)`: returns the first gap index or null if all summarized.
- `deleteSummariesOverlappingRange(startIndex, endIndex)`: removes overlapping scenes and returns the gap range needing resummarization.
- `getScenes()`: returns cloned scenes (safe copies).
- `getScenesInOrder()`: returns scenes sorted by start index.
- `ingestNpcNamesFromEntries(entries)`: stores NPC name lists per entry id when available.
- `getAbsentCharactersByScene(characterNames)`: returns a Map of scene start index to names missing from that scene.
- `serialize()`: returns a stable JSON-friendly payload including entry index map and NPC names.
- `load(data)`: clears and loads from serialized data, validating completeness.

## Private Helpers
- `#ingestEntryIndexMap(entryIndexMap)`: validates and populates entry id/index and NPC name maps.
- `#normalizeScene(scene)`: validates and normalizes scene shape.
- `#cloneScene(scene)`: deep-ish copy used by `getScenes`.

## Notes
- All validation is strict; missing fields throw explicit errors to avoid silent corruption.


[./classes/SettingInfo.md]
# SettingInfo

## Purpose
Represents a game setting/world configuration, including theme, genre, prompts, and defaults used to generate a game session. Tracks instances via static indexes and supports file persistence.

## Key State
- Core fields: `#id`, `#name`, `#description`, `#theme`, `#genre`, `#tone`, `#difficulty`, `#startingLocationType`.
- Prompt and style fields: `#currencyName`, `#currencyNamePlural`, `#currencyValueNotes`, `#writingStyleNotes`, `#baseContextPreamble`, `#characterGenInstructions`, `#imagePromptPrefix*`.
- Defaults: `#playerStartingLevel`, `#defaultStartingCurrency`, `#defaultPlayerName`, `#defaultPlayerDescription`, `#defaultStartingLocation`, `#defaultNumSkills`, `#defaultExistingSkills`.
- Lists: `#availableClasses`, `#availableRaces`.
- Metadata: `#createdAt`, `#lastUpdated`.
- Static indexes: `#indexByID`, `#indexByName`.

## Construction
- `new SettingInfo(options)` validates required fields and normalizes lists and numeric defaults. Adds the instance to static indexes.

## Accessors
- Getters and setters exist for all fields above. Setters normalize strings and update `#lastUpdated`.

## Instance API
- `update(updates)`: applies updates via setters, skipping id and timestamps.
- `getStatus()`: returns a full snapshot of all fields.
- `toJSON()`: alias of `getStatus()`.
- `clone(newName)`: deep-ish copy with a new id and timestamps; optionally renames.
- `getPromptVariables()`: returns a reduced object for prompt templates.
- `toString()`: returns `"name (theme/genre)"`.
- `save(saveDir)`: writes to `saves/settings` (or provided dir) as JSON.
- `deleteSavedFile(saveDir)`: deletes the file for this setting.

## Static API
- `create(options)`.
- `getById(id)` / `getByName(name)` / `getAll()` / `exists(id)` / `delete(id)` / `count()` / `clear()`.
- `fromJSON(data)`.
- `load(filepath)`: loads a single file.
- `saveAll(saveDir)` / `loadAll(saveDir)`.
- `listSavedSettings(saveDir)`: returns metadata for available settings on disk.

## Private Helpers
- `#generateId()`: unique id generator.
- `#normalizeExistingSkills(value)` / `#normalizeStringList(value)`.
- `#updateTimestamp()`.

## Notes
- Many setters normalize line endings to `\n` for prompt fields.
- List normalization accepts string (newline-delimited) or array input.


[./classes/Skill.md]
# Skill

## Purpose
Represents a character skill with a name, description, and optional attribute association.

## Construction
- `new Skill({ name, description, attribute })`: requires a non-empty string name. Description/attribute are optional strings.

## Instance API
- `update({ name, description, attribute })`: updates fields in place, trimming strings; ignores invalid or empty names.
- `toJSON()`: returns a plain object `{ name, description, attribute }`.

## Static API
- `fromJSON(data)`: validates and constructs a Skill from a plain object.

## Notes
- Input validation is strict: missing or non-string names throw errors.


[./classes/StatusEffect.md]
# StatusEffect

## Purpose
Represents a temporary or permanent modifier applied to an entity, including attribute/skill modifiers, need bar deltas, and duration semantics.

## Construction
- `new StatusEffect({ name, description, attributes, skills, needBars, duration })`
  - `description` is required and must be a non-empty string.
  - `attributes` and `skills` are arrays of `{ attribute|skill, modifier }`.
  - `needBars` is an array of `{ name, delta }`.
  - `duration` accepts numbers, `'instant'` (treated as 1), `'permanent'` (treated as -1), or null.

## Instance API
- `update({ name, description, attributes, skills, needBars, duration })`: normalizes and updates fields in place.
- `toJSON()`: returns a plain object snapshot.

## Static API
- `fromJSON(data)`: validates and constructs a StatusEffect from a plain object.
- `generateFromDescriptions(descriptions, { promptEnv, parseXMLTemplate, prepareBasePromptContext })`:
  - Takes a list of text descriptions (strings or objects with `description`, optional `name`, `level`).
  - Renders `base-context.xml.njk` and parses XML output from `LLMClient.chatCompletion`.
  - Validates and returns a `Map` keyed by source description with `StatusEffect` instances.
  - Logs prompts through `LLMClient.logPrompt` when available.

## Private Helpers
- `#normalizeModifiers(list, keyName)`: validates and normalizes attribute/skill modifier lists.
- `#normalizeNeedBars(list)`: validates and normalizes need bar deltas.
- `#normalizeDuration(value)`: converts duration inputs to integer turns or null.

## Notes
- All normalizers throw clear errors on invalid structures or missing data.
- `generateFromDescriptions` fails loudly on malformed XML or missing effect elements.


[./classes/Thing.md]
# Thing

## Purpose
Represents items and scenery in the game world. Supports rarity metadata, attribute bonuses, status effects (including AI enrichment), and placement in locations or inventories. Maintains indexes by id and name.

## Key State
- Core fields: `#id`, `#name`, `#description`, `#shortDescription`, `#thingType`, `#imageId`.
- Metadata: `#metadata` (mirrors slot, bonuses, cause effects, flags, levels).
- Rarity and level: `#rarity`, `#itemTypeDetail`, `#level`, `#relativeLevel`.
- Status: `#statusEffects`, `#causeStatusEffect` (applied to target/equipper).
- Flags: `#flags` (SanitizedStringSet) with boolean flag helpers (`isVehicle`, `isCraftingStation`, etc).
- Static indexes: `#indexByID`, `#indexByName`.

## Construction
- `new Thing({...})` validates required fields, normalizes metadata, initializes status effects, and registers in indexes.

## Static API (Rarity)
- `loadRarityDefinitions({ forceReload })`, `getAllRarityDefinitions()`, `generateRandomRarityDefinition()`.
- `getRarityDefinition(rarity, { fallbackToDefault })` and convenience getters for multipliers and color.
- `getDefaultRarityKey()` / `getDefaultRarityLabel()`.
- `getMaxAttributeBonus(rarity, level)`.
- `normalizeRarityKey(value)`.

## Static API (Lookup)
- `getAll()` / `getById(id)` / `getByName(name)`.
- `getAllByName(name)` / `getByNameAndLocation(name, location)`.
- `getByType(type)` / `getAllScenery()` / `getAllItems()`.
- `thingNameExists(name)`.
- `clear()`.
- `get validTypes()`.

## Accessors
- Basic getters: `id`, `name`, `description`, `shortDescription`, `thingType`, `imageId`, `createdAt`, `lastUpdated`.
- Equipment helpers: `equippedBy`, `isEquipped`, `equippedSlot`.
- Flags: `isVehicle`, `isCraftingStation`, `isProcessingStation`, `isHarvestable`, `isSalvageable` (get/set).
- Rarity/level: `rarity`, `itemTypeDetail`, `level`, `relativeLevel` (get/set).
- Metadata: `metadata` (get/set), `slot` (get/set), `attributeBonuses` (get/set).
- Cause effects: `causeStatusEffect` (get/set), `causeStatusEffectOnTarget`, `causeStatusEffectOnEquipper`.

## Instance API
- Flag helpers: `hasFlag(flag)`, `setFlag(flag, enabled)`.
- Bonuses: `getAttributeBonus(attributeName)`.
- Cause effects: `setCauseStatusEffects({ target, equipper, legacy })`.
- Serialization: `toJSON()`, `delete()`.
- Status effects: `getStatusEffects()`, `setStatusEffects(effects)`, `addStatusEffect(effect, defaultDuration)`, `removeStatusEffect(description)`, `tickStatusEffects()`, `clearExpiredStatusEffects()`.
- Inventory/world placement: `whoseInventory()`, `removeFromWorld()`, `drop(locationIdOverride)`, `putInLocation(locationId)`, `putInInventory(playerId)`.
- Type checks: `isType(type)`, `isScenery()`, `isItem()`.
- `toString()`.

## Static Inventory/World Helpers
- `whoseInventoryById(thingId)`.
- `removeFromWorldById(thingId)`.
- `dropById(thingId)`.
- `getAllByLocationId(locationId)`.
- `putInLocationById(thingId, locationId)`.
- `putInInventoryById(thingId, playerId)`.

## Private Helpers
- Index helpers: `#getNameBucket`, `#addThingToNameIndex`, `#removeThingFromNameIndex`, `#normalizeNameIndexEntry`.
- Metadata helpers: `#applyMetadataFieldsFromMetadata`, `#syncFieldsToMetadata`.
- Normalizers: `#normalizeBooleanFlag`, `#normalizeAttributeBonuses`, `#normalizeStatusEffects`, `#sanitizeSlot`, `#normalizeCauseStatusEffectEntry`.
- Cause effect helpers: `#upsertCauseStatusEffectEntry`, `#getCauseStatusEffectEntry`, `#ingestCauseStatusEffects`.
- Status enrichment: `#triggerStatusEffectEnrichment`, `#enrichStatusEffectsUsingGlobals`.

## Notes
- Status effect enrichment calls `StatusEffect.generateFromDescriptions` using `Globals` prompt hooks.
- Name lookups are location-aware: `getByName` prefers current location/region contexts.


[./classes/Utils.md]
# Utils

## Purpose
Collection of static utility helpers used across the server: set math, text similarity, XML parsing, game-state serialization, pending region stub maintenance, and chat summary queues.

## Set/Text Helpers
- `intersection(setA, setB)`, `difference(setA, setB)`, `union(setA, setB)`.
- `roundAwayFromZero(value)`.
- `longestCommonSubstringLength(a, b)`.
- `capitalizeProperNoun(str)`: title-cases and normalizes item/location names.
- K-gram utilities:
  - `pruneContainedKgrams(ngrams)`.
  - `hasKgramOverlap(a, b, { k, minMatches })`.
  - `findKgramOverlaps(a, b, { minK, maxK })`.
  - `findKgramOverlap(a, b, { k })`.

## XML Helpers
- `innerXML(node)`.
- `parseXmlDocument(xmlContent, mimeType)` with cheerio-based normalization for malformed XML.

## Game Balance Helpers
- `getMinimumUnmitigatedWeaponDamage(rarity, level)` (uses rarity definitions from `Thing` and `Globals.config.baseWeaponDamage`).

## Game State Serialization
- `serializeGameState(context)`.
- `writeSerializedGameState(saveDir, serialized)`.
- `loadSerializedGameState(saveDir)`.
- `hydrateGameState(serialized, context)`.

## Pending Region Stub Maintenance
- `rebuildPendingRegionStubs({ pendingRegionStubs, regions, gameLocations, gameLocationExits })`.
- `mergeDuplicatePendingRegionStubs({ pendingRegionStubs, regions, gameLocations, gameLocationExits })`.

## Chat Summary Store/Queue
- `setChatSummary(messageId, summaryPayload)` / `getChatSummary(messageId)` / `hasChatSummary(messageId)`.
- `serializeChatSummaries()` / `loadChatSummaries(data)` / `getAllChatSummaries()`.
- `enqueueChatSummaryCandidate(candidate)` / `dequeueChatSummaryBatch(batchSize)`.
- `getChatSummaryQueueLength()` / `peekChatSummaryQueue()`.

## Private Helpers (Selected)
- K-gram internals: `#normalizeKgramTokens`, `#buildKgramSet`, `#containsSubgram`.
- XML internals: `#getDomParserInstance`, `#normalizeXmlWithCheerio`.
- Lazy module getters: `#getLocationModule`, `#getLocationExitModule`, `#getRegionModule`, `#getThingModule`, `#getPlayerModule`, `#getSkillModule`.

## Notes
- `serializeGameState` and `hydrateGameState` coordinate `Location`, `Region`, `Thing`, `Player`, `Skill`, and stubs into a consistent save/load flow.
- Pending region stubs are aggressively validated; missing ids or duplicates throw explicit errors.


[./potential_redundancies.md]
# Potential Redundancies and Inconsistencies

This list is based on a quick pass through existing docs plus the current codebase. Each item includes a brief suggested fix.

## Redundancies

1) Duplicate API route definition for `GET /api/attributes`.
   - Evidence: `docs/API_README.md` notes the route is defined twice and the later definition is unreachable.
   - Suggested fix: remove or merge the duplicate definition in `api.js`, then update `docs/api/attributes.md` to reflect the single source of truth.

2) Duplicate field definitions and serialization in `Quest`.
   - Evidence: `Quest.js` declares `secretNotes` twice on the class and includes `secretNotes` twice in `toJSON()`.
   - Suggested fix: keep a single `secretNotes` field and serialize it once.

3) Duplicate static and instance methods in `Player`.
   - Evidence: `Player.js` defines `static getById` twice (with slightly different input handling), and also defines `get turnsSincePartyMemoryGeneration`, `incrementTurnsSincePartyMemoryGeneration`, and `resetTurnsSincePartyMemoryGeneration` twice with different side effects.
   - Suggested fix: consolidate each duplicate into a single authoritative implementation and delete the redundant versions.

4) Unexported and apparently unused `NameCache` class.
   - Evidence: `NameCache.js` defines a class but never exports it; no code references it.
   - Suggested fix: either export and integrate it, or remove the file if it is dead code.

## Inconsistencies

1) File name typo for `SceneSummaries` implementation.
   - Evidence: class is `SceneSummaries` but the file is `SceneSummaies.js` and required with the misspelling (e.g., `server.js`). Docs use the correct spelling.
   - Suggested fix: rename the file to `SceneSummaries.js` and update all requires; keep docs aligned with the file name.

2) `Player` exposes a deprecated `isNpc` getter that throws, while `isNPC` is the correct accessor.
   - Evidence: `Player.js` includes a `get isNpc()` that throws an error directing callers elsewhere.
   - Suggested fix: remove the throwing accessor if it is no longer used, or replace it with a non-throwing alias to reduce runtime surprises.

3) `ComfyUIClient.testConnection` references an undefined timeout variable.
   - Evidence: `ComfyUIClient.js` uses `baseTimeoutMilliseconds` in `testConnection()` but it is not defined in that scope.
   - Suggested fix: use `this.timeout` or a shared helper (e.g., `LLMClient.baseTimeoutMilliseconds()`), and keep the timeout strategy consistent with other methods.

4) Inconsistent save-image behavior between image clients.
   - Evidence: `OpenAIImageClient.saveImage` ensures the output directory exists, while `NanoGPTImageClient.saveImage` does not.
   - Suggested fix: pick a consistent contract (either ensure directory creation in both, or require the caller to pre-create it) and align both implementations and docs.

5) Inconsistent `Player.getById` input normalization.
   - Evidence: one `getById` trims string ids before comparing; the later duplicate does not.
   - Suggested fix: standardize on trimming and null/empty checks in a single method.


[./server_llm_notes.md]
Server & LLM Notes

- server.js
  - Bootstraps config (default + override yaml + --port), sets Globals.baseDir/config, and initializes Express + HTTP + RealtimeHub + ModLoader static serving. Maintains in-memory maps for players, things, skills, locations, exits, regions, pending stubs/images, and in-flight generations. Provides chat utilities (`normalizeChatEntry`, `pushChatEntry`, `scrubGeneratedBrackets`), location/region/thing helpers, save/load wiring (exposed via module.exports), and exposes many of these via `apiScope`.
  - Builds `promptEnv`/`viewsEnv` with Nunjucks, loads templates, and defines `prepareBasePromptContext` (builds base prompt context, triggers NPC memory selection jobs). Attaches `Globals.getBasePromptContext` and other helpers (e.g., plausibility parsing, attack resolution, status ticking).
  - Recent history keeps `event-summary` entries intact (scrubber can skip event stripping via `scrub_events`), so `<recentStoryHistory>` includes the latest event summaries.
  - Base prompt context now includes a `<factions>` block for LLM generation; location/region generators and NPC generators expect full faction names (or "None") and the server resolves those names to ids.
  - Manages image generation backends (ComfyUI/NanoGPT/OpenAI), queuing (`createImageJob`, `processJobQueue`, job maps/sets, `generateImageId`), and exposes job snapshots. Handles realtime attach, slash commands, mod loading, and kicks off default player creation + server start.
  - Initializes `Events` with dependencies (Location/Region accessors, generation functions, exit connection helpers, image generators, quest confirmation, etc.) and then registers routes via api.js using the populated `apiScope`.

- api.js
  - Exports `registerApiRoutes(scope)`; validates scope (must include Express app plus numerous helpers) and optionally installs an axios AI debug interceptor. Uses `with (scope)` to share state. Utility helpers inside include stream emitters for realtime (`realtimeHub`), autosave pruning, XML helpers for crafting/random events, and deletion helpers for NPCs/things.
  - `/api/chat` is the main turn handler: applies status effect need deltas, optional travel metadata, autosave, plausibility/attack checks, builds prompts via `prepareBasePromptContext` + `promptEnv`, calls `LLMClient.chatCompletion`, logs prompts, and streams status back to the client. It records chat history, injects NPC/location memories, may trigger Events.runEventChecks, attack damage application, quest confirmations, random event seeds, NPC corpse cleanup, and emits structured debug info. Random events are checked independently of NPC turn processing (forced-event actions still suppress random events).
  - Additional endpoints cover quest confirmations, chat history mutations, player CRUD (attributes, health, needs, party, skills, portraits), NPC CRUD/teleport/equipment/dispositions/memories/goals, location/region CRUD and generation (including stub expansion, exits, maps), crafting, thing/item operations (create, give/drop/teleport/delete/image), settings management (create/save/load/apply), save/load/new-game flows, slash commands, config test endpoints, and image job APIs (request/async generation/job status/metadata listing).
  - Uses helpers like `runAutosaveIfEnabled`, `generateRandomEventSeeds/ensureRandomEventSeedsForArea`, `renderCraftOutcomeForDegree`, and numerous validation branches to reject unsupported operations with explicit errors/status codes.

- Events.js
  - Static orchestrator class with `initialize(deps)` to wire dependencies (Location/Region lookup/generation, prompt env, XML parsing, exit connections, image generation, quest confirmations, currency labels, etc.) and configure timeouts/status durations. Maintains tracking sets to dedupe item/NPC/location changes in a turn.
  - `runEventChecks` renders an event-check prompt (built from EVENT_PROMPT_ORDER), calls `LLMClient.chatCompletion` with a required `<final>` regex (so missing blocks retry), parses the numbered answers from the `<final>` block into structured entries, and optionally suppresses environmental effects. It aggregates raw text into HTML, tracks follow-up queues, and can recursively analyze reward prose. Combined group answers are parsed as final block text (no extra `<final>` wrapper).
  - Before applying outcomes, Events ensures referenced NPCs exist (excluding death/incapacitation and defeated-enemy mentions), so handlers can resolve actors reliably; ensured NPCs are title-cased when their source name contains no capital letters.
  - Parsers/aggregators/handlers convert LLM responses into world mutations: new exits/movement, location alterations/regeneration, currency changes, item animation/alter/consume/drop/harvest/appearance, NPC arrival/departure/spawn, party changes, dispositions, status effects, environmental damage/healing, need bar changes, XP and quest awards/completions, deaths/incapacitation, triggered abilities, and random event seeding. Handlers rely on injected helpers to create/locate entities, ensure exits, queue assets, and generate images when needed.
  - Provides quest-specific checks, status effect helpers (`makeStatusEffect`, default/major durations), placeholder item creation for alterations, and utility methods for accessing current player/config/deps through `this._deps`.

- LLMClient.js
  - Axios-based chat wrapper pulling defaults from `Globals.config.ai`; enforces explicit config (endpoint/apiKey/model) and normalizes `/chat/completions` endpoints. Controls concurrency with semaphores keyed by apiKey+model (`getMaxConcurrent`), supports per-call overrides plus prompt_ai_overrides by metadataLabel.
  - Supports streaming with progress tracking/broadcast (`prompt_progress` via `Globals.realtimeHub`), timeout scaling, retry handling with optional waits, and on-response hooks. Seeds requests unless suppressed, resolves temperature/max_tokens, and merges extra payload/headers.
  - Strips `<think>` blocks from responses after optionally logging; validates XML and required tags when requested, writes errors and prompts to `logs/` via `writeLogFile`/`logPrompt`, and dumps debug payloads when enabled. Exposes helpers for base timeout resolution and progress rendering (interactive terminal friendly but guarded by TTY checks).


[./slash_commands.md]
Slash Commands Quick Guide

- Lifecycle
  - `server.js` initializes `SlashCommandRegistry` (loads `slashcommands/*.js`), then `/api/slash-command` in `api.js` invokes the matching module by name/alias.
  - `public/js/chat.js` sends `/command arg=value` or `/command arg1 arg2` to `/api/slash-command`; replies are rendered as system messages.

- Command shape
  - Extend `SlashCommandBase` and export the class.
  - Required statics: `name` (string), `description` (string), `args` (array), `execute(interaction, args)`.
  - Optional: `aliases` array; `validateArgs` inherited default checks types against `args`.
  - `args` entries: `{ name, type: 'string'|'integer'|'boolean', required: bool }`.
  - `usage` is auto-built from `args` (shown by `/help` via `SlashCommandBase.listCommands()`).
  - Per-command docs live in `docs/slashcommands/` (base class: `docs/slashcommands/SlashCommandBase.md`).

- Arg parsing (server)
  - Request body carries `args` (object) and `argsText` (raw string).
  - Server tokenizes `argsText` left-to-right (quoted strings respected) to fill missing args in declaration order; types are coerced (integer/boolean/String).
  - After filling, `validateArgs` runs; return 400 with `errors` if invalid.

- Interaction API
  - `interaction.user.id` is the caller’s userId (may be null).
  - `interaction.reply(payload)` collects responses; payload shape: `{ content: string, ephemeral?: boolean }`.
  - Return value is ignored; send one or multiple replies; empty replies produce a generic success message client-side.

- Best practices
  - Fail loudly with clear errors (throw or reply with `ephemeral: true`).
  - Normalize string inputs (trim/strip quotes) before lookups; validate types and existence.
  - Avoid silent fallbacks; if a helper is unavailable (e.g., `Globals.triggerRandomEvent`), throw with a precise reason.
  - Keep commands side-effect scoped and synchronous when possible; mark `execute` async if awaiting I/O.
  - Prefer existing helpers on `Globals`/models (e.g., `Location.get`, `playersByName`, `generateLevelUpAbilitiesForCharacter`).

- Adding a new command (example skeleton)
  ```js
  const Globals = require('../Globals.js');
  const SlashCommandBase = require('../SlashCommandBase.js');

  class MyCommand extends SlashCommandBase {
    static get name() { return 'mycmd'; }
    static get aliases() { return ['mc']; }
    static get description() { return 'Do a thing.'; }
    static get args() { return [{ name: 'target', type: 'string', required: true }]; }

    static async execute(interaction, args = {}) {
      const target = (args.target || '').trim();
      if (!target) throw new Error('Target is required.');
      // ...do work...
      await interaction.reply({ content: `Did the thing to ${target}.`, ephemeral: false });
    }
  }

  module.exports = MyCommand;
  ```
  - Drop the file in `slashcommands/`; it will auto-register on startup (name + aliases).

- Testing
  - Use `/help` to confirm registration/usage text.
  - Run the command in chat; verify expected replies and that invalid args return clear errors.


[./slop_and_repetition.md]
# Slop Checking & Repetition Busting

Quick refresher on where these systems live and how they're wired.

## Repetition busting (player action prose)

### What it does
- Default is ON (`config.default.yaml` sets `repetition_buster: true`), but it can be toggled in config.
- When `config.repetition_buster` is enabled, the player-action prompt runs a multi-step self-correction flow and outputs `<finalProse>...</finalProse>`. The server enforces a `requiredRegex` and extracts `finalProse` for player-action prompts (used for player actions and NPC narratives).
- If `config.repetition_buster` is **disabled**, the server still checks for repetition against recent prose. When overlap is detected, it re-renders the player-action prompt with repetition_buster forced on and re-asks the model.

### Full step list (current prompt)
1. Draft Response: generate a preliminary response following `config.prose_length`, strictly adhering to `success_or_failure`.
2. Analysis and planning (any format), including:
   - Repetitive patterns
   - Meaningless profundity
   - Character omniscience
   - Treknobabble
   - Continuity and logic
   - Forgotten party members
   - Aggro
   - Emotional thesis statements
   - "Everybody checking in"
   - Success or failure adherence
   - Remaining guidelines
3. Write a second draft based on the analysis.
4. Analyze the second draft for issues, then output final prose inside `<finalProse>...</finalProse>` without introducing new content.

### Detection logic
- Overlap detection uses `Utils.findKgramOverlap(prior, response, { k: 6 })`.
- Token normalization lowercases, strips punctuation as word breaks (except apostrophes), and removes common words and contractions before k-gram matching (`COMMON_WORDS` in `Utils.js`).
- The server logs the offending overlap when detected.

### Key files / functions
- Prompt template: `prompts/_includes/player-action.njk` (`config.repetition_buster` block)
- Prompt render + auto-rerun logic:
  - `api.js` → player action flow
  - `renderPlayerActionPrompt(forceRepetitionBuster)`
  - `runActionNarrativeForActor()` (NPC narrative also uses the player-action prompt)
  - `requiredRegex` + `<finalProse>` extraction
- K-gram utilities: `Utils.findKgramOverlap`, `Utils.findKgramOverlaps` in `Utils.js`

### Config switches
- `config.repetition_buster`: toggles the multi-step prompt + `<finalProse>` output (default true in `config.default.yaml`).
- `config.ai.dialogue_repetition_penalty`: passed to the LLM request as `repetition_penalty`.

### Notes
- The rerun is only triggered for `player-action` responses (not NPC turns).
- When repetition_buster is on, the server extracts `<finalProse>` from the model output for any `player-action` prompt.
- Attack prose uses the same repetition-buster flow (the attack branch of `prompts/_includes/player-action.njk` now includes the `<finalProse>` instructions).

## Slop checking + slop remover

### What it does
- Detects "slop words" (based on ppm thresholds) and repeated 3+-grams from recent prose history.
- If either are found, it calls the **slop remover** prompt to rewrite the text while preserving meaning.
- Results are logged and displayed as a 🧹 insight icon in the chat UI.

### Detection logic
- Slop words:
  - Source: `defs/slopwords.yaml`
  - Analyzer: `server.js` → `analyzeSlopwordsForText()` computes ppm against the provided text.
  - `api.js` → `getFilteredSlopWords()` runs the analyzer on combined slop history + current response, then filters to words present in the current response.
  - Slop history segments include `player-action`, `npc-action`, `quest-reward`, and `random-event` chat entries.
- Repeated n-grams:
  - `api.js` → `collectSlopNgrams()`, which combines two scans using `Utils.findKgramOverlaps()`.
  - Base scan: `minK: 3` across the last 20 slop history segments.
  - Supplemental scan: `minK: 6` across the last 80 assistant prose-like entries (`player-action`, `npc-action`, `quest-reward`, `random-event`, or null type).
  - Merges results and prunes contained n-grams via `Utils.pruneContainedKgrams()`.
  - Uses the same punctuation stripping + `COMMON_WORDS` filtering as repetition detection.

### Slop remover flow
- Entry point: `api.js` → `applySlopRemoval(prose, { returnDiagnostics })`.
- Prompt: `prompts/slop-remover.xml.njk`.
- Prompt inputs:
  - `storyText` (last 5 prose entries + last 5 player entries, merged chronologically)
  - `textToEdit` (current response)
  - `slopWords`
  - `slopNgrams`
- Output must be plain text (no XML). The server retries up to 3 times and can extend to 5 when parse failures occur.
- After each attempt, the server re-checks for remaining slop words and n-grams; if it hits max attempts, it logs and allows remaining slop.
- Diagnostics (`slopWords` + `slopNgrams`) are attached to the response and recorded in chat history.

### Where it runs
- Player action prose (after LLM response): `api.js` → main player-action flow
- NPC action text (planned action shown in chat): `api.js` → NPC turn handling
- NPC narrative prose: `api.js` → NPC turn handling
- Random event narrative: `api.js` → random event flow
- Quest reward prose: `Events.js` → quest reward flow
- Crafting narrative text: `api.js` → craft flow

### UI + logging
- Chat insight icon: 🧹, rendered from `public/js/chat.js`.
- Slop removal records:
  - `api.js` → `recordSlopRemovalEntry()` stores an attachment with type `slop-remover`.
  - Attachments are visible as tooltip details (slop words + repeated n-grams).
- LLM logs for slop remover: `logs/*_slop_remover_*.log`.

### Config switches
- `config.slop_buster`: enables the slop removal pipeline.

## Primary code map
- Detection utilities: `Utils.js`
  - `COMMON_WORDS`
  - `findKgramOverlap()` / `findKgramOverlaps()` / `pruneContainedKgrams()`
- Debug helper: `scripts/ngram_checker.js` (standalone k-gram overlap checker using the same normalization)
- Slop words config: `defs/slopwords.yaml`
- Slop analyzer: `server.js` → `analyzeSlopwordsForText()`
- Slop removal + n-gram detection: `api.js` → `getFilteredSlopWords()`, `collectRepeatedNgrams()`, `buildSlopContextText()`, `applySlopRemoval()`
- Repetition buster prompt: `prompts/_includes/player-action.njk`
- UI insights: `public/js/chat.js` (🧹 icon)


[./ui/assets_styles.md]
# Styling and Assets

## SCSS/CSS layout
- `public/css/_globals.scss`
  - Color palette, gradient, font family, and mixins.
  - Primary UI palette is defined here (glass background, primary blue, etc).
- `public/css/main.scss`
  - Base layout and the bulk of component styling for the chat UI.
  - Compiled output: `public/css/main.css`.
- `public/css/settings.scss`
  - Settings page layout and field styling.
  - Compiled output: `public/css/settings.css`.
- `public/css/lorebooks.css`
  - Lorebooks page styling (no SCSS source in repo).
- `public/css/map.css`
  - Shared container styling for Region and World map tabs.

## Images
- `public/generated-images/` is the image output directory for entity images.
- `public/js/image-manager.js` coordinates image job requests and updates.
- `public/js/lightbox.js` provides the full-screen lightbox viewer.

## Client templates
- `public/templates/plausibility.njk` is rendered in the browser via Nunjucks
  (used for plausibility insight tooltips).
- `views/popups/plausibility.njk` is the server-side copy.

## Vendor libraries (public/vendor)
Loaded on the chat page:
- `cytoscape.min.js` + layout plugins (`cose-base`, `fcose`, `euler`) for maps.
- `fitty.min.js` for auto-scaling entity name text.
- `markdown-it.min.js` for chat markdown rendering.
- `nunjucks.js` for client-side templating.
- `vaadin.js` (loaded for UI assets; check usage before removal).

## Notes
- The chat UI relies on SCSS variables and mixins in `_globals.scss`.
- `public/js/fitty-init.js` listens for `inventory:updated` and `location:updated`
  to reflow text after dynamic DOM updates.


[./ui/chat_interface.md]
# Chat Interface (views/index.njk)

The main UI is rendered by `views/index.njk` and powered by `public/js/chat.js` plus a large inline script block inside the template.

## Layout and tabs

- Tab bar controls panels with ids `tab-adventure`, `tab-map`, `tab-world-map`, `tab-character`, `tab-quests`, `tab-factions`, `tab-party`.
- `initTabs()` in `views/index.njk` handles tab switching and updates `window.location.hash` as `#tab-{name}`.
- Tab activation triggers:
  - `map` -> `window.loadRegionMap()`.
  - `world-map` -> `window.loadWorldMap()`.
  - `party` -> `window.refreshParty()`.
  - `factions` -> `window.refreshFactions()`.

## Adventure tab structure

- **Location panel** (`.location-block`):
  - Image + context menu for edit/summon/regenerate.
  - Exits list + "New Exit" button.
  - NPC list + "Add NPC" button.
  - Items/Scenery grids + "Craft" and "New Item/Scenery" buttons.
- **Chat panel** (`.chat-container`):
  - Message list (`#chatLog`) with user/AI messages and event-summary batches.
  - Input area (`#messageInput`, `#sendButton`) with slash command support.
- **Sidebar** (`.chat-sidebar`):
  - Player card (portrait, health, need bars, quick actions).
  - Party summary list.

## Core client controller (public/js/chat.js)

- `AIRPGChat` owns chat history, input handling, and the websocket lifecycle.
- Maintains:
  - `chatHistory` (system + local), `serverHistory` (from `/api/chat/history`).
  - `pendingRequests` for in-flight requests and status UI.
  - Websocket state (`ws`, `wsReady`, reconnect timers).
- Uses `markdown-it` for rendering message content when available.

## Websocket events

The chat client listens on `/ws?clientId=...` and handles:

- `connection_ack` (client id sync, image realtime enabled).
- `chat_status` (spinner / progress messages).
- `player_action`, `npc_turn` (streamed partial messages).
- `chat_complete` (final response).
- `chat_error` (display errors).
- `generation_status`, `region_generated`, `location_generated` (world generation status).
- `location_exit_created`, `location_exit_deleted` (refresh location + map).
- `image_job_update` (image job completion via `ImageGenerationManager`).
- `chat_history_updated` (refresh history and quest panel).
- `prompt_progress`, `prompt_progress_cleared` (LLM progress footer).
- `quest_confirmation_request` (modal prompt).

## Key API calls from the chat UI

Not exhaustive, but the core UI calls include:

- `/api/chat` (send a new action).
- `/api/chat/history` (reload server history).
- `/api/chat/message` (edit/delete chat entries).
- `/api/slash-command` (slash command execution).
- `/api/quests/confirm` (quest confirmation).
- `/api/quest/edit` and `/api/player/quests/:id` (quest edit / abandon).
- `/api/factions` + `/api/player/factions/:id/standing` (faction panel edits).
- `/api/player` and `/api/player/skills/:name/increase` (sidebar + skill adjust).
- `/api/locations/:id` and `/api/locations/:id/exits` (location details + exit edits).
- `/api/map/region` and `/api/map/world` (map tabs).

## LLM prompt modals (immediate close)

LLM-backed modal submits close immediately (no visible waiting state) and rely on an internal in-flight guard; errors surface via `alert()` after the modal closes:

- `#addNpcModal` (adds an NPC via `/api/locations/:id/npcs`).
- `#newExitModal` (creates/edits exits via `/api/locations/:id/exits`).
- `#craftingModal` (crafting/processing via `/api/craft`).
- `#salvageIntentModal` (salvage/harvest via `/api/craft`).

## Insights and attachments

Chat entries can include attachments rendered as inline "insights":

- `skill-check`, `attack-check`, `plausibility`, `slop-remover`.
- Plausibility is rendered client-side with Nunjucks using `public/templates/plausibility.njk`.
- Slop removal insight lists slop words / n-grams.

## Location + entity images

`views/index.njk` defines helpers:

- `renderEntityImage({ element, entityType, entityId, imageId, ... })` sets `data-*` and delegates to `window.AIRPG.imageManager`.
- `renderImageBadgesOverlay` adds badges for crafting/processing/harvest/salvage on item images.
  Images can be enlarged through `public/js/lightbox.js`.

## Quest, faction, and party panels

Inline script functions in `views/index.njk` render these tabs:

- `initQuestPanel()` uses `/api/quest/edit` and `/api/player/quests/:id`.
- `initFactionPanel()` uses `/api/factions` and `/api/player/factions/:id/standing`.
- The faction form includes fields for name, home region, short description, description, tags, goals, assets, relations, reputation tiers, and player standing.
- `initPartyDisplay()` renders party cards and ties into the chat sidebar.

## Player overview sync

`initPlayerOverviewSync()` periodically refreshes `/api/player` and updates:

- Chat sidebar player card and party list.
- Quest panel data.

## See also

- `docs/ui/modals_overlays.md` for the full modal inventory.
- `docs/ui/maps.md` for map-specific behaviors.


[./ui/maps.md]
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


[./ui/modals_overlays.md]
# Modals and Overlays (Chat UI)

Most modals live in `views/index.njk` and are wired up by the inline script or `public/js/chat.js`.

## Global overlays

- `#locationOverlay` (class `overlay-backdrop`): travel/generation spinner while location updates.
- `#npcModalBackdrop`, `#questEditBackdrop`, `#craftingModalBackdrop`, `#salvageIntentBackdrop`:
  shared backdrops used to dim the page for certain modals.

## Quest confirmation (runtime-only)

- Built dynamically in `AIRPGChat.setupQuestConfirmationModal()` (in `public/js/chat.js`).
- Used when the server sends `quest_confirmation_request` via websocket.
- Accept/Decline triggers `/api/quests/confirm`.

## Quest editing

- `#questEditModal` + `#questEditBackdrop`
- Edits quest name, description, rewards, objectives.
- Save uses `/api/quest/edit`.

## NPC views and management

- `#npcInventoryModal`: character inventory listing with filters.
- `#npcViewModal`: character overview (attributes, gear, skills, abilities, status).
- `#npcDispositionModal`: adjust dispositions.
- `#npcNeedsModal`: adjust need bars.
- `#npcMemoriesModal`: edit important memories.
- `#npcGoalsModal`: edit goals.
- `#npcEditModal`: full NPC edit form (attributes, skills, abilities, status effects, faction membership).
  - Abilities in the edit form include a required short description field.
- `#addNpcModal`: generate and add a new NPC (optional reference image).

## Item / scenery editing

- `#thingEditModal`: edit items/scenery (metadata, bonuses, on-hit/equip effects, flags).
  - Includes a short description field directly under the main description.
- `#inventoryTooltip` and `#partyTooltip`: floating tooltips for entity cards.

## Location and region editing

- `#locationEditModal`: edit location name/description/level/status effects and controlling faction.
- `#regionEditModal`: edit region name/description/parent/level and controlling faction.
  - Both include a short description field directly under the main description.
- `#newExitModal`: create new exits (new region/location, optional image).
- `#summonNpcModal`: summon an existing NPC into current location.
- `#summonThingModal`: summon an existing item/scenery into current location.

## Crafting / processing

- `#craftingModal`: drag-and-drop crafting UI.
- `#salvageIntentModal`: optional prompt before salvage.

## Save/load

- `#loadGameModal`: choose manual or autosave and load.

## Image lightbox

- `#imageLightbox`: full-screen image viewer bound by `public/js/lightbox.js`.

## Notes

- Most modals are toggled via `hidden` + `aria-hidden`.
- The inline script in `views/index.njk` contains the open/close logic and field wiring.
- LLM prompt modals (`#addNpcModal`, `#newExitModal`, `#craftingModal`, `#salvageIntentModal`) close immediately on submit; no visible waiting state is shown, and errors surface via `alert()` after closing.


[./ui/pages.md]
# UI Pages and Routes

This page maps routes to templates and the client scripts/styles they load.

## Main chat interface
- Route: `/`
- Template: `views/index.njk`
- Styles: `public/css/main.css`, `public/css/map.css`, plus mod styles if present.
- Scripts (in order):
  - Vendor: `public/vendor/fitty.min.js`, `public/vendor/cytoscape*.js`, `public/vendor/layout-base.js`, `public/vendor/cose-base.js`, `public/vendor/nunjucks.js`, `public/vendor/markdown-it.min.js`.
  - App: `public/js/fitty-init.js`, `public/js/cytoscape-convex-hull.js`, `public/js/lightbox.js`, `public/js/image-manager.js`, `public/js/currency-utils.js`, `public/js/chat.js`, `public/js/map.js`, `public/js/world-map.js`, `public/js/player-stats.js`.
  - Optional mod scripts from `ModLoader` (injected by `server.js`).
- Inline script responsibilities:
  - Tab switching (`initTabs`), map triggers, party/faction/quest panels.
  - Location display, edit modals, crafting/salvage modals.
  - Image rendering helpers (`renderEntityImage`) and tooltip helpers.
- Data injected by `server.js`:
  - `chatHistory`, `player`, `availableSkills`, `currentSetting`.
  - `rarityDefinitions`, `needBarDefinitions`, `checkMovePlausibility`.
  - `baseWeaponDamage`, `clientMessageHistory`, `saveMetadata`.

## New game
- Route: `/new-game`
- Template: `views/new-game.njk`
- Styles: `public/css/main.css` + page inline styles.
- Script: `public/js/new-game.js`.
- Data injected by `server.js`:
  - `newGameDefaults`, `currentSetting`.
- Notes: submits `/api/new-game` with a keepalive POST, then immediately navigates to `/#tab-adventure` while generation continues; websocket status updates drive the overlay spinner if the page remains visible.

## Server configuration
- Route: `/config`
- Template: `views/config.njk`
- Styles: `public/css/main.css`.
- Script: `public/js/config.js` + inline helper script.
- Data injected by `server.js`:
  - `config`, `modConfigs`, `modelOptions`, `savedMessage`, `errorMessage`.

## Game settings manager
- Route: `/settings`
- Template: `views/settings.njk`
- Styles: `public/css/main.css`, `public/css/settings.css`.
- Script: inline (settings CRUD is embedded in the template).
- Data injected by `server.js`:
  - `currentPage` only. Data is loaded via `/api/settings` calls.

## Lorebooks manager
- Route: `/lorebooks`
- Template: `views/lorebooks.njk`
- Styles: `public/css/main.css`, `public/css/lorebooks.css`.
- Script: `public/js/lorebooks.js`.
- Data injected by `server.js`:
  - `currentPage` only. Data is loaded via `/api/lorebooks` calls.

## Debug page
- Route: `/debug`
- Template: `views/debug.njk`
- Styles: `public/css/main.css` + inline styles.
- Script: external `pretty-json-custom-element` for rendering JSON.
- Data injected by `api.js`:
  - `player`, `playerJson`, `allPlayers`, `allLocations`, `gameWorld`, etc.

## Player stats editor (legacy)
- Route: `/player-stats`
- Template: `views/player-stats.njk`
- Styles: `public/css/main.css`.
- Script: `public/js/player-stats.js`.
- Data injected by `api.js`:
  - `player`, `availableSkills`.

## Shared navigation
- Template partial: `views/_navigation.njk`
- Appears on all pages; includes Save/Load buttons only on the chat page.


[./ui/README.md]
# UI Documentation

This folder documents the core UI (no mod-provided UI) for the AI RPG web client.

## Scope
- Server-rendered Nunjucks pages in `views/`.
- Client-side behavior in `public/js/`.
- Styling in `public/css/`.
- Client templates in `public/templates/`.
- Third-party browser libs in `public/vendor/`.

## UI entry points
- `/` -> `views/index.njk` (main chat interface).
- `/new-game` -> `views/new-game.njk`.
- `/config` -> `views/config.njk`.
- `/settings` -> `views/settings.njk`.
- `/lorebooks` -> `views/lorebooks.njk`.
- `/debug` -> `views/debug.njk`.
- `/player-stats` -> `views/player-stats.njk` (still routed, not linked in nav).

Routing is registered in `server.js` (most pages) and `api.js` (debug + player stats).

## Directory map
- `views/` server-rendered templates.
  - `index.njk` main UI (tabs, chat, panels, modals).
  - `_navigation.njk` shared nav buttons.
  - `new-game.njk`, `config.njk`, `settings.njk`, `lorebooks.njk`, `debug.njk`, `player-stats.njk`.
  - `views/popups/plausibility.njk` server-side copy of plausibility tooltip markup.
- `public/js/` client scripts (chat, maps, lorebooks, settings logic, etc).
- `public/css/` SCSS/CSS (global styles + page-specific overrides).
- `public/templates/` client-side Nunjucks templates (currently `plausibility.njk`).
- `public/vendor/` third-party libraries (cytoscape, fitty, markdown-it, nunjucks runtime).

## Runtime globals injected on the chat page
From `views/index.njk`:
- `window.currentSetting`, `window.rarityDefinitions`, `window.needBarDefinitions`.
- `window.AIRPG_CONFIG` (including `baseWeaponDamage`).
- `window.AIRPG_CONFIG.clientMessageHistory`.
- `window.__AIRPG_SAVE_METADATA__` (save metadata for summaries, etc).
- `window.CHECK_MOVE_PLAUSIBILITY`.
- `window.availableSkillsList` and `window.getKnownSkillNameSet()`.
- `window.AIRPG_CLIENT_ID` (set by `AIRPGChat` and reused by image jobs).

## Files in this folder
- `docs/ui/pages.md` routes, templates, scripts, and injected data.
- `docs/ui/chat_interface.md` main chat UI layout, behaviors, data flow.
- `docs/ui/modals_overlays.md` modal inventory (chat page).
- `docs/ui/maps.md` region map and world map implementation.
- `docs/ui/assets_styles.md` styling, assets, and vendor libraries.

