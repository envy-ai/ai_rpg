# Modules Mod

`mods/modules` provides socket-style item modules. Equippable base items define configured module slots, module items install into matching open slots, and installed modules contribute their attribute bonuses plus target/equipper status effects through the equipped base item.

## World Profile Settings
- The `Modules` world-profile tab has an `applyPreset` action plus editable `displayLabel`, `itemLabel`, and `slotTypes`.
- `slotTypes` is a positive row-edited list of `{ id, label, description }`. Slot type ids start with a letter and contain only letters, numbers, underscores, or hyphens; ids are unique case-insensitively.
- Labels default to the id, descriptions default to an empty string, and blank/null settings resolve to the default module slot type.
- Presets live in `mods/modules/presets.yaml`: Module, Crystal, Mod, and Materia. The `modules` preset id is the required default used during mod registration, so it must remain present.

## Thing Fields And Validation
- `moduleSlots`: array of slot entries on equippable base items. Each entry requires `{ "type": "configured-slot-type" }`; an optional string `label` is display-only. When no label is present, display code uses the configured slot-type label or the raw type id.
- `moduleType`: configured slot type for installable module items. Blank strings, `N/A`, `none`, and `null` are treated as not-a-module values.
- `installedModuleIds`: non-empty unique installed module Thing ids on a base item.
- `moduleInstalledOnItemId`: backlink from an installed module item to its base item.

These fields are registered first-class Thing extension fields, serialize at top level, and are available through `Thing.getExtensionField(...)` / `Thing.setExtensionField(...)`. They are exposed to item XML prompts/parsing, `createThing`, `updateObjectFields`, and the item editor. Prompt/tool descriptions list the active configured slot types. `moduleSlots` supplies a structured `createThing` schema requiring only the `type` key and uses nested XML exclusively:

```xml
<moduleSlots>
  <moduleSlot>
    <type>module</type>
    <label>Optional display label</label>
  </moduleSlot>
</moduleSlots>
```

`<type>` is required, `<label>` is optional, and an empty `<moduleSlots>` means `[]`. Text containing JSON or any unexpected child structure fails ordinary XML structural validation; there is no legacy JSON-text compatibility branch.

Validation rejects module slots on non-item or non-equippable Things, unknown slot types, malformed slot entries, malformed installed-id arrays, duplicate installed ids, and module items that also define module slots. Install/remove operations reject missing owners, missing stable ids, self-installation, equipped module items, already-installed modules, wrong requested slot types, full slots, missing inventory/location ownership, stale installed-module references, and legacy stacked base items that already carry installed-module links.

The `installedModuleIds` registered field validates every entry at the Thing persistence boundary. Non-string, blank, and duplicate ids therefore fail during Thing construction, save hydration, or field updates instead of remaining latent until a base-context prompt tries to render the item.

The mod also registers `ItemModuleSystem.validateItemModuleFields(...)` as a whole-Thing validator. The validator resolves slot types through the same active-setting accessor used by prompts and tools, so validation follows the setting's configured module vocabulary. Candidate creation, update, alteration, and recreation therefore reject contradictory module state before commit. Save hydration runs the same validator as a read-only audit and warns about invalid legacy records without repairing them.

## Prompt, Tool, And Event Hooks
- The mod registers a dynamic item-generation prompt instruction. Item-generation prompts count persisted Things with non-empty `moduleSlots` as modular items and persisted Things with a meaningful `moduleType` as module items, including installed modules because they remain real Things.
- If there are fewer than two module items per modular item, the prompt receives guidance naming the current gap and asking the generator to make at least one generated item use the active module item label, such as `Module`, `Crystal`, `Mod`, or `Materia`.
- Chat tools `installModule({ actorName?, baseItemName, moduleItemName, slotType?, reason? })` and `removeModule({ actorName?, baseItemName?, moduleItemName, reason? })` operate on inventory items by actor name or the current player. They are available in regular prose and generic-prompt tool sets.
- XML events `<moduleInstalled>` and `<moduleRemoved>` perform the same inventory-backed operations during event checks. Their raw payloads are parsed as JSON-shaped registered XML event payloads.
- Thing context actions `modules:install-module` and `modules:remove-module` run through `POST /api/mod-thing-context-actions/:actionId`. Action payloads use `baseItemId`, `moduleItemId`, `slotType`, `baseItemSource`, and `moduleItemSource` to resolve player inventory, NPC inventory, and loose current-location items. The response returns the updated actor (serialized with its fresh inventory), and the client re-renders the open inventory modal in place for that actor — player or NPC — via `refreshAfterModThingContextAction()`, so an installed or removed module is reflected without a manual inventory refresh. (The player inventory view reuses the NPC inventory modal, so both cases share the same re-render path.)
- The base-context contributor exposes the active module labels and slot types under `modContext`. The actor-status contributor exposes installed-module summaries in actor prompt/client status sections.
- A Thing-prompt contributor (`scope.registerThingPromptContributor`) makes every item that is output in full in base context also list the modules installed in it. `ItemModuleSystem.getInstalledModulesPromptXml(baseItem, { resolveThing })` resolves the item's `installedModuleIds` to their module items (by id, so it works in any inventory or location) and returns an `<installedModules>` XML block that `mapItemContext()` embeds as `item.modPromptXml` inside the full `<item>` output. Installed module items remain hidden from standalone inventory listings; they appear only nested inside their base item.

