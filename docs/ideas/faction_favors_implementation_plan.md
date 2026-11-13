# Faction Favors Implementation Plan

Implementation plan for the design in [faction_favors_brainstorm.md](faction_favors_brainstorm.md). Read that first; this document only covers how to build it.

## Status

Implemented (all seven phases). Current behaviour is documented in [api/factions.md](../api/factions.md#faction-favors), [FactionFavor](../classes/FactionFavor.md), [FactionFavorService](../classes/FactionFavorService.md) and [FactionFavorEffectRegistry](../classes/FactionFavorEffectRegistry.md). Differences from the plan below:

- **Guard plumbing.** The double-reward guard is turn-scoped state on `Events` (`setFavorGrantGuard` / `clearFavorGrantGuard`, cleared when the `/api/chat` response closes) instead of an option threaded through every `runEventChecks` call. It covers all event-check paths in the turn, including split travel phases and follow-ups. Currency is aggregated per pass, so the guard drops one pass's total only when it exactly equals the favor amount.
- **Fast travel.** The `fast-travel` effect only validates the destination. Movement runs through the existing map fast-travel turn (`travel: true`, fast-travel `travelMetadata`) followed by the normal player teleport, exposed to the favor menu as `window.performFavorFastTravel`, so arrival processing matches map travel.
- **Status in factions list.** `GET /api/factions` returns favors without status; status comes from `GET /api/player/favors` (with `includeLocked=true` for the Factions tab).
- **Chat entry icon.** Favor turns show a `Favor: <name>` label but no icon, so history entries for later-deleted favors don't trigger image errors.
- **Effect XML.** Generated effects use `itemName`/`itemDescription`/`amount`/`needBars` child elements; stored params are `{ name, description }`, `{ amount }`, `{ bars: [{ needBar, percentage }] }`.
- **Durations.** Cooldowns accept minutes, hours and days (not weeks), matching `Utils.parseDurationToMinutes`.
- **Generation.** All favor generation (new game, load backfill, faction creation, slash command) uses one base-context prompt (`promptType: 'faction-favors-generator'`) so it sees the whole story and reuses cached tokens. The reputation-tier and form-fill prompts no longer generate favors.
- **Tests.** `/api/chat` activation is covered through `FactionFavorService` and `Events` guard tests rather than a full `/api/chat` integration test; Playwright coverage was not added.

## Summary

Favors are stored on `Faction` next to `reputationTiers`. Per-player cooldown state is stored on `Player` next to faction standings. A new `FactionFavorService` checks availability and runs activation: it validates, applies the typed effect and rival-witness penalties, records the cooldown, then hands off to a normal `/api/chat` player-action turn carrying a `favorActivation` block. Favors are generated alongside reputation tiers, backfilled once for older saves, listed compactly in base context, editable in the Factions editor, and get lazy icons through the shared image pipeline.

## Config

New `config.default.yaml` section, documented in `docs/config.md`:

```yaml
faction_favors:
  enabled: true
  # Standing lost with a rival faction whose member witnesses a favor; doubled for hostile factions.
  rival_witness_penalty: 1
```

Icon settings, documented with the other icon types in `docs/api/images.md`:

```yaml
imagegen:
  prompt_generator_templates:
    favor: favor-image.xml.njk
  image_prompt_instructions:
    favor: ""
  favor_settings:
    image: { width: 1024, height: 1024 }
```

`enabled` must be a boolean when present; `rival_witness_penalty` must be a non-negative integer. Invalid values throw at config load with the key, problem and valid values (per `AGENTS.md`). When `enabled` is false: no generation, no base-context favor block, activation returns an error, and the UI hides favors. Stored favors are kept, so turning it back on restores them.

## Data model

### `FactionFavor.js` (new, plain validated records)

A normalizer module rather than a registry class, since favors live inside their faction:

| Field | Validation |
|---|---|
| `id` | `favor_...` via `IdGenerator.next('favor', name)`. Add `favor` to the prefix table in `docs/api/serialization.md` and to hydration identity reservation (favors are nested in faction records). |
| `name` | Required, non-empty. |
| `shortDescription` | Required, non-empty, one sentence. |
| `description` | Required, non-empty. |
| `minThreshold` | Must equal the `threshold` of one of the faction's tiers, and be `> 0`. |
| `cooldownMinutes` | Positive integer. Input may be a duration string, parsed with `Utils.parseDurationToMinutes`. |
| `requiresTarget` | Boolean. |
| `targetPrompt` | Required non-empty when `requiresTarget`, otherwise blank. |
| `presence` | `anywhere` or `faction-presence`. |
| `effect` | `null` or a typed effect validated by `FactionFavorEffectRegistry` (below). |
| `imageId`, `imagePrompt` | Strings, blank by default. |

Errors name the faction, favor and field, and say what is valid (for example "minThreshold 40 does not match any tier of Ashen Guild; valid thresholds: 20, 60").

### `Faction` changes

- New private `#favors` array, getter returning clones, setter that validates through `FactionFavor`, plus `getFavor(id)`, `setFavor(id, updates)` and `removeFavor(id)`.
- `toJSON` / `fromJSON` round-trip favors. Missing in older saves → `[]`.
- Changing `reputationTiers` so a favor's `minThreshold` no longer matches a tier throws; the caller must update the favor first or in the same edit.
- Static lookup `Faction.findFavor(favorId)` → `{ faction, favor }` or `null`, for the icon adapter and activation.
- `docs/classes/Faction.md` updated.

### `Player` changes

- New `#favorUsage`: `{ [favorId]: { lastUsedWorldMinute } }` with `getFavorUsage(favorId)`, `recordFavorUse(favorId, worldMinute)`, `removeFavorUsage(favorId)`.
- `toJSON` / `fromJSON` round-trip it; missing → `{}`.
- Faction deletion (`DELETE /api/factions/:id`) and favor deletion remove matching usage entries, alongside the existing standing cleanup. Load reconciliation drops usage entries whose favor no longer exists, matching how stale faction references are already reconciled.
- `docs/classes/Player.md` updated.

Delta undo is only proposed (`docs/ideas/delta_undo_implementation_plan.md`); factions and players are already in its proposed snapshot, so nothing extra is needed now.

## Effect registry

`FactionFavorEffectRegistry.js` (new), shaped like `QuestRewardBenefitRegistry`: each type has `normalize(params, { faction })`, `validateActivation({ player, faction, favor, target })` and `apply(...)`, plus a one-line description used in the generation prompt.

| Type | Params | Apply | Reuses |
|---|---|---|---|
| `reveal-route` | none | Server picks one hidden exit adjacent to a location the faction controls (or in its home region), preferring the current region. No candidate → activation error before anything is committed. | `HiddenDiscovery.revealHiddenExit` |
| `grant-item` | `{ name, description }` seed | Generates the item into the player's inventory. | Item generation used for quest `rewardItems` (`generateItemsByNames` in `Events.js`) |
| `grant-currency` | `{ amount }` positive integer | `player.adjustCurrency(amount)` | |
| `fast-travel` | none; target chosen at activation | Player picks a visited location the faction controls; moves via the existing teleport path with `accountTravelTime: false`. | `/api/npcs/:id/teleport` handler logic (factor into a callable helper if needed) |
| `restore-needs` | `{ bars: [{ needBarId, percentage }] }` | Sets those bars. Unknown bar ids fail validation against the active need-bar definitions. | `Player.setNeedBarPercentages` |

Each `apply` returns a short structured result (`{ summary, details }`) used in the turn's `<favorActivation>` block and the client response.

## Availability

`FactionFavorService.getFavorStatus(player, faction, favor, { location, worldMinute })` returns one of:

- `locked`: standing below `minThreshold` (via `Faction.resolveReputationTier`).
- `cooldown` with `readyAtWorldMinute`.
- `needs-presence`: `presence === 'faction-presence'` and none of: current location or its region has `controllingFactionId === faction.id`; an NPC with that `factionId` is in the current location or the party.
- `available`.

Order matters: `locked` wins over `cooldown`, which wins over `needs-presence`, so the UI shows the most fundamental reason.

## Activation

### Server flow

`FactionFavorService.activate({ favorId, target, fastTravelLocationId? })`, called from the `/api/chat` handler when the request carries `favorActivation`:

1. Resolve favor and faction; error if missing or `faction_favors.enabled` is false.
2. Check status is `available`; otherwise error naming the reason and, for cooldown, when it will be ready.
3. Validate the target text (required and non-empty when `requiresTarget`) and the effect's activation params.
4. Apply the typed effect, if any.
5. Compute and apply rival-witness penalties (below).
6. `player.recordFavorUse(favorId, Globals.getTotalWorldMinutes())`.
7. Return `{ favor, faction, effectResult, rivalPenalties }`.

Steps 1–3 fail with nothing changed. A failure in step 4 or 5 is reported with its original error and stack, and the cooldown is not recorded, so the player can retry. After step 6 the favor is spent: if the narrated turn fails, the error is shown and nothing is rolled back (decision 1).

### `/api/chat` integration

- New optional request field `favorActivation: { favorId, target?, fastTravelLocationId? }`. Validated like `travelMetadata`; invalid shapes return HTTP 400 with the field path.
- The server runs `activate` before the player-action prompt and builds the user message text itself ("I call in a favor from the Ashen Guild: Safe Lodging. Target: …"), so the client can't send mismatched text.
- The pending-quest-offer 409 check runs first, as for any turn.
- Base context for that turn gets a `<favorActivation>` block: faction name, favor name, full `description`, target, `effectResult.summary`, and one line of rival penalties when any applied. Instruction: the effect and penalties have already happened; narrate the faction delivering the favor and don't apply them again.
- Event checks run as usual, with the double-reward guard below.
- The stored user chat entry carries `metadata.favorActivation` (favor id, faction id, effect summary) so the client can render an icon and the turn can be identified later.

### Double-reward guard

The narration of a favor turn describes the effect that was already applied ("the quartermaster hands you a purse"), and ordinary event checks would otherwise apply it again. The guard is scoped to the favor turn only, including follow-up event passes inside that turn; it never affects later turns. The cooldown is what limits repeated use across turns.

Two layers:

1. **Prompt note.** `eventCheckIgnoreInstructions` for the turn says which effect was already applied (for example "The player already received *Guild Writ of Passage* and 50 coins from this favor; do not report them again.").
2. **Code-level pruning after parsing**, so the guard doesn't depend on the model following the note. `activate` returns a `favorGrantGuard` that `runEventChecks` receives as a new option and passes through every event-check path the same way the in-progress `protectedConsumptionThingIds` option is passed (XML parse, TinyBrain parse, `applyEventOutcomes`, follow-up queue, `EventReprocessor`):
   - `grant-item`: `{ itemNames: [grantedName] }`. Drops `item_appear` and `pick_up_item` entries whose item name matches case-insensitively, and `transfer_item` entries that give a matching item to the player.
   - `grant-currency`: `{ currencyAmount }`. Drops at most **one** positive `currency` entry whose amount equals the favor amount exactly. Other currency changes in the same turn (a purchase, a different payment) still apply, and a matching amount only ever removes one entry.
   - Other effect types have no guard: `reveal-route`, `fast-travel` and `restore-needs` produce the same end state if an event re-applies them.

   Pruned entries are removed from both `parsed` and `rawEntries`, as `_pruneProtectedConsumptionEntries` does, and each removal is logged with the favor id so it is visible when debugging a turn.

### Rival witnesses

In step 5, with no LLM call:

- For each faction R other than the favor's faction where `R.getRelation(favorFactionId)?.status` is `rival` or `hostile`.
- Witness check: an NPC with `factionId === R.id` in the current location or the party (same rule as `faction_reputation_change`).
- Penalty: `rival_witness_penalty` for `rival`, `2 ×` for `hostile`, applied with `player.setFactionStanding`.
- Penalties are added to the turn's existing `factionReputationChanges` so the client shows them like any other reputation change.

## Prompts

### Base context

New include `prompts/_includes/faction-favors.njk`, rendered in `base-context.xml.njk` after `<factions>`, only when `faction_favors.enabled` and at least one unlocked favor exists:

```
<factionFavors>
Ashen Guild | Safe Lodging | A night's shelter in any Guild house. | available
Ashen Guild | Quiet Inquiry | Guild informants dig up a name or place. | ready in 2 days 4 hours
Tidewatch | Harbor Passage | Free passage on a Tidewatch ship. | needs presence
<instructions>Favors the player can call in. A favor that is not "available" (on cooldown or needing the faction's presence) must not be provided in prose, even if the player asks for it; the faction can decline in character. Available favors only take effect when the player uses the favor action.</instructions>
</factionFavors>
```

- Only factions where the player's tier threshold is `> 0`, and only favors with `minThreshold <=` that tier. Locked favors are omitted.
- `prepareBasePromptContext()` supplies `factionFavors` as ready-to-render rows; document it in `docs/server_llm_notes.md`.
- Main-quest prompts render through the same base context, so they get this list for free. `main-quest-stage.njk` (when built) gets one sentence saying available favors are valid routes it may suggest as hooks.
- TinyBrain: the block is plain context and is included in TinyBrain base context the same way; no new family is needed.

### Generation

- Extend `prompts/faction-reputation-generator.xml.njk` so each `<faction>` also returns:

```xml
<favors>
  <favor>
    <name>…</name>
    <shortDescription>…</shortDescription>
    <description>…</description>
    <minThreshold>20|60</minThreshold>
    <cooldown>3 days</cooldown>
    <requiresTarget>true|false</requiresTarget>
    <targetPrompt>…</targetPrompt>
    <presence>anywhere|faction-presence</presence>
    <effect type="none|reveal-route|grant-item|grant-currency|fast-travel|restore-needs">…params…</effect>
  </favor>
</favors>
```

- The prompt lists the effect catalogue (from the registry's one-line descriptions) and the guidance: 1–2 favors at the 20 tier, 1–2 at the 60 tier, stronger effects and shorter cooldowns at 60, information favors default to `anywhere`, shelter and transport to `faction-presence`.
- The parser (`renderFactionReputationPrompt` caller in `server.js`) validates favors with the tiers through `FactionFavor`, and sends any errors back through the existing correction loop with the field path and valid values.
- `prompts/fill-faction-form.xml.njk` gets the same `<favors>` section so the faction form fill can draft favors.

### Backfill for older saves

- New prompt `prompts/faction-favors-generator.xml.njk`: same favor schema, for a list of existing factions with their tiers.
- On load, if `faction_favors.enabled` and any faction has positive tiers but no favors, queue one background job (`runAuditedBackgroundPrompt('faction_favors_backfill', …)`) covering those factions, with the stale-runtime guard used by other background prompts. It writes favors only to factions that still have none when it finishes. Failure is logged with `PromptAuditLog.recordFailure` and shown through persistent PageFeedback; the save stays playable without favors.
- `/faction_favors generate [factionName]` slash command reruns it on demand (also useful after adding a faction by hand).

### Icon prompt

`prompts/favor-image.xml.njk`, modelled on `technique-image.xml.njk`: setting block, faction name and short description, favor name and description, task asking for one bold motif for the service, consistent with the faction's style, no lettering/border/portrait/scene.

## Icons

Following the ability/technique/discipline pattern in `api.js` and `server.js` (`case 'discipline':` branches and the action-icon kind list):

- Accept `entityType: 'favor'` in `POST /api/images/request`, `/api/images/prompt` and `/api/images/upload`. `entityId` is the favor id, resolved through `Faction.findFavor`; unknown ids fail before queueing.
- Adapter reads/writes `imageId`/`imagePrompt` through `faction.setFavor`, revalidating that the favor still exists on every write, so a deleted favor fails before a job reports completion.
- Writer instructions: `imagegen.image_prompt_instructions.favor`, overridden by nonblank world-profile `imagePromptInstructionsFavor`; final prompt prefix `imagePromptPrefixFavor`. Add both to the World Profiles and Image Prompts controls.
- Lazy rendering only; no bulk generation on load or after favor generation.

## API

Documented in `docs/api/factions.md`:

| Endpoint | Purpose |
|---|---|
| `GET /api/factions` | Existing; each faction gains `favors`, each favor gains `status`, `readyAtWorldMinute` and a display `readyIn` string for the current player. |
| `GET /api/player/favors` | Unlocked favors across factions with status, for the chat-view menu. |
| `PUT /api/factions/:id` | Existing; `favors` becomes an accepted whole-field replacement, validated together with `reputationTiers`. Existing favor ids are preserved; new ones are allocated. |
| `GET /api/factions/:id/favors/:favorId/fast-travel-targets` | Visited locations the faction controls, for the `fast-travel` effect picker. |

Activation itself goes through `/api/chat` (above), not a separate endpoint, so it uses the normal turn lifecycle, streaming and error handling.

Chat tools: add `favors` to the allowed faction fields for the Story Tools field-update path, using the same validation.

## Client

- **Factions tab:** each faction card gets a Favors section. Each favor shows its icon (faction emblem until generated), name, short description, required tier label, cooldown length, and a status badge. Locked favors are greyed with "Requires <tier label>". Expanding shows the full description. An **Use** button appears on available favors.
- **Faction editor** (`public/js/faction-editor.js`): favor list editor with all fields, effect type select and per-type param fields, icon regenerate/upload using the shared icon controls.
- **Chat view:** a compact favors button in the action area opens a menu of unlocked favors with icons, status and "ready in …" timers. Selecting an available favor opens a small modal: target field (with `targetPrompt` placeholder) when required, location picker for `fast-travel`, then **Call in favor**. Submits through the normal chat send path with `favorActivation`.
- The user chat entry for a favor turn shows the favor icon and name.
- Status refreshes on `chat_complete` and world-time changes, so cooldown timers stay current.
- `docs/ui/chat_interface.md` updated.

## Tests

- `tests/faction_favor.model.test.js`: field validation and messages, threshold must match a positive tier, tier edit that orphans a favor throws, `toJSON`/`fromJSON`, older faction without favors.
- `tests/player.favor_usage.test.js`: usage round trip, cleanup on faction/favor deletion and load reconciliation.
- `tests/faction_favor_effects.test.js`: each effect's normalize/validate/apply, `reveal-route` with no candidate errors before mutation, `restore-needs` unknown bar id.
- `tests/faction_favor_service.test.js`: status ordering, presence via controlled location, controlled region, local NPC and party member; cooldown boundary minute; activation order; failure before cooldown leaves no usage; rival penalties for rival vs hostile, no witness → no penalty; disabled config.
- `tests/api.favor_activation.test.js`: `/api/chat` with `favorActivation` builds the user message, injects `<favorActivation>`, rejects invalid shapes with 400, respects the pending-quest 409, keeps the cooldown when the narration call fails.
- `tests/events.favor_grant_guard.test.js`: matching `item_appear`/`pick_up_item`/`transfer_item` pruned, non-matching items kept; exactly one equal-amount currency gain pruned, a second one and other amounts kept; guard absent on the next turn; guard carried through follow-up passes.
- `tests/base_context_faction_favors.test.js`: compact rows, locked omitted, block absent when disabled or empty.
- `tests/faction_reputation_generator.favors.test.js`: favor parsing and correction-loop errors; backfill only writes factions still without favors.
- `tests/server.image_prompt_batching.test.js`: extend with the `favor-image` template render; icon adapter rejects unknown/deleted favors.
- Playwright: Factions tab favor display, use flow with a target, fast-travel picker, cooldown timer after use.

## Docs to update

`docs/classes/Faction.md`, `docs/classes/Player.md`, `docs/classes/FactionFavor.md`, `docs/classes/FactionFavorService.md`, `docs/classes/FactionFavorEffectRegistry.md` (new), `docs/api/chat.md` (`favorActivation`), `docs/api/images.md`, `docs/api/factions.md`, `docs/api/serialization.md`, `docs/config.md`, `docs/server_llm_notes.md`, `docs/ui/chat_interface.md`, `docs/slash_commands.md`, `docs/README.md`.

## Phases

1. **Model.** `FactionFavor`, `Faction` favors, `Player` usage, persistence, reconciliation, config. Tests.
2. **Availability and effects.** `FactionFavorService.getFavorStatus`, effect registry with all five types. Tests.
3. **Activation.** `/api/chat` `favorActivation`, rival penalties, `<favorActivation>` block, double-reward guard (prompt note and `favorGrantGuard` pruning). Tests.
4. **Generation.** Reputation generator and form-fill extensions, backfill job, slash command.
5. **Prompt context.** `<factionFavors>` block.
6. **Client.** Factions tab, editor, chat-view menu and modal, chat entry rendering.
7. **Icons.** Image entity type, adapter, prompt writer, settings and World Profile controls.

Phases 1–3 can be tested with hand-written favors through the faction API before generation exists; phase 4 makes them appear in real games.
