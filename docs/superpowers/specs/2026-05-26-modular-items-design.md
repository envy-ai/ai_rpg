# Modular Items Mod Design

## Goal

Create a bundled `modules` mod that lets equippable items expose configurable module slots, lets item modules be installed into those slots, and applies installed modules' mechanical bonuses in addition to the base item.

## Terminology

The default world-profile terminology is:

- Display label: `Modules`
- Item label: `Module`
- Slot type label: `module`

The mod also supports terminology presets for `Crystal`, `Mod`, and `Materia`. Presets copy label and badge settings into editable world-profile fields, matching the existing implants preset pattern.

## Core Data Model

The mod registers first-class Thing fields under the `modules` namespace:

- `moduleSlots`: array on base items. Each entry is an object with:
  - `type`: configured module slot type.
  - Individual module slots are not named; the configured slot type supplies the display label.
- `moduleType`: string on module items. It must match one configured module slot type.
- `installedModuleIds`: array on base items. Each id points to an installed module Thing.
- `moduleInstalledOnItemId`: string backlink on module items. It points at the base item id.

All fields persist at the top level of Thing JSON through the existing registered entity-field mechanism. The mod also exposes these fields to item XML generation/parsing, `createThing`, `updateObjectFields`, and the item edit modal where appropriate.

## Configurable Slot Types

The `Modules` World Profiles tab includes an editable slot-type list. It must contain at least one entry and may contain any positive number of entries.

Each slot type has:

- `id`: required stable string used in saved item data.
- `label`: optional UI label; defaults to the id.
- `description`: optional prompt/UI guidance.

The default list contains one entry:

```json
[{ "id": "module", "label": "Module", "description": "General-purpose module slot." }]
```

The mod fails loudly when the configured list is empty, not an array, contains blank ids, duplicate ids, or malformed entries. No numeric clamping is introduced.

## Prompt and Field Guidance

Existing registered entity-field descriptions are mostly static, so the mod adds module-specific runtime helpers to render current slot-type options into item generation and edit surfaces.

Generation guidance:

- `moduleSlots` prompt text lists the active configured slot type ids and labels.
- `moduleType` prompt text lists the same options and says to use `N/A` unless the item is a module.
- The prompt explicitly says only equippable items may have module slots.

Tool/edit guidance:

- Item editor controls render configured slot types as selectable options.
- `moduleSlots` can add/remove slot rows and choose a configured type for each row.
- `moduleType` is a select with blank `Not a module` plus configured type options.
- `createThing` and `updateObjectFields` field descriptions include the configured options when the tool schema is assembled for a prompt.

## Validation Rules

The mod validates through shared helpers used by create/edit/generation, context actions, chat tools, and XML event handlers.

Base item rules:

- Only Things with `thingType: "item"` may have module slots.
- Only equippable items with a meaningful normal `slot` may have module slots.
- Non-equippable items must have zero module slots.
- Each `moduleSlots[].type` must match a configured slot type.
- `installedModuleIds` must be an array of existing item ids when mutations are applied.

Module item rules:

- A module item is any item with a meaningful `moduleType`.
- `moduleType` must match a configured slot type.
- A module item must not have module slots.
- A module item must not be stacked when installed.
- A module item must not be equipped through normal gear while installed.

Install rules:

- The base item and module item must exist in the same actor inventory.
- The base item must have at least one unfilled slot of the module's type.
- The module must not already be installed.
- The same module id cannot appear twice on a base item.
- Installing writes both `base.installedModuleIds` and `module.moduleInstalledOnItemId`.

Uninstall rules:

- Removing clears the module id from the base item and clears the module backlink.
- The module remains in inventory.
- Missing ids, stale backlinks, wrong-owner items, and malformed state produce explicit errors unless the operation is a documented sync cleanup.

## Mechanical Effects

Module effects add to the base item. They do not overwrite or mutate the base item's stored `attributeBonuses`, `causeStatusEffectOnTarget`, or `causeStatusEffectOnEquipper`.

Effective item mechanics:

- Attribute bonuses = base item bonuses plus installed module bonuses.
- Equipper status effects = base item equipper effect plus installed module equipper effects.
- Target status effects = base item target effect plus installed module target effects.

Actor mechanics:

- `Player.getModifiedAttribute()` includes module bonuses for equipped base items.
- `Player.getStatusEffects()` includes module equipper status effects for equipped base items.
- These contributions use `ModExtensionRegistry` contributor hooks so the mod remains isolated.

Attack mechanics:

- Attack damage/status handling applies the equipped weapon's base target effect and any installed module target effects.
- The attack result metadata may list multiple applied effects.
- Missing or malformed installed module ids fail loudly during direct install/uninstall, while passive attack/status collection skips stale ids only after inventory sync has removed them.

## User Interface

World Profiles:

- The `Modules` tab edits display terminology, item label, preset selection, and the slot-type list.
- Slot-type rows support add/remove and edit id/label/description.
- Saving an empty or invalid slot-type list fails in the UI before sending and fails again on the server if reached.

Item editor:

