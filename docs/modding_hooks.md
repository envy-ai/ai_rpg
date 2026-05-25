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
- Mods can call `scope.registerSettingField({ namespace, key, label, type, defaultValue, description, tabId, options, persist, action })` to add fields. Fields with a `tabId` render in that mod tab; fields without one stay in the Prompt Guidance `Mod Settings` block for compatibility.
- Setting fields support plain string/text/number controls plus `type: "select"`. Select `options` use `{ value, label, description? }`; action options can also include namespaced `settings` values and a `confirmMessage`.
- Fields default to `persist: true`. Use `persist: false` with `action: "applyPreset"` for a World Profiles select that asks for confirmation, copies option `settings` into editable fields, and does not save the action selector itself.

## XML Events
- Mods can call `scope.registerXmlEvent({ tagName, eventKey, promptSchema, parser, handler })` to add event-check XML tags.
- `promptSchema` should be shaped as `{ name, description, xml }`. The events prompt renders those fields the same way it renders built-in event-type names, descriptions, and XML examples.
- The registry accepts direct child XML under the registered tag, converts it to object-shaped raw data, then passes that raw data through the registered parser and handler.

## Actor Status Sections
- Mods can call `scope.registerActorStatusContributor(fn)` to add actor status/profile sections.
- Contributions are exposed as `modStatusSections` in prompt context, `/api/player`, client actor profiles, and detailed `/api/npcs/:id` character status responses.
- Character view detail refreshes preserve existing `modStatusSections` when a partial detail response is missing them, so a later attribute/details refresh does not erase mod-owned sections from the modal.

## Entity Fields
- Mods can call `scope.registerEntityField(...)` to add first-class mod-owned fields to core entities. The first supported `entityType` is `thing`.
- Registered Thing fields persist as top-level `Thing` JSON, are available through `thing.getExtensionField(fieldName)` / `thing.setExtensionField(fieldName, value)`, and are also installed as direct instance accessors when possible.
- `exposeToCreateTool` adds the field to the live `createThing` schema and forwards the value into the generator seed. After generation, the runtime writes the value back onto the created Thing so it survives even if the generator ignores it.
- `exposeToUpdateTool` lets generic prompts patch the field through `updateObjectFields({ objectType: "thing", fields: { ... } })`.
- `exposeToGeneratorPrompt` adds the field to the shared generated item XML scaffold, including craft, process, salvage, harvest, inventory, location-thing, container-content, and generic item generation prompts that include `_includes/item.njk`. It requires `xmlPrompt.placeholder`, and `xmlPrompt.tagName` defaults to the registered field name.
- `exposeToXmlParser` reads that XML tag from generated item/scenery output and maps it back onto the registered first-class Thing field. Parser-only fields can omit the placeholder and still use the default tag name.
- `exposeToEditModal` adds the field to the shared item/scenery edit modal. Use `edit: { label, placeholder, description, inputType, order }` to control the form field. Supported edit input types are `text`, `textarea`, `number`, and `checkbox`.
- `clearThingSlotWhenPresent: true` tells create/update/generation paths to clear the built-in `Thing.slot` equipment field when this registered field has a meaningful value. Attachment-style mods use this so special item systems do not accidentally expose normal gear equip controls.
- Registered item XML tags cannot reuse built-in item XML tags such as `slot`, `rarity`, `attributeBonuses`, or `containerContents`.

## Thing Image Badges
- Mods can call `scope.registerThingImageBadge({ id, fieldName, fieldValue, label, iconUrl, imageUrl, renderMode, position, order })` to add a small overlay badge to item/scenery images when the named Thing field is present.
- `fieldName` can refer to a first-class registered Thing field or legacy metadata. Empty strings, `N/A`, and `none` do not trigger the badge. `fieldValue` is optional and narrows the match to a specific value.
- Exactly one of `iconUrl` or `imageUrl` is required. URLs must come from `scope.getModAssetUrl(...)`, which serves files from `mods/<mod>/assets` under `/mods/<mod>/assets/...`.
- `renderMode: "mask"` renders the asset as a white CSS mask with a slight glow, which is best for monochrome SVG icons. `renderMode: "image"` renders the asset directly, which supports raster images such as PNG, JPEG, GIF, and WebP. `auto` masks `iconUrl` and renders `imageUrl` directly.
- `assetPathSetting` can point at a namespaced world-profile setting whose string value overrides the registered badge asset path at render time. `labelSetting` can similarly override the badge label from a world-profile setting. Both references should include `namespace`, `key`, and an optional `defaultValue`.
- `position` may be `top-left`, `top-right`, `bottom-left`, or `bottom-right`. Built-in item action badges continue to use the normal bottom-left badge bar.

## Thing Context Actions
- Mods can call `scope.registerThingContextAction({ id, label, fieldName, fieldValue, contexts, order, handler })` to add server-backed entries to item/scenery context menus.
- `fieldName` can refer to a first-class registered Thing field or legacy metadata. Empty strings, `N/A`, and `none` do not trigger the action. `fieldValue` is optional and narrows visibility to a specific value.
- `contexts` is an optional allow-list such as `player-inventory`, `npc-inventory`, or `npc-equipment`. An empty list allows the action anywhere the client renders a Thing context menu.
- The browser posts to `/api/mod-thing-context-actions/:actionId` with the Thing id, UI context, and owner hints. The registry executes the registered handler with `{ action, thing, actor, currentPlayer, context, requestBody, players, things, Globals }`.
- Handlers should throw explicit errors for invalid context, missing owners, incompatible items, or failed operations. The route returns the refreshed Thing and actor payload when available so the client can refresh inventories and profile sections.

## Bundled Generic Helpers
- `modding/ActorAttachmentSystem.js` implements inventory-backed actor attachments. Installed entries store item ids under `actor.modState[namespace].slots[slotName]`; items remain in inventory.
- `modding/ActorActivatableSystem.js` implements learned actor records that can be activated by spending a need-bar resource through a formula.

## Bundled Mods
- `mods/implants` registers the first-class Thing field `implantSlot`, exposes it in generated item XML and the item edit modal, clears normal `Thing.slot` when an implant slot is present, adds `Install implant` / `Uninstall implant` context-menu actions, adds an `Implants` world-profile tab, `equipImplant` / `unequipImplant`, `<implantEquipped>` / `<implantUnequipped>`, actor status sections, inventory sync, attribute bonuses, equipper status effects, and a top-left badge for implant-compatible items. Compatible items require `Thing.implantSlot`; `Thing.slot` remains normal gear only.
- Because item tooltips render stored attribute bonuses and equipper status effects without requiring a normal equipment slot, implant-compatible items expose their mechanical fields in the same tooltip sections as slot-based gear.
- The implants tab has editable `displayLabel`, `itemLabel`, and `badgeImagePath` settings, plus an apply-preset select backed by `mods/implants/presets.yaml`. The default `implants` preset uses item label `Implant` and `microchip.svg`; the `tattoo` preset uses item label `Tattoo Design` and `image.svg`.
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
