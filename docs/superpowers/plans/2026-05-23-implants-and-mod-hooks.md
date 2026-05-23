# Mod-Owned Implant and Spell System Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Repo rule: do not run git commands unless the user explicitly authorizes them.

**Goal:** Add mod hooks that let mods define new actor-owned systems, then ship two bundled mods: `implants` for inventory-backed body attachments and `spells` for generated mana-consuming spells.

**Architecture:** Core provides generic extension points plus optional helper libraries. The bundled mods own their domain systems: storage namespaces, metadata keys, display labels, tools, XML events, prompt/status output, generation prompts, and modifier/resource behavior. Implementing both mods is required so the hook system is proven against two different use cases instead of fitting only implants.

**Tech Stack:** Node.js CommonJS, Express routes in `api.js`, Nunjucks prompts, browser UI in `views/index.njk`, SCSS in `public/css/*.scss`, Node test runner.

---

## Key Decisions

- Use a hybrid hook model: low-level core hooks stay generic, while `modding/ActorAttachmentSystem.js` and `modding/ActorActivatableSystem.js` provide reusable helper behavior for common mod patterns.
- Core must not know about implant slots, implant labels, spell lists, mana costs, `implantSlot`, `equipImplant`, `castSpell`, or related XML tags except through registered mod data.
- Store actor extension state in generic persisted `Player.modState` namespaces. The implant mod uses `modState.implants`; the spell mod uses `modState.spells`.
- Store user-facing mod settings in generic persisted `SettingInfo.modSettings` namespaces. Mods register their own setting fields.
- Installed implants remain inventory-backed and use `metadata.implantSlot`; they never use normal `Thing.slot`.
- Spells are actor-owned generated records, not inventory Things. They are similar to implants in that they are mod-owned actor capabilities surfaced in status/prompt context and activated through prose tools/events.
- The spell mod ensures a `mana` need bar through its own `defs/need_bars.yaml` overlay and a startup/runtime validator that fails loudly if the active merged definitions do not expose the configured mana bar.
- Spell activation consumes mana using a configurable formula with variables from the spell’s `manaUsage` value (`low`, `medium`, `high`) and `level`.
- Do not add inventory UI install/remove controls for implants or direct spell-management UI in v1. Prose tools, XML events, and mod status sections own interaction.
- Registry lookups must be live, because mods load after API route registration.
- Tool/event/helper failures must be explicit; do not create missing placeholder implants/spells or silently ignore invalid activation.

## Core Hook Changes

- [ ] Create `ModExtensionRegistry` and expose one instance through server scope, API routes, event parsing, base context building, and mod scopes.
- [ ] Add registration methods:
  - `registerChatTool({ modName, definition, executor, allowedInRegularProse, allowedInGenericPrompt })`
  - `registerXmlEvent({ modName, tagName, eventKey, promptSchema, parser, handler })`
  - `registerBaseContextContributor({ modName, contributor })`
  - `registerActorStatusContributor({ modName, contributor })`
  - `registerAttributeModifierContributor({ modName, contributor })`
  - `registerStatusEffectContributor({ modName, contributor })`
  - `registerInventorySyncContributor({ modName, contributor })`
  - `registerSettingField({ modName, namespace, key, label, type, defaultValue, normalize })`
  - `registerStartupValidator({ modName, validator })`
- [ ] Validate duplicate names loudly:
  - chat tool function names
  - XML tag names
  - XML event keys
  - setting namespace/key pairs
- [ ] Update chat tool filtering/runtime to merge built-in tools with registry tools at request time.
- [ ] Update XML event parsing so registered XML tags map into registered event keys and handlers.
- [ ] Update event prompt rendering so registered `promptSchema` snippets are included in the events XML schema prompt.
- [ ] Run startup validators after mods load and definition caches reload, and expose a reload-time path so validation also catches broken mod state after `/reload_config`.
- [ ] Update base prompt context and actor serialization so registry contributors can add mod-owned sections without changing core player fields for each new system.
- [ ] Update player inventory removal, clear, and replacement paths to call inventory sync contributors after normal gear sync.
- [ ] Add generic `Player.modState` helpers and persistence:
  - `getModState(namespace)`
  - `setModState(namespace, value)`
  - `updateModState(namespace, updater)`
