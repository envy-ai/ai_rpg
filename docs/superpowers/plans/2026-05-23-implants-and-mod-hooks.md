# Mod-Owned Implant and Spell System Hooks Implementation Plan

> Archive note: this is the historical implementation plan for the implant/spell mod hook work. It is retained as a completed-plan reference, not as a pending task list. For current contracts, prefer [`../../modding_hooks.md`](../../modding_hooks.md), [`../../modding.md`](../../modding.md), [`../../classes/ModExtensionRegistry.md`](../../classes/ModExtensionRegistry.md), and [`../../classes/ActorAttachmentSystem.md`](../../classes/ActorAttachmentSystem.md).

**Historical goal:** Add generic mod hooks that let mods define actor-owned systems, then prove the hook surface with two bundled runtime mods: `implants` for inventory-backed body attachments and `spells` for generated mana-consuming abilities.

**Implemented architecture:** Core owns generic extension points and persistence primitives: `ModExtensionRegistry`, namespaced `Player.modState`, namespaced `SettingInfo.modSettings`, first-class registered `Thing` fields, actor status/base-context contributors, chat tools, XML event hooks, mod settings tabs/fields, Thing image badges, and Thing context actions. The bundled mods own their domain names, settings, tools, XML tags, prompt/status output, assets, and mechanics.

**Tech stack:** Node.js CommonJS, Express routes in `api.js`, Nunjucks prompts, server-rendered/browser UI in `views/*.njk`, SCSS in `public/css/*.scss`, and Node test runner coverage.

---

## Key Decisions

- Core hook storage is generic. Mods register tools, XML events, settings, entity fields, context actions, image badges, validators, and contributors through `ModExtensionRegistry`.
- The reusable behavior shipped as helper classes, not auto-registering factories: `modding/ActorAttachmentSystem.js` and `modding/ActorActivatableSystem.js`. Mods instantiate helpers and wire their methods into registry hooks.
- Core does not hard-code implant or spell tool/event names in built-in tool definitions or event schemas. Registered XML schemas and chat tool records are collected live from the registry.
- Actor extension state is persisted in `Player.modState`. The implant mod stores installed item ids under `modState.implants.slots`; the spell mod stores learned records under `modState.spells.records`.
- World-profile mod settings are persisted in `SettingInfo.modSettings`. The implant mod uses `modSettings.implants`; the spell mod uses `modSettings.spells`.
- Installed implants remain inventory-backed `Thing` records. Compatibility is determined by the first-class registered `Thing.implantSlot` field, and `clearThingSlotWhenPresent` keeps those items out of normal gear slots.
- Spells are actor-owned generated records, not inventory Things. They surface through actor status/base prompt context and activate through prose tools/events.
- The spells mod provides a `mana` need-bar defs overlay and a startup validator requiring the `mana` bar. If a world setting points `manaNeedBarId` at a missing bar, activation fails through the actor need-bar helper.
- Spell cost defaults are `{ low: 10, medium: 25, high: 50 }` with formula `baseCost * level`. Formula variables are `level`, `usageRank`, `manaUsage`, and `baseCost`; costs are not clamped.
- Runtime mod enablement is process-local. Missing enablement flags are treated as enabled, but changing enabled mods requires restart before hooks, defs overlays, assets, and validators change.

## Core Hook Changes

- [x] Create `ModExtensionRegistry` and expose one instance through server scope, API routes, event parsing, base-context building, globals, and mod scopes.
- [x] Add registration methods for the shipped hook surface:
  - `registerChatTool(...)`
  - `registerXmlEvent(...)`
  - `registerBaseContextContributor(...)`
  - `registerPlayerActionPromptStep(...)`
  - `registerGenerationPromptInstruction(...)`
  - `registerActorStatusContributor(...)`
  - `registerAttributeModifierContributor(...)`
  - `registerStatusEffectContributor(...)`
  - `registerThingTargetStatusEffectContributor(...)`
  - `registerInventorySyncContributor(...)`
  - `registerSettingTab(...)`
  - `registerSettingField(...)`
  - `registerEntityField(...)`
  - `registerThingImageBadge(...)`
  - `registerThingContextAction(...)`
  - `registerStartupValidator(...)`
