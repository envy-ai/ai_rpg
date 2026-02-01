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
