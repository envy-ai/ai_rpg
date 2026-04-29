# Player

## Purpose
Represents a player or NPC with attributes, skills, inventory, gear, status effects, need bars, dispositions, party membership, quests, progression, and optional alias names. Maintains static indexes and shared definitions (gear slots, dispositions, need bars), all loaded from root `defs/*.yaml` plus any matching mod defs overlays.

## Key State
- Identity: `#id`, `#name`, `#aliases`, `#description`, `#shortDescription`, `#imageId`, `#class`, `#race`, `#gender`, `#isNPC`.
- Core stats: `#attributes`, `#level`, `#experience`, `#health` (finite float), `#healthAttribute`, `#healthRegenAppliedAt`.
- Inventory/gear: `#inventory`, `#gearSlots`, `#gearSlotsByType`, `#gearSlotNameIndex`.
- Skills/abilities: `#skills`, `#abilities`, `#unspentSkillPoints`, `#unspentAttributePoints`.
- Pending level-up ability draft state: `#pendingAbilityOptionsByLevel` (per-level generated options for player-only ability selection flow).
- Status/needs: `#statusEffects`, `#needBars`, `#needBarApplicability`, `#needBarRatesAppliedAt`.
- Social: `#dispositions`, `#personalityType`, `#personalityTraits`, `#personalityNotes`, `#resistances`, `#vulnerabilities`.
- Factions: `#factionId`, `#factionStandings` (map of `factionId -> number`).
- UI state: `#thingListViewPreferences` (per-panel shared thing-list view modes for location/inventory/crafting panels).
- Party/quests: `#partyMembers`, `#quests`, `#goals`, `#characterArc`.
- Movement/turns: `#currentLocation`, `#previousLocationId`, `#lastSeenTime` (`last_seen_time` absolute world minutes), `#lastSeenLocation` (`last_seen_location` id), `#wasInPlayerLocationPreviousRound`, `#elapsedTime` (minutes), `#lastVisitedTime` (minutes), `#inCombat`, `#lastActionWasTravel`, `#consecutiveTravelActions`.
- Lifecycle: `#isDead`, `#persistWhenDead`, `#corpseCountdown`.
- Static indexes: `#indexById`, `#indexByName`.

## Construction
- `new Player(options)` loads definitions, validates input, initializes attributes, inventory, gear, skills, dispositions, need bars, per-actor need-bar applicability, and registers in indexes.

## Static API
- Lookup and registry:
  - `getAll()`, `getById(id)`, `get(id)`, `getByName(name)`, `getByNames(names)`, `unregister(target)`.
  - `clearRuntimeRegistries()` clears in-memory player registries (`#instances`, `#indexById`, `#indexByName`) before hydration/new-game rebuilds.
  - `removeNpcFromAllLocations(npcId)` removes an NPC id from every location's `npcIds` list.
  - `resolvePlayerId(playerLike)`.
- Current player helpers:
  - `setCurrentPlayerResolver(resolver)`, `getCurrentPlayer()`, `getCurrentPlayerId()`.
- Definitions:
  - `getDispositionDefinitions()`, `getDispositionDefinition(name)`, `resolveDispositionIntensity(type, value)`; disposition definitions include the configured display `icon`.
  - `getNeedBarDefinitionsForContext()` (prompt/UI-safe need-bar definitions including icon/color metadata, `while_you_were_away_prompt_notes`, plus `small`/`medium`/`large`/`fill` and `small`/`medium`/`large`/`empty` trigger lists).
  - `validateNeedBarPromptSentences({ onError })` preflights `effect_thresholds.*.sentence` coverage for prompt-facing need summaries.
  - `reloadDefinitionCaches({ refreshInstances })` clears shared defs caches and can reapply merged need-bar definitions to already loaded actors.
  - `setAvailableSkills(skillsInput)`, `getAvailableSkills()`.
- Global behaviors:
  - `applyStatusEffectNeedBarsToAll()` (uses canonical world minutes, initializes missing actor/effect/health-regeneration minute stamps without backfilling, applies configured health regeneration, baseline `change_per_minute` need-bar drift, plus status-effect need-bar deltas once per elapsed minute, and decrements finite status-effect durations by elapsed minutes capped to remaining time).
  - `updatePreviousLocationsForAll()`.
  - `getNpcIdsSharingPlayerLocation(...)` snapshots which NPCs share the player's location or party context at turn start.
  - `recordNpcSightingsForCurrentPlayer(...)` updates NPC `last_seen_time` / `last_seen_location` for NPCs sharing the current player's location at the end of a turn and uses the turn-start snapshot to record whether each NPC was with the player continuously from the previous round.
  - `setExperienceRolloverMultiplier(value)`.
