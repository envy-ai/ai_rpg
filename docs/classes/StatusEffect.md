# StatusEffect

## Purpose

`StatusEffect` is the shared value object for temporary, indefinite, and permanent conditions. It stores display text plus optional mechanical modifiers:

- `attributes`: array entries shaped as `{ attribute, modifier }`
- `skills`: array entries shaped as `{ skill, modifier }`
- `needBars`: array entries shaped as `{ name, delta, percentDelta? }`, interpreted as additive per-minute fixed/percentage rates
- `needBarMaximums`: `{ name, percentModifier }` entries changing an active need's authored base capacity by the summed percentage
- `duration`: canonical minute count, `null`, or `-1`
- `appliedAt`: world-time minute stamp used by elapsed-time need/status ticking

The class validates and normalizes the shape. Owner classes decide which fields they preserve, when durations tick, and whether need-bar deltas are applied.

## Canonical Shape

`new StatusEffect({ id, name, description, attributes, skills, needBars, needBarMaximums, maxHealthPercent, techniqueGrants, duration, appliedAt, techniqueProvenance, register })`

Complete NPC alteration and explicit repair XML use
[StatusEffectXml](StatusEffectXml.md). The
[`/repair_status_effects`](../slashcommands/RepairStatusEffectsCommand.md)
maintenance command reviews existing character-owned records through base
context without copying dynamic ability, equipment or mod effects into
intrinsic state.

- `id` is optional. Missing or blank IDs use `IdGenerator.next('status', source)` from the nonempty name, otherwise description, taking its first three words; supplied IDs remain unchanged and reserved.
- `description` is required and must be a non-empty string.
- `name` is optional and trimmed to `''` when missing.
- `attributes` and `skills` must be arrays when present. Each entry must be an object with a non-empty `attribute` or `skill` name and a finite numeric `modifier`.
- `needBars` must be an array when present. Each entry must have a non-empty `name` and at least one populated finite `delta` or `percentDelta`; absent fixed delta normalizes to zero. Empty optional numeric leaves mean omission; explicit zero remains a value. Health percentage rates use effective maximum HP; other needs use authored base range, independent of capacity modifiers. Both components add per world minute.
- `needBarMaximums` must be an array when present. Entries require a non-empty need `name` and finite signed `percentModifier`. Capacity modifiers use the authored base range and retain exact fill percentage without multiplying fixed costs, recovery or baseline drift. Known unavailable need targets disable only the relevant component.
- `appliedAt` may be `null`/omitted or any finite non-negative number. The constructor does not supply an owner timestamp by itself.

All normalizers throw explicit errors on invalid input.

Modifier diagnostics identify the entry index and explain that fixed `modifier` and `percentModifier` may coexist on one identity. Permanent ability attachment magnitudes remain numeric; formula support belongs to technique effect statuses. Existing outer-status modifier duplicate acceptance is unchanged.

## Duration Semantics

`StatusEffect.normalizeDuration(value)` converts accepted inputs to canonical minutes:

- `null`, `undefined`, empty string, `none`, `n/a`, and `na` resolve to `null`.
- `null` means no scheduled expiration or unknown duration; owner tick methods retain it.
- `instant` resolves to `1`.
- `permanent` and `continuous` resolve to `-1`.
- Any negative numeric value or negative bare integer string resolves to `-1`.
- Positive integer numbers and bare integer strings are minute counts. A single leading `+` on an integer or unit-bearing duration preserves its positive value, such as `+3` or `+2 hours`.
- Non-negative numeric inputs must be integers; `2.5` as a number throws.
- Unit-bearing strings are parsed by `Utils.parseDurationToMinutes(...)`. Accepted forms include `HH:MM`, `4 hours`, `15 minutes`, `1 day, 2.5 hours`, `3d4h2m`, `90m`, `30 seconds`, and `1m30s`.
- Unit-bearing decimal quantities and seconds round to the nearest minute. Bare decimal strings without units, such as `2.5`, throw.
- Signed unit strings such as `-10m` are not accepted for status effects; use `permanent` or a negative bare integer for permanent effects.
- `0` means expired. Owner tick methods usually leave the entry at `0` until `clearExpiredStatusEffects()` removes it.

