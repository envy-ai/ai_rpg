# Player

## Purpose
Represents a player or NPC with attributes, skills, inventory, gear, status effects, need bars, dispositions, party membership, quests, progression, and optional alias names. Maintains static indexes and shared definitions (gear slots, dispositions, need bars).

## Key State
- Identity: `#id`, `#name`, `#aliases`, `#description`, `#shortDescription`, `#imageId`, `#class`, `#race`, `#gender`, `#isNPC`.
- Core stats: `#attributes`, `#level`, `#experience`, `#health`, `#healthAttribute`.
- Inventory/gear: `#inventory`, `#gearSlots`, `#gearSlotsByType`, `#gearSlotNameIndex`.
- Skills/abilities: `#skills`, `#abilities`, `#unspentSkillPoints`, `#unspentAttributePoints`.
- Status/needs: `#statusEffects`, `#needBars`.
- Social: `#dispositions`, `#personalityType`, `#personalityTraits`, `#personalityNotes`.
- Factions: `#factionId`, `#factionStandings` (map of `factionId -> number`).
- Party/quests: `#partyMembers`, `#quests`, `#goals`, `#characterArc`.
- Movement/turns: `#currentLocation`, `#previousLocationId`, `#elapsedTime` (minutes), `#lastVisitedTime` (minutes), `#inCombat`, `#lastActionWasTravel`, `#consecutiveTravelActions`.
- Lifecycle: `#isDead`, `#corpseCountdown`.
- Static indexes: `#indexById`, `#indexByName`.

## Construction
- `new Player(options)` loads definitions, validates input, initializes attributes, inventory, gear, skills, dispositions, need bars, and registers in indexes.

## Static API
- Lookup and registry:
  - `getAll()`, `getById(id)`, `get(id)`, `getByName(name)`, `getByNames(names)`, `unregister(target)`.
  - `removeNpcFromAllLocations(npcId)` removes an NPC id from every location's `npcIds` list.
  - `resolvePlayerId(playerLike)`.
- Current player helpers:
  - `setCurrentPlayerResolver(resolver)`, `getCurrentPlayer()`, `getCurrentPlayerId()`.
- Definitions:
  - `getDispositionDefinitions()`, `getDispositionDefinition(name)`, `resolveDispositionIntensity(type, value)`.
  - `getNeedBarDefinitionsForContext()`.
  - `setAvailableSkills(skillsInput)`, `getAvailableSkills()`.
- Global behaviors:
  - `applyStatusEffectNeedBarsToAll()` (uses canonical world minutes, initializes missing `appliedAt` stamps, applies need-bar deltas once per elapsed minute, and decrements finite status-effect durations by elapsed minutes capped to remaining time).
  - `updatePreviousLocationsForAll()`.
  - `setExperienceRolloverMultiplier(value)`.
- Handlers:
  - `setNpcInventoryChangeHandler(handler)`, `setLevelUpHandler(handler)`.

## Accessors (Grouped)
- Identity and descriptors: `id`, `name`, `aliases`, `description`, `shortDescription`, `imageId`, `class`, `race`, `gender`, `personalityType`, `personalityTraits`, `personalityNotes`.
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
- Attributes/skills/abilities:
  - `getAttributeNames()`, `getAttributeDefinition(name)`, `getAttributeModifier(name)`, `getAttributeModifiers()`.
  - `setAttribute(name, value)` (if this increases max health, current health is increased by the same delta; decreases still clamp to max).
  - `getSkills()`, `getSkillValue(name)`, `setSkillValue(name, value)`.
  - `getSkillModifiers(name, { includeEquipped })`.
  - `increaseSkill(name, amount)`, `syncSkillsWithAvailable()`.
  - `getAbilities()`, `setAbilities(list)`, `addAbility(ability)`.
- Progression:
  - `levelUp(count)` (updates level/health only; point pools are formula-derived dynamically).
  - `getUnspentSkillPoints()`, `setUnspentSkillPoints(value)`, `adjustUnspentSkillPoints(delta)`.
  - `getUnspentAttributePoints()`, `setUnspentAttributePoints(value)`, `adjustUnspentAttributePoints(delta)`.
  - `addExperience(amount, raw)`, `addRawExperience(amount)`, `setExperience(value)`.
- Health/combat:
  - `modifyHealth(amount, reason)`, `setHealthAttribute(attributeName)`.
  - `isAlive()`, `updateCorpseCountdown()`.
- Status effects:
  - `getStatusEffects()`, `getIntrinsicStatusEffects()`.
  - `setStatusEffects(effects)`, `addStatusEffect(effect, defaultDuration)`, `removeStatusEffect(description)`.
  - `tickStatusEffects(elapsedMinutes)`, `clearExpiredStatusEffects()`.
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
- Point-pool formulas: `#buildPointPoolVariables`, `#evaluatePointPoolState`.

## Notes
- The class supports NPCs and players; many behaviors are shared with `isNPC` gating certain flows.
- Gear and inventory are tightly coupled; equip/unequip flows update health and modifiers.
- Need bar logic includes per-turn decay and magnitude-based adjustments.
- `elapsedTime` is minute-canonical; setter validation requires non-negative integer minutes, and load paths normalize to integer minutes.
- Unspent skill/attribute points are formula-derived at read time from current level + assigned stats/skills.
- Party members are treated as off-location actors: joining party removes them from all location `npcIds` and clears `currentLocation`.
- Direct unspent-point mutators (`setUnspent*`/`adjustUnspent*`) now throw by design.