- Handlers:
  - `setNpcInventoryChangeHandler(handler)`, `setLevelUpHandler(handler)`.

## Accessors (Grouped)
- Identity and descriptors: `id`, `name`, `aliases`, `description`, `shortDescription`, `imageId`, `class`, `race`, `gender`, `personalityType`, `personalityTraits`, `personalityNotes`, `resistances`, `vulnerabilities`.
- Factions: `factionId`.
- State: `level`, `experience`, `health`, `maxHealth`, `healthAttribute`, `isDead`, `persistWhenDead`, `isDisabled`, `inCombat`, `isHostile`, `corpseCountdown`, `elapsedTime`, `createdAt`, `lastUpdated`.
- Locations: `currentLocation`, `location`, `currentVehicle`, `previousLocationId`, `previousLocation`, `currentLocationObject`, `lastVisitedTime`, `last_seen_time`, `last_seen_location`, `was_in_player_location_previous_round` (plus camelCase aliases).
- Social/party: `partyMembers`, `isInPlayerParty`, `wasEverInPlayerParty`, `partyMembershipChangedThisTurn`, `partyMembersAddedThisTurn`, `partyMembersRemovedThisTurn`.
- Quests/goals: `goals`, `characterArc`, `currentQuests`, `completedQuests`.
- Need bars/memory: `turnsSincePartyMemoryGeneration`, `importantMemories`.

## Instance API (Highlights)
- Quests/goals:
  - `addGoal(goal)`, `removeGoal(goal)`.
  - `addQuest(quest)`, `removeQuest(questId)`, `getQuestById(questId)`.
  - `getCurrentQuests()`, `getCompletedQuests()`.
- Aliases:
  - `getAliases()`, `setAliases(list)`, `addAlias(alias)`, `removeAlias(alias)`.
- Party management:
  - `addPartyMember(memberId)`, `removePartyMember(memberId)`, `clearPartyMembers()`, `getPartyMembers()`.
  - `addPartyMember(...)` now enforces party/location invariants by removing the member from all location NPC lists and clearing their explicit location.
  - Party memory helpers: `addPartyMemoryHistorySegment(...)`, `getPartyMemoryHistorySegments(...)`, `clearPartyMemoryHistory()`.
  - `markPartyMembershipChangedThisTurn()`, `clearPartyMembershipChangeTracking()`.
- Dispositions:
  - `getDisposition(targetId, type)`, `setDisposition(...)`, `increaseDisposition(...)`, `decreaseDisposition(...)`.
  - `getDispositionTowards(player, type)`, `setDispositionTowards(...)`.
  - `getDispositionIntensityTowards(...)`, `getDispositionTowardsCurrentPlayer(...)`, `setDispositionTowardsCurrentPlayer(...)`.
- Factions:
  - `getFactionStandings()`, `setFactionStandings(mapOrObject)`.
  - `getFactionStanding(factionId)`, `setFactionStanding(factionId, value)`, `removeFactionStanding(factionId)`.
- UI state:
  - `getThingListViewPreferences()`, `setThingListViewPreferences(mapOrObject)`.
  - `setThingListViewPreference(panelKey, viewMode)`.
- Attributes/skills/abilities:
  - `getAttributeNames()`, `getAttributeDefinition(name)`, `getAttributeModifier(name)`, `getAttributeModifiers()`.
  - `setAttribute(name, value)` (if this increases max health, current health is increased by the same delta; decreases still clamp to max).
  - `getSkills()`, `getSkillValue(name)`, `setSkillValue(name, value)`.
  - `getSkillModifiers(name, { includeEquipped })`.
  - `increaseSkill(name, amount)`, `syncSkillsWithAvailable()`.
  - `getAbilities()`, `setAbilities(list)`, `addAbility(ability)`.
  - Pending player draft options:
    - `getPendingAbilityOptionsByLevel()`, `getPendingAbilityOptionsForLevel(level)`.
    - `setPendingAbilityOptionsForLevel(level, abilities)`.
    - `clearPendingAbilityOptionsForLevel(level)`, `clearPendingAbilityOptions()`.
- Progression:
  - `levelUp(count)` (updates level/health only; point pools are formula-derived dynamically).
  - `getUnspentSkillPoints()`, `setUnspentSkillPoints(value)`, `adjustUnspentSkillPoints(delta)`.
  - `getUnspentAttributePoints()`, `setUnspentAttributePoints(value)`, `adjustUnspentAttributePoints(delta)`.
  - `addExperience(amount, raw)` (normal gameplay XP is divided by `(currentLevel / 2)` for levels above `1`; for non-NPC actors with party members, shared XP is still derived from the original pre-division award and then scaled per recipient by `sourceLevel / recipientLevel`; `raw=true` bypasses both the level-based divisor and the party-recipient scaling), `addRawExperience(amount)`, `setExperience(value)`.
