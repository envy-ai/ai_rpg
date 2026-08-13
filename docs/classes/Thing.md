# Thing

## Purpose
`Thing` represents items and scenery in the game world. It owns the durable object record used by locations, actor inventories, containers, crafting, event checks, prompt generation, saves, and the browser UI.

The class maintains runtime indexes by id and normalized name. Rarity definitions come from merged `defs/rarities.yaml` data, including enabled mod overlays.

## Key State
- Core identity: `#id`, `#name`, `#description`, `#shortDescription`, `#thingType`, `#imageId`, `#imagePrompt`, `#createdAt`, `#lastUpdated`. `imagePrompt` defaults to blank and does not cause prompt generation during construction.
- Item mechanics: `#rarity`, `#itemTypeDetail`, `#slot`, `#attributeBonuses`, `#unscaledAttributeBonuses`, `#level`, `#relativeLevel`, `#count`.
- Effects: `#statusEffects` for effects on the thing itself and `#causeStatusEffect` for effects applied to a target or equipper.
- Placement helpers: `#metadata`, which mirrors ownership, location, container, slot, bonus, level, count, and boolean-flag data used by callers and save compatibility.
- Containers: `#containedThingIds` for instantiated contents and `#containerContents` for pending generated-content seeds.
- Harvesting: `#previouslyHarvestedItems` and `#lastHarvested`, where `lastHarvested` is absolute world minutes.
- Flags: `#flags`, a `SanitizedStringSet` backing `isVehicle`, `isCraftingStation`, `isProcessingStation`, `isHarvestable`, `isSalvageable`, `isContainer`, and `requiresCheckToOpen`.
- Mod fields: `#extensionFields`, which stores registered first-class Thing fields such as `implantSlot`, `moduleSlots`, `moduleType`, `installedModuleIds`, and `moduleInstalledOnItemId`.
- Static registries: `#indexByID`, `#indexByName`, `#runtimeRegistries`, rarity definitions, and valid type definitions.

## Construction
`new Thing({...})` requires non-empty string `name`, `description`, and `thingType`, with `thingType` limited to `item` or `scenery`. Missing ids are allocated through `IdGenerator.next('thing')` and registered with the id generator.

Construction normalizes metadata mirrors, boolean flags, status effects, cause effects, counts, levels, container data, harvest data, and registered extension fields before inserting the instance into the static id/name indexes. Loaded records call `Thing.fromJSON(...)`, which constructs with status-effect enrichment disabled.

## Static API
- Rarity: `loadRarityDefinitions({ forceReload })`, `getAllRarityDefinitions()`, `generateRandomRarityDefinition()`, `getRarityDefinition(rarity, { fallbackToDefault })`, `getDefaultRarityKey()`, `getDefaultRarityLabel()`, rarity multiplier/color getters, `getMaxAttributeBonus(rarity, level)`, and `normalizeRarityKey(value)`.
- Lookup: `getAll()`, `getById(id)`, `getByName(name)`, `getAllByName(name)`, `getByNameAndLocation(name, location)`, `getByType(type)`, `getAllScenery()`, `getAllItems()`, `thingNameExists(name)`, `allThingNames`, `validTypes`, and `clear()`.
- Placement helpers: `whoseInventoryById(thingId)`, `whoseContainerById(thingId)`, `removeFromWorldById(thingId)`, `dropById(thingId)`, `getAllByLocationId(locationId)`, `putInLocationById(thingId, locationId)`, and `putInInventoryById(thingId, playerId)`.
- Stack helpers: `canMergeStacks(targetThing, incomingThing)`, `findMergeTarget(incomingThing, candidates)`, and `mergeIntoExistingStack(incomingThing, candidates)`.
- Runtime registry hooks: `registerRuntimeRegistry(map)` and `unregisterRuntimeRegistry(map)` keep external runtime maps such as the server `things` map in sync when merge/delete paths remove a `Thing`.
- Flag metadata: `booleanFlagMap` and `booleanFlagKeys`.

