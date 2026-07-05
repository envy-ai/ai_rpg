# Serialization & Save Format

This page documents the persisted game-save format and the server-side hydration path. Shared HTTP response shapes such as `NpcProfile`, `LocationResponse`, `Thing`, `Quest`, and `NeedBar` are documented in `docs/api/common.md`; lifecycle routes are documented in `docs/api/game.md`.

## Ownership

- `Utils.serializeGameState(context)` builds the in-memory save snapshot.
- `Utils.writeSerializedGameState(saveDir, serialized)` writes the snapshot to a save directory.
- `Utils.loadSerializedGameState(saveDir)` reads a save directory into a raw serialized object.
- `Utils.hydrateGameState(serialized, context)` migrates compatible save data and rebuilds runtime registries.
- `api.js` wraps these helpers for `/api/save`, autosave, `/api/load`, `/api/saves`, and post-load reconciliation.
- Domain classes own their record shapes through `toJSON()` / `fromJSON()` or subsystem helpers such as `MysteryBox.serializeAll()` / `MysteryBox.loadAll()`.

## Save Directories

Manual saves are written under `saves/`. Autosaves use `autosaves/`. Save directory names are prefixed with an ISO timestamp fragment and include sanitized setting, player, location, and uniqueness segments.

Each save directory can contain:

| File | Contents |
| --- | --- |
| `gameWorld.json` | Object with `locations`, `locationExits`, and `regions` maps. Locations serialize through `Location.toJSON()` / `getDetails()`, exits through `LocationExit.toJSON()`, and regions through `Region.toJSON()`. |
| `allPlayers.json` | Map of player/NPC ids to `Player.toJSON()` records. Inventories, barter inventories, party members, quests, and registered Player extension fields are stored inside each actor record. |
| `things.json` | Map of item/scenery ids to `Thing.toJSON()` records. Container contents, pending container seed entries, stack count, harvest state, flags, status effects, metadata, and registered Thing extension fields are persisted here. |
| `factions.json` | Map of faction ids to `Faction.toJSON()` records. |
| `skills.json` | Array of `Skill.toJSON()` records. |
| `chatHistory.json` | Array of normalized chat entries. Autosaves may omit a final entry when it duplicates the final entry in the latest autosave directory. |
| `chatSummaries.json` | Chat-summary store managed by `Utils.serializeChatSummaries()` / `Utils.loadChatSummaries()`. |
| `sceneSummaries.json` | `SceneSummaries.serialize()` payload. |
| `images.json` | Generated-image registry data from the runtime `generatedImages` map. Image files themselves are resolved from `public/generated-images` during load checks. |
| `mysteryBoxes.json` | Object map from `MysteryBox.serializeAll()`. |
| `mysteryThreads.json` | Object map from `MysteryThread.serializeAll()`. |
| `scheduledEvents.json` | Object map from `ScheduledEvent.serializeAll()`. |
| `trackers.json` | Object map from `Tracker.serializeAll()`. |
| `pendingRegionStubs.json` | Object map of unresolved region-entry stubs and their preserved metadata. Hydration rebuilds and deduplicates this map against loaded locations/regions. |
| `worldTime.json` | Minute-canonical world time, normally `{ dayIndex, timeMinutes }`. |
| `calendarDefinition.json` | Normalized active calendar definition used for date, season, holiday, and light-level resolution. |
| `gameConfigOverride.yaml` | Raw per-game YAML config override normalized by `Globals.setGameConfigOverrideYaml()`. Blank content means no per-game override. |
| `setting.json` | Active setting snapshot when a setting exists at save time. |
| `metadata.json` | Save metadata, counts, enabled mod list, save-file version, ID counters, prompt counters, summary style, plot analysis, offscreen NPC activity state, and current player/location identifiers. |

`loadSerializedGameState()` supplies per-file defaults for missing files and logs JSON parse failures before returning that file's default value. Hydration still validates subsystem payloads and throws for unavailable required serializers, invalid object-map payloads in strict subsystem loaders, invalid pending-region data, and invalid saved exit travel times.

