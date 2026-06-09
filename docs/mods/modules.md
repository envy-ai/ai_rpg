# Modules Mod

`mods/modules` adds socket-style item modules. Equippable base items can define module slots, module items can be installed into matching slots, and installed modules add their attribute bonuses plus target/equipper status effects to the base item while it is equipped.

## World Profile Settings
- The `Modules` tab has editable `displayLabel`, `itemLabel`, and `slotTypes`.
- `slotTypes` is a positive row-edited list of `{ id, label, description }`.
- Presets are defined in `mods/modules/presets.yaml`: Module, Crystal, Mod, and Materia. The `modules` preset id is the required default used during mod registration, so it must remain present.

## Thing Fields
- `moduleSlots`: array of slot entries on equippable base items. Each entry is `{ "type": "configured-slot-type" }`; individual slots are not named.
- `moduleType`: configured slot type for module items.
- `installedModuleIds`: installed module Thing ids on a base item.
- `moduleInstalledOnItemId`: backlink from module item to base item.

These fields are registered first-class Thing extension fields and are available in item XML prompts/parsing, `createThing`, `updateObjectFields`, and the item editor. Prompt/tool descriptions list the active configured slot types. `moduleSlots` also supplies a structured `createThing` schema requiring only the `type` key, and seeded array values render into item XML as JSON instead of JavaScript object strings.

## Generation Guidance
- The mod registers a dynamic item-generation prompt instruction. Each item-generation prompt counts persisted Things with non-empty `moduleSlots` as modular items and persisted Things with a meaningful `moduleType` as module items, including installed modules because they remain real Things.
- If there are fewer than two module items per modular item, the prompt receives guidance naming the current gap and asking the generator to make at least one generated item use the active module item label, such as `Module`, `Crystal`, `Mod`, or `Materia`.

## UI
- Module-compatible base item cards show the `modular.svg` badge in the upper-left image corner with an upper-right occupied/total slot count, such as `1/3`.
- Module item cards show the `module.svg` badge in the upper-left image corner.
- Tooltips and image lightbox details include an `Installed Modules` section; each installed module row shows a small module icon to the left of the module name.
- The item editor renders module-specific controls for slots and module type.
- Clicking the module-compatible badge opens the module workbench. The workbench filters the inventory column to loose modules from the owner inventory plus loose current-location items, tracks each module source internally, greys out modules that fit no open slot on the selected base item, highlights only compatible slots during drag, and supports installing modules into slots or removing installed modules.
- Occupied workbench slots show the installed module thumbnail with contained scaling so the full module image remains visible inside the small slot preview.
- Loose module item cards can also be dropped directly onto compatible modular item cards with a valid open slot. Valid modular card targets highlight during drag, and the drop uses the same install action as the workbench.
- Inventory panels, location item panels, crafting pickers, barter offer lists, and base-context inventory prompt sections hide installed modules as standalone items. The owning base item remains visible and exposes installed module details through its tooltip/lightbox.
- Context menus expose `Install Module` on compatible loose modules and `Remove Module` on base items with installed modules for player inventory, NPC inventory, and loose location items. Install prompts for a compatible item when more than one candidate exists; remove prompts for the installed module when the base item has more than one module.

## Mechanics
- Attribute bonuses from installed modules are added through a registry attribute contributor when the base item is equipped.
- Module equipper status effects are added through a registry status-effect contributor.
- Module target status effects are added through a Thing target-status-effect contributor during attack handling.
- Inventory sync removes stale installed-module references when items leave an actor inventory.
- Installed modules remain raw Things held by the same holder as their base item: actor inventory for inventory-held base items, or the loose location item set for location-held base items. Installing across holders transfers the module to the base item's holder before linking it, so saves keep the module record and backlinks intact; display and trade surfaces filter installed modules out instead of deleting them.
- Installing a stacked loose module splits off one single-count module Thing and links that copy to the base item. The remaining stack count is reduced by one and stays in its original holder unless the selected single module copy is transferred to the base item's holder for installation.
