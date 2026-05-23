# ModExtensionRegistry

## Purpose
Central registry for mod-provided runtime extension hooks. The server creates one registry, exposes it on `Globals.modExtensionRegistry`, passes it into API/event/prompt contexts, and gives each `mod.js` a namespaced registration wrapper through `ModLoader`.

## Hook Types
- `registerChatTool({ definition, executor, allowedInRegularProse, allowedInGenericPrompt })`: adds a live chat tool. API route filtering combines built-in tools with registry tools at request time, so mods may load after route registration.
- `registerXmlEvent({ tagName, eventKey, promptSchema, parser, handler })`: adds a camelCase XML event tag, parser, prompt-schema entry, and outcome handler. `promptSchema` should be `{ name, description, xml }`; `name` defaults to the tag name when omitted.
- `registerBaseContextContributor(fn)`: contributes generic mod context for base prompts.
- `registerActorStatusContributor(fn)`: contributes actor profile/status sections for prompts and client payloads.
- `registerAttributeModifierContributor(fn)`: contributes numeric attribute bonuses, used by `Player.getModifiedAttribute`.
- `registerStatusEffectContributor(fn)`: contributes continuous actor status effects, used by `Player.getStatusEffects`.
- `registerInventorySyncContributor(fn)`: lets mods remove stale actor mod-state references after inventory replacement/removal.
- `registerSettingTab({ id, label, description, order })`: declares a mod-owned World Profiles editor tab. The id must be safe for DOM data attributes: start with a letter and contain only letters, numbers, `_`, or `-`.
- `registerSettingField({ namespace, key, label, type, defaultValue, description, tabId, normalize })`: declares world-profile mod setting fields. Fields with `tabId` render in that registered mod tab; fields without `tabId` keep rendering in the legacy Prompt Guidance `Mod Settings` block.
- `registerEntityField({ entityType, fieldName, type, defaultValue, description, exposeToCreateTool, exposeToUpdateTool, exposeToGeneratorPrompt, exposeToXmlParser })`: declares a first-class mod-owned entity field. The initial supported entity type is `thing`. Registered Thing fields are persisted at top level by `Thing.toJSON()`, exposed through `thing.getExtensionField(...)` / `thing.setExtensionField(...)`, and installed as direct instance accessors such as `thing.implantSlot`.
- `registerStartupValidator(fn)`: runs after mods and merged definitions load.

## Notes
- Duplicate chat tool names, XML tags, XML event keys, setting tabs, setting fields, and entity fields fail loudly.
- A field that references an unknown setting tab fails during registration.
- Entity fields whose names collide with built-in `Thing` fields fail during registration; fields whose names collide with runtime properties also fail when a Thing is instantiated.
- Chat tools can be allowed separately for regular prose prompts and generic prompts.
- `createThing` and `updateObjectFields` build their Thing-field surfaces from the registry at request/runtime, so fields added by enabled mods are visible without hard-coding them into core tool definitions.
- XML event prompt schema entries are injected into `prompts/_includes/events-xml.njk` through `modEventPromptSchemas`, where the prompt renders each entry's `name`, `description`, and `xml`.
- Registered XML tags are converted to JSON raw payloads before the mod parser runs, so mod parsers can consume object-shaped event data without string-splitting legacy arrows.