## Accessors
- Identity and serialization state: `id`, `name`, `description`, `shortDescription`, `thingType`, `imageId`, `imagePrompt`, `createdAt`, `lastUpdated`, `checksum`, and `count`.
- Equipment helpers: `equippedBy`, `isEquipped`, and `equippedSlot`.
- Boolean flags: `isVehicle`, `isCraftingStation`, `isProcessingStation`, `isHarvestable`, `isSalvageable`, `isContainer`, and `requiresCheckToOpen`.
- Container data: `containedThingIds`, `containerContents`, `getInventoryItems()`, `addInventoryItem()`, `removeInventoryItem()`, `hasInventoryItem()`, `containsThingRecursive()`, `setInventory()`, `clearInventory()`, `clearContainerContents()`, and `whoseContainer()`.
- Rarity and level data: `rarity`, `itemTypeDetail`, `level`, and `relativeLevel`. Generated XML `<type>` values map to `itemTypeDetail`; `metadata.itemType` is also accepted by callers that read generated records.
- Metadata and stats: `metadata`, `slot`, `attributeBonuses`, `unscaledAttributeBonuses`, and `getAttributeBonus(attributeName)`.
- Mod extension fields: `getExtensionField(fieldName)`, `setExtensionField(fieldName, value)`, and `getExtensionFields({ includeDefaults })`. Direct property accessors such as `thing.implantSlot` exist for fields registered before the instance is constructed or hydrated.
- Cause effects: `causeStatusEffect`, `causeStatusEffectOnTarget`, `causeStatusEffectOnEquipper`, and `setCauseStatusEffects({ target, equipper, legacy })`. A Thing can carry **multiple** effects per role: `#causeStatusEffect` is an array (deduplicated by effect name/description). `setCauseStatusEffects` accepts an array (or a single effect) for `target` and/or `equipper`. The singular getters return the first effect of each role (backward compatible); the plural getters `causeStatusEffectsOnTarget` and `causeStatusEffectsOnEquipper` return every effect for that role. Consumers apply them all: `Player.getStatusEffects()` applies every equip effect of each equipped item, and combat/consume paths apply every inflict effect of the weapon/consumed item (in addition to mod-contributed effects such as installed modules). Multiple effects survive save/load through the `causeStatusEffects` field on both the serialized payload and `metadata`; the singular `causeStatusEffectOnTarget`/`causeStatusEffectOnEquipper` fields remain for backward compatibility.
- Harvest helpers: `previouslyHarvestedItems`, `lastHarvested`, `recordSuccessfulHarvest(itemNames, { harvestedAtMinutes })`, and `getLastHarvestedAgoText(...)`.
- Status effects: `getStatusEffects()`, `setStatusEffects(effects)`, `addStatusEffect(effect, defaultDuration)`, `removeStatusEffect(description)`, `tickStatusEffects(elapsedMinutes)`, and `clearExpiredStatusEffects()`.
- Type helpers: `isType(type)`, `isScenery()`, `isItem()`, and `toString()`.

## Serialization And Saves
`toJSON()` writes the top-level Thing state used in `things.json`, including `imagePrompt`, split cause-effect fields (the singular `causeStatusEffectOnTarget`/`causeStatusEffectOnEquipper` plus the full `causeStatusEffects` array for multi-effect items), boolean flags, stack count, levels, harvest history, container state, registered extension fields, metadata mirrors, and status effects. `Utils.serializeGameState(...)` persists the runtime `things` map with `thing.toJSON()`, and `Utils.hydrateGameState(...)` hydrates each payload through `Thing.fromJSON(...)`.

`Thing.fromJSON(...)` accepts top-level fields and metadata mirrors for compatibility. It restores only extension fields currently registered in `Globals.modExtensionRegistry`; mods that own Thing fields must register those fields before save hydration.

`checksum` is a fast FNV-1a hash of canonicalized `toJSON()` data. It excludes identity/timestamps (`id`, `createdAt`, `lastUpdated`), stack quantity (`count`), the presentation-only `imagePrompt`, prompt-roundtrip raw bonuses (`unscaledAttributeBonuses`), and placement/ownership metadata (`location*`, `owner*`, `player*`, `inventoryOwnerId`, `containerId`) so equivalent items hash the same across movement, saves, prompt edits, and stack quantity differences.

