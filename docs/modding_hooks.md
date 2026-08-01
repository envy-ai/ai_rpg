# Modding Hooks

## Overview
Runtime mods register behavior through the shared `ModExtensionRegistry`. `ModLoader` gives each `mod.js` a scoped `register(scope)` object, so registrations are namespaced to the active mod through helpers such as `scope.registerChatTool(...)`, `scope.registerXmlEvent(...)`, and `scope.registerEntityField(...)`.

Registry-backed hooks are process-local. The enabled mod set is fixed at startup; changing mod enablement on disk requires a restart before runtime hooks, defs overlays, static assets, scripts, styles, or validators change.

## Chat Tools
- `scope.registerChatTool({ definition, executor, allowedInRegularProse, allowedInGenericPrompt })` registers a live chat tool.
- `definition.function.name` must be unique and cannot collide with a built-in tool name reserved by the server.
- Tool definitions are collected at request time, filtered separately for regular prose prompts and generic prompts, and executed through the registry record's `executor`.
- Tool executors receive the same runtime context as built-in chat tools. Invalid arguments or incompatible game state should throw clear errors.

## Actor State and Settings
- Actors persist namespaced state in `Player.modState`.
- Use `actor.getModState(namespace)`, `actor.setModState(namespace, value)`, or `actor.updateModState(namespace, updater)`. Saves without mod state read a missing namespace as `{}`.
- `modState` namespaces and namespace values must be objects; invalid or non-serializable values throw.
- World profiles persist namespaced settings in `SettingInfo.modSettings`.
- Use `setting.getModSetting(namespace, key, defaultValue)` for active-world labels, formulas, resource ids, and asset paths.

## World Profile Settings
- `scope.registerSettingTab({ id, label, description, order })` declares a World Profiles editor tab.
- `scope.registerSettingField({ namespace, key, label, type, defaultValue, description, tabId, options, persist, action, normalize })` declares a mod setting field.
- Fields with `tabId` render in the matching mod tab. Fields without `tabId` render in the Prompt Guidance `Mod Settings` block for compatibility with tabless fields.
- The Worlds UI renders `string`, `text`, `number`, `object`, `array`, and `select` fields. Object and array fields use JSON textareas.
- Select `options` use `{ value, label, description? }`. Action options can include namespaced `settings` values and `confirmMessage`.
- Fields default to `persist: true`. Use `persist: false` with `action: "applyPreset"` for a selector that asks for confirmation, copies option `settings` into editable fields, and skips saving the selector value.
- `normalize` must be a function when supplied. The registry stores it in field snapshots for mod-side use; the Worlds UI save path persists rendered values without invoking it.

## Prompt Context and Prompt Instructions
- `scope.registerBaseContextContributor(fn)` contributes arbitrary mod context. The server collects contributor results under `modContext` while building base prompt context.
- `scope.registerPlayerActionPromptStep({ id, step, text, tinyBrainText?, order? })` appends an instruction to `prompts/_includes/player-action.njk`. `tinyBrainText` supplies the smaller instruction used by the staged template and falls back to `text` when omitted.
- Player-action `step` accepts only `1` or `3`. Step `1` entries render after built-in `1f`; step `3` entries render after built-in `3k` in the GLM editing/pruning sequence.
- The `id` is scoped to the registering mod; duplicate ids for the same mod throw. The server assigns labels automatically per stage: step `1` starts at `1g`, and step `3` starts at `3l`.
- `order` is optional. When omitted, registration order is used; when provided, it controls sorting before automatic numbering.
- In `player-action.tinybrain.njk`, each registered step is its own `llmparse('mod_step_<number>')` checkpoint, so phrase `tinyBrainText` as a direct request for an immediate non-empty answer. The answer and any tool results remain available to later prompt steps.
- `scope.registerGenerationPromptInstruction({ id, generationType, generationTypes, text, textProvider, order? })` contributes instructional text to item, location, and/or region generation prompts.
- `generationType` accepts `item`, `location`, or `region`; `generationTypes` accepts a list. Item instructions render in single-item, container-content, inventory, and location item/scenery generation prompts. Location and region instructions render in their respective generator prompts.
- Use `text` for static guidance or `textProvider(context)` for dynamic guidance. Providers receive the prompt-render context plus shared maps such as `things`, and may return an empty string to omit the instruction for that render. Non-string provider results throw.