- [x] Validate duplicate names loudly for chat tools, XML tags/keys, setting tabs/fields, entity fields, image badges, context actions, prompt steps, and generation instructions.
- [x] Merge built-in chat tools with registry tools at request time, filtered separately for regular prose and generic prompts.
- [x] Map registered XML tags into registered event keys, parsers, prompt schemas, and handlers.
- [x] Render registered XML event schema snippets into `prompts/_includes/events-xml.njk`.
- [x] Run startup validators after mods and merged definitions load. The original reload-time validator idea was superseded by restart-bound mod enablement rather than hot-swapped runtime hooks.
- [x] Add registry actor-status contributors to client/player/NPC payloads and base prompt context through `modStatusSections`.
- [x] Add base-context contributors under `modContext`.
- [x] Run inventory sync contributors after inventory mutation paths so mod-owned references can prune stale item ids.
- [x] Add generic `Player.modState` helpers and persistence:
  - `getModState(namespace)`
  - `setModState(namespace, value)`
  - `updateModState(namespace, updater)`
- [x] Add generic `SettingInfo.modSettings` helpers and persistence:
  - `getModSettings(namespace)`
  - `getModSetting(namespace, key, defaultValue)`
  - `setModSetting(namespace, key, value)`
  - `updateModSettings(namespace, updates)`
- [x] Use existing actor need-bar helpers (`getNeedBarValue`, `setNeedBarValue`) for mod activation logic.
- [x] Populate `scope.modConfig` with file config and schema defaults during `register(scope)`.

## Generic Actor Attachment Helper

- [x] Create `modding/ActorAttachmentSystem.js`.
- [x] Export `ActorAttachmentSystem` as a CommonJS class. The original `createActorAttachmentSystem(...)` factory did not ship.
- [x] Constructor options include:
  - `namespace`
  - `displayLabel`
  - `itemSlotFieldName`
  - `installToolName`
  - `removeToolName`
  - `installEventTag`
  - `removeEventTag`
  - `installEventKey`
  - `removeEventKey`
- [x] The helper provides install, remove, list, inventory sync, attribute modifier, equipper status effect, actor status section, display-label, and XML raw-payload parsing behavior.
- [x] The helper does not register hooks by itself. `mods/implants/mod.js` wires it into context actions, chat tools, XML events, inventory sync, actor status, base context, attributes, and status effects.
- [x] Attachment state lives under `actor.modState[namespace].slots`, with each slot storing an ordered array of `Thing` ids.
- [x] Items resolve from the actor inventory by object/id or exact name. Missing, ambiguous, or out-of-inventory items fail loudly.
- [x] Compatibility requires the configured item slot field, such as `implantSlot`; `Thing.slot` is ignored for attachment compatibility.
- [x] Install/remove mutations preserve health ratio when the actor exposes `withHealthRatioPreserved`.
- [x] Status output is shaped as mod-owned actor status sections, not as core gear.

## Generic Actor Activatable Helper

- [x] Create `modding/ActorActivatableSystem.js`.
- [x] Export `ActorActivatableSystem` as a CommonJS class. The original `createActorActivatableSystem(...)` factory did not ship.
- [x] Constructor options include:
  - `namespace`
  - `displayLabel`
  - `resourceNeedBarId`
  - `usageBaseCosts`
  - `costFormula`
  - `recordLabel`
- [x] Learned entries are stored under `actor.modState[namespace].records`. The original plan's `known` key was not used.
- [x] The helper provides learn, list, find, cost calculation, activation, actor status section, display-label, and XML raw-payload parsing behavior.
- [x] The helper does not render generation prompts or register hooks by itself. `mods/spells/mod.js` owns prompt rendering, `LLMClient.logPrompt(...)`, chat tools, XML events, settings, startup validation, actor status, and base context wiring.
- [x] Formula variables are:
  - `level`
  - `usageRank` (`low` = 1, `medium` = 2, `high` = 3)
  - `manaUsage` as the same numeric value as `usageRank`
  - `baseCost`