- Equippable item forms show a `Module Slots` editor with add/remove slot rows.
- Non-equippable item forms keep the slots editor hidden or disabled and submit an empty list.
- Module item forms show a `Module Type` select.
- When `moduleType` is set, normal equipment slot controls remain available only if the item is not being treated as an installed module. A module item cannot itself have module slots.

Inventory/location cards:

- Base item cards do not render installed module strips; installed module details stay in tooltip/lightbox content.
- Module items show the `module.svg` badge in the upper-left image corner.
- Base items with module slots show the `modular.svg` badge in the upper-left image corner, with occupied/total slot text on the badge.

Tooltip and lightbox:

- Item tooltips include a `Modules` section under the base item details.
- Each installed module row shows a small module icon to the left of the name, plus slot type, attribute bonuses, and target/equipper effects when present.
- The image lightbox reuses the tooltip content, so installed modules appear there automatically.

Context menu actions:

- `Install Module` opens a picker of compatible base items when invoked on a module item.
- `Remove Module` removes an installed module from its base item.
- If a base item has open compatible slots, its menu can also open an install picker listing compatible inventory modules.
- All menu actions call server-backed mod context actions and refresh the affected inventory/profile views.

## Chat Tools and XML Events

The mod registers regular and generic prompt tools:

- `installModule({ actorName?, baseItemName, moduleItemName, slotType?, reason? })`
- `removeModule({ actorName?, baseItemName?, moduleItemName, reason? })`

The mod registers XML events:

- `<moduleInstalled><actorName>optional</actorName><baseItemName>item</baseItemName><moduleItemName>module</moduleItemName><slotType>optional</slotType><reason>why</reason></moduleInstalled>`
- `<moduleRemoved><actorName>optional</actorName><baseItemName>optional</baseItemName><moduleItemName>module</moduleItemName><reason>why</reason></moduleRemoved>`

Both tools and XML handlers resolve actors like implants: omitted actor defaults to the current player, explicit actor names must resolve unambiguously, and all invalid operations throw clear errors.

## Files and Boundaries

New mod files:

- `mods/modules/mod.js`: registration, settings, tools, XML events, context actions, contributors, and base context.
- `mods/modules/presets.yaml`: terminology/badge presets.
- `mods/modules/assets/module.svg`: default badge asset.
- `mods/modules/public/js/modules-ui.js`: module-specific picker and field UI enhancements.
- `mods/modules/public/css/modules.scss` and compiled `modules.css`: namespaced UI styles.

Shared helper:

- `mods/modules/ItemModuleSystem.js`: item-to-item install/remove/list/sync/effective-mechanics helper. It is generic enough to unit test but scoped to this feature.

Core touch points:

- `Player.js`: consume mod attribute/status contributions for module-equipped base items through existing registry hooks.
- `api.js` / `chat_tool_calls.js` / generation paths: dynamic field schema descriptions and validation hooks for module fields.
- `server.js`: item XML prompt/parser support for dynamic module field guidance and multi-effect attack application.
- `views/index.njk`: stable hook points and minimal helpers needed by `modules-ui.js` if existing mod script injection is not enough.
- `public/css/main.scss`: only shared styling primitives if a mod-local stylesheet cannot reach a core-rendered element cleanly.

## Testing

Unit tests:

- Slot-type normalization accepts one or many entries and rejects empty/malformed lists.
- Thing fields persist and round-trip as first-class fields.
- Non-equippable items with module slots fail validation.
- Installing/removing modules updates both base and backlink fields.
- Wrong type, duplicate install, missing owner, installed stacked module, and stale ids fail loudly.
- Effective item mechanics combine base and module bonuses/effects.
- Actor modified attributes and status effects include installed modules only when the base item is equipped.
- Attack status application handles base effect plus installed module effects.
- XML generation/parser tests include configured slot-type options and parsed module fields.
- Chat tool schemas include current slot-type options.

UI/source tests:

- World Profiles renders the module slot-type list editor.
- Item edit modal renders module slot/type controls.
- Thing cards omit installed module strips.
- Tooltip/lightbox source includes installed module sections with module icons beside module names.
- Context menus expose install/remove module actions from registered mod actions.
- SCSS compiles to CSS.

Manual/e2e smoke:

- Enable the mod, configure one slot type, create equippable base item with one slot, create matching module, install it, equip base item, and confirm visible UI plus actor stat/status changes.

## Documentation

Update:

- `docs/modding.md`
- `docs/modding_hooks.md`
- `docs/classes/Thing.md`
- `docs/classes/Player.md`
- `docs/ui/chat_interface.md`
- `docs/ui/assets_styles.md`
- `docs/api/chat.md`
- `docs/api/things.md`
- `docs/README.md`

Create:

- `docs/classes/ItemModuleSystem.md`
- `docs/mods/modules.md`

## Open Implementation Notes

- Do not use git unless explicitly asked.
- Do not manually delete logs.
- Compile any changed SCSS before finishing.
- Prefer explicit exceptions over silent cleanup except for clearly documented inventory sync of stale references.