## Metadata

`metadata.json` includes:

- `saveName`, `timestamp`, `source` (`saves` or `autosaves`), `gameVersion`.
- Player fields: `playerId`, `playerName`, `playerLevel`.
- Current location fields: `currentLocationId`, `currentLocationName`.
- Current setting fields: `currentSettingId`, `currentSettingName`.
- Count fields: `chatHistoryLength`, `totalPlayers`, `totalThings`, `totalLocations`, `totalLocationExits`, `totalRegions`, `totalFactions`, `totalMysteryBoxes`, `totalMysteryThreads`, `totalScheduledEvents`, `totalTrackers`, `totalGeneratedImages`, `totalSkills`.
- `enabledMods`: sorted unique startup-active mod directory names. `/api/load` compares this list with the running server's startup-frozen active mod list before hydration.
- `idCounters`: `IdGenerator.snapshotCounters()` output so compact ids are not reused after deleted records disappear from the live world.
- `saveFileSaveVersion`: numeric save-format version recorded in memory as `Globals.saveFileSaveVersion`.
- Prompt/runtime fields: `summaryStyle`, `npcAliasesGenerated`, `plotSummaryTurnCounter`, `plotExpanderTurnCounter`, `improvementPromptTurnCounter`, `offscreenNpcActivityState`, and `plotAnalysis`.

## ID Allocation

Persisted domain objects use `IdGenerator` compact counters:

| Prefix | Objects |
| --- | --- |
| `char` | Players and NPCs |
| `thing` | Items and scenery |
| `loc` | Locations |
| `exit` | Location exits |
| `region` | Regions and pending region stubs |
| `faction` | Factions |
| `quest` | Quests |
| `obj` | Quest objectives |
| `status` | Status effects |
| `mystery` | Mystery boxes |
| `mthread` | Mystery threads |
| `sevent` | Scheduled events |

Hydration resets the generator, seeds counters from `metadata.idCounters`, and registers loaded or explicit ids through each model constructor/loader. Chat message ids, prompt ids, generated-image request ids, and other operational ids are outside this allocator.

## Domain Records

The save format stores canonical server records, not necessarily the expanded client API payloads.

- `Player.toJSON()` stores actor identity, descriptors, aliases, health, attributes, skills, abilities, declined abilities, inventory ids, barter inventory ids, gear, quests, dispositions, faction state, need bars, need-bar applicability, per-minute need/health timestamps, party state, travel memory, hidden/death flags, UI view preferences, mod state, and registered Player extension fields at top level.
- `Thing.toJSON()` stores item/scenery identity, type, count, image, rarity/level fields, slot/attribute bonuses, target/equipper cause effects, container state, harvest state, boolean flags, metadata, status effects, and registered extension fields at top level.
- `Location.toJSON()` stores location details including exits, region id, controlling faction id, image variants, visit/favorite state, stubs, generation hints, NPC ids, thing ids, random events, status effects, and vehicle info.
- `Region.toJSON()` stores region details including blueprints, location ids, entrance, parent, controlling faction, vehicle info, weather/weather state, status effects, random events, concepts, secrets, and average level.
- `LocationExit.toJSON()` stores edge details including destination, destination region, travel time in minutes, bidirectionality, image id, vehicle edge fields, and timestamps.
- `StatusEffect.toJSON()` stores id, name, description, attribute/skill/need modifiers, duration in minutes, and applied world minute.
- `VehicleInfo.toJSON()` stores terrain types, icon, current/pending destinations, fixed-route destination ids or pending-region tokens, ETA, departure time, and vehicle exit id.
- `Quest`, `Faction`, `Skill`, `SettingInfo`, `MysteryBox`, `MysteryThread`, and `ScheduledEvent` persist through their own JSON helpers.

