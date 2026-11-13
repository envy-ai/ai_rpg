# Thing

Missing item/scenery IDs use the first three name words through shared `IdGenerator`, with numeric collision suffixes. Copies use their final override name; inherited grants use the referenced technique name (or the owning item name where the existing contract permits it) and receive the copied source item ID. Existing supplied IDs remain stable.

## Hidden discovery

Location Things persist the atomic pair `hiddenFromPlayer` and `discoveryDifficulty`. Difficulty is one of `Trivial`, `Easy`, `Medium`, `Hard`, `Very Hard`, or `Legendary`; visible Things require null. Generated Thing XML defaults omitted or blank scalar `hiddenFromPlayer` to `false`; visible entries may omit `discoveryDifficulty`, which normalizes to null. Explicitly hidden entries still require a valid difficulty. Duplicate tags, invalid booleans, invalid supplied difficulty labels, and nonblank difficulty on visible entries remain validation errors. `setHiddenDiscovery(...)` changes both fields together. Legacy save hydration also defaults missing fields to visible/null; hidden state participates in stack checksums. Player interactions reject hidden Things until discovery. See [HiddenDiscovery](HiddenDiscovery.md) for the shared XML parser.

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

`new Thing({ ..., register: false })` and `Thing.fromJSON(data, { register: false })` create validation candidates without allocating an id or entering static/runtime indexes. `ThingMutationService` uses this mode for create, update, alteration, and recreation preparation. `replaceStateFrom(candidate)` replaces a registered Thing's validated private state in place, preserving its id, object identity, creation timestamp, and external references.

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

`combinerMechanicsChecksum` provides a structural mechanics fingerprint that excludes names, descriptions, short descriptions, image identity, timestamps, and quantity. It remains available for callers that need a strict comparison, but the explicit AI item combiner no longer requires equality: after the AI suggests a same-quality group and the player approves it, the selected keeper's mechanics apply to the combined quantity.

`copy({...})` creates a fresh `Thing` id/timestamps with the same hashable data and image by default. Stack splitting uses it to preserve item details while overriding count and placement metadata. `containedThingIds` and pending `containerContents` are reset unless explicitly supplied in the copy overrides.

## Placement And Stacks
`removeFromWorld()` detaches a thing from players, equipment, barter inventories, locations, and containing Things. `drop(locationIdOverride)`, `putInLocation(locationId)`, and `putInInventory(playerId)` move the thing through `Location` and `Player` APIs.

`Player.addInventoryItem(...)`, `Location.addThingId(...)`, and container `addInventoryItem(...)` automatically merge incoming item stacks into same-name, same-checksum destination stacks when both stacks are item-type, unequipped, and not containers. Callers pass `mergeStacks: false` for explicit split/separate flows that must keep records distinct. Internal named-item generation also accepts sanitized `creationMetadata`; quest completion combines that metadata with `mergeStacks: false` so each reward has persisted quest/reward-index provenance and an interrupted item-generation pass can recognize already-created rewards. Merging increases the surviving stack's `count`, deletes the incoming `Thing` from static indexes, and cleans registered runtime maps.

`consumeOne({ things })` delegates to `consumeQuantity(1, { things })`. `consumeQuantity(quantity, { things })` validates a positive safe integer and subtracts the exact quantity once for a partial stack; full consumption uses the native deletion/holder/registry cleanup. Missing counts and stored zero retain native one-individual-record consumption semantics. Populated counts must be nonnegative safe integers and over-consumption fails before mutation. Shared stack consumption should use this API or the event-system quantity consumer instead of deleting directly or looping once per unit. Crafting applies target status effects separately per consumed unit only when effects exist.

## Containers
Only `isContainer` Things can hold contents. Contents must be item-type Things; equipped items are rejected. A container cannot contain itself, and nested containers are rejected when the move would create a descendant cycle.

Instantiated contents are stored as `containedThingIds`; contained items receive `metadata.containerId` and have owner/player/location placement metadata cleared. `removeFromWorld()` also removes matching ids from all container inventories.

`containerContents` is a pending seed list parsed from generated Thing XML before real contained item Things exist. Entries normalize to `{ name, count }`; missing or empty values produce `[]`, omitted counts default to `1`, count text such as `3 flares` yields `3`, empty sentinel names such as `empty`, `none`, and `n/a` are ignored, and zero-count entries are ignored. A Thing with non-empty pending contents is marked as a container with a console warning.

The shared single-Thing generator accepts the same core seed fields exposed by item XML, including short descriptions, stack counts, pending container contents, attribute bonuses, target/equipper effects with nested modifiers, properties, boolean flags, and registered mod fields. Seed normalization validates and retains these values, and `_includes/item.njk` renders them as filled XML fields rather than blank schema placeholders.

