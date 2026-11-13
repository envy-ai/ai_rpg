# Crafting API

Common payloads: see `docs/api/common.md` (ActionResolution, Thing, ChatEntry).

## POST /api/craft

Resolves player crafting, processing, salvage, and harvest actions. The route requires an active player, runs the crafting plausibility/result prompts, applies the selected outcome to world state, advances world time, records check/result chat entries, and returns the created or recovered things.

Request:
- Body:
  - `slots` (optional): array of `{ thingId: string, slotIndex?: number, quantity?: number }`. Craft/process may use an empty array. Each source stack occupies one slot. Quantity defaults to `1` and must be a positive safe integer no greater than its live count; repeated source IDs are rejected. Salvage/harvest require exactly one selected target with quantity `1`.
  - `mode` (optional): `craft` | `process` | `salvage` | `harvest`; defaults to `craft`.
  - `actionType` (optional): compatibility alias. `salvage` and `harvest` override `mode`; other values leave the normalized `mode` behavior in place.
  - `noProse` (optional): boolean, `1`/`0`, or common true/false strings such as `true`, `false`, `yes`, `no`, `on`, `off`.
  - `craftTargetType` (optional): `item` | `scenery`; applies only to craft mode. `scenery` output is placed in the current location and has no slot, attribute bonuses, or status effects.
  - `intendedItemName` (optional string): player-facing target name for craft/process attempts.
  - `notes` (optional string): player intent for craft/process attempts.
  - Station fields: `stationThingId`, `stationName`.
  - Salvage fields: `salvageItemId`, `salvageItemName`, `salvageItemDescription`, `salvageNotes`. The selected `slots[0].thingId` is the authoritative salvage target; these fields are labels and prompt context.
  - Harvest fields: `harvestItemId`, `harvestItemName`, `harvestItemDescription`, `harvestNotes`. The selected `slots[0].thingId` is the authoritative harvest target; these fields are labels and prompt context.
  - Realtime/client fields: `clientId`, `requestId` are used for prose/check notifications and check-result metadata when supplied.

Response:
- 200: `{ success: true, outcome, resultLevel, craftedItem, craftedItems, recoveredItems, consumedThingIds, narrative, plausibility, unmatchedConsumedNames, timeTakenMinutes, timeProgress, locationRefreshRequested, worldTime }`
  - `outcome`: ActionResolution.
  - `resultLevel`: normalized crafting result tier selected from the prompt output, such as `success`, `barely_failed`, `major_success`, or `critical_failure`.
  - `craftedItem`: first crafted Thing JSON object, or `null`.
  - `craftedItems`: crafted Thing JSON objects. Portable items are placed in player inventory; scenery is attached to the current location.
  - `recoveredItems`: recovered Thing JSON objects for salvage/harvest results, placed in player inventory.
  - `consumedThingIds`: unique source ids with consumed units. Partially consumed sources retain their existing id/count; fully consumed sources are removed through native consumption.
  - `consumedItems`: exact receipts `{ thingId, quantity }` per consumed source.
  - `narrative`: `{ description: string, otherEffect: string | null }`. In `noProse` mode, `description` is a deterministic action summary and `otherEffect` is `null`.
  - `plausibility`: `{ type, reason }`.
  - `unmatchedConsumedNames`: compatibility field; successful responses normally contain `[]` because unmatched consumed names fail before the response is sent.
  - `timeTakenMinutes`: integer minutes applied to world-time advancement for the action; minimum `1`.
  - `timeProgress`: raw world-time advancement result from `Globals.advanceTime(...)`.
  - `locationRefreshRequested`: boolean indicating that automatic hidden-NPC checks require a client location refresh.
  - `worldTime`: updated serialized world-time payload.
- 200 implausible outcome: `{ success: true, applied: false, implausible: true, reason, outcome, resultLevel: "implausible", plausibility }`. This is a normal, non-mutating gameplay result rather than an API error; the client displays `reason` in a popup notification and does not refresh crafting-related state.
- 400: `{ success: false, error }` for request-level validation failures such as no active player, unknown selected thing id, nonlocal/offscreen selected input, equipped player-owned input, non-empty container input, wrong salvage/harvest slot count, or a harvest target whose authoritative `isHarvestable` flag is not `true`.
- 500: `{ success: false, error }` for prompt, parser, model-result validation, item-name validation, or world-mutation failures that occur during processing.