Registered Thing and Player extension fields must be registered before load for `Thing.fromJSON()` / `Player.fromJSON()` to restore them. Enabled-mod compatibility is checked before hydration when `metadata.enabledMods` is present; callers may pass `modMismatchChoice: 'keep-current'` to `/api/load` to bypass the mismatch response and hydrate under the running server's active mods.

## Hydration Flow

`/api/load` performs these steps:

1. Resolve the requested save directory from `saves/` or `autosaves/`.
2. Read raw serialized files with `Utils.loadSerializedGameState(saveDir)`.
3. Compare `metadata.enabledMods` against the startup-active mod list when the metadata field exists.
4. Apply `gameConfigOverride.yaml` through `Globals.reloadConfigAndDefs({ needBarSentenceValidationMode: 'throw' })`.
5. Clear transient job/image/NPC-generation queues.
6. Run `Utils.hydrateGameState(...)`.
7. Reconcile faction references, party-member location state, missing image ids, world time on the current player, summary state, and short-description backfill planning.
8. Resolve the current player from `metadata.playerId` or the first loaded actor.
9. Return `loadedData` with the client-facing current-player profile and totals.

`hydrateGameState()` migrates compatible save data before registry rebuild, then loads skills, factions, mystery boxes, mystery threads, scheduled events, trackers, things, players, images, chat history, locations, exits, regions, pending region stubs, chat summaries, and scene summaries. Player runtime registries and static model indexes for quests, locations, things, regions, factions, mystery boxes/threads, scheduled events, and trackers are cleared before re-instantiating saved records.

## Compatibility And Migrations

The active save format version is `1.2` (`Globals.currentSaveVersion`).

Migration behavior developers need to preserve:

- Saves with hour-based `worldTime.timeHours` and related hour fields are converted to minute-canonical values before object hydration. This includes player/location elapsed or visited timestamps, status-effect duration/appliedAt fields, weather duration fields, and offscreen NPC activity snapshots.
- Saves below version `1.1` have serialized need-bar values scaled by `10`, then `metadata.saveFileSaveVersion` is set to `1.1` in the in-memory serialized object.
- Saves below version `1.2` have persisted domain ids and exact structured references migrated to compact counter ids. The migration writes `metadata.idCounters` and sets `metadata.saveFileSaveVersion` to `1.2` in the in-memory serialized object.
- Missing saved exit `travelTimeMinutes` values hydrate as `0`, the sentinel for an unpopulated travel time. Invalid non-integer or negative travel times throw.
- Location saves without `visited` hydrate non-stub locations as visited and stub locations as unvisited. Missing `favorite` hydrates as `false`.
- Saves with mystery boxes but no threads hydrate one inactive `Legacy Mystery Boxes` thread containing the existing boxes.
- Saved settings without hiding/perception selections can be backfilled during `/api/load`; successful backfill rewrites the loaded save.
- Missing `calendarDefinition.json` is filled from the loaded setting calendar definition when present, or generated through the calendar generation path.
- `VehicleInfo.fromJSON()` accepts `eta`, `departure_time`, and `vehicleExitID` aliases, but rejects obsolete `destination` and `destinationType` fields.

After a migrated load, the in-memory metadata version is normalized and the next save writes the upgraded format.

## API Shape Boundaries

Client responses usually use expanded API shapes instead of raw save records. Examples:

- `serializeNpcForClient()` expands inventory and party-related fields for player/NPC endpoint responses.
- `buildLocationResponse(...)` enriches `Location.toJSON()` with region names/path, pending image jobs, NPC profiles, thing profiles, map-oriented exit metadata, and vehicle display fields.
- `Player.getStatus()` includes derived modifiers, definitions, expanded inventory objects, and route-supplied status sections beyond `Player.toJSON()`.
- `GET /api/saves` starts with baseline listing fields and merges each save's `metadata.json`.

When documenting endpoint payloads, prefer `docs/api/common.md`. Use this page for persisted save directory behavior and load/save compatibility notes.
