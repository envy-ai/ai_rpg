# ActorAttachmentSystem

## Purpose
`modding/ActorAttachmentSystem.js` provides a generic helper for mod-owned actor attachment systems. Attachments are inventory-backed `Thing` records referenced from actor mod state, not normal gear slots.

The helper does not register hooks by itself. A mod creates an instance and wires its methods into context actions, chat tools, XML events, inventory sync, attribute/status contributors, actor status, or base-context contributors. The bundled `mods/implants` mod configures it for `implantSlot`, `equipImplant` / `unequipImplant`, and `<implantEquipped>` / `<implantUnequipped>`.

## Construction
- Required options: `namespace` and `itemSlotFieldName`.
- `displayLabel` defaults to `namespace`.
- Optional naming metadata: `installToolName`, `removeToolName`, `installEventTag`, `removeEventTag`, `installEventKey`, and `removeEventKey`. Defaults are derived from `namespace`.
- `itemMetadataSlotKey` is accepted as a compatibility alias for `itemSlotFieldName`. Slot lookup reads `item.getExtensionField(itemSlotFieldName)` when available, or `item[itemSlotFieldName]`; it does not read item metadata.

## Key State
- Actor state lives under `actor.modState[namespace].slots`.
- Each slot stores an ordered array of installed `Thing` ids. Multiple items can occupy the same slot because the helper does not enforce slot capacity.
- State loading validates that slot values are arrays, trims string ids, and drops blank ids.
- Installed Things remain in the actor inventory. Removing an attachment removes only the mod-state reference.
- Compatibility is determined by the configured item slot field, such as `implantSlot`; `Thing.slot` remains normal gear only.

## Main API
- `install({ actor, item, itemName, slot, implantSlot, reason })`: resolves an inventory item by object/id or exact name, requires a stable item id and configured slot field, rejects requested slot mismatches and duplicate installs, appends the item id to the slot array, and returns `{ actor, item, slot, reason }`. `implantSlot` is a caller-facing requested-slot alias used by the implants mod.
- `remove({ actor, item, itemName, reason })`: resolves an inventory item, requires it to be installed, removes its id from the installed slot, leaves the `Thing` in inventory, and returns `{ actor, item, slot, reason }`.
- `list(actor)`: returns installed `{ slot, itemId, item }` entries whose items are present in inventory.
- `syncWithInventory(actor)`: removes installed ids for Things no longer in inventory and returns `true` when it prunes at least one id.
- `getAttributeModifierContributions(actor, attributeName)`: sums installed items' `getAttributeBonus(attributeName)` values, ignoring unsupported or non-numeric entries.
- `getStatusEffectContributions(actor)`: returns equipper status effects from installed items through `causeStatusEffectOnEquipper` or `causeStatusEffect.applyToEquipper`.
- `getActorStatusSection(actor, context)`: returns `null` when no attachments are installed; otherwise returns `{ key, label, entries }` with slot, item id, item name, and item description.
- `getDisplayLabel(context)`: reads `setting.getModSetting(namespace, 'displayLabel')` or `setting.modSettings[namespace].displayLabel`, falling back to the constructor label.
- `parseXmlRaw(raw)`: parses a JSON object payload for registered XML event parsers and throws on blank or non-object payloads.

## Failure And Mutation Behavior
- The helper throws explicit errors for missing mod-state support, missing inventory access, missing or ambiguous item names, item objects outside the actor inventory, missing item ids, missing slot fields, requested slot mismatches, duplicate installs, non-installed removals, malformed slot state, and invalid XML parser payloads.
- If the actor supports `withHealthRatioPreserved`, install/remove mutations run inside it so max-health-changing attachments preserve health ratio.