The container inventory API generates pending contents through the shared `thing-generator-contents` prompt before serializing the container payload, including when TinyBrain is configured. Concurrent requests for the same container join one in-flight generation promise. The response uses the existing strict XML inventory parser, which normalizes accepted entries to item kind and supplies the configured default rarity when omitted. `ContainerContentsGeneration.validateGeneratedContainerContentsAgainstSeeds(...)` requires every exact pending name and at least its requested total count, summing repeated names across both seeds and generated stacks. Additional item names, surplus quantities, and combined or split stacks are allowed inside this container. Every returned entry still needs a nonblank name, a positive integer count, valid XML/mod fields, and whole-Thing candidate validation before any `Thing` is created. Malformed XML, substitutions that omit a requested name, insufficient requested quantities, and invalid extra items log the rejected prompt response and rerun the complete generation/parse attempt according to `ai.retryAttempts`; exhaustion propagates the final explicit error while leaving the pending seeds intact. Correction feedback identifies the error, preserves every requested minimum, and explicitly permits valid extras. The prompt also states that the model must never generate the containing Thing, choose sensible numeric fields itself without randomness, and never make tool calls.

A valid response creates the complete batch of item Things and inserts every entry into the container with stack merging disabled, then applies the ordinary configured slop-word and duplicate-name canonicalization and clears the seeds; therefore a requested seed name can still become a different canonical final name. An attachment or canonicalization failure removes the new batch and preserves the seeds; existing container contents remain. Extra generated contents never become loose location items or actor inventory entries. Actor/barter inventory generation and location approved rosters retain their own count contracts; their nested `<containerContents>` seeds use this dedicated path when materialized. `requiresCheckToOpen` makes the browser run the dedicated checked-open route before showing inventory; a successful response with `permanentlyOpened` persists `requiresCheckToOpen: false`. Checked-open event extraction excludes `alter_item` because that route already owns the lock mutation, preventing a second AI alteration from rewriting unrelated container fields.

`generateItemsByNames` accepts an optional `options.onCreated(thing)` ownership callback immediately after a new item commits, before placement. The contents generator accepts `onCreated(things)` immediately after its content batch commits, before attachment. Its rollback covers attachment, canonicalization, prompt logging, seed clearing and reuse-session commit; failed post-commit bookkeeping restores pending seeds. [Target-sourced faction item favors](FactionFavorEffectRegistry.md) use both callbacks to remove precisely their own crate and content objects if delivery fails. These favors eagerly generate their seeded container contents before activation succeeds; ordinary pending containers still hydrate when opened or inspected.

`delete()` rejects non-empty containers so contents are not orphaned. The event-system `consume_item` full-destruction path resolves the destroyed container's holder or location, moves instantiated contents there, clears the container inventory, then deletes the container.

## Prompts, APIs, And Events

Location item/scenery generation supports staged `location_things_generation`: a compact XML roster must satisfy configured count/rarity minimums before full Thing generation. Final expansion must preserve exactly the approved names, kinds and rarities; full XML/mod/hidden-discovery and whole-Thing validation happen inside the active final stage before the existing atomic batch commit. Standard mode uses one strict parser-feedback conversation without nested root retries. See [LocationThingGenerationPlan](LocationThingGenerationPlan.md).

Generated item descriptions remain descriptive prose. Mechanical details such as type, slot, rarity, value, weight, properties, attribute bonuses, target/equipper cause effects, flags, and mod fields are stored structurally and rendered by client tooltips/details. Base-context compact item, scenery, and inventory rows always render stack counts as a separate `quantity N;` field after the item name, keeping the quantity out of the canonical item name and short description.

The shared item XML prompt includes count, item/scenery kind, type, slot, rarity, value, weight, relative level, boolean flags, container data, attribute bonuses, target/equipper cause effects, properties, short description, and registered Thing fields exposed to generator prompts. The XML parser returns the same fields for natural location generation, inventory generation, container-content generation, crafting/process/salvage/harvest output, item alteration, and thing separation.

Collection fields such as `moduleSlots` render exactly one enclosing XML tag
whether the seed is absent, an empty array, or populated. An absent seed includes
the child-structure guidance inside that wrapper; seeded entries render as child
elements. This keeps the example item XML well formed for container contents and
other generators that share `_includes/item.njk`.