- [x] Invalid records, invalid usage values, invalid formulas, missing/invalid resource values, and insufficient resource values fail loudly.
- [x] Computed costs are positive finite numbers and are not clamped.

## Implant Mod

- [x] Add bundled `mods/implants/mod.js`.
- [x] Configure `ActorAttachmentSystem` with:
  - `namespace: "implants"`
  - `itemSlotFieldName: "implantSlot"`
  - `displayLabel` from the active/default preset
  - `installToolName: "equipImplant"`
  - `removeToolName: "unequipImplant"`
  - `installEventTag: "implantEquipped"`
  - `removeEventTag: "implantUnequipped"`
  - `installEventKey: "implant_equipped"`
  - `removeEventKey: "implant_unequipped"`
- [x] Register an `Implants` World Profiles tab and fields under `modSettings.implants`:
  - `displayLabel`
  - `itemLabel`
  - `badgeImagePath`
  - non-persisted `applyPreset`
- [x] Load terminology/badge presets from `mods/implants/presets.yaml`; shipped presets are `implants` and `tattoo`.
- [x] Register `Thing.implantSlot` as a first-class mod entity field and expose it to create/update tools, generation prompts, XML parsing, and the item/scenery edit modal.
- [x] Use `clearThingSlotWhenPresent` so implant-compatible items do not behave as normal gear-slot items.
- [x] Register a top-left implant-compatible Thing image badge with setting-driven asset and label overrides.
- [x] Register `Install implant` and `Uninstall implant` Thing context actions for inventory owners.
- [x] Define `equipImplant` parameters: `actorName` optional, `itemName` required, `implantSlot` optional, `reason` optional.
- [x] Define `unequipImplant` parameters: `actorName` optional, `itemName` required, `reason` optional.
- [x] Define `<implantEquipped>` and `<implantUnequipped>` XML tags with actor/item/slot/reason payloads.
- [x] Keep the mod enabled by default unless disabled by `config.mods.implants.enabled: false` or mod file config; restart is required for enablement changes to affect runtime hooks.

## Spell Mod

- [x] Add bundled `mods/spells/mod.js`.
- [x] Add `mods/spells/defs/need_bars.yaml` with a shared `mana` need bar.
- [x] Add `mods/spells/prompts/spell-generator.xml.njk` for generated spell records.
- [x] Configure `ActorActivatableSystem` with:
  - `namespace: "spells"`
  - `displayLabel: "spells"`
  - `recordLabel: "spell"`
  - `resourceNeedBarId: "mana"`
  - `usageBaseCosts: { low: 10, medium: 25, high: 50 }`
  - `costFormula: "baseCost * level"`
- [x] Register a `Spells` World Profiles tab and fields under `modSettings.spells`:
  - `displayLabel`, default `spells`
  - `manaNeedBarId`, default `mana`
  - `manaUsageBaseCosts`, default `{ low: 10, medium: 25, high: 50 }`
  - `manaCostFormula`, default `baseCost * level`
- [x] Define spell records with:
  - `id` generated when omitted
  - `name`
  - `description`
  - `level`
  - `manaUsage` as `low`, `medium`, or `high`
  - `effectSummary`
- [x] Define `generateSpell` parameters: `actorName` optional, `concept` optional, `level` optional, `manaUsage` optional.
- [x] Define `castSpell` parameters: `actorName` optional, `spellName` required, `reason` optional. The original `targetName` parameter was not implemented.
- [x] `generateSpell` renders the mod prompt, calls `LLMClient.chatCompletion`, logs with `LLMClient.logPrompt(...)`, parses XML, and stores the validated record in `modState.spells.records`.
- [x] `castSpell` resolves a known spell, computes mana cost from settings, verifies sufficient resource value, deducts the exact computed cost, and returns a prose-tool result.
- [x] `<spellLearned>` stores an explicit spell record; `<spellCast>` consumes mana through the same activation path as `castSpell`.
- [x] Keep the mod enabled by default unless disabled by `config.mods.spells.enabled: false` or mod file config; restart is required for enablement changes to affect runtime hooks.

