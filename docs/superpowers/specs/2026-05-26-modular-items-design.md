# Modular Items Design Archive

## Status

Implemented as the bundled `mods/modules` mod. This archive preserves the 2026-05-26 design intent and summarizes the current implemented shape; it is not the primary behavior reference.

Use these active docs for day-to-day implementation details:

- `docs/mods/modules.md`
- `docs/classes/ItemModuleSystem.md`
- Related integration notes in `docs/modding.md`, `docs/modding_hooks.md`, `docs/classes/Thing.md`, `docs/api/chat.md`, and `docs/api/things.md`

Sections below marked "Current" describe implemented behavior. Sections marked "Design intent" describe the durable rationale behind the original proposal.

## Goal

Current: item Things can expose configurable module slots, separate item Things can be installed into matching slots, and installed modules contribute mechanical bonuses through the base item while remaining persisted Things.

Design intent: the feature should support setting-specific terminology such as modules, crystals, mods, or materia without changing the underlying data model. Invalid module state should fail loudly during direct mutations instead of being hidden by broad fallback logic.

## Terminology And Settings

Current: the default terminology is:

- Display label: `Modules`
- Installable item label: `Module`
- Default slot type id: `module`

The `Modules` World Profiles tab provides an `applyPreset` action plus editable `displayLabel`, `itemLabel`, and `slotTypes` settings. Presets live in `mods/modules/presets.yaml` and currently include Modules, Crystals, Mods, and Materia. The `modules` preset id is the required default used during mod registration.

Current slot-type settings:

- `slotTypes` is a positive list of `{ id, label, description }` records.
- `id` is required, starts with a letter, and contains only letters, numbers, underscores, or hyphens.
- Duplicate ids are rejected case-insensitively.
- `label` defaults to the id.
- `description` defaults to an empty string.
- Blank, null, or missing settings resolve to the default module slot type; an explicit empty array or malformed entry throws a clear error.

## Data Model

Current: the mod registers first-class Thing extension fields under its module namespace. They serialize at the top level of Thing JSON and are available through normal Thing extension-field accessors.

- `moduleSlots`: array on equippable base items. Each entry requires `{ "type": "configured-slot-type" }`; an optional string `label` may be present as display text. When no slot label exists, display code uses the configured slot-type label or the raw type id.
- `moduleType`: configured slot type for installable module items. Blank strings, `N/A`, `none`, and `null` are treated as not-a-module values.
- `installedModuleIds`: array of installed module Thing ids on a base item. Meaningful arrays must contain non-empty unique strings.
- `moduleInstalledOnItemId`: backlink from an installed module item to its base item.

These fields are exposed to item XML prompts/parsing, `createThing`, `updateObjectFields`, and the item editor. Dynamic field descriptions list the active configured slot types. The structured `createThing` schema for `moduleSlots` accepts only the `type` key, even though persisted or XML-parsed slot entries may include the optional display-only `label`.

Design intent: installed modules remain normal Things rather than being copied into derived base-item data. The relationship is explicit and bidirectional so saves can preserve both the base item and the installed module record.

## Validation And Ownership

Current validation rules:

- Only item Things may have module slots or a module type.
- Only equippable items with a meaningful normal equipment `slot` may have module slots.
- Module items cannot also define module slots.
- Every module slot and module type must match a configured slot type.
- Installed-module id arrays must be arrays of unique non-empty strings.
- Direct install/remove operations reject missing owners, missing stable ids, self-installation, equipped module items, already-installed modules, wrong requested slot types, full slots, stale installed references, and malformed state.

Current ownership behavior:

- Chat tools operate on actor inventories by actor name or the current player.
- Thing context actions support player inventory, NPC inventory, and loose current-location items.
- Installed module Things are stored in the same raw holder as the base item: actor inventory for inventory-held base items, or the loose location item set for location-held base items.
- Installing across holders transfers the module to the base item's holder before linking it.
- Installing a stacked module splits off one single-count module Thing and installs that copy; the remaining stack count is reduced by one.
- Inventory sync removes stale installed ids and backlinks after inventory replacement or removal. Direct install/remove paths still fail loudly for invalid state.

## Prompt, Tool, And Event Integration

Current prompt integration:

- Registered field descriptions and XML placeholders include active slot-type options.
- Item-generation prompts count persisted modular items and module items, including installed modules because they remain real Things.
- When there are fewer than two module items per modular item, item generation receives guidance asking for at least one generated item to use the active module item label.
- Base-context contribution exposes active module labels and slot types under mod context.
- Actor-status contribution exposes installed-module summaries in prompt/client status sections.