## Input Selection

- Craft/process can run with no selected slot inputs; the prompts judge the attempt from the station, current scene, player abilities, and notes.
- Craft/process selects exact quantities without splitting or changing inventory. The server validates quantities before prompt work and rechecks live stock, source identity, ownership/location, equipment and container availability together before consumption. A rejected quantity cannot consume a valid prefix of the selections.
- Native omitted-count and stored-zero Things each represent one selectable/consumable individual record; neither authorizes selecting two units. Populated malformed/negative/unsafe counts fail. Aggregate native consumption adjusts each stack once rather than looping over its units; only actual per-unit status effects require unit iteration.
- Salvage/harvest require exactly one selected slot target.
- Harvest additionally requires the selected Thing's authoritative `isHarvestable` value to be exactly `true`; labels and prompt context cannot make a non-harvestable Thing eligible.
- Selected inputs may come from the active player inventory, existing item contents inside unlocked containers in that inventory, loose current-location items or scenery, or existing item contents inside unlocked containers in the current location. Player-owned selected inputs must be unequipped; offscreen/nonlocal thing ids are rejected.
- Current-location container contents are available even when the container itself is scenery. Nested current-location and player-inventory container contents are accepted by the server through recursive availability sets, but traversal stops at any container that still has `requiresCheckToOpen: true`.
- Crafting availability only walks already-instantiated `containedThingIds`. It does not open containers or generate pending `containerContents` seeds for either location containers or player-inventory containers.
- Non-empty containers cannot be selected as crafting inputs. Empty the container first if the container itself should be consumed or processed. Container emptiness is based on normalized, nonblank `containedThingIds`, so blank placeholder entries do not make a container count as non-empty.

## Roll Controls

- `notes`, `salvageNotes`, and `harvestNotes` support one inline die-roll override token matching `<[+-]?\d+>` (for example `<+3>`).
- Tokens are stripped from the prompt text before processing.
- The first parsed integer is used as the player d20 roll for the crafting plausibility/skill-check resolution.
- The override is not clamped.

## Prompt And Result Flow