## UI And Prompt Behavior

- [x] Actor mod-status sections render in player/NPC profile surfaces via `modStatusSections`.
- [x] Base prompt context includes actor `modStatusSections` so prose can see installed attachments and learned spells.
- [x] Base prompt context also includes registry `modContext` entries for mod-level context such as labels and item terminology.
- [x] Registered event schema snippets render in `prompts/_includes/events-xml.njk`.
- [x] Normal inventory equipment controls continue to use normal gear data such as `slot`, `metadata.slot`, and `equippedSlot`; tests guard that `implantSlot` does not trigger the normal Equip/Unequip pill.
- [x] Implant-compatible inventory items may show mod-owned affordances: image badges, edit-modal `Implant slot`, and context-menu install/uninstall actions.
- [x] There is no dedicated spell management UI in this plan; spell generation and casting are tool/XML driven, with status display through profile/prompt sections.

## Test Coverage Map

- [x] `tests/mod_extension_hooks.test.js` covers registry duplicate rejection/live lookups, XML registration, bundled implant/spell registration, `Player.modState`, `SettingInfo.modSettings`, attachment install/remove/sync, and activatable learn/cast cost behavior.
- [x] `tests/settings_mod_tabs.test.js` covers mod setting tabs and registered field rendering.
- [x] `tests/mod_entity_field_xml_prompt.test.js`, `tests/chat_tool_create_thing_container.test.js`, `tests/chat_tool_update_character_fields.test.js`, and `tests/api.crafting_registered_thing_fields.test.js` cover registered `Thing.implantSlot` prompt/tool/XML/API surfaces.
- [x] `tests/mod_thing_image_badges_ui.test.js` covers mod Thing image badges, context actions, and edit-field exposure.
- [x] `tests/thing_grid_equipment_pill_ui.test.js` guards against treating `implantSlot` as normal equipment.
- [x] `tests/definition_overlays.test.js` covers definition overlay loading/validation, including mod-provided defs.

## Gotchas

1. Do not add `SettingInfo.implantLabel` or `SettingInfo.spellLabel`; labels belong to registered `modSettings`.
2. Do not add implant- or spell-specific fields/methods to `Player`; use generic `modState` and registry contributors.
3. Helper classes do not register hooks automatically. Mods own registration and can choose which helper methods to expose.
4. Do not reuse `Thing.slot` for implants. `Thing.slot` remains normal gear; `Thing.implantSlot` is a first-class mod field.
5. Tool/event/helper failures should throw explicit errors rather than creating missing placeholder implants/spells.
6. Registry lookups for tool/schema surfaces must stay live at request/render time.
7. Existing saves must load with empty `modState` and `modSettings`.
8. Attribute/status contributors must preserve current gear behavior and only add registered mod contributions.
9. Spell cost formulas must not clamp numeric values; invalid formulas fail, and insufficient mana blocks casting.
10. New generation prompts must be logged with `LLMClient.logPrompt(...)`.

## Acceptance Criteria

- A mod can add an inventory-backed actor attachment system without core code knowing the system's domain name.
- A mod can add generated actor capability records with resource costs, need-bar validation, activation tools, and event hooks.
- The bundled `implants` mod adds install/remove prose tools, XML events, prompt context, actor status output, setting labels, presets, image badges, context actions, and modifier/status behavior through hooks.
- The bundled `spells` mod ensures mana exists, generates learned spell records, computes configurable mana costs from usage/level, consumes mana on cast, and exposes spell status/prompt context through hooks.
- A setting can rename visible mod-owned system labels without changing code or global config.
- Installed implant items remain in inventory and are not managed by normal gear equipment UI.
- Implant and spell state persists in saves, and stale implant references are cleaned up when inventory contents change.
- The same hook set is reusable for later systems such as tattoos, runes, brands, licenses, curses, cyberware, techniques, prayers, or psychic powers.
