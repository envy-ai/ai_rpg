# Modding Hooks

## Overview
Mods can now add behavior through the shared `ModExtensionRegistry` instead of only contributing defs overlays or Express routes. `ModLoader` exposes namespaced helper methods on each mod scope, so a mod calls `scope.registerChatTool(...)`, `scope.registerXmlEvent(...)`, and related helpers without manually passing its own mod name.

## Actor State and Settings
- Actors persist namespaced state in `Player.modState`.
- Use `actor.getModState(namespace)`, `actor.setModState(namespace, value)`, or `actor.updateModState(namespace, updater)`.
- Missing old-save state reads as `{}`.
- World profiles persist namespaced settings in `SettingInfo.modSettings`.
- Use `setting.getModSetting(namespace, key, defaultValue)` for active-world labels, formulas, and resource ids.
- Mods can call `scope.registerSettingTab({ id, label, description, order })` to add a World Profiles editor tab.
- Mods can call `scope.registerSettingField({ namespace, key, label, type, defaultValue, description, tabId })` to add fields. Fields with a `tabId` render in that mod tab; fields without one stay in the Prompt Guidance `Mod Settings` block for compatibility.

## XML Events
- Mods can call `scope.registerXmlEvent({ tagName, eventKey, promptSchema, parser, handler })` to add event-check XML tags.
- `promptSchema` should be shaped as `{ name, description, xml }`. The events prompt renders those fields the same way it renders built-in event-type names, descriptions, and XML examples.
- The registry accepts direct child XML under the registered tag, converts it to object-shaped raw data, then passes that raw data through the registered parser and handler.

## Entity Fields
- Mods can call `scope.registerEntityField(...)` to add first-class mod-owned fields to core entities. The first supported `entityType` is `thing`.
- Registered Thing fields persist as top-level `Thing` JSON, are available through `thing.getExtensionField(fieldName)` / `thing.setExtensionField(fieldName, value)`, and are also installed as direct instance accessors when possible.
- `exposeToCreateTool` adds the field to the live `createThing` schema and forwards the value into the generator seed. After generation, the runtime writes the value back onto the created Thing so it survives even if the generator ignores it.
- `exposeToUpdateTool` lets generic prompts patch the field through `updateObjectFields({ objectType: "thing", fields: { ... } })`.

## Bundled Generic Helpers
- `modding/ActorAttachmentSystem.js` implements inventory-backed actor attachments. Installed entries store item ids under `actor.modState[namespace].slots[slotName]`; items remain in inventory.
- `modding/ActorActivatableSystem.js` implements learned actor records that can be activated by spending a need-bar resource through a formula.

## Bundled Mods
- `mods/implants` registers the first-class Thing field `implantSlot`, adds an `Implants` world-profile tab, `equipImplant` / `unequipImplant`, `<implantEquipped>` / `<implantUnequipped>`, actor status sections, inventory sync, attribute bonuses, and equipper status effects. Compatible items require `Thing.implantSlot`; `Thing.slot` remains normal gear only.
- `mods/spells` adds a `Spells` world-profile tab, `generateSpell` / `castSpell`, `<spellLearned>` / `<spellCast>`, a mana need-bar overlay, spell actor status sections, and per-world spell settings under `modSettings.spells`.

## Spell Cost Formula
The spells mod defaults to:

```text
baseCost * level
```

The formula receives:

- `level`
- `usageRank` (`low=1`, `medium=2`, `high=3`)
- `manaUsage` (same numeric value as `usageRank`)
- `baseCost`

The result must be a positive finite number. Values are not clamped.