## XML Events
- `scope.registerXmlEvent({ tagName, eventKey, promptSchema, parser, handler })` registers an event-check XML tag.
- `tagName` is matched case-insensitively during XML parsing. `eventKey` is the structured outcome key used by the parser and handler maps.
- `promptSchema` may be an XML example string or `{ name, description, xml }`. Object schemas require `xml`; `name` defaults to the tag name when omitted.
- Registered schemas render in `prompts/_includes/events-xml.njk` under `modEventPromptSchemas`.
- Direct child XML under the registered tag is converted to an object-shaped JSON raw payload. Repeated child tags become arrays. The registered `parser` receives that raw payload string, and the registered `handler` runs during the normal outcome application pass.
- Unregistered XML tags throw `Unknown event XML tag`. Parser errors fail the XML event-check parse. Handler failures are reported by the event pipeline in the same pass as built-in outcome handler failures.

## Actor Contributors
- `scope.registerActorStatusContributor(fn)` contributes actor profile/status sections. Contributions are exposed as `modStatusSections` in prompt context, `/api/player`, client actor profiles, and detailed `/api/npcs/:id` character status responses.
- Character view detail refreshes preserve existing `modStatusSections` when a partial detail response omits them, so attribute/details refreshes do not erase mod-owned sections from the modal.
- `scope.registerAttributeModifierContributor(fn)` contributes numeric attribute modifiers used by `Player.getModifiedAttribute(...)`.
- `scope.registerStatusEffectContributor(fn)` contributes continuous actor status effects used by `Player.getStatusEffects()`.
- `scope.registerThingTargetStatusEffectContributor(fn)` contributes additional target status effects for an actor/item pair during attack handling. The modules mod uses this for installed module target effects.
- `scope.registerThingPromptContributor(fn)` contributes mod-owned XML embedded inside a Thing's full base-context representation. `fn(thing, context)` receives the resolved Thing and a context (`{ things, Thing, resolveThing }`) and returns an XML string (or `null`/empty to contribute nothing); returning a non-string fails loud. `mapItemContext()` in `prepareBasePromptContext()` collects the fragments (via `ModExtensionRegistry.collectThingPromptContributions`) and exposes them as `item.modPromptXml`, which the full `<item>` blocks in `prompts/base-context.xml.njk` render. The modules mod uses this to list the modules installed in each item whenever that item is output in full. Because module items are resolved by id through `resolveThing`, this works for items in any inventory or location (no actor required).
- `scope.registerInventorySyncContributor(fn)` lets mods clean actor mod state after inventory replacement or removal. `Player` invokes these contributors through the registry inventory-sync path.
- `scope.registerStartupValidator(fn)` runs after mods and merged definitions load. Validator failures are wrapped with the mod name and stop startup.

