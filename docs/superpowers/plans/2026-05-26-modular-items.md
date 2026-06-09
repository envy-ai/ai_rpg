# Modular Items Implementation Plan

## Goal

Implement the `modules` bundled mod from `docs/superpowers/specs/2026-05-26-modular-items-design.md` without using git. The mod lets equippable items expose configurable module slots, lets item Things act as installable modules, and adds installed modules' bonuses/status effects to the equipped base item.

## Constraints

- Write failing tests before production changes.
- Do not use git commands.
- Prefer explicit errors for invalid module data and invalid installs.
- Persist module fields as registered Thing extension fields.
- Keep module UI namespaced under the mod where possible.
- Compile any changed SCSS output before finishing.

## Steps

1. Add tests for `ItemModuleSystem`.
   - Slot-type normalization accepts one or many entries and rejects empty/duplicate/malformed definitions.
   - Item validation rejects module slots on non-equippable items and rejects invalid module types.
   - Install/remove mutates both `installedModuleIds` and `moduleInstalledOnItemId`.
   - Effective bonuses and target/equipper status effects combine base item plus installed modules.

2. Add source/registration tests for the bundled mod.
   - `mods/modules/mod.js` registers settings, Thing fields, context actions, chat tools, XML events, and contributor hooks.
   - Setting presets include Module, Crystal, Mod, and Materia terminology.
   - Chat tool schemas and item XML prompts expose configured slot-type guidance.

3. Add UI/source tests.
   - Settings page has a module slot-type row editor and validates a positive list before save.
   - Item editor has module-specific slot/type controls with configured slot type options.
   - Thing cards omit installed module strips; tooltips/lightboxes render installed module detail sections with module icons beside module names.
   - Context action execution can pass module/base ids selected by a picker.

4. Implement `mods/modules/ItemModuleSystem.js`.
   - Normalize slot types.
   - Resolve actor inventory items by id/name.
   - Validate base/module item rules.
   - Install/remove/list/sync installed module references.
   - Collect effective attribute bonuses, equipper status effects, and target status effects.

5. Implement `mods/modules`.
   - Add `mod.js`, `presets.yaml`, `assets/module.svg`, and namespaced public JS/SCSS/CSS.
   - Register World Profiles settings, fields, badges, context actions, chat tools, XML events, inventory sync, base-context, actor-status, attribute, status-effect, and target-effect hooks.

6. Add core integration points.
   - Add registry support for target-status-effect contributors.
   - Include module target effects during attack status application.
   - Add dynamic registered-field description hooks for chat tool schemas and item XML prompts.
   - Add settings-page array/slot-type editor support.
   - Add play-page helpers that expose installed module resolution and module-specific item edit controls to `modules-ui.js`.

7. Update docs.
   - Add `docs/classes/ItemModuleSystem.md` and `docs/mods/modules.md`.
   - Update modding, hooks, Thing, Player, UI, API, and README docs.

8. Verify.
   - Run focused `node --test` suites for new and touched behavior.
   - Run `node --check` on changed JS files.
   - Compile SCSS.