## Instance API

- `update({ name, description, attributes, skills, needBars, duration, appliedAt })`: normalizes provided fields and updates the instance in place. Blank `name` or `description` inputs are ignored.
- `toJSON()`: returns `{ id, name, description, attributes, skills, needBars, duration, appliedAt }`.
- `fromJSON(data)`: validates that `data` is an object and constructs a `StatusEffect`.

## Generation API

`generateFromDescriptions(descriptions, { promptEnv, parseXMLTemplate, prepareBasePromptContext })` expands plain descriptions into structured effects.

- `descriptions` must be a non-empty array of strings or objects with `description`, optional `name`, and optional finite `level`.
- The method renders `base-context.xml.njk` with `promptType: 'status-effect-generate'` and `statusEffectSeeds`.
- It calls `LLMClient.chatCompletion({ metadataLabel: 'status_effect_generate' })`. Its response validator logs each domain-validation attempt and checks the complete candidate batch inside that completion's configured correction budget. XML failures retain the completion client's detailed error logs. Exact errors are sent back as correction feedback; transport failures and cancellation propagate directly.
- The XML response must contain one or more `<effect>` nodes with a unique `<sourceDescription>` and a non-empty `<description>`. Every distinct input description must appear exactly once; unknown source descriptions and omitted seeds reject the response.
- Generated `<duration>` text is normalized through the constructor.
- Generated attribute, skill, and need-bar entries preserve explicit zero modifiers/rates. Missing names or non-finite modifiers/deltas throw.
- The return value is a `Map` keyed by source description with `StatusEffect` instances.

Candidate constructors use `register: false` during validation. Status IDs are allocated only after the entire response passes, so rejected drafts do not consume IDs or apply owner state. A later registration/application failure is outside the correction loop.

Malformed prompt setup, XML parser errors, missing effect nodes, duplicate source descriptions, and invalid mechanics all raise errors.

## Owner Behavior

### Player and NPC

`Player` stores intrinsic effects in private `#statusEffects`. `toJSON()` persists only those intrinsic effects in its status list; owned ability attachments persist on their abilities. `getStatusEffects()` combines intrinsic effects, ability attachments, dynamic equipped-item equipper effects and registered mod status contributions. Only the intrinsic list is writable as the NPC alteration prompt's top-level status state.

`setStatusEffects(...)` replaces intrinsic effects. `addStatusEffect(...)` accepts one effect or an array, gives strings and objects without a duration a default duration of `1`, and replaces an existing intrinsic effect with the same description. `removeStatusEffect(...)` matches exact `name` or exact `description`, case-insensitively.

Player/NPC normalization:

- Accepts strings, `StatusEffect` instances, and objects using `description`, `text`, or `name`.
- Preserves `attributes`, `skills`, `needBars`, `duration`, `appliedAt`, `id`, and `name` when provided.
- Supplies a default `appliedAt` for missing intrinsic effects: player `elapsedTime` for the main player, otherwise `Globals.getTotalWorldMinutes()`, otherwise `0`.
- Sorts intrinsic effects by `name || description` and stores at most 60 entries.

Player mechanics:

- `Player.applyStatusEffectNeedBarsToAll()` uses world minutes to apply baseline need-bar drift, configured health regeneration, and intrinsic status-effect `needBars` once per elapsed minute.
- Health deltas use the special `Health` need bar name; other entries call `setNeedBarValue(...)`.
- Finite intrinsic status durations are decremented by elapsed minutes, capped to the remaining duration, and `appliedAt` is advanced to the processing baseline.
- Missing intrinsic `appliedAt` stamps are initialized without backfilling prior elapsed time.
- `clearExpiredStatusEffects()` removes duration-`0` intrinsic effects.
- Attribute modifiers from intrinsic status effects affect modified attributes and max health. Native need-bar mutation boundaries preserve the current Health fill percentage when a status or attachment changes maximum health; see [Player](Player.md#conditional-need-level-effects-and-capacity).
- `isDisabled` treats exact `Incapacitated` status as disabling even when the actor has positive health.

### Thing

`Thing` has two status-effect surfaces:

- `statusEffects`: effects on the item/scenery itself.
- `causeStatusEffectOnTarget` and `causeStatusEffectOnEquipper`: effect templates applied to a target or exposed to an equipper. `causeStatusEffect` remains a compatibility shape for combined target/equipper payloads.

Thing behavior:

- Target cause effects apply through item ingestion, item infliction, weapon damage application, and consumed crafting/action inputs.
- Equipper cause effects appear in `Player.getStatusEffects()` while the item is equipped.
- `setCauseStatusEffects({ target, equipper, legacy })` normalizes split and compatibility inputs. A cause effect with no target flags defaults to target application.
- Cause effects preserve `attributes`, `skills`, `needBars`, and `duration`.
- The stored `statusEffects` list preserves `attributes`, `skills`, `duration`, `appliedAt`, `id`, and `name`; it does not preserve `needBars`.
- Stored thing status effects sort by `name || description`, cap at 60 entries, tick finite durations with `tickStatusEffects(...)`, and remove duration-`0` entries with `clearExpiredStatusEffects()`.
- Thing status-effect enrichment can call `StatusEffect.generateFromDescriptions(...)` for stored effects and cause effects when prompt infrastructure is available. `Thing.fromJSON(...)` disables enrichment during hydration.

### Location

Locations store status effects as `StatusEffect` instances.

- Strings become one-minute effects.
- Object entries use `description`, `text`, or `name` as description input.
- Location normalization preserves `attributes`, `skills`, `duration`, `appliedAt`, `id`, and `name`; it does not preserve `needBars`.
- Effects sort by `name || description` and cap at 60 entries.
- `addStatusEffect(...)` replaces an existing effect with the same description. `removeStatusEffect(...)` matches description.
- `tickStatusEffects(...)` decrements finite durations, and `clearExpiredStatusEffects()` removes duration-`0` entries.

### Region

Regions store a lightweight plain-object status shape rather than `StatusEffect` instances.

- Strings become `{ id, description, duration: 1 }`.
- Object entries use `description`, `text`, or `name` as the description.
- Region normalization preserves `id`, `description`, normalized `duration`, and optional `appliedAt`.
- Region status effects do not preserve `name`, `attributes`, `skills`, or `needBars`.
- Finite durations tick and duration-`0` entries clear through the same public method names used by locations and things.

## Event, API, UI, and Prompt Surfaces

- `status_effect_change` event outcomes apply generated mechanics for gained effects when generation succeeds; otherwise they apply a simple effect using `Events.DEFAULT_STATUS_DURATION` (`3`). Lost effects call `removeStatusEffect(...)`.
- `item_ingest` and `item_inflict` apply the item's configured target cause effect instead of trusting the prompt's status text, and dedupe same-turn item-triggered gains.
- `death_incapacitation` applies `Deceased` or `Incapacitated` with no scheduled expiration.
- Player, NPC, location, and thing API routes accept `statusEffects` arrays or `null` for clearing where supported.
- Chat tool `updateObjectFields` can patch `statusEffect` records by id/name context and can set `name`, `description`, `attributes`, `skills`, `needBars`, `duration`, or `appliedAt`.
- Base-context prompts expose status-effect `name`, `description`, and `duration`. Item output prompts also expose split target/equipper cause effects with `name`, `description`, and `duration`.
- The UI formats canonical minute durations as natural labels, shows expired/permanent labels for `0`/negative durations, displays item target/equipper effects in tooltips, and shows a portrait health-drain indicator for active negative `Health` need-bar deltas.
- Player and location edit UI rows collect description, duration, attribute modifiers, and skill modifiers. NPC edit rows also collect need-bar deltas.

## Persistence and Compatibility

- `StatusEffect.toJSON()` persists all canonical fields.
- `Player.toJSON()` persists intrinsic status effects only; dynamic equipped-item and mod-contributed effects are derived at read time.
- `Thing.toJSON()` persists stored item/scenery status effects, split target/equipper cause effects, and compatibility `causeStatusEffect` data when representable.
- `Location.toJSON()` and `Region.toJSON()` persist their status-effect lists.
- `Utils.hydrateGameState(...)` compatibility migrations convert hour-based status-effect `duration` and `appliedAt` values to minutes when loading hour-based saves, including nested thing cause-effect payloads and metadata mirrors.
- The same hydration path assigns first-three-name/description-word `status_...` IDs to saved status effects that lack IDs, including nested cause effects.

## Scope Notes

- `StatusEffect` validation is stricter than some display serializers. Invalid constructor data throws rather than producing placeholder mechanics.
- Dynamic equipped-item and mod-contributed effects are visible through `Player.getStatusEffects()` but are not intrinsic player effects and are not saved in `Player.toJSON()`.
- Need-bar ticking is implemented for intrinsic player/NPC effects through `Player.applyStatusEffectNeedBarsToAll()`. Stored thing/location/region status lists use duration ticking only.
- Owner normalizers are not identical. Use the owner-specific rules above when deciding whether a field survives a round trip.

## Technique provenance and refresh

Technique effects persist validated `techniqueProvenance` with technique/effect/actor/operation IDs, source kind/ID, pinned definition and optional personal revision, optional item ID, stacking/refresh policy, optional potency and original `authoredDuration`. Shared normalizers and duration ticks retain it. Identity is common technique ID plus effect ID; ordinary statuses remain independent even when their description matches. Character-owned refresh is performed through `Player.upsertTechniqueStatusEffect`, with explicit rejection for incomparable variants and no default magnitude stacking. Constructor option `register: false` permits pure validation without allocating/registering status IDs. See [TechniqueService](TechniqueService.md).

## Percentage modifiers and technique grants

Status effects additionally persist finite signed `maxHealthPercent` (default `0`) and optional `percentModifier` beside the existing fixed `modifier` on each attribute or skill entry. Each attribute's flat contributions are summed first, then all active percentages are summed and applied to that flat-adjusted value. Maximum health uses the existing level and modified-health-attribute formula, then applies the sum of active `maxHealthPercent` values. There is no additional rounding or clamping; a nonpositive or nonfinite resulting maximum health is an error. Skill percentage contributions use the base rank plus all fixed skill modifiers before their summed percentage. Fixed and percentage fields may coexist.

`techniqueGrants` is an optional array of pinned `{ id, sourceStatusId, techniqueId, definitionRevision, provenance? }` records. Its source status ID must match the containing effect ID. Active status grants provide technique access only while the effect is active; duration `0` grants no access. Removing or expiring the status revokes the source, while independently learned techniques remain. The grant ID and status ID are persisted so unrelated edits preserve source identity. Ability-owned permanent statuses and equipped-item equipper statuses use the same mechanism. The StatusEffect generation parser accepts optional `<percentModifier>` beside `<modifier>` for attributes/skills and `<maxHealthPercent>` on the effect; it omits zero-only generated modifiers.

## Conditional need-level source

Need-level templates normalize into ordinary status mechanics but are derived from
active, applicable need bars. Their projection carries
`needBarSource: { barId, barName, threshold, key, levelName }` and optional
`inactiveNeedBarTargets` for unavailable component targets. They are never inserted
into intrinsic save lists or repaired as intrinsic duplicates. Native cards use
`While <barName> is <levelName>` in place of a permanent lifetime label. Attribute,
skill, capacity and ongoing-rate components use the existing Stat/Change tables.
The engine applies their numeric modifiers once; narrative checks must not apply
the same contribution again as a circumstance adjustment.

Technique stronger-effect refresh compares a need rate's combined fixed and
percentage amount using the target actor's rate basis. `chooseTechniqueRefresh`
accepts `{ actor }` (or an explicit `{ rateBasis(name) }` resolver); nonzero
percentage rates cannot be compared without that context. Existing opposing,
multiple-component and duration tradeoff rejection rules remain in force, with
explicit potency/replace available for authored incomparable variants.

Location and stored Thing status lists retain their existing fixed-only legacy
normalization, but reject a populated `needBars[].percentDelta` because those
owners have no ongoing rate processor. The diagnostic identifies the owner/list
path and directs ongoing percentage effects to character intrinsic statuses or
item target/equipper cause statuses. Explicit zero is populated and receives the
same unsupported-owner error; omitted/null/blank percentage leaves are omission.
Capacity modifiers remain supported through `needBarMaximums` on these owners.