- The route attempts an autosave before prompt processing and another autosave after a successful action applies inventory/scenery changes, time advancement, harvest history, vehicle arrivals, scheduled events, hidden-NPC checks, and NPC sighting updates. Autosave errors are logged as warnings.
- Crafting prompt context is built with craft-history omission enabled, so prior craft/harvest/process entries are excluded from base-context history for these prompts.
- Plausibility prompts use `plausibility-check-craft`, `plausibility-check-salvage`, or `plausibility-check-harvest` and are logged through `LLMClient.logPrompt()` on every structured-response attempt.
- Initial plausibility/result generation uses the configured parser-retry budget. Before resolving a die roll or mutating state, validation requires one complete `<response>` wrapper and a supported `<plausibility><type>` value. `Plausible` outcomes require a complete `<skillCheck>` with non-empty `<reason>`, `<skill>`, `<attribute>`, and one of the configured prompt contract's difficulty labels: `Trivial`, `Easy`, `Medium`, `Hard`, `Very Hard`, or `Legendary`. `Implausible` outcomes require a non-empty `<reason>` and do not require result XML.
- Actionable plausibility responses must include a usable standard `success` result. The initial retry boundary parses generated Thing XML, rejects missing or invalid `timeTaken`, and validates selected-input consumption names before accepting the response. A rejected response is returned to the model with the exact validation failure and a concise correction request.
- After validation succeeds, the server resolves the ActionResolution exactly once and maps it to a crafting `resultLevel`. An `implausible` result returns the normal non-mutating response described above; no crafting result, die roll, inventory mutation, or time advancement is applied.
- Non-success result tiers are generated through `promptType=craft-success-degree`; `LLMClient` requires a full outer `<response>...</response>` wrapper before accepting the response.
- Initial crafting-result and success-degree parsing use strict XML parsing before any Thing output is prepared. Mismatched opening/closing tags and other malformed XML are rejected instead of being repaired into a different field structure by the DOM parser.
- Craft success-degree generation keeps XML parsing and consumption validation inside the configured parser-retry budget. Missing levels, malformed XML, unknown/repeated source IDs and consumption beyond selection are rejected before mutation. Corrections start from the original base-outcome messages plus the exact error and request a fresh complete response; the rejected partial XML is logged rather than retained in the next prompt.
- Named generation schemas select `<craftingResults>` for craft/process/repair/upgrade, `<salvageResults>` for salvage, and `<harvestResults>` for harvest. Shared result fragments permit inherited fields and partial output items, including active mod fields; present nested objects retain their required structure. The final merged parser still validates the selected level, time and consumption.
- Marked model-correctable XML guard failures join that same outer `ai.retryAttempts + 1` budget. Logs retain the full stitched rejection, effective correction messages, rejection phase and attempt log reference. Cancellation, unrelated transport failures and schema/configuration errors still propagate; existing missing-root handling, continuation and token limits remain unchanged.
- Craft result parsing accepts `<craftingResults>`, `<salvageResults>`, or `<harvestResults>`. Craft/process consumption uses `<itemsConsumed><item><thingId>thing_1</thingId><quantity>3</quantity></item></itemsConsumed>`, with one record per consumed source. Empty wrappers mean nothing consumed. Names cannot replace IDs, so same-name stacks remain distinct. Salvage/harvest retain `<itemsConsumed><itemName>exact target name</itemName></itemsConsumed>`. Other result fields include `<itemsCrafted>`, `<itemsRecovered>`, optional direct output `<item>` nodes, `<other>` for critical outcomes, `<abilities>` and required `<timeTaken>`. Consumed-source records are never parsed as output.
- The server supplies `selectedInputQuantities` to updated craft/degree prompts. Without the flag, hot-read templates retain the older running backend's name-based contract until restart.
- Success-degree parsing fills omitted direct `<result>` fields from the base success outcome. Explicit empty output wrappers are preserved, and returned `<item>` nodes keep model-authored fields while missing nested item fields are filled from the base item.
- `timeTaken` uses the shared duration parser. Accepted formats include `HH:MM`, integer minute values, and explicit day/hour/minute/round units; unit-bearing quantities may be decimal. Parsed values are rounded to the nearest minute and then advanced with a one-minute minimum.
- A result entry with missing or invalid `<timeTaken>` is skipped during parsing. If the selected outcome has no usable parsed result, the request fails with the route error shape.
- Player-action prose generation uses `_includes/player-action-craft.njk` via `promptType=player-action-craft` and is logged through `LLMClient.logPrompt()`. The parser reads `<result><description>...</description></result>` and optional `<otherEffectDescription>`.
- Standard and TinyBrain craft narration share `_includes/harvest-source-preservation.njk`. Only harvest mode adds its instruction: outcomes better than a major failure cannot destroy or consume the harvested source, including in additional-effect prose. Major and critical failure still follow the supplied outcome rather than requiring destruction.

## Consumption And Output

- Craft/process consumption follows the model output literally: only selected input things explicitly listed under `<itemsConsumed>` are consumed. If no inputs were selected, `<itemsConsumed>` must remain empty.
- Craft/process consumed IDs must match selected sources; quantities cannot exceed selection even when unselected stock remains. Salvage/harvest names must match their single selected target, case-insensitively after trimming.
- Salvage consumes the sole selected target when the result omits `<itemsConsumed>`.
- Harvest preserves the exact selected source on results strictly better than `major_failure`: `barely_failed`, `failure`, `barely_succeeded`, `success`, `major_success`, and `critical_success`. A valid `<itemsConsumed>` entry for that source is ignored on those tiers. `major_failure` and `critical_failure` retain ordinary source consumption. Selected-target/name validation still applies.
- Consumed input Things with `causeStatusEffectOnTarget` apply native target effects once per consumed unit to the current player on successful prose-mode actions, and effects appear in the result summary.
- Craft/process output is instantiated from `<itemsCrafted>` when present, otherwise from parsed recovered/direct item nodes accepted for compatibility. Portable items go to player inventory; scenery is attached to the current location.
- Salvage/harvest output is instantiated from `<itemsRecovered>` when present, otherwise from a parsed direct item node accepted for compatibility, and goes to player inventory.
- Crafted item level is computed from the top two selected input levels, station level, and player level counted twice, then adjusted by the blueprint `relativeLevel`. Salvage/harvest recovered items use the blueprint level, source level, or player level.
- Parsed output `<count>` values are preserved on created Thing stacks.
- Crafted/recovered Thing construction preserves split `causeStatusEffectOnTarget` and `causeStatusEffectOnEquipper` entries, container fields, station/vehicle/harvest/salvage flags, and registered first-class Thing fields parsed from item XML. Registered fields with `clearThingSlotWhenPresent` clear the normal gear `slot` before construction.
- Created things are validated with `Globals.ensureThingNamesAllowed(...)` before the response is sent. Harvest/salvage narration takes output names and stack quantities from those finalized recovered Thing instances after name validation, rather than the original blueprints. Standard and TinyBrain prompts each present one authoritative recovered-output list; TinyBrain omits the separate produced-output row for these modes.