Current chat tools:

- `installModule({ actorName?, baseItemName, moduleItemName, slotType?, reason? })`
- `removeModule({ actorName?, baseItemName?, moduleItemName, reason? })`

Current XML events:

- `<moduleInstalled><actorName>optional</actorName><baseItemName>base item</baseItemName><moduleItemName>module item</moduleItemName><slotType>optional</slotType><reason>why</reason></moduleInstalled>`
- `<moduleRemoved><actorName>optional</actorName><baseItemName>optional base item</baseItemName><moduleItemName>module item</moduleItemName><reason>why</reason></moduleRemoved>`

The XML handlers use the registered XML event pipeline and parse their raw payloads through `ItemModuleSystem.parseXmlRaw(...)`.

## Mechanics

Current: module effects are additive and do not mutate the base item's stored mechanics.

- Attribute bonuses from installed modules contribute only while the base item is equipped.
- Equipper status effects from installed modules contribute only while the base item is equipped.
- Target status effects from installed modules contribute during attack handling for the attacking base item.
- `ItemModuleSystem.getEffectiveAttributeBonus(...)` returns the base item bonus plus installed-module bonuses.
- `Player.getModifiedAttribute()` receives only installed-module bonuses through the registry contributor; ordinary base-item equipment bonuses continue through the existing gear path.

Design intent: module mechanics should stay isolated behind mod extension hooks instead of requiring special-case module logic throughout core player and combat code.

## User Interface

Current World Profiles behavior:

- The `Modules` tab edits terminology and slot types.
- Slot-type rows can add, remove, and edit id, label, and description values.
- Invalid slot-type lists fail in the UI and again through server-side normalization if reached.

Current item editor behavior:

- Equippable item forms render module slot controls.
- Non-equippable items save with no module slots.
- Module item forms render a module type control.
- Setting a module type clears editable module slots for that item.

Current item card and detail behavior:

- Modular base item cards show `modular.svg` in the upper-left image corner and an occupied/total slot count, such as `1/3`.
- Module item cards show `module.svg` in the upper-left image corner.
- Base item cards intentionally do not render installed module strips.
- Tooltips and image lightbox details include an installed-modules section with a small module icon, slot type, attribute bonuses, target effects, and equipper effects when present.
- Inventory panels, loose location item panels, container player-inventory views, crafting pickers, barter offer lists, NPC memory prompts, character-alter prompts, and base-context inventory prompt sections hide installed modules as standalone items while keeping the base item visible.

Current install/remove UI behavior:

- Clicking the modular badge opens the module workbench.
- The workbench can source loose modules from the owner inventory plus loose current-location items, tracks each module source, greys out modules that do not fit an open slot, highlights compatible slots during drag, and supports installing or removing modules.
- Loose module item cards can be dropped directly onto compatible modular item cards when the module is a single loose item and a matching slot is open.
- Stacked modules install through the workbench or context-action path, where one item can be split from the stack.
- Context menus expose `Install Module` and `Remove Module` for player inventory, NPC inventory, and loose location items. When multiple candidates exist, the UI prompts for the base item or installed module.

## Code Boundaries

Current primary files:

- `mods/modules/mod.js`: mod registration, settings, fields, badges, context actions, chat tools, XML events, contributors, and generation/base-context hooks.
- `mods/modules/ItemModuleSystem.js`: slot-type normalization, validation, install/remove/list/sync behavior, stack splitting, and effective-mechanics helpers.
- `mods/modules/presets.yaml`: terminology presets.
- `mods/modules/assets/module.svg` and `mods/modules/assets/modular.svg`: item image badges.
- `mods/modules/public/js/modules-ui.js`: small browser bridge for module context-action picker behavior.
- `mods/modules/public/css/modules.scss` and compiled `modules.css`: namespaced module UI styles.
- `views/index.njk`: core-rendered item editor, card, workbench, tooltip/lightbox, and drag/drop integration points used by the modules UI.

Design intent: keep module-specific behavior in the mod where possible, and use shared registry hooks or existing core UI extension points when core-rendered surfaces need to participate.

## Verification Anchors

Current focused coverage lives in:

- `tests/item_module_system.test.js`
- `tests/modules_mod_registration.test.js`
- `tests/modules_prompt_schema.test.js`
- `tests/modules_ui_source.test.js`

These tests cover the core helper, mod registration, dynamic prompt/schema behavior, and source-level UI integration for the implemented modules mod.