## Entity Fields
- `scope.registerEntityField(...)` declares first-class mod-owned fields on core entities. Runtime integration currently supports `entityType: "thing"` and `entityType: "player"`.
- Supported field types are `string`, `number`, `integer`, `boolean`, `array`, and `object`.
- Registered Thing fields persist as top-level `Thing` JSON, are available through `thing.getExtensionField(fieldName)` / `thing.setExtensionField(fieldName, value)`, and are installed as direct instance accessors when possible.
- Registered Player fields persist as top-level `Player` JSON, are available through `player.getExtensionField(fieldName)` / `player.setExtensionField(fieldName, value)`, and are installed as direct instance accessors when possible.
- Optional `validateValue(value, context)` runs after core field-type normalization and before a Thing or Player value is persisted by construction, save hydration, or setters. It receives `{ entity, entityType, fieldName }` and should throw a clear error for malformed values.
- `Thing.fromJSON(...)` restores only fields registered in `Globals.modExtensionRegistry` at hydration time. Mods that own Thing fields must register them before save hydration.
- `Player.fromJSON(...)` restores only fields registered in `Globals.modExtensionRegistry` at hydration time. Mods that own Player fields must register them before save hydration.
- Entity field names cannot collide with built-in fields for their entity type or runtime properties, and must be JavaScript-style property names.
- For Thing fields, `exposeToCreateTool` adds the field to the live `createThing` schema and forwards the value into the generator seed. After generation, the runtime writes the value back onto the created Thing so it persists even if the generator omits it.
- `exposeToUpdateTool` lets generic prompts patch the field through `updateObjectFields({ objectType: "thing", fields: { ... } })`.
- For Player fields, `exposeToCreateTool` adds the field to the live `createNpc` schema and forwards it into NPC generation. `exposeToUpdateTool` lets generic prompts patch the field through `updateCharacterFields(...)` or `updateObjectFields({ objectType: "character", fields: { ... } })`.
- `toolSchema` supplies the JSON schema used for that field in `createThing` or `createNpc`. Use it for structured array/object fields that need item shapes, required keys, or `additionalProperties: false`; the registered description or `descriptionProvider` still supplies active prompt text.
- `exposeToGeneratorPrompt` adds the field to the shared generated item XML scaffold, including craft, process, salvage, harvest, inventory, location-thing, container-content, and generic item generation prompts that include `_includes/item.njk`. It requires `xmlPrompt.placeholder`; `xmlPrompt.tagName` defaults to the field name.
- `exposeToXmlParser` reads that XML tag from generated item/scenery output and maps it back onto the registered Thing field. Parser-only fields can omit the placeholder and still use the default tag name.
- For Player fields, `exposeToGeneratorPrompt` adds the field to NPC generation and character-alter XML scaffolds. `exposeToXmlParser` reads the tag back from generated NPC XML and character-alter XML.
- `exposeToEditModal` adds the field to the shared item/scenery edit modal. Use `edit: { label, placeholder, description, inputType, order }` to control the form field. Supported edit input types are `text`, `textarea`, `number`, and `checkbox`.
- For Player fields, `exposeToEditModal` adds the field to a `Mod Fields` section of the character (NPC) edit modal, using the same `edit: { label, placeholder, description, inputType, order }` metadata. Values are read from and written to the registered field (`player.setExtensionField`), round-trip through `PUT /api/npcs/:id`, and appear in NPC payloads serialized for the client. Empty inputs clear the stored value.
- Dynamic `descriptionProvider` and `xmlPromptPlaceholderProvider` callbacks are evaluated when field snapshots are requested. Non-string provider return values throw; `null` and `undefined` keep the registered fallback text.
- `clearThingSlotWhenPresent: true` clears the built-in `Thing.slot` equipment field when the registered field has a meaningful value in create, update, API payload, and generation paths. Attachment-style mods use this so special item systems do not expose normal gear equip controls.
- Registered item XML tags cannot reuse built-in item XML tags such as `slot`, `rarity`, `attributeBonuses`, or `containerContents`.

## Thing Image Badges
- `scope.registerThingImageBadge({ id, fieldName, fieldValue, label, iconUrl, imageUrl, renderMode, position, order, assetPathSetting, labelSetting })` adds a client-rendered overlay badge to item/scenery images.
- `fieldName` can refer to a first-class registered Thing field or legacy metadata. Empty strings, `N/A`, and `none` do not trigger the badge. `fieldValue` is optional and narrows the match to a specific value.
- Exactly one of `iconUrl` or `imageUrl` is required. URLs must come from `scope.getModAssetUrl(...)`, which serves files from `mods/<mod>/assets` under `/mods/<mod>/assets/...`.
- `renderMode: "mask"` renders the asset as a white CSS mask with a slight glow, which is suitable for monochrome SVG icons. `renderMode: "image"` renders the asset directly, which supports raster images such as PNG, JPEG, GIF, and WebP. `auto` masks `iconUrl` and renders `imageUrl` directly.
- `assetPathSetting` can point at a namespaced world-profile setting whose string value overrides the registered badge asset path at render time. `labelSetting` can override the badge label from a world-profile setting. Both references use `namespace`, `key`, and optional `defaultValue`.
- `position` may be `top-left`, `top-right`, `bottom-left`, or `bottom-right`. Built-in item action badges use the normal bottom-left badge bar.

