# Modular Items Implementation Archive

## Status

Implemented. This file preserves the 2026-05-26 implementation plan for the bundled `modules` mod while pointing at the current code and docs shape. The active user-facing references are `docs/mods/modules.md` and `docs/classes/ItemModuleSystem.md`; the original design remains in `docs/superpowers/specs/2026-05-26-modular-items-design.md`.

## Original Goal

Implement the `modules` bundled mod from `docs/superpowers/specs/2026-05-26-modular-items-design.md` without using git. The mod lets equippable item Things expose configurable module slots, lets item Things act as installable modules, and contributes installed modules' bonuses and status effects through the equipped base item instead of mutating the base item's stored mechanics.

## Historical Constraints

- Write failing tests before production changes.
- Do not use git commands.
- Prefer explicit errors for invalid module data and invalid installs.
- Persist module fields as registered Thing extension fields.
- Keep module UI and assets namespaced under the mod where possible; use shared UI hooks/styles only where core-rendered surfaces require them.
- Compile any changed SCSS output before finishing.

## Completed Implementation Structure

1. Test coverage for `ItemModuleSystem` and mod registration.
   - `tests/item_module_system.test.js` covers slot-type normalization, item-field validation, install/remove backlink mutation, stack splitting, wrong-type failures, ownership failures, attribute bonuses, equipper effects, and target-effect contributions.
   - `tests/modules_mod_registration.test.js` covers settings, Thing fields, badges, context actions, chat tools, XML events, contributors, presets, dynamic `createThing` schema, loose-location installs, location-held base items, and removing modules from loose location items.
   - `tests/modules_prompt_schema.test.js` covers dynamic registered-field descriptions for configured slot types.
   - `tests/modules_ui_source.test.js` covers the World Profiles row editor, item editor controls, tooltip/lightbox module details, context-action payloads, standalone installed-module filtering, namespaced mod assets/styles, workbench drag-install/removal, loose-location sources, and occupied/total badge counts.

2. `mods/modules/ItemModuleSystem.js`.
   - Normalizes configured slot types and validates module fields against the active world-profile settings.
   - Resolves actor inventory items by id/name and validates base/module item rules.
   - Installs, removes, lists, and syncs module references through `installedModuleIds` and `moduleInstalledOnItemId`.
   - Splits one item from stacked module Things before installation when needed.
   - Exposes installed-module contributions through `getEffectiveAttributeBonus(...)`, `getAttributeModifierContributions(...)`, `getStatusEffectContributions(...)`, and `getTargetStatusEffectContributions(...)`. Normal base-item attribute/status behavior remains on the existing gear and attack paths.

3. Bundled `mods/modules` mod.
   - `mods/modules/mod.js` registers the `Modules` World Profiles tab, setting fields, first-class Thing fields, top-left image badges, context actions, chat tools, XML events, base-context data, item-generation guidance, inventory sync, actor-status, attribute, equipper-status, and attack target-status contributors.
   - `mods/modules/presets.yaml` provides Module, Crystal, Mod, and Materia terminology presets.
   - `mods/modules/assets/module.svg` marks installable module items; `mods/modules/assets/modular.svg` marks compatible base items.
   - `mods/modules/public/js/modules-ui.js` and `mods/modules/public/css/modules.scss` provide mod-local UI behavior and styling where core-rendered surfaces can load mod assets cleanly.

4. Core integration points.
   - `ModExtensionRegistry` and `ModLoader` support Thing target-status-effect contributors, dynamic registered-field descriptions, structured registered-field tool schemas, setting tabs/fields, image badges, context actions, and inventory sync contributors.
   - Attack handling includes installed module target effects for the attacking base item. `Player` attribute/status calculations include installed-module contributions only while the base item is equipped.
   - Item XML prompts, `createThing`, `updateObjectFields`, and the item editor expose configured module slot-type guidance through registered Thing fields.
   - Base-context inventory, NPC memory prompts, character-alter prompts, container views, crafting pickers, barter offer lists, inventory panels, and loose location item panels hide installed modules as standalone items while preserving their Thing records.

5. UI behavior.
   - World Profiles renders a positive row-edited `slotTypes` list.
   - The item editor renders module slot/type controls using the configured slot types; module items cannot also retain editable module slots.
   - Base item cards show `modular.svg` with occupied/total slot text, module item cards show `module.svg`, and installed module strips are intentionally omitted from cards.
   - Tooltips and image lightboxes render installed-module details with a small module icon, slot type, attribute bonuses, target effects, and equipper effects.
   - The module workbench opens from the modular badge, supports drag/drop install and removal, can source loose modules from inventory or the current location, and greys out modules that cannot fit an open slot.
   - Context menus expose install/remove actions for player inventory, NPC inventory, and loose location items. The action payload includes base/module ids, slot type, and source metadata.

6. Current documentation anchors.
   - `docs/mods/modules.md` is the main behavior reference for settings, fields, validation, prompt/tool/event hooks, UI, mechanics, stack splitting, and installed-module persistence.
   - `docs/classes/ItemModuleSystem.md` documents helper methods and failure modes.
   - Related integration notes live in `docs/modding.md`, `docs/modding_hooks.md`, `docs/classes/Thing.md`, `docs/classes/Player.md`, `docs/api/chat.md`, `docs/api/things.md`, `docs/ui/chat_interface.md`, and `docs/ui/assets_styles.md`.

## Verification Targets

- Focused Node tests: `node --test tests/item_module_system.test.js tests/modules_mod_registration.test.js tests/modules_prompt_schema.test.js tests/modules_ui_source.test.js`
- Syntax checks for touched JS during implementation: `node --check` on changed JavaScript files.
- SCSS compilation for any changed SCSS, including `mods/modules/public/css/modules.scss` and shared SCSS when core-rendered module UI styles are touched.
