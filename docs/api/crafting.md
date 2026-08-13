# Crafting API

Common payloads: see `docs/api/common.md` (ActionResolution, Thing, ChatEntry).

## POST /api/craft

Resolves player crafting, processing, salvage, and harvest actions. The route requires an active player, runs the crafting plausibility/result prompts, applies the selected outcome to world state, advances world time, records check/result chat entries, and returns the created or recovered things.

Request:
- Body:
  - `slots` (optional): array of `{ thingId: string, slotIndex?: number }`. Craft and process requests may use an empty array. Salvage and harvest requests require exactly one selected target.
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
  - `consumedThingIds`: ids of selected inputs consumed by the result. Stack inputs with `count > 1` are decremented by one and remain in place; stacks at `1` or `0` are removed.
  - `narrative`: `{ description: string, otherEffect: string | null }`. In `noProse` mode, `description` is a deterministic action summary and `otherEffect` is `null`.
  - `plausibility`: `{ type, reason }`.
  - `unmatchedConsumedNames`: compatibility field; successful responses normally contain `[]` because unmatched consumed names fail before the response is sent.
  - `timeTakenMinutes`: integer minutes applied to world-time advancement for the action; minimum `1`.
  - `timeProgress`: raw world-time advancement result from `Globals.advanceTime(...)`.
  - `locationRefreshRequested`: boolean indicating that automatic hidden-NPC checks require a client location refresh.
  - `worldTime`: updated serialized world-time payload.
- 400: `{ success: false, error }` for request-level validation failures such as no active player, unknown selected thing id, nonlocal/offscreen selected input, equipped player-owned input, non-empty container input, wrong salvage/harvest slot count, a harvest target whose authoritative `isHarvestable` flag is not `true`, or implausible crafting.
- 500: `{ success: false, error }` for prompt, parser, model-result validation, item-name validation, or world-mutation failures that occur during processing.

## Input Selection

- Craft/process can run with no selected slot inputs; the prompts judge the attempt from the station, current scene, player abilities, and notes.
- Salvage/harvest require exactly one selected slot target.
- Harvest additionally requires the selected Thing's authoritative `isHarvestable` value to be exactly `true`; labels and prompt context cannot make a non-harvestable Thing eligible.
- Selected inputs may come from the active player inventory, existing item contents inside unlocked containers in that inventory, loose current-location items or scenery, or existing item contents inside unlocked containers in the current location. Player-owned selected inputs must be unequipped; offscreen/nonlocal thing ids are rejected.
- Current-location container contents are available even when the container itself is scenery. Nested current-location and player-inventory container contents are accepted by the server through recursive availability sets, but traversal stops at any container that still has `requiresCheckToOpen: true`.
- Crafting availability only walks already-instantiated `containedThingIds`. It does not open containers or generate pending `containerContents` seeds for either location containers or player-inventory containers.
- Non-empty containers cannot be selected as crafting inputs. Empty the container first if the container itself should be consumed or processed. Container emptiness is based on normalized, nonblank `containedThingIds`, so blank placeholder entries do not make a container count as non-empty.

## Roll Controls

- `notes`, `salvageNotes`, and `harvestNotes` support one inline die-roll override token matching `<-?\d+>`.
- Tokens are stripped from the prompt text before processing.
- The first parsed integer is used as the player d20 roll for the crafting plausibility/skill-check resolution.
- The override is not clamped.

## Prompt And Result Flow

- The route attempts an autosave before prompt processing and another autosave after a successful action applies inventory/scenery changes, time advancement, harvest history, vehicle arrivals, scheduled events, hidden-NPC checks, and NPC sighting updates. Autosave errors are logged as warnings.
- Crafting prompt context is built with craft-history omission enabled, so prior craft/harvest/process entries are excluded from base-context history for these prompts.
- Plausibility prompts use `plausibility-check-craft`, `plausibility-check-salvage`, or `plausibility-check-harvest` and are logged through `LLMClient.logPrompt()`.
- The plausibility response must include a standard `success` result. The server resolves an ActionResolution, maps it to a crafting `resultLevel`, and returns 400 when the mapped level is `implausible`.
- Non-success result tiers are generated through `promptType=craft-success-degree`; `LLMClient` requires a full outer `<response>...</response>` wrapper before accepting the response.
- Craft success-degree generation also keeps XML parsing and selected-input consumption validation inside the configured parser-retry budget. Missing result levels, malformed result XML, unknown consumed names, and duplicate consumed names beyond the number of separately selected Things are rejected before mutation and retried with the rejected response plus a concise correction. A stack count greater than one does not authorize repeating that Thing's name: one selected Thing can contribute at most one consumed unit per action.
- Craft result parsing accepts `<craftingResults>`, `<salvageResults>`, or `<harvestResults>` parents. Result entries read `<itemsConsumed><itemName>...`, `<itemsCrafted>`, `<itemsRecovered>`, optional direct `<item>` nodes, `<other>` for critical success/failure, `<abilities>`, and required `<timeTaken>`.
- Success-degree parsing fills omitted direct `<result>` fields from the base success outcome. Explicit empty output wrappers are preserved, and returned `<item>` nodes keep model-authored fields while missing nested item fields are filled from the base item.
- `timeTaken` uses the shared duration parser. Accepted formats include `HH:MM`, integer minute values, and explicit day/hour/minute/round units; unit-bearing quantities may be decimal. Parsed values are rounded to the nearest minute and then advanced with a one-minute minimum.
- A result entry with missing or invalid `<timeTaken>` is skipped during parsing. If the selected outcome has no usable parsed result, the request fails with the route error shape.
- Player-action prose generation uses `_includes/player-action-craft.njk` via `promptType=player-action-craft` and is logged through `LLMClient.logPrompt()`. The parser reads `<result><description>...</description></result>` and optional `<otherEffectDescription>`.