## Thing Context Actions
- `scope.registerThingContextAction({ id, label, fieldName, fieldValue, contexts, order, handler })` adds a server-backed entry to item/scenery context menus.
- `fieldName` can refer to a first-class registered Thing field or legacy metadata. Empty strings, `N/A`, and `none` do not trigger the action. `fieldValue` is optional and narrows visibility to a specific value.
- `contexts` is an optional allow-list such as `player-inventory`, `npc-inventory`, `npc-equipment`, or `location`. An empty list allows the action anywhere the client renders a Thing context menu.
- The browser posts to `/api/mod-thing-context-actions/:actionId` with the Thing id, UI context, and owner hints. The registry executes the registered handler with `{ action, thing, actor, currentPlayer, context, requestBody, players, things, locations, Globals }`.
- Handlers should throw explicit errors for invalid context, missing owners, incompatible items, or failed operations. The route returns the refreshed Thing and actor payload when available so the client can refresh inventories and profile sections.

## Bundled Generic Helpers
- `modding/ActorAttachmentSystem.js` implements inventory-backed actor attachments. Installed entries store item ids under `actor.modState[namespace].slots[slotName]`; items remain in inventory.
- `modding/ActorActivatableSystem.js` implements learned actor records that can be activated by spending a need-bar resource through a formula.

## Bundled Mods
- `mods/implants` registers the first-class Thing field `implantSlot`, exposes it in generated item XML and the item edit modal, clears normal `Thing.slot` when an implant slot is present, adds `Install implant` / `Uninstall implant` context-menu actions, adds an `Implants` world-profile tab, registers `equipImplant` / `unequipImplant`, registers `<implantEquipped>` / `<implantUnequipped>`, contributes actor status sections, inventory sync, attribute bonuses, equipper status effects, base context, and a top-left badge for implant-compatible items. Compatible items require `Thing.implantSlot`; `Thing.slot` remains normal gear only.
- Implant-compatible item tooltips render stored attribute bonuses and equipper status effects without requiring a normal equipment slot, so their mechanical fields appear in the same tooltip sections as slot-based gear.
- The implants tab has editable `displayLabel`, `itemLabel`, and `badgeImagePath` settings, plus an apply-preset select backed by `mods/implants/presets.yaml`. The default `implants` preset uses item label `Implant` and `microchip.svg`; the `tattoo` preset uses item label `Tattoo Design` and `image.svg`.
- `mods/need-bar-lust` is a hybrid need-bar mod. Its defs overlay adds the `sex` / `Sexual Satisfaction` need bar, and its runtime hook registers stage-1 player-action prompt guidance for lust-driven NPC initiative and intimate-scene prose handling.
- `mods/modules` owns `mods/modules/ItemModuleSystem.js` for item-to-item module installation. Base items store installed module ids, module items store a backlink, and installed modules contribute additive attribute/status/target effects while the base item is equipped. The mod registers first-class module fields, item tooltip/lightbox module details with small module icons, `module.svg` installable-module badges, `modular.svg` modular-item badges, `installModule` / `removeModule`, `<moduleInstalled>` / `<moduleRemoved>`, a configurable `Modules` world-profile tab, inventory sync, attribute modifiers, equipper status effects, attack target status effects, item-generation guidance, and base context. The tab's slot-type list is configurable and may contain one or many positive entries.
- `mods/spells` adds a `Spells` world-profile tab, `generateSpell` / `castSpell`, `<spellLearned>` / `<spellCast>`, a mana need-bar overlay through defs, spell actor status sections, base context, a startup validator that requires the `mana` need bar, and per-world spell settings under `modSettings.spells`.

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