- Health/combat:
  - `modifyHealth(amount, reason)`, `setHealth(health)`, `setHealthAttribute(attributeName)`.
  - `isAlive()`, `updateCorpseCountdown()`.
- Status effects:
  - `getStatusEffects()`, `getIntrinsicStatusEffects()`.
  - `setStatusEffects(effects)`, `addStatusEffect(effect, defaultDuration)`, `removeStatusEffect(description)`.
  - `tickStatusEffects(elapsedMinutes)`, `clearExpiredStatusEffects()`.
- Need bars:
  - `getNeedBars(options)`, `getNeedBarValue(identifier)`.
  - `getNeedBarApplicability()`, `setNeedBarApplicability(map)`.
  - `setNeedBars(list)`, `setNeedBarValue(identifier, value)`.
  - `applyNeedBarChange(identifier, options)`.
  - `getNeedBarsForContext(options)`, `getNeedBarPromptContext(options)`.
  - `getNeedSentencePromptContext({ actorName, onMissingSentence })` resolves active need-bar threshold sentences with `%CHARACTER%` substitution for base-context prompt rendering.
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
  - `recordLastSeenByPlayer({ time, locationId, wasInPlayerLocationPreviousRound })`.
- Serialization:
  - `getStatus()`, `toJSON()`, `static fromJSON(data)`.
- Misc:
  - `generateAttributes(method, diceModule)`, `getGenerationMethods()`.
  - `finalizeTurn()`.
  - `toString()`.

## Private Helpers (Selected)
- Initialization: `#loadDefinitions`, `#initializeAttributes`, `#initializeInventory`, `#initializeGear`, `#initializeSkills`, `#initializeDispositions`, `#initializeNeedBars`.
- Gear helpers: `#resolveItemIdFromGearValue`, `#normalizeSlotType`, `#resolveSlotName`, `#syncGearWithInventory`, `#preserveHealthRatioAfterGearChange`.
- Need bar helpers: `#normalizeNeedBarChangeList`, `#normalizeNeedMagnitudeKey`, `#normalizeNeedValueMap`, `#buildNeedBarDefinition`, `#cloneNeedBarDefinition`, `#loadNeedBarDefinitionState`, `#formatNeedBarForContext`, `#resolveNeedBarByIdentifier`, `#resolveNeedBarMagnitudeDelta`, `#resolveNeedBarThreshold`, `#applyNeedBarValue`.
- Attributes/health: `#normalizeHealthValue`, `#getHealthRegenPercentPerMinute`, `#defaultHealthAttribute`, `#resolveHealthAttribute`, `#calculateBaseHealth`, `#validateAttributeValue`, `#calculateAttributeModifier`.
- Status/abilities: `#normalizeStatusEffects`, `#normalizeAbilities`, `#getIntrinsicStatusEffects`.
- Pending draft options: `#normalizePendingAbilityOptionsByLevel`.
- Dispositions: `#normalizeDispositionType`, `#sanitizePersonalityValue`, `#applyHostileDispositionsToCurrentPlayer`.
- Inventory helpers: `#resolveThing`, `#addInventoryThing`, `#removeInventoryThing`, `#notifyNpcInventoryChange`.
- XP: `#skillPointsPerLevel`, `#processExperienceOverflow`.
- Point-pool formulas: `#buildPointPoolVariables`, `#evaluatePointPoolState`.

