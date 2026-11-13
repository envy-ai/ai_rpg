# Player

## Purpose
Represents a player or NPC with attributes, skills, inventory, gear, status effects, need bars, dispositions, party membership, quests, progression, and optional alias names. Maintains static indexes and shared definitions (gear slots, disposition types, need bars), loaded from root `defs/*.yaml` plus any matching mod defs overlays, with the disposition first-impression multiplier loaded from merged config.

## Key State
- Identity: `#id`, `#name`, `#aliases`, `#description`, `#shortDescription`, `#imageId`, `#imagePrompt`, `#class`, `#race`, `#gender`, `#isNPC`. `imagePrompt` defaults to an empty string and is only populated when an image prompt is actually generated or manually edited.
- Core stats: `#attributes`, `#level`, `#experience`, `#health` (finite float), `#healthAttribute`, `#healthRegenAppliedAt`.
- Inventory/gear: `#inventory`, `#gearSlots`, `#gearSlotsByType`, `#gearSlotNameIndex`.
- Barter: `#barterInventory`, `#willingToTrade`, `#tradeRefusalExpiresAt`, `#barterStockUpdatedAt`, `#barterProfile`.
- Skills/abilities: `#skills`, `#abilities`, `#declinedAbilities`, `#unspentSkillPoints`, `#unspentAttributePoints`.
- Pending level-up ability draft state: `#pendingAbilityOptionsByLevel` and `#pendingAbilityAttachmentDraftsByLevel` (per-level generated options and detached attachment previews for player-only ability selection).
- Status/needs: `#statusEffects`, `#needBars`, `#needBarApplicability`, `#needBarRatesAppliedAt`, `#derivedNeedRatesAppliedAt`, and cached derived need-level status projections.
- Social: `#dispositions`, `#relationships` (`target character id -> label of at most six words`), `#personalityType`, `#personalityTraits`, `#personalityNotes`, `#aiNotes`, NPC behavioral `#disposition`, `#resistances`, `#vulnerabilities`, NPC-only `#hiddenFromPlayer`, and optional `#hostileArrivalProvenance`.
- Player prompt control: `#playerGuidance`, an arbitrary persisted string injected into shared base context for the current player. Missing legacy-save values normalize to an empty string.
- Factions: `#factionId`, `#factionStandings` (map of `factionId -> number`), `#favorUsage` (map of `favorId -> { lastUsedWorldMinute }`, the per-favor cooldown record for [faction favors](FactionFavorService.md); persisted as `favorUsage`, missing in older saves loads as `{}`).
- UI state: `#thingListViewPreferences` (per-panel shared thing-list view modes for location/inventory/crafting/barter panels).
- Mod state: `#modState` (namespaced JSON object persisted for hook-based mods) and `#extensionFields` (top-level first-class Player fields registered by enabled mods).
- Party/quests: `#partyMembers`, `#quests`, `#goals`, `#characterArc`.
- Movement/turns: `#currentLocation`, `#previousLocationId`, `#lastSeenTime` (`last_seen_time` absolute world minutes), `#lastSeenLocation` (`last_seen_location` id), `#wasInPlayerLocationPreviousRound`, `#elapsedTime` (minutes), `#lastVisitedTime` (minutes), `#inCombat`, `#lastActionWasTravel`, `#consecutiveTravelActions`.
- Lifecycle: `#isDead`, `#persistWhenDead`, `#corpseCountdown`.
- Static indexes: `#indexById`, `#indexByName`.

## Construction
- `new Player(options)` loads definitions, validates input, initializes attributes, inventory, gear, skills, dispositions, need bars, per-actor need-bar applicability, installs accessors for currently registered Player extension fields, assigns a shared first-three-name-word `char_...` ID when missing, and registers in indexes.
- `Player.prepareNeedBarState({ needBars, needBarApplicability, isNPC })` returns detached `needBars` and `needBarApplicability` Maps using the same normalization/defaults as construction. It creates no actor, allocates no IDs and changes no registry. The constructor's need-bar initializer uses this shared builder.

## Static API

- `registerAbilityIdentities(options)`: reserves supplied owned, declined, pending, status, and pending attachment candidate IDs without creating or changing actor records. Save hydration calls it for every serialized actor before allocating any missing ability IDs, preserving later actors' explicit identities.
- Lookup and registry:
  - `getAll()`, `getById(id)`, `get(id)`, `getByName(name)`, `getByNames(names)`, `unregister(target)`.
  - `clearRuntimeRegistries()` clears in-memory player registries (`#instances`, `#indexById`, `#indexByName`) before hydration/new-game rebuilds.
  - `removeNpcFromAllLocations(npcId)` removes an NPC id from every location's `npcIds` list.
  - `resolvePlayerId(playerLike)`.
- Current player helpers:
  - `setCurrentPlayerResolver(resolver)`, `getCurrentPlayer()`, `getCurrentPlayerId()`.
