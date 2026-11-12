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
- `install({ actor, item, itemName, sourceActors = [], slot, implantSlot, reason })`: resolves an inventory item by object/id or exact name, requires a stable item id and configured slot field, rejects requested slot mismatches and duplicate installs, appends the item id to the slot array, and returns `{ actor, item, sourceActor, slot, reason }`. The recipient inventory takes precedence. Only when no recipient item matches does lookup consider the explicitly supplied accessible source actors; ambiguity in the selected inventory scope fails. `implantSlot` is a caller-facing requested-slot alias used by the implants mod.
- `remove({ actor, item, itemName, reason })`: resolves an inventory item, requires it to be installed, removes its id from the installed slot, leaves the `Thing` in inventory, and returns `{ actor, item, slot, reason }`.
- `list(actor)`: returns installed `{ slot, itemId, item }` entries whose items are present in inventory.
- `syncWithInventory(actor)`: removes installed ids for Things no longer in inventory and returns `true` when it prunes at least one id.
- `getAttributeModifierContributions(actor, attributeName)`: sums installed items' `getAttributeBonus(attributeName)` values, ignoring unsupported or non-numeric entries.
- `getStatusEffectContributions(actor)`: returns equipper status effects from installed items through `causeStatusEffectOnEquipper` or `causeStatusEffect.applyToEquipper`.
- `getActorStatusSection(actor, context)`: returns `null` when no attachments are installed; otherwise returns `{ key, label, presentation: 'equipment', entries }` with slot, item id, item name, and item description. The character view resolves each exact item id from that actor's inventory and reuses its native equipment list: slot/name rows, item icons, rarity styling, full hover tooltips, lightbox and owner-aware context actions. Multiple installed items in one slot retain separate rows. The configured mod label remains the section heading.
- `getDisplayLabel(context)`: reads `setting.getModSetting(namespace, 'displayLabel')` or `setting.modSettings[namespace].displayLabel`, falling back to the constructor label.
- `parseXmlRaw(raw)`: parses a JSON object payload for registered XML event parsers and throws on blank or non-object payloads.

## Failure And Mutation Behavior
- The helper throws explicit errors for missing mod-state support, missing inventory access, missing or ambiguous item names, item objects outside the supplied inventory scope, missing item ids, missing slot fields, requested slot mismatches, duplicate installs, non-installed removals, malformed slot state, and invalid XML parser payloads.
- If the actor supports `withHealthRatioPreserved`, install/remove mutations run inside it so max-health-changing attachments preserve health ratio.

## Automatic installation transfer

The implants mod's `equipImplant` tool and `<implantEquipped>` event do not
require a separate inventory transfer. If the item is absent from the recipient,
they can supply the current player's carried inventory as a source for a visible
recipient at the same location or in the player's party. Lookup never searches
the world, remote actors, location items, containers or merchant stock. Existing
recipient-owned installations and inventory-owner context actions retain their
original target behavior. Standard and TinyBrain event prompts receive the same
registered automatic-transfer guidance.

Before transferring, install validates the item identity, compatibility, requested
slot and recipient duplicate state. A hidden, normally equipped, module-attached
or already-installed source item is rejected; it must first be made available or
removed from that installation explicitly. No item is generated or implicitly
detached. The exact canonical Thing moves through native remove/add inventory
methods with stack merging disabled and NPC equipment checks suppressed, then
its id is installed. Successful installs remain inventory-backed and continue to
participate in save persistence, inventory sync and status/attribute contributors.

If transfer, mod-state storage or health reconciliation fails, rollback restores
source ownership, item metadata, both characters' complete mod state and health.
Recipient-owned installation failures restore the original attachment state and
health. Original errors propagate; failed rollback adds its causes in an
`AggregateError` rather than hiding a partial failure.