Thing XML parsing requires every entry to contain a nonblank direct `<name>` and `<description>`. It also propagates malformed XML, invalid `itemOrScenery` values, requested-kind mismatches, invalid registered-field structure, and nonempty status-effect durations that `StatusEffect.normalizeDuration(...)` cannot parse instead of converting a failed batch into an empty list. Valid generated status durations are normalized to canonical minutes while parsing. Single-thing generation explicitly instructs the model to return one `<items>` root containing one `<item>`, even when only one thing is requested. It requires that complete wrapper, uses strict XML, requires exactly one parsed Thing, merges explicit seed values as hard candidate constraints, and runs whole-Thing validators before it can instantiate anything. `runPromptWithParseRetries(...)` owns these validation retries: each rejected raw response and precise root, parse, count, or whole-Thing error is sent back with a correction instruction requiring the complete wrapper and preserved seed constraints. The configured `ai.retryAttempts` budget applies once to this validation conversation; transport retries remain separate, and completion failures/cancellation propagate. Every accepted or rejected response is logged with its conversation and validation result through `LLMClient.logPrompt()`. Exhaustion throws without creating the rejected Thing. Location, inventory, and container-content generation prepare and validate every member of a response before registering the batch, so a rejected response cannot partially persist its valid prefix.

After a valid XML envelope and readable item identity, `parseThingsXml` collects independent target/equipper effect, charge-pool, registered-field and pure parsed-field mod-invariant errors for each item, then continues to sibling items. It throws through [ResponseValidation](ResponseValidation.md) before returning any partial batch. A mod's parsed-field validator sees only successfully parsed name, kind, normal equipment slot and registered XML fields; invalid registered fields block that dependent check, while invalid charge or effect fields do not. Whole-Thing candidate validation still waits for a complete parsed item. The same parser serves standard and TinyBrain item generation.

`POST /api/things`, `PUT /api/things/:id`, crafting instantiation, event-created placeholder items, location/inventory generation, and container-content generation all construct or mutate `Thing` records through the same structural fields. API payloads also accept registered fields exposed to create/edit flows.

The `thing-separate` route accepts item and scenery sources. If separated output contains one or more containers, the first returned container receives the rest of the returned item-type things. Scenery output remains at the source destination because container inventories only hold item Things. Stack separation and explicit split-stack flows opt out of automatic merging. Both routes reject Things participating in an installed-module relationship so `Thing.copy(...)` cannot duplicate module ids or backlinks.

Event checks use Thing data for item infliction, ingestion, consumption, alteration, transfer, pickup/drop, harvested resources, and item-to-NPC transformation. Target cause effects apply to attack/use targets; equipper cause effects contribute through `Player.getStatusEffects()` while the item is equipped.

The item context menu's currency-conversion cheat resolves an integer per-unit standard value from direct `value` or metadata `value`, `standardValue`, or `baseValue`, then multiplies it by the complete stack count. Its preview and confirmed mutation share the same resolver. Missing/negative values, invalid counts or totals, scenery, and non-empty containers fail explicitly; pending container-content seeds count as contents. The confirmed route rechecks the preview before using the ordinary authoritative deletion path and crediting the active player.

## Mod Fields
`ModExtensionRegistry.registerEntityField({ entityType: 'thing', ... })` registers first-class Thing fields. Registered fields validate type, serialize as top-level properties when stored, expose optional default values through `getExtensionFields({ includeDefaults: true })`, and can be exposed to create tools, update tools, generator prompts, XML parsing, and the item editor.

For fields with `clearThingSlotWhenPresent`, generation and API write paths clear the normal equipment `slot` when the registered field has a meaningful value. The implants mod uses this for `implantSlot`, so implant-compatible items remain inventory items rather than normal gear-slot equipment. The implant field's item prompt and tool description state this rule and tell generators to use `N/A` for ordinary modular gear. Since `moduleSlots` require a normal equipment slot, implant-compatible items cannot also have module slots under the current invariant.

The modules mod registers `moduleSlots`, `moduleType`, `installedModuleIds`, and `moduleInstalledOnItemId`. Base equippable items use normal `Thing.slot` plus `moduleSlots`; module items use `moduleType`; installed modules remain real Things in the same holder as their base item, with backlinks and UI filtering handled by the modules mod.

## Validation And Errors
Invalid required constructor fields, invalid `thingType`, invalid count values, invalid extension field values, invalid registered-field JSON, malformed Thing XML, invalid non-array container contents, invalid non-string contained ids, malformed status-effect entries, and unresolved destructive container operations throw explicit errors. Alter-thing XML treats omitted/empty optional target or equipper status-effect elements, plus exact `N/A`, `none`, `null`, and `not applicable` sentinels, as absence rather than inventing a persisted effect; prompts ask for empty optional elements. Registered extension fields may supply `validateValue(value, context)`, which runs after core type normalization and before constructor, hydration, or setter persistence. Several API routes catch these errors and return structured `{ success: false, error }` responses.

Level values are rounded to positive integers in the model. `relativeLevel` is rounded into the model-supported relative range. Stack `count` must be an integer `0` or greater and defaults to `1` when absent.