- [ ] Add generic `SettingInfo.modSettings` helpers and persistence, with settings UI/API support for registered fields.
- [ ] Expose need-bar read/write helpers to mod tool executors through scope, using existing `getNeedBarValue` and `setNeedBarValue` behavior.
- [ ] Fix the `ModLoader.getModConfig()` registration-time issue so `scope.modConfig` includes file config and schema defaults during `register(scope)`.

## Generic Actor Attachment Helper

- [ ] Create `modding/ActorAttachmentSystem.js`.
- [ ] Export `createActorAttachmentSystem(scope, options)` where `options` includes:
  - `namespace`
  - `itemSlotMetadataKey`
  - `displayLabelSettingKey`
  - `defaultDisplayLabel`
  - `installToolName`
  - `removeToolName`
  - `installEventTag`
  - `removeEventTag`
  - `installEventKey`
  - `removeEventKey`
- [ ] The helper registers install/remove chat tools, install/remove XML event tags, actor status/base-context contributors, attribute/status contributors, inventory sync, and a display-label setting field.
- [ ] The helper stores state under `actor.modState[namespace].slots`, with each slot value as an ordered array of Thing IDs.
- [ ] The helper resolves actors and items through existing scope helpers where available, defaults actor to current player when omitted, and requires the item to be in the actor inventory.
- [ ] The helper verifies the item metadata slot key exists and matches any requested slot.
- [ ] The helper preserves health ratio when attachment changes alter max-health-affecting modifiers.
- [ ] The helper produces generic status/base-context output shaped as mod-owned attachment sections, not as core gear.

## Generic Actor Activatable Helper

- [ ] Create `modding/ActorActivatableSystem.js`.
- [ ] Export `createActorActivatableSystem(scope, options)` where `options` includes:
  - `namespace`
  - `entryLabel`
  - `displayLabelSettingKey`
  - `defaultDisplayLabel`
  - `resourceNeedBarSettingKey`
  - `defaultResourceNeedBarId`
  - `usageField`
  - `levelField`
  - `usageBaseValuesSettingKey`
  - `costFormulaSettingKey`
  - `generateToolName`
  - `activateToolName`
  - `learnEventTag`
  - `activateEventTag`
  - `learnEventKey`
  - `activateEventKey`
  - `generatorPromptTemplate`
- [ ] Store generated/known entries under `actor.modState[namespace].known`, as mod-owned JSON records with stable IDs.
- [ ] Register generation and activation chat tools, learn/activate XML events, actor status/base-context contributors, and setting fields for display label, resource need bar id, usage base values, and cost formula.
- [ ] Use the existing formula evaluator with variables:
  - `level`
  - `usageRank` (`low` = 1, `medium` = 2, `high` = 3)
  - `baseCost` from the configured usage base values
  - `manaUsage` as the same numeric value as `usageRank`
- [ ] Fail loudly if a generated entry has an invalid level, invalid usage value, invalid formula result, missing resource bar, or insufficient resource value.
- [ ] Log all generation prompts through `LLMClient.logPrompt()`.
- [ ] Do not clamp computed costs. If the formula returns a finite positive value larger than current mana, activation fails for insufficient mana.

## Implant Mod

- [ ] Add bundled `mods/implants/mod.js`.
- [ ] Configure `ActorAttachmentSystem` with:
  - `namespace: "implants"`
  - `itemSlotMetadataKey: "implantSlot"`
  - `displayLabelSettingKey: "displayLabel"`
  - `defaultDisplayLabel: "implants"`
  - `installToolName: "equipImplant"`
  - `removeToolName: "unequipImplant"`
  - `installEventTag: "implantEquipped"`
  - `removeEventTag: "implantUnequipped"`
  - `installEventKey: "implant_equipped"`
  - `removeEventKey: "implant_unequipped"`
