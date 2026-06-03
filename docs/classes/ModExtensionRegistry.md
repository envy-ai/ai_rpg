# ModExtensionRegistry

## Purpose
Central registry for mod-provided runtime extension hooks. The server creates one registry, exposes it on `Globals.modExtensionRegistry`, passes it into API/event/prompt contexts, and gives each `mod.js` a namespaced registration wrapper through `ModLoader`.

## Hook Types
- `registerChatTool({ definition, executor, allowedInRegularProse, allowedInGenericPrompt })`: adds a live chat tool. API route filtering combines built-in tools with registry tools at request time, so mods may load after route registration.
- `registerXmlEvent({ tagName, eventKey, promptSchema, parser, handler })`: adds a camelCase XML event tag, parser, prompt-schema entry, and outcome handler. `promptSchema` should be `{ name, description, xml }`; `name` defaults to the tag name when omitted.
- `registerBaseContextContributor(fn)`: contributes generic mod context for base prompts.
- `registerPlayerActionPromptStep({ id, step, text, order })`: adds a mod-owned step to the `player-action` prompt self-correction process. `step` is required and currently accepts only `1` or `3`. The server exposes sorted steps as `modPlayerActionPromptSteps` and numbers them automatically per stage.
- `registerActorStatusContributor(fn)`: contributes actor profile/status sections for prompts and client payloads.
- `registerAttributeModifierContributor(fn)`: contributes numeric attribute bonuses, used by `Player.getModifiedAttribute`.
- `registerStatusEffectContributor(fn)`: contributes continuous actor status effects, used by `Player.getStatusEffects`.
- `registerThingTargetStatusEffectContributor(fn)`: contributes additional target status effects for a specific actor/item pair, used by attack handling for systems such as installed item modules.
- `registerInventorySyncContributor(fn)`: lets mods remove stale actor mod-state references after inventory replacement/removal.
- `registerSettingTab({ id, label, description, order })`: declares a mod-owned World Profiles editor tab. The id must be safe for DOM data attributes: start with a letter and contain only letters, numbers, `_`, or `-`.
- `registerSettingField({ namespace, key, label, type, defaultValue, description, tabId, normalize, options, persist, action })`: declares world-profile mod setting fields. Fields with `tabId` render in that registered mod tab; fields without `tabId` keep rendering in the legacy Prompt Guidance `Mod Settings` block. `type: "select"` fields may provide option metadata, and non-persisted action fields can drive UI-only behavior such as applying a preset to other fields.
- `registerEntityField({ entityType, fieldName, type, defaultValue, description, descriptionProvider, exposeToCreateTool, exposeToUpdateTool, exposeToGeneratorPrompt, exposeToXmlParser, exposeToEditModal, clearThingSlotWhenPresent, edit, xmlPrompt, xmlPromptPlaceholderProvider, toolSchema })`: declares a first-class mod-owned entity field. The initial supported entity type is `thing`. Registered Thing fields are persisted at top level by `Thing.toJSON()`, exposed through `thing.getExtensionField(...)` / `thing.setExtensionField(...)`, and installed as direct instance accessors such as `thing.implantSlot`. Dynamic providers can render active world-profile options into prompt/tool field descriptions. `toolSchema` can override the generated `createThing` JSON schema for structured fields while the dynamic description is still applied.
- `registerThingImageBadge({ id, fieldName, fieldValue, label, iconUrl, imageUrl, renderMode, position, order, assetPathSetting, labelSetting })`: declares a client-rendered item/scenery image overlay. The badge appears when the Thing has a meaningful value for `fieldName`, optionally matching `fieldValue`. Exactly one of `iconUrl` or `imageUrl` is required, and the URL must point at the registering mod's `/mods/<mod>/assets/...` path. `renderMode` supports `auto`, `mask`, and `image`; `position` supports all four image corners. `assetPathSetting` and `labelSetting` can point at namespaced world-profile settings that override the badge asset path and label in the browser.
- `registerThingContextAction({ id, label, fieldName, fieldValue, contexts, order, handler })`: declares a server-backed item/scenery context-menu action. The client receives only metadata; the registry keeps the handler for `/api/mod-thing-context-actions/:actionId`.
- `registerStartupValidator(fn)`: runs after mods and merged definitions load.

## Notes
- Duplicate chat tool names, XML tags, XML event keys, setting tabs, setting fields, entity fields, Thing image badges, Thing context actions, and per-mod player-action prompt step ids fail loudly.
- A field that references an unknown setting tab fails during registration.
- Select setting field options are cloned into registry snapshots. Preset-style options may include a `settings` object whose namespace/key values are copied into other editable mod fields by the Worlds UI after confirmation.
- Non-persisted setting fields are UI controls only; they are rendered, but skipped when the Worlds UI writes `SettingInfo.modSettings`.
- Entity fields whose names collide with built-in `Thing` fields fail during registration; fields whose names collide with runtime properties also fail when a Thing is instantiated.
- Chat tools can be allowed separately for regular prose prompts and generic prompts.
- `createThing` and `updateObjectFields` build their Thing-field surfaces from the registry at request/runtime, so fields added by enabled mods are visible without hard-coding them into core tool definitions. `createThing` uses a field's `toolSchema` when present; otherwise it derives a simple schema from the registered field type.
- Thing entity fields can opt into generated item XML by setting `exposeToGeneratorPrompt: true` and `xmlPrompt.placeholder`. `xmlPrompt.tagName` defaults to the field name. `exposeToXmlParser: true` parses that tag from generated item/scenery XML and writes the value into the first-class field on created Things.
- Thing entity fields can opt into the edit modal with `exposeToEditModal: true`; `edit.inputType` supports `text`, `textarea`, `number`, and `checkbox`.
- `clearThingSlotWhenPresent` is Thing-only. It is used by special equipment-like systems whose compatibility field should never make the item use normal gear slots.
- Registered Thing XML tags fail during registration when they collide with built-in item XML tags.
- Thing image badges are sorted by numeric `order` and then id. Badge asset URLs are validated at registration time so mods cannot point at arbitrary application paths. If a badge uses `assetPathSetting`, the client resolves the configured path under the same registering mod asset root.
- Thing context actions are sorted by numeric `order` and then full id. `fieldName`/`fieldValue` control client visibility, while the server handler performs authoritative validation.
- XML event prompt schema entries are injected into `prompts/_includes/events-xml.njk` through `modEventPromptSchemas`, where the prompt renders each entry's `name`, `description`, and `xml`.
- Registered XML tags are converted to JSON raw payloads before the mod parser runs, so mod parsers can consume object-shaped event data without string-splitting legacy arrows.
- Player-action prompt steps with `step: 1` are rendered after built-in step `1f` and receive labels such as `1g.`, `1h.`, and so on. Steps with `step: 3` are rendered in the GLM repetition-buster editing/pruning sequence after built-in step `3j` and receive labels such as `3k.`, `3l.`, and so on.