- Definitions:
  - `getDispositionDefinitions()`, `getDispositionDefinition(name)`, `resolveDispositionIntensity(type, value)`; disposition definitions include the configured display `icon` and the merged-config `dispositions.first_impression_multiplier`.
  - `getNeedBarDefinitionsForContext()` (prompt/UI-safe need-bar definitions including icon/color metadata, `while_you_were_away_prompt_notes`, plus `small`/`medium`/`large`/`fill` and `small`/`medium`/`large`/`empty` trigger lists).
  - `validateNeedBarPromptSentences({ onError })` preflights `effect_thresholds.*.sentence` coverage for prompt-facing need summaries.
  - `reloadDefinitionCaches({ refreshInstances, beforeInstall })` validates detached merged need-bar definitions, settles old elapsed rates, and atomically installs caches/actor state. Optional synchronous `beforeInstall` runs after settlement and before installation, allowing config changes to share this boundary. Rejected definitions or combined maxima restore caches and all actor state.
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
- Identity and descriptors: `id`, `name`, `aliases`, `description`, `shortDescription`, `imageId`, `imagePrompt`, `class`, `race`, `gender`, `personalityType`, `personalityTraits`, `personalityNotes`, `aiNotes`, `disposition`, `playerGuidance`, `resistances`, `vulnerabilities`. `disposition` is literal `N/A` for sentient NPCs or a free-text instinctive behavior rule for animal-level or less intelligent NPCs. `normalizeNpcDisposition(value)` trims strings, preserves canonical `N/A`, converts only blanks to `null`, and rejects other value types. `getPlayerGuidance()` and `setPlayerGuidance(value)` provide explicit access; the setter requires a string, normalizes CRLF/CR line endings, trims outer whitespace, and updates `lastUpdated`. Direct character-field chat tools may also accept the serialized `personality` object, but only its `type`, `traits`, `notes`, and `aiNotes` keys map back to these persisted fields.
- Factions: `factionId`.
- State: `level`, `experience`, `health`, `maxHealth`, `healthAttribute`, `isDead`, `persistWhenDead`, `isDisabled` (dead, zero-health, or carrying an exact `Incapacitated` status effect), `inCombat`, legacy/persisted `isHostile`, `hiddenFromPlayer` / `isHiddenFromPlayer`, `corpseCountdown`, `elapsedTime`, `createdAt`, `lastUpdated`. Player-facing hostility is derived from current disposition thresholds through `DispositionHostility` rather than trusting the raw flag.
- Locations: `currentLocation`, `location`, `currentVehicle`, `previousLocationId`, `previousLocation`, `currentLocationObject`, `lastVisitedTime`, `last_seen_time`, `last_seen_location`, `was_in_player_location_previous_round` (plus camelCase aliases). `currentVehicle.allowedDestinations` resolves every fixed-route `VehicleInfo.destinations` entry into canonical location/region identity for structured prompt parsing; missing route locations fail explicitly instead of exposing unresolved IDs as acceptable destinations.
- Social/party: `partyMembers`, `relationships`, `isInPlayerParty` (derived from the current player's `partyMembers` list), `wasEverInPlayerParty`, `partyMembershipChangedThisTurn`, `partyMembersAddedThisTurn`, `partyMembersRemovedThisTurn`.
- Quests/goals: `goals`, `characterArc`, `currentQuests`, `completedQuests`.
- Need bars/memory: `turnsSincePartyMemoryGeneration`, `importantMemories`. Dead NPC/corpse actors can retain persisted memory state, but NPC memory prompt scheduling skips them while `isDead` is true.

## Instance API (Highlights)
- Quests/goals:
  - `addGoal(goal)`, `removeGoal(goal)`.
  - `addQuest(quest)`, `removeQuest(questId)`, `getQuestById(questId)`.
  - `getCurrentQuests()`, `getCompletedQuests()`.
- Aliases:
  - `getAliases()`, `setAliases(list)`, `addAlias(alias)`, `removeAlias(alias)`.
- Party management:
  - `addPartyMember(memberId)`, `removePartyMember(memberId)`, `clearPartyMembers()`, `getPartyMembers()`.
  - `addPartyMember(...)` enforces party/location invariants by removing the member from all location NPC lists and clearing their explicit location.
  - Party memory helpers: `addPartyMemoryHistorySegment(...)`, `getPartyMemoryHistorySegments(...)`, `clearPartyMemoryHistory()`. New segments exclude shared prompt diagnostics before projection. Saved buffers retain type/metadata/ephemeral/structured exclusion provenance on hydration; prompt reads filter rows and empty segments before applying segment limits, leaving the raw saved buffer intact. Normal buffer limits count eligible story segments, so diagnostic-only segments cannot evict story context. See [base_context_history](base_context_history.md).
  - Completed ordinary/creative gameplay turns and event-driven travel advance the party-memory counter once in the background. Questions, generic prompts, comments, rejections, failed turns and early recovery/benchmark responses do not. Direct travel leaves counter ownership to the movement endpoint's existing scene-change memory pass, including its consecutive-travel policy. At `party_generate_memory_interval`, eligible NPC history drives the shared memory/goals/numeric-disposition prompt; unchanged dispositions remain unchanged. Counters and history buffers persist in saves.
  - `markPartyMembershipChangedThisTurn()`, `clearPartyMembershipChangeTracking()`.
- Dispositions:
  - `getDisposition(targetId, type)`, `setDisposition(...)`, `increaseDisposition(...)`, `decreaseDisposition(...)`.
  - `getDispositionTowards(player, type)`, `setDispositionTowards(...)`.
  - `getDispositionIntensityTowards(...)`, `getDispositionTowardsCurrentPlayer(...)`, `setDispositionTowardsCurrentPlayer(...)`.
- Relationships:
  - `getRelationships()`, `getRelationship(targetId)`, `setRelationships(mapOrObject)`, `setRelationship(targetId, label)`, `removeRelationship(targetId)`.
  - Relationship keys are stable character ids resolved through `Player.resolvePlayerId(...)`; labels must be non-empty strings of six words or fewer.
- Factions:
  - `getFactionStandings()`, `setFactionStandings(mapOrObject)`.
  - `getFactionStanding(factionId)`, `setFactionStanding(factionId, value)`, `removeFactionStanding(factionId)`.
  - `getFavorUsageMap()`, `getFavorUsage(favorId)`, `recordFavorUse(favorId, worldMinute)` (non-negative whole minute), `removeFavorUsage(favorId)`.
  - New-game setup generates one bounded integer standing for every active faction from the player's class, race, and description plus public faction identity. It validates the complete response before one atomic map write and preserves any standing already present.
- UI state:
  - `getThingListViewPreferences()`, `setThingListViewPreferences(mapOrObject)`.
  - `setThingListViewPreference(panelKey, viewMode)`.
- Mod state:
  - `modState` returns a cloned full namespaced state object.
  - `getModState(namespace)`, `setModState(namespace, value)`, and `updateModState(namespace, updater)` are for mod-owned actor state. Missing old-save state reads as `{}`.
  - `getExtensionField(fieldName)`, `setExtensionField(fieldName, value)`, and `getExtensionFields({ includeDefaults })` are for registered first-class Player fields. Registered fields also install direct accessors such as `player.sexualTraits`.
  - `withHealthRatioPreserved(mutator)` delegates to `withNeedBarMutation`; attachment-style source changes settle old time and preserve Health/need fill percentages once.
- Attributes/skills/abilities:
  - `getAttributeNames()`, `getAttributeDefinition(name)`, `getAttributeModifier(name)`, `getAttributeModifiers()`.
  - `setAttribute(name, value)` preserves the exact current Health percentage when the derived maximum changes.
  - `getSkills()`, `getSkillValue(name)`, `setSkillValue(name, value)`.
  - `getSkillModifiers(name, { includeEquipped })`.
  - `increaseSkill(name, amount)`, `syncSkillsWithAvailable()`.
  - `getAbilities()`, `setAbilities(list)`, `addAbility(ability)`.
  - `getDeclinedAbilities()`, `getDeclinedAbilityNames()`, `setDeclinedAbilities(list)`, `addDeclinedAbility(ability)`, `addDeclinedAbilities(list)`, `clearDeclinedAbilities()`.
  - Pending player draft options:
    - `getPendingAbilityOptionsByLevel()`, `getPendingAbilityOptionsForLevel(level)`.
    - `setPendingAbilityOptionsForLevel(level, abilities)`.
    - `getPendingAbilityAttachmentDraftsByLevel()`, `getPendingAbilityAttachmentDraftsForLevel(level)`, `setPendingAbilityAttachmentDraftsForLevel(level, entries)`; entries contain `{ abilityId, draft: { statusEffects } }`.
    - `clearPendingAbilityOptionsForLevel(level)`, `clearPendingAbilityOptions()`.
- Progression:
  - `levelUp(count)` (updates level/health only; point pools are formula-derived dynamically).
  - `getUnspentSkillPoints()`, `setUnspentSkillPoints(value)`, `adjustUnspentSkillPoints(delta)`.
  - `getUnspentAttributePoints()`, `setUnspentAttributePoints(value)`, `adjustUnspentAttributePoints(delta)`.
  - `addExperience(amount, raw)` (normal gameplay XP is divided by `(currentLevel / 2)` for levels above `1`; for non-NPC actors with party members, shared XP is derived from the original pre-division award and then scaled per recipient by `sourceLevel / recipientLevel`; `raw=true` bypasses both the level-based divisor and the party-recipient scaling), `addRawExperience(amount)`, `setExperience(value)`.
  - `previewExperienceAward(amount, raw=false)` validates a finite amount and returns the same native scaled player award without changing XP, level, or party state. `addExperience` uses this helper; quest completion uses it before applying its already difficulty-scaled input so reward summaries remain accurate even across XP rollover.
- Health/combat:
  - `modifyHealth(amount, reason)`, `setHealth(health)`, `setHealthAttribute(attributeName)`.
  - `isAlive()`, `updateCorpseCountdown()`.
- Status effects:
  - `getStatusEffects()`, `getIntrinsicStatusEffects()`.
  - `setStatusEffects(effects)`, `addStatusEffect(effect, defaultDuration)`, `removeStatusEffect(nameOrDescription)`.
  - `tickStatusEffects(elapsedMinutes)`, `clearExpiredStatusEffects()`.
- Need bars:
  - `getNeedBars(options)`, `getNeedBarValue(identifier)`.
  - `getNeedBarApplicability()`, `setNeedBarApplicability(map)`.
  - `setNeedBars(list)`, `setNeedBarValue(identifier, value)` accept raw units. Existing bounds are retained for bulk value edits.
  - `setNeedBarPercentages([{ id, percentage }])` applies absolute resulting percentages together, so a Rest-driven Stamina maximum change preserves both requested percentages. Blank/missing percentages fail; explicit zero is valid.
  - `settleNeedBarTime({ worldMinutes })` applies the coherent elapsed-time rules below.
  - `withNeedBarMutation(mutator, { settle = true, preserveHealth = true })` wraps synchronous logical mutations, rolls back rejected changes and reconciles capacities once. Native mutation methods use this boundary; nested calls share it.
  - `applyNeedBarChange(identifier, options)`.
  - `getNeedBarsForContext(options)`, `getNeedBarPromptContext(options)`.
  - `getNeedSentencePromptContext({ actorName, onMissingSentence })` resolves active need-bar threshold sentences with `%CHARACTER%` substitution for base-context prompt rendering.
- Inventory/gear:
  - Inventory: `addInventoryItem(...)`, `removeInventoryItem(...)`, `hasInventoryItem(...)`, `getInventoryItems()`, `clearInventory()`, `setInventory(items)`.
  - `addInventoryItem(...)` automatically merges incoming non-container, unequipped item stacks into existing same-name/same-checksum stacks in the actor inventory unless called with `mergeStacks: false`.
  - Barter inventory: `addBarterInventoryItem(...)`, `removeBarterInventoryItem(...)`, `hasBarterInventoryItem(...)`, `getBarterInventoryItems()`, `clearBarterInventory()`, `setBarterInventory(items)`, `barterInventorySize`.
  - Gear: `getGear()`, `getGearSlotsByType()`, `getEquippedSlotForThing(...)`, `hasEquippedThing(...)`, `getEquippedItemIdForType(slotType)`.
  - Equip flows: `equipItem(...)`, `equipItemInSlot(...)`, `unequipItemId(...)`, `unequipSlot(...)`.
  - `dropAllInventoryItems()`.
- Currency:
  - `getCurrency()`, `setCurrency(value)`, `adjustCurrency(delta)`.
  - The item `Convert to Currency` cheat uses `setCurrency(...)` only after its server-authoritative item preview has been reconfirmed and the complete stack has been deleted. The payout is the stack count multiplied by its integer per-unit standard value and always goes to the active player regardless of the item's prior holder.
- Trade state:
  - `willingToTrade`, `setWillingToTrade(value, { refusalExpiresAt })`, `refreshTradeWillingness(currentWorldMinutes)`.
  - `tradeRefusalExpiresAt`, `barterStockUpdatedAt`, `barterProfile`.
- Movement:
  - `setLocationByName(name)`, `setLocation(location)`, `moveToLocation(direction, locationMap)`.
  - `setLocation(...)` records the pre-arrival `visited` / `lastVisitedTime` state for non-NPC destination moves before marking the destination visited, preserving the data used by the while-you-were-away arrival gate.
  - While-you-were-away arrival prompts prefer `last_seen_time` / `last_seen_location` for per-NPC reunion candidates, but can synthesize visible current-location candidates from the destination's pre-arrival visit state when those per-NPC fields are missing.
  - `getCurrentLocationName()`, `getCurrentLocationInfo(locationMap)`, `getAvailableExits(locationMap)`.
  - `updatePreviousLocation()`.
  - `recordLastSeenByPlayer({ time, locationId, wasInPlayerLocationPreviousRound })`.
- Serialization:
  - `getStatus()`, `toJSON()`, `static fromJSON(data)`. Behavioral `disposition` is included in status and saves; missing/blank legacy values hydrate as `null`, while `N/A` round-trips literally. Mechanically replenished NPCs also round-trip strict `hostileArrivalProvenance` containing `arrivalId`, `pendingAttemptId`, and `wild` or `faction` source. `toJSON()` writes registered Player extension fields at top level, and `fromJSON()` restores only fields registered in `Globals.modExtensionRegistry` at hydration time. Registered `validateValue` callbacks run after core type normalization and before constructor, hydration, or setter persistence.
  - `imagePrompt` is included in status/API/save payloads; old saves hydrate it as blank.
  - `playerGuidance` is included in status/API/save payloads; old saves without the field hydrate it as blank, while present non-string values fail explicitly.
- Misc:
  - `generateAttributes(method, diceModule)`, `getGenerationMethods()`.
  - `finalizeTurn()`.
  - `toString()`.

## Private Helpers (Selected)
- Initialization: `#loadDefinitions`, `#initializeAttributes`, `#initializeInventory`, `#initializeGear`, `#initializeSkills`, `#initializeDispositions`, `#initializeNeedBars`.
- Gear helpers: `#resolveItemIdFromGearValue`, `#normalizeSlotType`, `#resolveSlotName`, `#syncGearWithInventory`, `#preserveHealthRatioAfterGearChange`.
- Mod sync helpers: `#syncModStateWithInventory` calls registered inventory-sync contributors after inventory removal/replacement.
- Need bar helpers: `#normalizeNeedBarChangeList`, `#normalizeNeedMagnitudeKey`, `#normalizeNeedValueMap`, `#buildNeedBarDefinition`, `#cloneNeedBarDefinition`, `#loadNeedBarDefinitionState`, `#formatNeedBarForContext`, `#resolveNeedBarByIdentifier`, `#resolveNeedBarMagnitudeDelta`, `#resolveNeedBarThreshold`, `#applyNeedBarValue`.
- Attributes/health: `#normalizeHealthValue`, `#getHealthRegenPercentPerMinute`, `#defaultHealthAttribute`, `#resolveHealthAttribute`, `#calculateBaseHealth`, `#validateAttributeValue`, `#calculateAttributeModifier`.
- Status/abilities: `#normalizeStatusEffects`, `#normalizeAbilities`, `#getIntrinsicStatusEffects`.
- Pending draft options: `#normalizePendingAbilityOptionsByLevel`.
- Dispositions: `#normalizeDispositionType`, `#sanitizePersonalityValue`, `#applyHostileDispositionsToCurrentPlayer`.
- Inventory helpers: `#resolveThing`, `#addInventoryThing`, `#removeInventoryThing`, `#addBarterInventoryThing`, `#removeBarterInventoryThing`, `#notifyNpcInventoryChange`.
- XP: `#skillPointsPerLevel`, `#processExperienceOverflow`.
- Point-pool formulas: `#buildPointPoolVariables`, `#evaluatePointPoolState`.

## NPC generation prompt fields

`prompts/_includes/npc-generation-fields.njk` owns the shared NPC child-field scaffold, including registered Player fields and starting-technique selection. The three callers set one `npcGenerationVariant` before including it:

| Variant | Caller | Distinct behavior |
| --- | --- | --- |
| `region` | `region-generator-important-npcs.njk` | Relative level +2 to +5 and an explicit region location field. |
| `location` | `location-generator-npcs.xml.njk` | Relative level -3 to +3, with lower levels encouraged for quantity groups. |
| `single` | `_includes/npc-generator-single.njk` | Existing core/extension seed values; otherwise the same fields and guidance as batch generation, with the -3 to +3 relative-level range and quantity compensation. |

All variants include a role field and share unseeded name guidance, three-sentence descriptions covering appearance/personality/role/typical behavior/distinguishing details without current whereabouts/actions, the complete trait examples, up to two paragraphs of personality notes including secrets, and one or two sentences of action-trigger AI notes. Name and description guidance retains singular quantity-group names, existing/deceased-name exclusion, and `%NAME%` substitution.

The world's optional `npcNamingGuidance` appears inside the unseeded name description only when nonblank after trimming. It applies across all three variants and never overrides an explicit single-NPC name. The shared `xmlComment` filter encodes markup and hyphens so even `--`, `-->`, and trailing hyphens remain inside the XML comment; unseeded `<name>` retains no actual text value. Settings retain the original guidance apart from CRLF normalization.

The callers retain response/NPC wrappers, memories, batch/name/deduplication instructions, contemplation, generation-only field references, and character-generation guidance. Single-NPC additional instructions and exact seeded-name guidance also remain in its caller. Change shared fields in the include rather than copying them into callers; variant branches are limited to seed handling, relative-level guidance, and the region location field.

Single-NPC truthy seed checks remain distinct from explicit boolean/health checks: `isHostile` and `hiddenFromPlayer` preserve explicit false values and their existing accepted true spellings; `startingHealthPercentage` preserves zero. Relative level and currency still use truthiness, so zero leaves their generation placeholders. All variants retain the historical explicit starting-health seed check. Registered extension fields receive `npc` only for `single` and an empty seed for both batch variants; their renderer remains `_includes/player-generator-fields.njk`.

The include iterates configured attributes and need bars and emits mod fields and starting-technique selection once per NPC. Optional disposition guidance still permits omission, blank, or `N/A` when no behavioral rule applies; optional collection conventions and parser/validator behavior are unchanged.

## Notes
- The class supports NPCs and players; many behaviors are shared with `isNPC` gating certain flows.
- Player ability drafts persist thumbs-downed options as `declinedAbilities` records on the player. Future player ability-option prompts receive those names through the existing declined-abilities prompt context so the same options are not offered repeatedly.
- Player ability submission is atomic across automatic generation of the next missing level: current abilities, health, declined cards, pending options, and detached attachment drafts are snapshotted before mutation and restored if next-level generation fails. The selected option's saved draft is applied without reauthoring. Card-shortage regeneration uses the shared configured prompt-attempt budget rather than a separate hard-coded three-attempt limit.
- Player ability-option retries keep valid partial cards locally, check response XML, the exact case-insensitive player name, target levels and uniqueness before adding more, and send the exact failure with the next remaining-card request. Exhaustion reports the last validation error and retains it as the cause. The player-option prompt returns XML only, with one character and the requested number of options; comparison guidance stays internal. Its dedicated `player-ability-options.schema.xml` requires that single-character structure and each ability field, avoiding prose brainstorming containing XML examples that the live guard could mistake for the response document. The validator enforces actor identity, exclusions and level, collecting valid cards up to the remaining requested count; surplus cards retain their existing ignored behavior. NPC level-up retries similarly validate new abilities and progression target names before accepting a response. A genuinely unclosed `<npcs>` response also asks for closed XML followed by `DONE` through the shared retry helper; semantic failures do not. Their existing required/optional attempt limits remain unchanged; valid optional empty results remain accepted. Actual randomized progression and ability mutation occur once after acceptance, never while a rejected response is being corrected.
- Level-up ability generation displays the full target name in progress, for example `levelup_abilities_Fizz[counter]`, via the `LLMClient.chatCompletion` option `progressDisplayLabel`. The shared request helper adds this suffix only for `levelup_abilities`; player ability-option calls keep their existing display. Model overrides, logs, retry ownership and output statistics still use the original family metadata label.
- Generated NPC batches preflight every draft's faction, registered Player fields and supplied starting needs before returning from the generation correction loop. Single-NPC seed defaults remain available during this check. Missing/null/empty needs retain normal defaults; explicitly malformed entries, unknown bar IDs, nonfinite percentages and nonfinite converted values receive actor-specific correction errors. No draft in a rejected batch constructs or registers a Player.
- Gear and inventory are tightly coupled; equip/unequip flows update health and modifiers.
- Registered mod attribute/status contributors are included in `getModifiedAttribute()` and `getStatusEffects()`. Inventory-backed attachment/module mods should remove stale installed item ids through `registerInventorySyncContributor`; the modules mod contributes installed module bonuses/status effects only when the base item is equipped.
- NPC/player inventory generation uses the shared base-context prompt wrapper with `promptType: "inventory-generator"` and the task-specific include at `prompts/_includes/inventory-generator.njk`; generated item XML is parsed by the existing inventory item parser and stored as `Thing` records.
- Inventory XML, barter-stock entry count, whole-Thing/mod invariants and final scaled candidate preparation run inside one effective-label configured correction loop. Rejected responses receive the exact item/field error before any items are created. Every response and correction conversation is logged; recoverable attempts stay quiet and terminal exhaustion reports through `PromptFailureReporter`. Existing optional `throwOnError: false` callers still receive an empty result after terminal failure; no existing inventory is regenerated automatically.
- Current health is stored and serialized as a finite float. Health setters/modifiers accept finite non-negative numbers, while client-facing health readouts round displayed current/max health upward with `Math.ceil`.
- `healthRegenPercentPerMinute` config applies passive health regeneration as a percentage of current max health for each elapsed world minute; per-actor `healthRegenAppliedAt` is persisted so reloads do not replay already-processed regeneration.
- Need bar logic includes per-minute baseline drift (`change_per_minute`) and magnitude-based adjustments.
- Global `defs/need_bars.yaml -> need_values` defines separate `increase` and `decrease` default maps, each with its own `small` / `medium` / `large` deltas. Individual bars can override either direction through their own nested `need_values` block, and any missing per-bar directional keys fall back to the matching global direction. These magnitudes preserve decimal values exactly.
- Need-bar definitions can include `while_you_were_away_prompt_notes`; `getNeedBarDefinitionsForContext()` exposes it under the same snake_case key so the while-you-were-away prompt can use bar-specific reunion guidance.
- `applyNeedBarChange(...)` returns `needBarIcon` / `needBarColor` metadata alongside the delta/threshold payload so event summaries and notifications can use the configured need-bar icon directly. Definitions may set the optional boolean `hide_increase_to_max`; a full increase still sets the bar to its maximum, but its returned change carries `hideFromHistory: true` so history/chat presentation can suppress that noise. Other changes carry `false`.
- Need bars use explicit audience flags (`player`, `party`, `nonParty`). NPCs retain both party-only and non-party-only bar state internally so values survive party swaps. Active reads, prompt context, endpoint payloads, and per-minute drift treat `party` as “currently in the party or has ever been in the party,” while `nonParty` means “not currently in the party,” so former party members can have both party-history bars and non-party bars active at once.
- Per-actor need-bar minute drift persists a `needBarRatesAppliedAt` timestamp in saves so reloads do not replay already-processed elapsed world minutes.
- Need-bar serialization preserves `value` and `initialValue` as distinct fields. Hydration restores the current raw `value` without replacing the actor's original starting baseline in `initialValue`; legacy/scalar inputs without a stored baseline still initialize it from their supplied starting value.
- Need-bar applicability is persisted separately per actor in `needBarApplicability`. This is distinct from current audience activation: a bar can be defined for NPC audiences globally but be explicitly disabled for a specific NPC. Save/load persists the full resolved applicability map, and old saves missing need-bar state hydrate storable bars as `value: 100` and `applicable: true`.
- Disposition types/ranges/icons load from `defs/dispositions.yaml`, while the first-impression delta multiplier comes from merged config at `dispositions.first_impression_multiplier`; invalid multiplier values throw before disposition definitions are returned.
- NPC barter inventory is persisted separately from normal inventory. Barter-stock items carry `metadata.barterOwnerId` while in that stock, are serialized by id in saves, and are exposed in `getStatus()` / NPC client payloads as expanded Thing JSON. Generated barter stock is created through the shared `inventory-generator` prompt in batches, then attached to this separate barter inventory. Moving an item into ordinary inventory clears barter-owner metadata.
- NPC trade willingness is persisted as `willingToTrade` plus optional `tradeRefusalExpiresAt` world minutes. `refreshTradeWillingness(...)` flips temporary refusals back to willing once the configured expiry time is reached.
- Shared thing-list UI view modes persist per actor in `thingListViewPreferences`, keyed by the fixed panel ids `npcInventory`, `npcBarterInventory`, `craftingInventory`, `locationScenery`, `locationItems`, `containerPlayerInventory`, `containerContents`, `barterPlayerInventory`, and `barterMerchantInventory`, so page reloads and save/load restore the same panel view selections. Fetching the current player inventory also instantiates any pending `Thing.containerContents` seeds on containers in that inventory before serializing the player payload.
- `setNeedBarApplicability(...)` preserves stored values for bars that stay enabled, drops bars explicitly disabled for that actor, and restores newly re-enabled bars at `100`.
- Status-effect-driven max-health increases raise current health by the same max-health delta. Status-effect-driven decreases do not subtract health back out; they only clamp current health if it exceeds the reduced max.
- `removeStatusEffect(...)` removes intrinsic effects by exact case-insensitive `name` or exact case-insensitive `description`, preserving legacy description removal while allowing XML event checks to clear effects by listed status-effect name.
- `isDisabled` treats the explicit `Incapacitated` status effect as disabling even when the actor has positive health.
- `inCombat` is persisted by `toJSON()`/`fromJSON()`. `Globals.setInCombat(...)` synchronizes the active player's field, and activating a loaded player restores the global combat flag from that persisted field so save/reload does not silently switch NPC-turn scheduling back to non-combat settings.
- `persistWhenDead` is persisted per actor. When true, dead actors never receive a corpse countdown and are skipped by corpse cleanup; missing save data defaults it to `false`.
- `isInPlayerParty` is not persisted as actor state. It is a derived getter that checks whether the active current player's `getPartyMembers()` list contains the actor id; direct property assignments and `setInPlayerParty(...)` calls throw so party membership changes go through `addPartyMember(...)` / `removePartyMember(...)`.
- `wasEverInPlayerParty` is persisted per actor. It flips to `true` when the actor joins the player party, and load reconciliation also marks actors listed in the current player's persisted `partyMembers` list as historical party members so older saves do not lose that history. Missing save data defaults it to `false`; legacy saved `isInPlayerParty` fields are ignored as active-membership authority.
- Joining the player party, leaving the player party, or dying while currently in the player party permanently flips `persistWhenDead` to `true` for that actor.
- `elapsedTime` is minute-canonical; setter validation requires non-negative integer minutes, and load paths normalize to integer minutes.
- `currentVehicle` returns `null` unless the actor is in a vehicle location or vehicle region; when present it includes `vehicleKind` (`location` or `region`), vehicle name/description, `location` (`<regionName>:<locationName>`), the full `vehicleInfo` object, explicit trip-state booleans (`isUnderway`, `hasArrived`, `isArriving`) mirrored onto `vehicleInfo` for prompt compatibility, `destination`, `destinationResolved`, optional `pendingDestination`, numeric `minutesToDestination`, plus a formatted `timeToDestination` string (`X days, Y hours, Z minutes`, omitting all zero-value units except exact `0 minutes`, and appending `ago` when negative). During timed travel, `destination` can come from `pendingDestination` even when `vehicleInfo.currentDestination` is `null`, so prompts can see the intended target without forcing early destination generation. Trip-state booleans are sourced from `VehicleInfo` and distinguish pre-departure, underway, arrival, and arrived states. TinyBrain uses `vehicleKind` to distinguish movement among locations inside a region-sized vehicle from movement among narrated areas of one location vehicle.
- Unspent skill/attribute points are formula-derived at read time from current level + assigned stats/skills.
- Party members are treated as off-location actors: joining party removes them from all location `npcIds` and clears `currentLocation`; direct and prompt-driven player movement preserve that null location while membership continues; leaving party places the actor at the current player's location.
- For `party_change` events, a newly joined hostile NPC additionally receives the existing hostile-to-friendly transition through `Events.makeCharacterNotHostile`. It neutralizes configured negative dispositions and clears the raw hostile flag after membership succeeds. This event-specific integration does not change the general `addPartyMember` contract, duplicate joins, already friendly members or departures.
- TinyBrain player movement asks which living party members and origin-location NPCs accompany the player. Exact canonical names and aliases are accepted and normalized to canonical names. Selected party members keep their membership and off-location representation; selected non-party NPCs are physically relocated to the destination. The selection itself never recruits or dismisses a character.
- Generic/scheduled chat prompts can call `updatePartyMembers({ add?, remove? })` to apply validated multi-NPC party membership changes. The tool delegates to `addPartyMember(...)` and `removePartyMember(...)`, so remote additions become off-location party actors and removals remain at the current player location.
- Gameplay XP awards above level `1` are reduced by dividing the incoming award by `(level / 2)`.
- Party XP sharing scales by each recipient's level and derives party shares from the original pre-division gameplay award, so the source actor's own level reduction does not cascade onto other recipients.
- `getById(id)` is index-backed (`#indexById`) so party XP and other lookups resolve the canonical current instance, not stale insertion-order instances.
- `unregister(target)` rebuilds indexes after removals to prevent stale id/name registry entries and cancels any active technique summon lease for an intentionally removed actor.
- `relationships` is persisted as a sparse object map of `otherCharacterId -> short label`, separate from numeric dispositions and faction standings. The model rejects invalid maps, empty target ids, self-targeting entries, non-string labels, and labels longer than six words so bad relationship graph data fails during development instead of being silently hidden. Chat prompts can set individual non-player character edges through `setRelationship({ characterA, characterB, relationship, reciprocalRelationship? })`, or multiple edges through `setRelationship({ items: [...] })`; the tool rejects item calls where either character is the current player, and omitting the reciprocal label leaves the reverse edge unchanged. Batch relationship calls attempt every item in order and return per-item success/error records. Successful relationship calls report previous labels and whether each direct or reciprocal edge was added or updated. Parser-driven housekeeping can remove a directed edge with `<relationship><action>remove</action>...</relationship>` and reports that mutation as deleted. Housekeeping summarizes successful relationship label changes in visible player-only `relationship-updates` chat entries, which are excluded from all LLM prompt-history paths. Base-context prompts render non-empty per-character `<relationships>` and `<reciprocalRelationships>` sections with resolved character names. Reciprocal sections omit relationships from characters already present in the scene, party, or player record because those characters list their own outgoing labels.
- Direct unspent-point mutators (`setUnspent*`/`adjustUnspent*`) throw by design.
- `setLocation(locationId)` warns with a stack trace and leaves `currentLocation` as-is when the provided string id cannot be resolved. For non-NPC moves to a different destination, it also snapshots the destination's pre-move visit state before `markVisited()` updates `lastVisitedTime`.
- NPC last-seen state is persisted as snake_case save fields: `last_seen_time` stores an absolute world-minute timestamp, `last_seen_location` stores the location id, and `was_in_player_location_previous_round` records whether the NPC was with the player continuously from the previous round. Chat, direct movement, crafting/processing, and location-modification actions snapshot same-location NPCs at turn start, then update sightings after successful turn resolution so base-context can mention absent NPCs and expose newly present NPCs without implying continuously present NPCs vanished during the turn.
- NPC hidden visibility is persisted as `hiddenFromPlayer`. Save hydration also restores `last_seen_time`, `last_seen_location`, `was_in_player_location_previous_round`, aliases, and the actor's canonical location independently of visibility. Current-location client payloads intentionally include hidden NPCs with `hiddenFromPlayer:true`; the Adventure UI hides living hidden NPCs by default until its `show hidden` eye toggle is enabled. Last-seen recording skips living hidden NPCs until an event, automatic hide/perception opposed check, or prose tool reveals them. Dead NPCs/corpses are always treated as visible even if their persisted record is hidden. Base-context includes living hidden NPCs in character XML with `<hidden>true</hidden>`; visible characters and corpses omit the field rather than rendering `<hidden>false</hidden>`. The HIDE-8 state-only persistence scenario protects this hydration/client-marker contract after deliberate contradictory visibility, sighting, and membership mutations.
- NPC hover tooltips and portrait-lightbox sidecars in the current-location list, compact Adventure party list, and Party tab reuse the item-tooltip presentation. Available serialized fields supply level, state, class/race, description, health, faction, current party membership, trade availability, aliases, resistances/vulnerabilities, dispositions toward the player, and active status effects; absent optional fields are omitted rather than replaced with invented values.
- Location, region-important, single-NPC, and hostile-presence generation accept an optional singular `<disposition>` field. Missing or blank values mean no behavioral disposition; duplicate fields remain invalid. Sentient NPCs may omit the field or return and persist `N/A`; non-sentient animals and creatures supply a behavior blurb when applicable. Only real non-`N/A` values appear in NPC/party base context and specialized NPC-memory context, with a shared instruction to follow the behavior unless current circumstances justify otherwise. This field is separate from the numeric per-character `dispositions` map.

## Techniques

Actors persist validated `techniques` and `disciplineAccess` arrays through construction, `getStatus()`, `toJSON()`, and `fromJSON()`. `getTechniques`/`setTechniques` and `setDisciplineAccess` clone and validate the complete records; missing old-save fields initialize empty. See [Technique](Technique.md) and [TechniqueService](TechniqueService.md) for acquisition, personal revision history, source selection and resource costs. `validateTechniqueStatusEffect` preflights identity-aware refresh without mutation; `upsertTechniqueStatusEffect` settles collided elapsed ticks, preserves stronger authored mechanics, and reconciles max health. Need definitions may declare `technique_payment_direction: increase|decrease`; missing direction must be supplied explicitly in a technique cost.

### Ability icon identity

Every normalized learned, declined, and pending-choice ability has a persisted `id`, nullable `imageId`, and `imagePrompt` string. Old saves without IDs receive a new ID during hydration and persist it on the next save. Present IDs must be nonempty and cannot contain colons; duplicate IDs within an ability list reject. Status snapshots and ability selection/save copies retain these fields.
New missing ability IDs use `IdGenerator.nextUniqueNamed('ability', name)`: `Salvage Scan` becomes `ability_salvage_scan`, then `ability_salvage_scan_2` if the base ID is already reserved. Only the first three source words are used, with lowercase Unicode letters/numbers and snake_case separators; punctuation-only names reject because they cannot form an ID. Owned, declined, pending-choice, and server-generated option records share the allocator. Existing IDs remain unchanged, including UUID-style and numeric saved identities; selecting or renaming an existing ability retains its ID. Supplied IDs in owned, declined, and pending lists register with `IdGenerator` before missing IDs are allocated. Save hydration reserves these identities across all serialized actors first, so a later actor's saved ID cannot collide with an earlier actor's missing identity. Nested status and technique/discipline candidate IDs in persisted pending attachment drafts also reserve their counters on load. Named high-water counters persist in `metadata.idNameCounters`, so deleted/discarded IDs stay reserved across reload.

`getAbilityById(id)` reads one owned/declined/pending record; `updateAbilityImage(id, { imageId?, imagePrompt? })` validates and updates only presentation metadata. `setAbilities` retains an existing ID/art when the input carries that ID, or when an ID-less input has one unambiguous existing name; ambiguous existing identities require an explicit ID. Callers editing a name should retain the ID. Image API identity is `actorId:abilityId`, never a display name.

### Ability status attachments

Owned abilities may persist `statusEffects` templates. Each has a stable status ID, permanent duration `-1`, ordinary attribute/skill fixed and percentage modifiers, optional `maxHealthPercent`, and optional pinned `techniqueGrants`. Per-minute `needBars` are rejected on ability templates because their acquisition timing needs its own persisted tick state. Declined and pending ability records can retain the same attachment structure without applying it. `setAbilities` preserves omitted attachments for an existing stable ID (or one unambiguous matching name); explicit `statusEffects: []` clears them. The setter reconciles current health when maximum health changes and restores previous abilities/health if validation fails. `previewMaxHealthForAbilities` checks a proposed ability replacement without committing it.

Pending level-up offers keep their generated attachment proposals in `pendingAbilityAttachmentDraftsByLevel`, separate from inactive option `statusEffects`. Drafts are serialized in saves and status payloads, keyed by level and ability ID, and cleared with their option cards. An empty draft status list means preview authoring completed with no supported effect. Existing saves without this field load normally and acquire previews only when option generation is explicitly ensured. `updateAbilityImage` changes pending option artwork without altering its detached mechanics draft.

Owned ability statuses contribute to `getStatusEffects()`, modified attributes, skill modifiers, and maximum health while their ability exists. They are derived from the saved ability records and are not duplicated in the intrinsic `statusEffects` save array. Their pinned status technique grants are available through TechniqueService only while the owning ability/status exists. Direct `setStatusEffects` and `addStatusEffect` validate pinned grant references and reconcile health transactionally.

## Conditional need-level effects and capacity

[NeedBarStatusEffects](NeedBarStatusEffects.md) compiles optional keyed
`effect_thresholds.<floor>.status_effects` maps. Only the current lower-inclusive
band contributes; active bars stack with intrinsic, ability, equipped and mod
sources through `getStatusEffects()`. These projections have `source: "need-bar"`,
stable actor/bar/floor/key-bound IDs, and `needBarSource` metadata. They are not
inserted into intrinsic storage, grant techniques, allocate IDs during reads or
persist duplicate statuses. Known unavailable rate/capacity targets are listed
in `inactiveNeedBarTargets`; their other components remain active.

Public bars carry authored `baseMin`, `baseMax`, `baseCapacity` and effective
`min`/`max`. Percent capacity modifiers sum against the authored range. Every
capacity change preserves `(value - oldMin) / (oldMax - oldMin)` exactly, including
fractional values and nonzero minima. Threshold selection maps this fraction
back to authored base coordinates; the full-only band remains full-only.
`initialValue` stays historical. `relativeToLevel` and `relatedAttribute` retain
their metadata meaning and introduce no extra capacity scaling.

Configured ordinary magnitudes, baseline drift, technique costs and fixed
status deltas retain their authored units. Fractional default magnitudes use
base capacity. `needBars[].percentDelta` uses base capacity for non-Health needs
and effective maximum HP for Health. Explicit full/empty operations target
effective bounds; absolute percentage assignments specify effective resulting
states rather than recovery deltas.

Health source transitions preserve its unrounded percentage once. Explicit
damage/healing flushes pending maximum changes before applying the actual
amount; later source reconciliation does not erase that amount. The existing
explicit full heal on `levelUp` remains a full heal, while direct `setLevel`
preserves percentage. Zero HP remains zero unless healed and does not itself
create a corpse or set `isDead`.

## Elapsed time, transactions and hydration

`settleNeedBarTime` snapshots start-of-minute bands/statuses, nets baseline
Health regeneration and all eligible Health rates before bounding Health once,
applies fixed need drift/rates, then reconciles capacity changes and timed
intrinsic expiration. A duration-one status contributes for its last full
minute before expiring. Constant bands/rates are batched only until a threshold,
bound, source-clock or expiration transition. Long skips follow the same rules
as minute stepping and have no time cap. Missing clocks initialize without
backfill; repeated processing of the same minute applies nothing twice.

`needBarRatesAppliedAt`, `healthRegenAppliedAt`, `derivedNeedRatesAppliedAt` and
intrinsic `appliedAt` clocks persist. Inactive bars contribute neither rates nor
statuses; audience/applicability/source changes settle the old interval first.
`Player.applyStatusEffectNeedBarsToAll()` uses the same actor integrator and
restores all actors if one fails.

`Player.withNeedBarWorldMutation(mutator, { settle = true })` handles rare shared
source/party/reload changes, with synchronous or asynchronous callbacks and
nested ownership. It snapshots affected runtime actors, settles old rates and
reconciles once after success; errors restore actor states. Source owners must
also restore any external source state they mutate if reconciliation fails.

`Player.fromJSON(data, { deferNeedBarFinalization: true })` retains saved Health
and its `maxHealth` reference during hydration. Saved need bounds remain usable
before rescaling, including values above the authored base maximum. Setters on
pending actors do not settle or reconcile incomplete-world state.
`Player.finalizeNeedBarStateAfterWorldRestore()` finalizes all pending actors
atomically after locations, status sources and party membership are restored.
Identifiable pre-feature saves without a Health reference reconstruct their old
maximum through the native formula with new need-derived contributions excluded.
New-format need entries require their saved effective min/max; an absent or invalid
new-format Health reference is rejected. Unusable saved bounds/references fail
with `NEED_BAR_STATE_INVALID` rather than inventing a prior percentage or silently
losing an actor. Failed direct hydration unregisters its rejected actor. Direct `fromJSON`
without the defer option finalizes after its own hydration.