- [ ] Register the implant display-label setting under `modSettings.implants.displayLabel`.
- [ ] Define `equipImplant` parameters: `actorName` optional, `itemName` required, `implantSlot` optional, `reason` optional.
- [ ] Define `unequipImplant` parameters: `actorName` optional, `itemName` required, `reason` optional.
- [ ] Define XML tags with the same actor/item/slot/reason fields as the tools.
- [ ] Keep the mod enabled by default through existing mod discovery rules unless disabled with `config.mods.implants.enabled: false` or `mods/implants/config.json`.

## Spell Mod

- [ ] Add bundled `mods/spells/mod.js`.
- [ ] Add `mods/spells/defs/need_bars.yaml` with a `mana` definition or overlay that guarantees a usable mana bar when the mod is enabled.
- [ ] Add `mods/spells/prompts/spell-generator.xml.njk` for generating spell records.
- [ ] Configure `ActorActivatableSystem` with:
  - `namespace: "spells"`
  - `entryLabel: "spell"`
  - `displayLabelSettingKey: "displayLabel"`
  - `defaultDisplayLabel: "spells"`
  - `resourceNeedBarSettingKey: "manaNeedBarId"`
  - `defaultResourceNeedBarId: "mana"`
  - `usageField: "manaUsage"`
  - `levelField: "level"`
  - `usageBaseValuesSettingKey: "manaUsageBaseCosts"`
  - `costFormulaSettingKey: "manaCostFormula"`
  - `generateToolName: "generateSpell"`
  - `activateToolName: "castSpell"`
  - `learnEventTag: "spellLearned"`
  - `activateEventTag: "spellCast"`
  - `learnEventKey: "spell_learned"`
  - `activateEventKey: "spell_cast"`
  - `generatorPromptTemplate: "spell-generator.xml.njk"`
- [ ] Register spell settings under `modSettings.spells`:
  - `displayLabel`, default `spells`
  - `manaNeedBarId`, default `mana`
  - `manaUsageBaseCosts`, default `{ low: 50, medium: 100, high: 200 }`
  - `manaCostFormula`, default `baseCost * level`
- [ ] Define generated spell records with required fields:
  - `id`
  - `name`
  - `description`
  - `level`
  - `manaUsage` as `low`, `medium`, or `high`
  - `effectSummary`
- [ ] Define `generateSpell` parameters: `actorName` optional, `concept` required, `level` optional, `manaUsage` optional.
- [ ] Define `castSpell` parameters: `actorName` optional, `spellName` required, `targetName` optional, `reason` optional.
- [ ] `generateSpell` stores the validated spell in the actor’s `modState.spells.known`.
- [ ] `castSpell` resolves the known spell, computes mana cost from settings, verifies the actor has enough mana, deducts that mana, and returns a tool result for prose narration.
- [ ] `<spellLearned>` stores a generated or explicit spell record; `<spellCast>` consumes mana through the same activation path as `castSpell`.
- [ ] Keep the mod enabled by default through existing mod discovery rules unless disabled with `config.mods.spells.enabled: false` or `mods/spells/config.json`.

## UI And Prompt Behavior

- [ ] Render actor mod-status sections in player/NPC profile surfaces using contributor labels, so installed implants and known spells appear under their configured labels.
- [ ] Include actor mod-status sections in base prompt context so prose can see installed attachments and known spells.
- [ ] Include registered events schema snippets in `prompts/_includes/events-xml.njk`.
- [ ] Ensure inventory UI equipment controls only respond to normal gear data (`slot`, `metadata.slot`, `equippedSlot`) and do not treat `metadata.implantSlot` as normal equipment.
- [ ] Optionally show implant-compatible inventory items as normal inventory rows/cards with no install/remove button.
- [ ] Do not add a spell management UI in v1; spell generation/casting is prose/tool driven.