## UI
- Module-compatible base item cards show the `modular.svg` badge in the upper-left image corner with an upper-right occupied/total slot count, such as `1/3`.
- Module item cards show the `module.svg` badge in the upper-left image corner.
- Tooltips and image lightbox details include an `Installed Modules` section. Each installed module row shows a small module icon to the left of the module name, and includes slot type, attribute bonuses, target effects, and equipper effects when present.
- The World Profiles page renders `slotTypes` with the modules row editor. The item editor renders module-specific controls for module slots and module type; setting a module type clears editable module slots for that item, and non-equippable items save with no module slots.
- Clicking the module-compatible badge opens the module workbench. The workbench filters the inventory column to loose modules from the owner inventory plus loose current-location items, tracks each module source internally, greys out modules that fit no open slot on the selected base item, highlights only compatible slots during drag, and supports installing modules into slots or removing installed modules.
- Occupied workbench slots show the installed module thumbnail with contained scaling so the full module image remains visible inside the small slot preview.
- Loose module item cards can also be dropped directly onto compatible modular item cards with a valid open slot. Valid modular card targets highlight during drag, and the drop uses the same install action as the workbench. Direct card drops require a single loose module item; stacked modules are installed through the workbench or context action path where one item can be split from the stack.
- Inventory panels, loose location item panels, the container modal player-inventory side, crafting pickers, barter offer lists, NPC memory prompts, character-alter prompts, and base-context inventory prompt sections hide installed modules as standalone items. The owning base item remains visible and exposes installed module details through its tooltip/lightbox.
- Context menus expose `Install Module` on compatible loose modules and `Remove Module` on base items with installed modules for player inventory, NPC inventory, and loose location items. Install prompts for a compatible base item or module item when more than one candidate exists; remove prompts for the installed module when the base item has more than one module.

## Mechanics
- Attribute bonuses from installed modules contribute through a registry attribute contributor when the base item is equipped.
- Module equipper status effects contribute through a registry status-effect contributor.
- Module target status effects contribute through a Thing target-status-effect contributor during attack handling.
- `ItemModuleSystem.getEffectiveAttributeBonus(...)` returns the base item bonus plus installed-module bonuses. `Player.getModifiedAttribute()` receives only installed-module bonuses for equipped base items through the registry contributor, so normal base-item equipment bonuses continue through the existing gear path.
- Inventory sync removes stale installed-module references when items leave an actor inventory. Direct install/remove mutations preserve actor health ratios when the actor provides `withHealthRatioPreserved(...)`.
- Installed modules remain raw Things held by the same holder as their base item: actor inventory for inventory-held base items, or the loose location item set for location-held base items. Installing across holders transfers the module to the base item's holder before linking it, so saves keep the module record and backlinks intact; display, prompt, and trade surfaces filter installed modules out instead of deleting them.
- Installation always links one module instance to one base-item instance. If the loose module, base item, or both are stacked, one single-count Thing is split from each applicable stack and the two singleton instances are linked. Each original stack remains loose with its count reduced by one; a source whose count was already one is used directly. Every new singleton is registered in the runtime Thing map so it persists in saves.
- Separate and Split Stack reject Things with either side of an installed-module relationship. Modules must be removed first, preventing copied base items from sharing one installed module id or copied modules from retaining one stale base-item backlink.
