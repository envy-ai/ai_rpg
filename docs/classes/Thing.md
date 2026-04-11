# Thing

## Purpose
Represents items and scenery in the game world. Supports rarity metadata, attribute bonuses, status effects (including AI enrichment), and placement in locations or inventories. Maintains indexes by id and name. Rarity definitions are loaded from root `defs/rarities.yaml` plus any matching mod defs overlays.

## Key State
- Core fields: `#id`, `#name`, `#description`, `#shortDescription`, `#thingType`, `#imageId`, `#count`.
- Metadata: `#metadata` (mirrors slot, applied bonuses, raw prompt-scale `unscaledAttributeBonuses`, cause effects, flags, levels).
- Rarity and level: `#rarity`, `#itemTypeDetail`, `#level`, `#relativeLevel`.
- Harvest history: `#previouslyHarvestedItems` (deduped list of item names harvested from this node) and `#lastHarvested` (absolute world minutes at the last successful harvest).
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
- Basic getters: `id`, `name`, `description`, `shortDescription`, `thingType`, `imageId`, `createdAt`, `lastUpdated`, `checksum`, `count`.
- Equipment helpers: `equippedBy`, `isEquipped`, `equippedSlot`.
- Flags: `isVehicle`, `isCraftingStation`, `isProcessingStation`, `isHarvestable`, `isSalvageable` (get/set).
- Rarity/level: `rarity`, `itemTypeDetail`, `level`, `relativeLevel` (get/set).
- Metadata: `metadata` (get/set), `slot` (get/set), `attributeBonuses` (get/set), `unscaledAttributeBonuses` (get/set; prompt-scale source bonuses mirrored into metadata when known).
- Stack size: `count` (get/set; persisted integer quantity, defaults to `1`).
- Cause effects: `causeStatusEffect` (get/set), `causeStatusEffectOnTarget`, `causeStatusEffectOnEquipper`.
- Harvest helpers: `previouslyHarvestedItems` (get/set), `lastHarvested` (get/set), `getLastHarvestedAgoText(...)`.

## Instance API
- Flag helpers: `hasFlag(flag)`, `setFlag(flag, enabled)`.
- Bonuses: `getAttributeBonus(attributeName)`.
- Cause effects: `setCauseStatusEffects({ target, equipper, legacy })`.
- Harvest tracking: `recordSuccessfulHarvest(itemNames, { harvestedAtMinutes })` appends newly seen harvested item names and stamps `lastHarvested` at the successful completion time.
- Distinct target/equipper cause effects remain separate through constructor ingestion and metadata sync; dual-effect items are not collapsed into one shared payload.
- Serialization: `toJSON()`, `copy({...})`, `delete()`.
- Status effects: `getStatusEffects()`, `setStatusEffects(effects)`, `addStatusEffect(effect, defaultDuration)`, `removeStatusEffect(description)`, `tickStatusEffects(elapsedMinutes)`, `clearExpiredStatusEffects()`.
- Consumption: `consumeOne({ things })` decrements persisted `count` by `1` when the stack is larger than `1`; otherwise it fully deletes the thing from inventories/locations, static indexes, and the provided runtime `things` container.
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
- Normalizers: `#normalizeBooleanFlag`, `#normalizeAttributeBonuses`, `#normalizeStatusEffects`, `#sanitizeSlot`, `#normalizeCauseStatusEffectEntry`, `#normalizePreviouslyHarvestedItems`, `#normalizeLastHarvested`.
- Cause effect helpers: `#upsertCauseStatusEffectEntry`, `#getCauseStatusEffectEntry`, `#ingestCauseStatusEffects`.
- Status enrichment: `#triggerStatusEffectEnrichment`, `#enrichStatusEffectsUsingGlobals`.

## Notes
- Status effect enrichment calls `StatusEffect.generateFromDescriptions` using `Globals` prompt hooks.
- Name lookups are location-aware: `getByName` prefers current location/region contexts.
- Harvest history is persisted in both top-level `Thing` JSON and mirrored metadata so save/load and metadata-based paths stay in sync.
- `checksum` is a fast non-cryptographic FNV-1a hash of canonicalized `toJSON()` data. It intentionally excludes volatile identity/timestamp fields (`id`, `createdAt`, `lastUpdated`), the persisted `count`, prompt-roundtrip-only metadata (`unscaledAttributeBonuses`), and placement/ownership metadata (`location*`, `owner*`, `player*`, `inventoryOwnerId`) so equivalent things remain stable across saves and movement.
- `copy({...})` creates a new `Thing` with a fresh id/timestamps but the same hashable data and image by default; stack-splitting paths use it to preserve item identity details while changing only count/placement metadata as needed.
- Shared consumption code should call `consumeOne({ things })` instead of directly deleting a consumed thing; this preserves stacked items by decrementing `count` in place when possible.
