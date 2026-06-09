# ItemModuleSystem

## Purpose
`mods/modules/ItemModuleSystem.js` is the module-owned helper behind the bundled `mods/modules` mod. It manages item-to-item module installation, validates configured slot types, and exposes additive module mechanics without storing derived bonuses on the base item.

## Data Fields
- `moduleSlots`: array on equippable base items. Entries are `{ type }`. Legacy slot labels may still be read for display, but new/edit/create surfaces do not require or collect per-slot names.
- `moduleType`: configured slot type for installable module items.
- `installedModuleIds`: module Thing ids installed on a base item.
- `moduleInstalledOnItemId`: backlink from a module item to its base item.

## Core Methods
- `normalizeSlotTypes(value)`: validates a positive list of `{ id, label?, description? }` slot types. Empty, duplicate, blank, or malformed definitions throw.
- `validateItemModuleFields(item, { slotTypes })`: enforces item/module shape rules.
- `install({ actor, baseItem/baseItemName/baseItemId, moduleItem/moduleItemName/moduleItemId, slotType, slotTypes })`: installs a module in an open compatible slot and writes both sides of the relationship. If the selected loose module item is stacked, one single-count copy is split from the stack and installed.
- `remove(...)`: removes an installed module and clears its backlink.
- `syncWithInventory(actor)`: removes stale installed ids/backlinks after inventory replacement or removal.
- `getEffectiveAttributeBonus(actor, baseItem, attributeName)`: returns base item bonus plus installed module bonuses.
- `getAttributeModifierContributions(actor, attributeName)`: returns only installed-module bonuses for equipped base items, for `Player.getModifiedAttribute()`.
- `getStatusEffectContributions(actor)`: returns installed-module equipper effects for equipped base items.
- `getTargetStatusEffectContributions(actor, baseItem)`: returns installed-module target effects for attack application.

## Notes
- Only equippable item Things may have module slots.
- Module items cannot have module slots. Stacked loose module items split one single-count module for installation, and installed module Things cannot be normally equipped while installed.
- Installed module Things remain in the same raw holder as the base item while installed: actor inventory for inventory-held base items, or loose location Things for location-held base items. The modules mod transfers a module to the base item's holder before calling `install(...)`, and `moduleInstalledOnItemId` links the module to the base item. UI, barter, crafting, and base-context inventory surfaces are responsible for hiding those linked modules as standalone items while still rendering them under the base item.
- Direct install/remove operations fail loudly for missing inventory ownership, stale installed ids, duplicate installs, wrong slot types, and malformed state.