## Consumption And Output

- Craft/process consumption follows the model output literally: only selected input things explicitly listed under `<itemsConsumed>` are consumed. If no inputs were selected, `<itemsConsumed>` must remain empty.
- Consumed names must exactly match selected input thing names, case-insensitively after trimming. Unmatched consumed names fail loudly instead of consuming unrelated inputs.
- Salvage consumes the sole selected target when the result omits `<itemsConsumed>`.
- Harvest keeps the selected source intact unless the model explicitly lists that selected source under `<itemsConsumed>`.
- Consumed input Things with `causeStatusEffectOnTarget` apply that status effect to the current player on successful prose-mode actions, and the effect is included in the result summary.
- Craft/process output is instantiated from `<itemsCrafted>` when present, otherwise from parsed recovered/direct item nodes accepted for compatibility. Portable items go to player inventory; scenery is attached to the current location.
- Salvage/harvest output is instantiated from `<itemsRecovered>` when present, otherwise from a parsed direct item node accepted for compatibility, and goes to player inventory.
- Crafted item level is computed from the top two selected input levels, station level, and player level counted twice, then adjusted by the blueprint `relativeLevel`. Salvage/harvest recovered items use the blueprint level, source level, or player level.
- Parsed output `<count>` values are preserved on created Thing stacks.
- Crafted/recovered Thing construction preserves split `causeStatusEffectOnTarget` and `causeStatusEffectOnEquipper` entries, container fields, station/vehicle/harvest/salvage flags, and registered first-class Thing fields parsed from item XML. Registered fields with `clearThingSlotWhenPresent` clear the normal gear `slot` before construction.
- Created things are validated with `Globals.ensureThingNamesAllowed(...)` before the response is sent.

## Chat, Events, And Time

- `noProse` skips the player-action prose prompt, crafting result event-summary entries, consumed-item status-effect application, and additional-effect event checks. Quest checks still run using the deterministic action summary line.
- Craft/process/salvage/harvest success-degree outcomes are recorded as visible prompt-excluded `check-results` chat entries using the same collapsed and expanded rendering as skill checks. This entry is synthesized from the action's ActionResolution, so it is recorded for `noProse` requests as well.
- Prose-mode result summaries include source context: harvest/salvage lines use `from <source>`, and craft/process lines use `using <inputs>`.
- Prose-mode craft/process/salvage/harvest item-result summary rows are categorized as `inventory` for the `What changed` drawer.
- Prose-mode result summaries include the elapsed-time row based on the applied `timeTakenMinutes`.
- With `ai.tinybrain` and the relevant family enabled, craft/process/salvage/harvest and location-modification prose use staged outcome acknowledgement, planning, draft, audit, optional revision, and final XML. The mechanically selected `timeTakenMinutes` remains authoritative and the final XML must echo that exact duration; prompt retries never recreate, consume, or apply items again.
- Additional `<other>` effects from the selected result can generate a separate visible player-action entry and run ordinary event checks in prose mode.
- Quest checks run after the crafting mutation path. Quest reward/objective summaries are recorded when applicable.
- After time advancement, the route applies time-based status/need processing, processes due vehicle arrivals and scheduled events, runs automatic hidden-NPC checks for the current player, records same-location NPC sightings, and includes updated `worldTime` in the response.

## Harvest State

- Harvest plausibility prompts receive `lastHarvestTime` as human-readable `... ago` text when available.
- Harvest plausibility prompts receive `harvestTarget.pastHarvests` from the source Thing's persisted harvest history.
- Successful harvest actions update the source Thing with a deduplicated `previouslyHarvestedItems` list and `lastHarvested` as absolute world minutes at successful completion time.