## Notes
- The class supports NPCs and players; many behaviors are shared with `isNPC` gating certain flows.
- Gear and inventory are tightly coupled; equip/unequip flows update health and modifiers.
- Current health is stored and serialized as a finite float. Health setters/modifiers accept finite non-negative numbers, while client-facing health readouts round displayed current/max health upward with `Math.ceil`.
- `healthRegenPercentPerMinute` config applies passive health regeneration as a percentage of current max health for each elapsed world minute; per-actor `healthRegenAppliedAt` is persisted so reloads do not replay already-processed regeneration.
- Need bar logic includes per-minute baseline drift (`change_per_minute`) and magnitude-based adjustments.
- Global `defs/need_bars.yaml -> need_values` now defines separate `increase` and `decrease` default maps, each with its own `small` / `medium` / `large` deltas. Individual bars can override either direction via their own nested `need_values` block, and any missing per-bar directional keys still fall back to the matching global direction. These magnitudes preserve decimal values exactly instead of being rounded or forced up to a minimum of `1`.
- Need-bar definitions can include `while_you_were_away_prompt_notes`; `getNeedBarDefinitionsForContext()` exposes it under the same snake_case key so the while-you-were-away prompt can use bar-specific reunion guidance.
- `applyNeedBarChange(...)` now returns `needBarIcon` / `needBarColor` metadata alongside the usual delta/threshold payload so event summaries and notifications can use the configured need-bar icon directly.
- Need bars now use explicit audience flags (`player`, `party`, `nonParty`). NPCs retain both party-only and non-party-only bar state internally so values survive party swaps. Active reads, prompt context, endpoint payloads, and per-minute drift treat `party` as “currently in the party or has ever been in the party,” while `nonParty` still means “not currently in the party,” so former party members can have both party-history bars and non-party bars active at once.
- Per-actor need-bar minute drift now persists a `needBarRatesAppliedAt` timestamp in saves so reloads do not replay already-processed elapsed world minutes.
- Need-bar applicability is now also persisted separately per actor in `needBarApplicability`. This is distinct from current audience activation: a bar can be defined for NPC audiences globally but still be explicitly disabled for a specific NPC. Save/load now persists the full resolved applicability map, and legacy saves missing need-bar state default storable bars to `value: 100` and `applicable: true` during hydration.
- Shared thing-list UI view modes are now persisted per actor in `thingListViewPreferences`, keyed by the fixed panel ids `npcInventory`, `craftingInventory`, `locationScenery`, `locationItems`, `containerPlayerInventory`, and `containerContents`, so page reloads and save/load restore the same panel view selections.
- `setNeedBarApplicability(...)` preserves stored values for bars that stay enabled, drops bars explicitly disabled for that actor, and restores newly re-enabled bars at `100`.
- Status-effect-driven max-health increases now raise current health by the same max-health delta. Status-effect-driven decreases do not subtract health back out; they only clamp current health if it now exceeds the reduced max.
- `persistWhenDead` is persisted per actor. When true, dead actors never receive a corpse countdown and are skipped by corpse cleanup; missing save data defaults it to `false`.
- `wasEverInPlayerParty` is also persisted per actor. It flips to `true` when the actor joins the player party, and load reconciliation also marks currently in-party actors as historical party members so older saves do not lose that history. Missing save data defaults it to `false`.
- Joining the player party, leaving the player party, or dying while currently in the player party permanently flips `persistWhenDead` to `true` for that actor.
- `elapsedTime` is minute-canonical; setter validation requires non-negative integer minutes, and load paths normalize to integer minutes.
- `currentVehicle` returns `null` unless the actor is currently in a vehicle location or vehicle region; when present it includes vehicle name/description, `location` (`<regionName>:<locationName>`), the full `vehicleInfo` object, explicit trip-state booleans (`isUnderway`, `hasArrived`, `isArriving`) mirrored onto `vehicleInfo` for prompt compatibility, `destination`, `destinationResolved`, optional `pendingDestination`, numeric `minutesToDestination`, plus a formatted `timeToDestination` string (`X days, Y hours, Z minutes`, omitting all zero-value units except exact `0 minutes`, and appending `ago` when negative). During timed travel, `destination` can come from `pendingDestination` even when `vehicleInfo.currentDestination` is still `null`, so prompts can see the intended target without forcing early destination generation. These booleans now come from `VehicleInfo` directly, so pre-departure states no longer appear as arrived.
- Unspent skill/attribute points are formula-derived at read time from current level + assigned stats/skills.
- Party members are treated as off-location actors: joining party removes them from all location `npcIds` and clears `currentLocation`.
- Gameplay XP awards above level `1` are reduced by dividing the incoming award by `(level / 2)`.
- Party XP sharing now scales by each recipient's level instead of copying the source actor's already-scaled award, and it derives party shares from the original pre-division gameplay award so the source actor's own level reduction does not cascade onto other recipients.
- `getById(id)` is index-backed (`#indexById`) so party XP and other lookups resolve the canonical current instance, not stale insertion-order instances.
- `unregister(target)` now rebuilds indexes after removals to prevent stale id/name registry entries.
- Direct unspent-point mutators (`setUnspent*`/`adjustUnspent*`) now throw by design.
- `setLocation(locationId)` now warns with a stack trace and leaves `currentLocation` unchanged when the provided string id cannot be resolved.
- NPC last-seen state is persisted as snake_case save fields: `last_seen_time` stores an absolute world-minute timestamp, `last_seen_location` stores the location id, and `was_in_player_location_previous_round` records whether the NPC was with the player continuously from the previous round. Chat, direct movement, crafting/processing, and location-modification actions snapshot same-location NPCs at turn start, then update sightings after successful turn resolution so base-context can mention absent NPCs and expose newly present NPCs without implying continuously present NPCs have recently vanished.
