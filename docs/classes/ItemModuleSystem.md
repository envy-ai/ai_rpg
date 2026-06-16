# ItemModuleSystem

## Purpose
`mods/modules/ItemModuleSystem.js` is the module-owned helper behind the bundled `mods/modules` mod. It validates module configuration and Thing fields, installs and removes item-to-item modules, keeps base-item and module backlinks synchronized, and exposes installed-module mechanics without storing derived bonuses on the base item.

## Data Fields
- `moduleSlots`: array on equippable base items. Entries require `{ type }`; an optional string `label` may be present and is used only as display text. When no label is present, display code uses the configured slot-type label or the raw type id.
- `moduleType`: configured slot type for installable module items. Meaningful values exclude blank strings, `N/A`, `none`, and `null`.
- `installedModuleIds`: non-empty, unique module Thing ids installed on a base item.
- `moduleInstalledOnItemId`: backlink from an installed module item to its base item.

The modules mod registers these as first-class Thing extension fields, so they serialize at top level, are available through `Thing.getExtensionField(...)` / `Thing.setExtensionField(...)`, and are exposed to item XML prompts/parsing, `createThing`, `updateObjectFields`, and the item editor.

## Slot Type Configuration
- `normalizeSlotTypes(value)` accepts an array or JSON string of `{ id, label?, description? }` slot-type records. Missing, blank, or null input resolves to the system default slot type.
- Slot type ids must start with a letter and contain only letters, numbers, underscores, or hyphens.
- The slot-type list must contain at least one entry and cannot contain duplicate ids, case-insensitively.
- Labels default to the id; descriptions default to an empty string.
- `getSlotTypeMap(...)` and `getConfiguredSlotTypeOptionsText(...)` support prompt/tool descriptions for the active world-profile slot types.

## Validation
- `validateItemModuleFields(item, { slotTypes })` validates `moduleSlots` and `moduleType` against the active slot-type list.
- Only item Things may have module slots or a module type.
- Only equippable items, meaning items with a meaningful normal equipment `slot`, may have module slots.
- Module items cannot also have module slots.
- Unknown slot types, malformed slot entries, malformed installed-id arrays, duplicate installed ids, and malformed slot-type definitions throw explicit errors.

## Core Methods
- `getModuleType(item)`, `isModuleItem(item)`, `getModuleSlots(item, { slotTypes, validate })`, `getInstalledModuleIds(baseItem)`, and `getModuleInstalledOnItemId(moduleItem)` normalize field access across real `Thing` instances and plain test objects.
- `install({ actor, baseItem/baseItemName/baseItemId, moduleItem/moduleItemName/moduleItemId, slotType, slotTypes, reason })` installs a module in the next open compatible slot and writes both sides of the relationship. The helper requires an actor-like owner with `getInventoryItems()`; item objects, ids, or names must resolve inside that owner. It rejects missing stable ids, self-installation, equipped module items, already-installed modules, wrong requested slot types, full slots, and stale installed-module references. If the selected loose module item is a stack, the helper splits one single-count copy into the owner inventory and installs that copy.
- `remove({ actor, baseItem/baseItemName/baseItemId?, moduleItem/moduleItemName/moduleItemId, reason })` removes an installed module and clears its backlink. When the base item is omitted, removal resolves it from the module backlink.
- `listInstalledModules(actor, baseItem)` resolves installed ids from the owner inventory and returns `{ moduleId, moduleItem, baseItem, slot }` entries.
- `syncWithInventory(actor)` removes stale installed ids and backlinks after inventory replacement or removal.
- `getEffectiveAttributeBonus(actor, baseItem, attributeName)` returns the base item bonus plus installed module bonuses.
- `getAttributeModifierContributions(actor, attributeName)` returns only installed-module bonuses for equipped base items, for `Player.getModifiedAttribute()`.
- `getStatusEffectContributions(actor)` returns installed-module equipper effects for equipped base items, for `Player.getStatusEffects()`.
- `getTargetStatusEffectContributions(actor, baseItem)` returns installed-module target effects for attack application.
- `getActorStatusSection(actor, context)` returns prompt/client status-section data describing installed modules on the actor's carried base items.
- `parseXmlRaw(raw)` parses JSON-shaped XML event payloads for the mod-registered module event handlers.

Mutations run inside `actor.withHealthRatioPreserved(...)` when that helper exists, so derived health ratios survive module bonus changes.

## Mod Callers
- `mods/modules/mod.js` owns the singleton system and registers the `Modules` world-profile tab, terminology presets, setting fields, Thing extension fields, image badges, context actions, chat tools, XML events, base-context data, item-generation guidance, inventory sync, actor status, attribute modifier, equipper status-effect, and attack target-status-effect contributors.
- Chat tools `installModule` and `removeModule` operate on inventory items by actor name or the current player.
- XML events `<moduleInstalled>` and `<moduleRemoved>` perform the same inventory-backed operations during event checks.
- Thing context actions `modules:install-module` and `modules:remove-module` are invoked through `POST /api/mod-thing-context-actions/:actionId`. The action wrapper resolves player inventory, NPC inventory, and loose current-location sources, transfers the module to the base item's holder before linking, and adapts loose location items through an actor-like owner.
- The browser UI uses those context actions from item menus, the module workbench, and direct module-card drops onto compatible base item cards.

## Notes
- Installed module Things remain real Things in the same raw holder as the base item: actor inventory for inventory-held base items, or loose location Things for location-held base items. The backlink distinguishes installed modules from loose modules.
- UI inventory panels, location item panels, container player-inventory views, crafting pickers, barter offer lists, NPC memory prompts, character alteration prompts, and base-context inventory sections hide installed modules as standalone items. The visible base item still renders installed module details in tooltips and image-lightbox data.
- Attribute bonuses from installed modules are additive only while the base item is equipped. Equipper status effects follow the same equipped-base rule. Target status effects are contributed for the attacking base item during attack handling.
- Installed modules are counted as module items by the generation-balance prompt instruction because they remain persisted Things with `moduleType`.
- Direct install/remove operations fail loudly for missing ownership, stale installed ids, duplicate installs, wrong slot types, equipped module items, and malformed state.
