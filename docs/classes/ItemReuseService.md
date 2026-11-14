# ItemReuseService

## Nested staged generation

`session.resolve(request)` accepts an optional `request.withNestedPrompt(callback)` capability from its staged caller. Location TinyBrain parsing forwards its parse-context helper through roster resolution. Only a missing family's authoring wait runs inside it; cached families retain the same uninterrupted ownership. The authoring promise is created inside the owned callback so cancellation before entering cannot launch a replacement request. Shared in-flight authoring waits use the same scope. Nested authoring inherits the staged caller's native reservation and cassette permit, retaining its optional all-model slot; different targets hand off the single model lease. Terminal cancellation remains explicit and configured independent capacity remains usable.

## Purpose and flow

Standard-item families preserve a canonical design for each allowed rarity. Their raw attribute bonuses are materialized by the ordinary caller's existing level and rarity calculations. Observed catalogue snapshots are never automatically promoted into standard templates, since older snapshots may not contain original unscaled bonuses.

A per-operation session resolves named item requests. Known compatible variants return their original parsed item data without a full generation completion. An unknown name uses one logged XML family-authoring completion to decide whether it is standard and, if so, author every rarity from its minimum through maximum in one response. A nonstandard result continues through the ordinary generation path. Only the requested rarity and quantity become live items; the other variants remain definitions.

The family authoring prompt uses the caller's effective metadata-label profile, retry budget, inventory timeout scale and world-generation token budget. It includes the ordinary item/mod fields and generation instructions, exposes no native tools, and sends rejected XML and precise parser/domain errors through the existing bounded correction conversation. All variants validate before any family can be saved.

The fixed requested family name is forwarded to mod instruction providers, so world-wide module-count guidance is omitted for this single-name authoring task. Open item rosters retain that guidance. Shared item XML rules give numeric charge, mode-specific ammo, valid duration and module-slot examples. The shared item parser can report independent charge, effect and parsed mod-invariant errors from one family variant, plus errors in sibling variants, in one bounded correction attempt; no invalid variant is committed.

## Session contract

`new ItemReuseService({ catalogue, authorFamily, prepareVariant, rarityDefinitions })` accepts engine adapters. `authorFamily(request)` returns a proposed `{ name, minimumRarity, maximumRarity, variants }` or null for a nonstandard item. Variants are complete parsed item records with raw `attributeBonuses`.

`createSession()` returns:

- `resolve({ name, rarity, itemOrScenery, description, count, relativeLevel, seed })`: returns a detached raw item or null. The outer description is a planning hint; `seed` contains explicit hard constraints. Count, relative level and hidden discovery are per-instance values. Other incompatible populated seed fields bypass reuse rather than overriding the requested mechanics. Free-form seed notes also use ordinary generation.
- `getPromptFamilies()`: compact family identities and allowed rarity choices for roster planning.
- `assertCurrent()`: check the game epoch and pending family compatibility immediately before live commit.
- `commit()`: persist the validated pending families after successful item placement and name validation.

Matching is case-insensitive by exact canonical name. Multiple matching families reject instead of choosing arbitrary mechanics. Requesting a known standard item outside its allowed rarity range rejects with the allowed alternatives. Equal numeric value/weight constraints compare numerically; explicit zero remains meaningful. Unknown requested rarities reject.

Concurrent equivalent authoring requests share one promise. The key excludes per-instance quantities, levels and discovery state while retaining hard definition constraints. World reset/load invalidates in-flight sessions. No session may commit its families into a different game.

## Native integration

`server.js` owns `createItemReuseSession`, the logged XML authoring adapter and `markItemReuseProvenance`.

Named single-item generation resolves reuse before its full completion. Inventory/barter, container contents and standard/TinyBrain location generation first choose a compact roster, then expand only unresolved items; see [ItemBatchGenerationPlan](ItemBatchGenerationPlan.md). Existing count, placement, mod validation and level/bonus calculations remain authoritative. Anonymous single-item requests, explicit complete item edits and crafting outcome authoring retain their normal generation contracts. This subsystem grants no recipe knowledge and never bypasses crafting checks.

Copied grants receive fresh grant IDs and unbound item sources, then native Thing commit binds them to each new item. Permanent intrinsic statuses and complete target/equipper effects survive materialization. `Thing.fromJSON` explicitly preserves original unscaled bonuses. Instance ownership, container contents and installed-module relationships are never inherited from observed copies.

Internal provenance stores a family name and SHA-256 fingerprint of canonical mechanics. The duplicate-name generator exempts only unchanged canonical copies, so ordinary standard items may share their name without another LLM call. Renaming or changing their mechanics invalidates the exemption. These presentation/provenance fields are excluded from stack checksums.

Charge-bearing family XML is parsed as a complete item, then normalized into a template without current `chargePool.amount`. `initialAmount` is required explicitly for every charged family variant. Internal revalidation accepts this normalized template; candidate materialization restores `amount` from `initialAmount` before whole-Thing validation. A fresh charged copy always requires count 1. Current charge from an observed item never becomes the family's default.

## Focused family prompt context

The family adapter explicitly selects `contextPolicy: 'item-family'` in the
shared base wrapper, independently of `prompt_uses_caching`. It retains the
canonical complete setting, shared and scene mod contributions, rarity rules,
attribute descriptions, equipment slots, ordinary item/mod XML instructions and
validation. Its focused task context supplies the owner identity/profile, target
region/location (including stub/blueprint descriptions), caller-provided
additional lore/item/ability context, caller lore entries and lore matched to the
requested item, explicit seed and owner/scene. Request constraints remain nested
XML, including explicit zero/false values.

With caching enabled, the ordinary stable-context message boundary follows the
family's setting/shared mod/rarity/attribute/equipment reference blocks and
precedes scene mod contributions, owner/location/region and lore. This preserves
the native optional Strata prefix hint for the focused cohort without pinning
changing owner or scene facts.

The focused context omits absent, null, empty and whitespace-only optional
`additionalLore`, `itemContext` and `abilityContext` elements. Populated values
must be strings; invalid types fail with the named field instead of being
silently stringified or discarded. The owner's finite numeric `level` is
explicitly serialized as XML text, including zero, while other text fields
still pass the strict `xmlText` filter. A deterministic item-family prompt
render/parse failure preserves its cause and exits the caller's staged or
standard parse loop immediately; it is not model-response feedback.

Unrelated player/party detail, world/NPC indexes, story history, trackers,
plot/tonal reviews and current needs/weather are omitted. The adapter uses the
native synchronous base builder when no caller base context is supplied, avoiding
an unused background memory-selection prompt. Supplied base contexts remain
available to mod instruction providers. Standard and TinyBrain roster resolution
share this adapter, correction rules and logged output.