## Chat, Events, And Time

Item-bearing result/source/consumption and preserved-ingredient rows retain exact name ranges and mutation-time quality snapshots through [ItemSummaryPresentation](../classes/ItemSummaryPresentation.md). Sources are captured before consumption and generated outputs before narration; deleted stacks therefore retain the correct colors in saved `What changed` rows. Counts and multi-item bullet wording remain native, with only names receiving existing inventory rarity colors.

- `noProse` skips the player-action prose prompt, ordinary crafting result event-summary entries, consumed-item status-effect application, and additional-effect event checks. Quest checks still run using the deterministic action summary line. When an ingredient-preservation bonus applies, the route stores that deterministic line as a visible prompt-excluded `crafting-result` parent and a linked bonus summary so the bonus still appears in `What changed` after reloading.
- Craft/process/salvage/harvest success-degree outcomes are recorded as visible prompt-excluded `check-results` chat entries using the same collapsed and expanded rendering as skill checks. This entry is synthesized from the action's ActionResolution, so it is recorded for `noProse` requests as well.
- Prose-mode result summaries retain source context: harvest/salvage use `from <source>`, craft/process use `using <inputs>`. Quantities above one render as `**3x** Iron Ingot` with only the quantity bold. Multiple output/ingredient types use bullet lists.
- Prose-mode craft/process/salvage/harvest item-result summary rows are categorized as `inventory` for the `What changed` drawer.
- Craft output records an `inventory` bonus per source with selected units spared: selected quantity minus consumed quantity. One spared stack unit says `Bonus: 1 unit of <name> was not consumed.` Multiple units say `Bonus: **3x** <name> were not consumed.` Unselected stock never earns a bonus. Exact Thing IDs preserve same-name sources and references on `craft_ingredient_preserved` rows. The station is excluded. Slots remain ingredient inputs without separate tool/catalyst roles. Imperfect output from a failed check qualifies; processing, salvage, harvest and outcomes without output do not.
- Prose-mode result summaries include the elapsed-time row based on the applied `timeTakenMinutes`.
- With `ai.tinybrain` and the relevant family enabled, craft/process/salvage/harvest and location-modification prose use staged outcome acknowledgement, planning, draft, audit, optional revision, and final XML. The mechanically selected `timeTakenMinutes` remains authoritative and the final XML must echo that exact duration; prompt retries never recreate, consume, or apply items again.
- Additional `<other>` effects from the selected result can generate a separate visible player-action entry and run ordinary event checks in prose mode. For a harvest result strictly better than `major_failure`, these checks and their follow-ups ignore consumption events whose native resolved quantity would consume the selected source ID. Ignored events produce no consumption receipts or summaries; other effects and consumption of distinct same-name sources remain eligible. Standard and TinyBrain checks share this protection.
- Quest checks run after the crafting mutation path. Quest reward/objective summaries are recorded when applicable.
- After time advancement, the route applies time-based status/need processing, processes due vehicle arrivals and scheduled events, runs automatic hidden-NPC checks for the current player, records same-location NPC sightings, and includes updated `worldTime` in the response.

## Harvest State

- Harvest plausibility prompts receive `lastHarvestTime` as human-readable `... ago` text when available.
- Harvest plausibility prompts receive `harvestTarget.pastHarvests` from the source Thing's persisted harvest history.
- Successful harvest actions update the source Thing with a deduplicated `previouslyHarvestedItems` list and `lastHarvested` as absolute world minutes at successful completion time.