## Test Plan

- [ ] Unit test `ModExtensionRegistry` registration, duplicate rejection, live lookups, startup validators, and contributor ordering.
- [ ] Unit test `SettingInfo.modSettings` defaults, persistence, API update behavior, and settings UI rendering for registered fields.
- [ ] Unit test `Player.modState` persistence and old-save defaulting.
- [ ] Unit test inventory sync contributors running after item removal, inventory clear, and inventory replacement.
- [ ] Unit test `ActorAttachmentSystem` install/remove:
  - successful install into metadata slot
  - multiple installed items in one slot
  - duplicate install failure
  - missing actor failure
  - ambiguous item failure
  - item not in actor inventory failure
  - missing metadata slot failure
  - requested slot mismatch failure
  - removal keeps the Thing in inventory
  - inventory sync clears stale Thing IDs
- [ ] Unit test attachment attribute modifiers and equipper status effects.
- [ ] Unit test `ActorActivatableSystem` generation/activation:
  - generated spell validation
  - invalid `manaUsage` failure
  - invalid level failure
  - cost formula using low/medium/high and level
  - invalid formula failure
  - missing mana bar failure
  - insufficient mana failure
  - successful cast deducts exact computed mana
  - cast does not clamp mana/cost values
- [ ] Need-bar overlay test proving `mods/spells/defs/need_bars.yaml` ensures the configured mana bar exists when the spell mod is enabled.
- [ ] Chat tool runtime tests proving `equipImplant`, `unequipImplant`, `generateSpell`, and `castSpell` are available in regular prose and generic prompts through registry tools.
- [ ] XML event tests proving implant and spell event tags parse through registry events and call their helper paths.
- [ ] Two-mod integration test proving implant and spell sections can coexist in actor status/base context without name collisions.
- [ ] UI/static tests proving `metadata.implantSlot` does not render normal Equip/Unequip controls and actor mod-status sections render under configured labels.
- [ ] Run targeted Node tests for changed behavior.
- [ ] Run `node --check` on altered JS files.
- [ ] If SCSS changes, compile the corresponding CSS before finishing.

## Gotchas

1. Do not add `SettingInfo.implantLabel` or `SettingInfo.spellLabel`; labels belong to registered `modSettings`.
2. Do not add implant- or spell-specific fields/methods to `Player`; use generic `modState` and registry contributors.
3. Do not reuse `Thing.slot`; current inventory UI treats it as normal gear.
4. Tool/event handlers must throw explicit errors rather than creating missing placeholder implants/spells.
5. Registry lookups must not be frozen at API registration time.
6. Existing saves must load with empty `modState` and `modSettings`.
7. Attribute/status contributors must preserve current gear behavior and only add registered mod contributions.
8. Spell cost formulas must not clamp numeric values; invalid formulas fail, and insufficient mana blocks casting.
9. All new generation prompts must be logged with `LLMClient.logPrompt()`.

## Acceptance Criteria

- A mod can add a new inventory-backed actor attachment system without core code knowing the system’s domain name.
- A mod can add a generated actor capability system with resource costs, need-bar validation, activation tools, and event hooks.
- The bundled `implants` mod adds install/remove prose tools, XML events, prompt context, actor status output, setting label, and modifier/status behavior through hooks.
- The bundled `spells` mod ensures mana, generates known spell records, computes configurable mana costs from usage/level, consumes mana on cast, and exposes spell status/prompt context through hooks.
- A setting can rename visible mod-owned system labels without changing code or global config.
- Installed implant items remain in inventory but are not managed by inventory equipment UI.
- Implant and spell state persists in saves, and stale implant references are cleaned up when inventory contents change.
- The same hook set is reusable for later systems like tattoos, runes, brands, licenses, curses, cyberware, techniques, prayers, or psychic powers.