`combinerMechanicsChecksum` is the authoritative structural guard used after the AI item combiner proposes a group. It additionally excludes names, descriptions, short descriptions, and image identity, allowing cosmetically different same-purpose stacks to merge while retaining every structured mechanical field. A mismatch rejects the whole requested group before mutation, preventing an item with different type, effects, bonuses, flags, properties, or extension fields from being converted into the kept stack's count.

`copy({...})` creates a fresh `Thing` id/timestamps with the same hashable data and image by default. Stack splitting uses it to preserve item details while overriding count and placement metadata. `containedThingIds` and pending `containerContents` are reset unless explicitly supplied in the copy overrides.

## Placement And Stacks
`removeFromWorld()` detaches a thing from players, equipment, barter inventories, locations, and containing Things. `drop(locationIdOverride)`, `putInLocation(locationId)`, and `putInInventory(playerId)` move the thing through `Location` and `Player` APIs.

`Player.addInventoryItem(...)`, `Location.addThingId(...)`, and container `addInventoryItem(...)` automatically merge incoming item stacks into same-name, same-checksum destination stacks when both stacks are item-type, unequipped, and not containers. Callers pass `mergeStacks: false` for explicit split/separate flows that must keep records distinct. Internal named-item generation also accepts sanitized `creationMetadata`; quest completion combines that metadata with `mergeStacks: false` so each reward has persisted quest/reward-index provenance and an interrupted item-generation pass can recognize already-created rewards. Merging increases the surviving stack's `count`, deletes the incoming `Thing` from static indexes, and cleans registered runtime maps.

`consumeOne({ things })` decrements `count` for stacks larger than one and deletes the thing when the consumed stack reaches zero. Shared consumption paths that operate on stacks should use this API or the event-system quantity consumer instead of deleting directly.

## Containers
Only `isContainer` Things can hold contents. Contents must be item-type Things; equipped items are rejected. A container cannot contain itself, and nested containers are rejected when the move would create a descendant cycle.

Instantiated contents are stored as `containedThingIds`; contained items receive `metadata.containerId` and have owner/player/location placement metadata cleared. `removeFromWorld()` also removes matching ids from all container inventories.

`containerContents` is a pending seed list parsed from generated Thing XML before real contained item Things exist. Entries normalize to `{ name, count }`; missing or empty values produce `[]`, omitted counts default to `1`, count text such as `3 flares` yields `3`, empty sentinel names such as `empty`, `none`, and `n/a` are ignored, and zero-count entries are ignored. A Thing with non-empty pending contents is marked as a container with a console warning.

The container inventory API generates pending contents through the `thing-generator-contents` prompt before serializing the container payload. Concurrent requests for the same container join one in-flight generation promise. The response is parsed as strict XML and its complete item-name/count multiset must exactly match the pending seeds before any `Thing` is created. Malformed XML, substitutions, missing/extra entries, and count changes log the rejected prompt response and rerun the complete generation/parse attempt according to `ai.retryAttempts`; exhaustion propagates the final explicit error while leaving the pending seeds intact. The prompt also states that the model must generate only the listed contents, never the containing Thing. A valid response creates the real item Things, applies the ordinary configured slop-word and duplicate-name canonicalization, inserts them into the container, and clears the seeds; therefore a requested seed name can still become a different canonical final name. `requiresCheckToOpen` makes the browser run the dedicated checked-open route before showing inventory; a successful response with `permanentlyOpened` persists `requiresCheckToOpen: false`. Checked-open event extraction excludes `alter_item` because that route already owns the lock mutation, preventing a second AI alteration from rewriting unrelated container fields.

`delete()` rejects non-empty containers so contents are not orphaned. The event-system `consume_item` full-destruction path resolves the destroyed container's holder or location, moves instantiated contents there, clears the container inventory, then deletes the container.

## Prompts, APIs, And Events
Generated item descriptions remain descriptive prose. Mechanical details such as type, slot, rarity, value, weight, properties, attribute bonuses, target/equipper cause effects, flags, and mod fields are stored structurally and rendered by client tooltips/details. Base-context compact item, scenery, and inventory rows always render stack counts as a separate `quantity N;` field after the item name, keeping the quantity out of the canonical item name and short description.

