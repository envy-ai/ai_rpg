# ActorAttachmentSystem

## Purpose
Reusable helper for mod-owned actor attachment systems where installed records remain inventory-backed `Thing` objects but do not use normal gear slots.

The bundled implants mod uses it for `equipImplant` / `unequipImplant`, but the helper is domain-neutral: the caller supplies the namespace, display label, item slot field name, tool names, and event names.

## Key State
- Actor state lives under `actor.modState[namespace].slots`.
- Each slot stores an ordered array of installed Thing ids.
- Installed Things remain in the actor inventory. Removing an attachment removes only the mod-state reference.
- Compatibility is determined by a first-class Thing field named by `itemSlotFieldName`, such as `implantSlot`; `Thing.slot` remains normal gear only.

## Main API
- `install({ actor, item, itemName, implantSlot, slot, reason })`: resolves an inventory item, verifies its registered slot field, rejects duplicate installs and slot mismatches, then stores the Thing id under the slot.
- `remove({ actor, item, itemName, reason })`: removes an installed Thing id from mod state while leaving the Thing in inventory.
- `list(actor)`: returns installed `{ slot, itemId, item }` entries that still exist in inventory.
- `syncWithInventory(actor)`: removes stale installed ids for Things no longer in inventory.
- `getAttributeModifierContributions(actor, attributeName)`: sums installed item attribute bonuses.
- `getStatusEffectContributions(actor)`: returns equipper status effects contributed by installed items.
- `getActorStatusSection(actor, context)`: builds a profile/prompt status section using the active setting label when present.

## Notes
- The helper fails loudly on missing actors, missing inventory items, ambiguous item names, missing item slot fields, duplicate installation, and slot mismatches.
- If the actor supports `withHealthRatioPreserved`, install/remove mutations run inside it so max-health-changing attachments preserve health ratio.
- The constructor still accepts the old `itemMetadataSlotKey` option as an alias for `itemSlotFieldName`, but slot lookup reads the first-class Thing field and does not inspect metadata.