Status-effect enrichment calls `StatusEffect.generateFromDescriptions(...)` through `Globals` prompt hooks when prompt services are available. Hydration disables enrichment to avoid save/load side effects; prompt-backed alteration enriches target/equipper effects before writing them onto the `Thing`.

## Technique grants

`techniqueGrants` is a validated first-class field, included in construction, cloning/replacement, field registry create/edit contracts and save hydration. Each grant pins its stable grant ID, source item ID, common technique ID and immutable definition revision. Ordinary grants provide access while equipped; `teaches: true` permits an explicit durable learning operation from an owned item. No historic item gains a grant automatically. See [Technique](Technique.md) for the exact schema and [TechniqueService](TechniqueService.md) for source resolution.

Unregistered creation candidates may leave grant `sourceItemId` unbound; commit binds the newly allocated item ID. Catalogue/revision references are validated even for candidates. Registered creation/update rejects grant IDs already owned by another item, and hydration seeds grant ID counters. `Thing.copy()` gives inherited grants independent grant IDs and the new copied item ID while preserving pinned mechanics/provenance.
# Status effect percentage and technique fields

Thing cause-status templates preserve `maxHealthPercent`, attribute/skill `percentModifier`, and nested `techniqueGrants` when normalized from metadata. An equipper effect exposes those mechanics while the item is equipped. Player gives each exposed effect a stable item-scoped status ID and rebinds its grant source IDs to that item, so separate copies do not share a technique source. Target-applied effects become ordinary intrinsic statuses when applied.

Cause templates and generated enrichment also preserve `needBarMaximums` and
percentage-per-minute `needBars[].percentDelta`. Capacity modifiers change the
target's effective maximum while preserving its fill percentage; authored costs
and recovery remain fixed units. Item XML and generation seeds retain both fixed
and percentage components instead of silently dropping them.

Shared generated-Thing XML parsing treats omitted or blank `<count>` as `1` and omitted or blank `<relativeLevel>` as null, while preserving explicit zero values. Nonempty count values still require a non-negative integer. Optional registered scalar fields, empty registered collections and optional cause-effect text retain their established parsing semantics.

## Permanent item memory

Registered items are tracked by [ItemCatalogue](ItemCatalogue.md). Normal deletion retains the final canonical definition; save capture refreshes and retains live definitions. `delete({ remember: false })` is reserved for cleanup of rejected provisional creations. Candidates with `register: false` do not enter the catalogue. `Thing.clear()` resets catalogue state for world isolation; save hydration restores the catalogue after clearing live registries.

## Standard item reuse

[ItemReuseService](ItemReuseService.md) persists explicitly authored standard-item families and all allowed rarity variants. Named generation can skip a full completion; inventory, containers and locations use [compact rosters](ItemBatchGenerationPlan.md) before expanding only unresolved entries. Reused data keeps raw bonuses for the caller's normal level scaling, receives fresh grant/source identities, and passes the same mutation-service validators. Incompatible explicit seed constraints retain ordinary generation. Complete edits and crafting outcomes are not silently replaced by a name match.

Standard-copy provenance does not affect stack equivalence. Duplicate-name canonicalization skips an unchanged marked copy, while a changed name or canonical mechanics invalidates that exemption. Current `Thing.fromJSON` explicitly forwards saved raw bonuses as well as scaled bonuses.

## Ammunition and charge

`chargePool` optionally stores `{ mode, amount, capacity, unit, initialAmount?, ammoType?, costPerUse? }`; `ammoType` on the Thing itself identifies loose ammunition instead. Compatibility keys trim, normalize Unicode NFC and lowercase; matching is exact and never inferred from a name. A Thing cannot simultaneously be loose ammunition and charged equipment. Charge is independent of `count`: pools require exactly one individual item, while loose ammunition uses a safe integer stack count. All pool values are finite nonnegative numbers bounded by capacity; discrete values and payments require safe integers. Empty pools remain on intact items, and zero survives copying and saves.

Charge and ammunition fields are first-class fields in generation, shared XML, create/edit tools, client serialization and full/compact prompt context. Setters validate complete values; `chargePool` reads return copies. Charged records never merge or enter the AI combiner, and separation rejects charged sources. Copies preserve current charge. `replaceStateFrom` preserves validated candidate count and charge together. `captureDeletionRollback()` captures exact static/runtime registry membership for restoring a failed transactional source deletion; callers restore ownership through native inventory APIs.

[ItemChargeService](ItemChargeService.md) owns checked spending, adjustment, physical reload and operation replay. [ItemCatalogue](ItemCatalogue.md) omits live charge amounts from definitions; only declared `initialAmount` initializes newly materialized standard copies.