The shared item XML prompt includes count, item/scenery kind, type, slot, rarity, value, weight, relative level, boolean flags, container data, attribute bonuses, target/equipper cause effects, properties, short description, and registered Thing fields exposed to generator prompts. The XML parser returns the same fields for natural location generation, inventory generation, container-content generation, crafting/process/salvage/harvest output, item alteration, and thing separation.

Thing XML parsing propagates malformed XML, invalid `itemOrScenery` values, requested-kind mismatches, invalid registered-field JSON, and nonempty status-effect durations that `StatusEffect.normalizeDuration(...)` cannot parse instead of converting a failed batch into an empty list. Valid generated status durations are normalized to canonical minutes while parsing. Single-thing generation uses strict XML, requires exactly one parsed Thing, validates an explicitly requested item/scenery kind, and retries the complete generation request before it can instantiate anything. Location item/scenery generation also uses strict XML parsing and retries the complete generation request before propagating the validation error. Container-content generation applies the same configured retry policy around strict parsing and exact pending-seed validation. Parsing and validation finish before any object from those responses is created, so a rejected attempt cannot partially persist a batch.

`POST /api/things`, `PUT /api/things/:id`, crafting instantiation, event-created placeholder items, location/inventory generation, and container-content generation all construct or mutate `Thing` records through the same structural fields. API payloads also accept registered fields exposed to create/edit flows.

The `thing-separate` route accepts item and scenery sources. If separated output contains one or more containers, the first returned container receives the rest of the returned item-type things. Scenery output remains at the source destination because container inventories only hold item Things. Stack separation and explicit split-stack flows opt out of automatic merging.

Event checks use Thing data for item infliction, ingestion, consumption, alteration, transfer, pickup/drop, harvested resources, and item-to-NPC transformation. Target cause effects apply to attack/use targets; equipper cause effects contribute through `Player.getStatusEffects()` while the item is equipped.

## Mod Fields
`ModExtensionRegistry.registerEntityField({ entityType: 'thing', ... })` registers first-class Thing fields. Registered fields validate type, serialize as top-level properties when stored, expose optional default values through `getExtensionFields({ includeDefaults: true })`, and can be exposed to create tools, update tools, generator prompts, XML parsing, and the item editor.

For fields with `clearThingSlotWhenPresent`, generation and API write paths clear the normal equipment `slot` when the registered field has a meaningful value. The implants mod uses this for `implantSlot`, so implant-compatible items remain inventory items rather than normal gear-slot equipment.

The modules mod registers `moduleSlots`, `moduleType`, `installedModuleIds`, and `moduleInstalledOnItemId`. Base equippable items use normal `Thing.slot` plus `moduleSlots`; module items use `moduleType`; installed modules remain real Things in the same holder as their base item, with backlinks and UI filtering handled by the modules mod.

## Validation And Errors
Invalid required constructor fields, invalid `thingType`, invalid count values, invalid extension field values, invalid registered-field JSON, malformed Thing XML, invalid non-array container contents, invalid non-string contained ids, malformed status-effect entries, and unresolved destructive container operations throw explicit errors. Alter-thing XML treats omitted/empty optional target or equipper status-effect elements, plus exact `N/A`, `none`, `null`, and `not applicable` sentinels, as absence rather than inventing a persisted effect; prompts ask for empty optional elements. Registered extension fields may supply `validateValue(value, context)`, which runs after core type normalization and before constructor, hydration, or setter persistence. Several API routes catch these errors and return structured `{ success: false, error }` responses.

Level values are rounded to positive integers in the model. `relativeLevel` is rounded into the model-supported relative range. Stack `count` must be an integer `0` or greater and defaults to `1` when absent.

Status-effect enrichment calls `StatusEffect.generateFromDescriptions(...)` through `Globals` prompt hooks when prompt services are available. Hydration disables enrichment to avoid save/load side effects; prompt-backed alteration enriches target/equipper effects before writing them onto the `Thing`.
