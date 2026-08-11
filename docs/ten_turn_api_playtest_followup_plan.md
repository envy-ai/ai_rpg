# Ten-Turn API Playtest Follow-Up Plan

## Non-negotiable rule: do not mechanically police generated prose

> **Do not add regular expressions, keyword checks, dialogue detection, prose classifiers, or chains of `if` statements that try to determine whether free-form generated prose obeyed a narrative instruction.** Do not make a playtest pass by adding application-code heuristics for particular wording seen in a failed generation. Those checks are brittle, overfit individual responses, and produce false positives.
>
> Enforce syntax and mechanically knowable semantics only in parsers for explicitly structured outputs. Guide free-form prose through prompting, and record prose-quality or instruction-following problems for human review. A prose expectation in this plan is not authorization to turn that expectation into a regex or ad hoc content validator.
>
> **This rule applies to every automated assertion and every proposed implementation fix in this document.** A prose or dialogue defect may fail human review, but must never be converted into executable wording detection. Automated pass/fail decisions must come from structured model output or authoritative game state.

This is the comprehensive follow-up plan for the coverage gaps recorded in [ten_turn_api_playtest_gaps.md](ten_turn_api_playtest_gaps.md). Of the 148 backend cases, 102 have passed with retained authoritative API evidence and 46 remain. The completed cases are VEH-1 through VEH-10, REG-1 through REG-6, FAST-1 through FAST-7, CONT-1 through CONT-8, INV-1 through INV-7, EQUIP-1 through EQUIP-5, TRADE-1 through TRADE-9, CRAFT-1 through CRAFT-8, COMBAT-1 through COMBAT-10, PARTY-1 through PARTY-8, QUEST-1 through QUEST-9, NEED-1 through NEED-8, and HIDE-1 through HIDE-7. Their evidence is retained under `tmp/followup-api-playtest/` or source-controlled deterministic tests; family rollups and case-level assertion reports record the passing state and defects repaired during those runs.

The acceleration infrastructure was introduced mid-goal. It speeds up remaining cases and model-backed defect loops; it is **not** a retroactive requirement to convert or rerun cases that already passed. VEH-7, COMBAT-1, and COMBAT-2 additionally have canonical fixture/declarative regressions, while COMBAT-3 has a prepared declarative scenario. See [followup_api_playtest.md](followup_api_playtest.md).

[followup_api_playtest_acceleration_plan.md](followup_api_playtest_acceleration_plan.md) is the companion implementation plan for using strict recorded-completion replays, declarative one-command cases, reusable canonical fixtures, focused triage reports, and final live-model verification where they materially accelerate the remaining work or protect a discovered regression.

The primary test surface is the backend API. Browser/Playwright checks are included only where the feature's player-visible contract materially matters, such as maps, containers, barter, combat result details, and the level-up ability modal.

## Test-run contract

### Runtime and isolation

1. Start from one named baseline manual save and record its player, location, world time, inventory, party, quests, currency, needs, status effects, and faction standings.
2. Start the game outside the sandbox with the qwen-combo-router configuration plus a temporary override under `tmp/` that disables image generation. Do not pass a save on the startup command line; load the baseline through the normal API after startup. Enable only the background systems required by the current scenario.
3. Maintain one WebSocket client for the entire request. It must record prompt progress, answer `quest_confirmation_request`, and answer forced `player_input_request` rolls when a case calls for `<f>`.
   The API harness must use a local HTTP transport without a client-side response deadline: a complete turn can legitimately take more than five minutes when several prompt families and model swaps run in sequence.
4. Run only one scenario on a loaded fixture. Restore the scenario fixture before every success, failure, cancellation, or edge-case variant.
5. Never use an earlier scenario's mutated world as the next scenario's starting state.
6. If a prompt fails, preserve its response JSON and prompt/error logs, stop the game server, make and document the smallest fix, restart from the latest pre-case autosave, and replay the exact case.

### Standard `@@` fixture protocol

`@@` setup messages are generic tool-bearing prompts. They are allowed to create or update test fixtures, but they are not the behavior under test unless a case explicitly says otherwise. Prefix each setup request with this contract:

```text
@@ QA FIXTURE SETUP ONLY. Use game tools to perform exactly the requested setup. Do not advance time, move the player, start combat, award rewards, or write story prose. Do not create anything not requested. At the end, report every canonical created or changed entity name and ID, grouped by entity type, and report any requested operation that did not succeed.
```

After every setup command:

1. Inspect `toolInvocations` and reject a fixture with any unsuccessful or unrequested mutation.
2. Resolve canonical IDs using `GET /api/player`, `GET /api/players`, `GET /api/locations`, `GET /api/regions`, and `GET /api/things` as applicable. Requested names are hints; generated canonical names and returned IDs are authoritative.
3. Validate location membership, ownership, containment, health, hostility, party state, and flags before testing.
4. Save the validated fixture under a scenario-specific name. Do not repair setup drift during the behavioral case.

### Evidence required for every case

Store artifacts under `tmp/followup-api-playtest/<scenario>/<case>/`:

- request body and response JSON;
- relevant before/after API snapshots;
- the logical prompt log path and any parser/tool error logs;
- event-summary, check-results, tool-call-debug, and visible prose entries for the turn;
- world time and `timeProgress` before and after;
- a short assertion report listing each pass/fail condition;
- for UI-visible cases, Playwright screenshot, rendered visible text/state, and console/page errors.

A case does not pass merely because it returned HTTP 200. Its prose, mechanical state, event summaries, time, persistence after save/reload, and absence of duplicate effects must all agree.

### Configuration variants

Create a separate temporary override for each row instead of editing the shared qwen-combo-router configuration:

| Variant | Required differences from the normal no-image fixture |
| --- | --- |
| Default isolated | Image generation off; random events off; ordinary and combat NPC turns off unless the case explicitly needs them. |
| Combat | `combat_npc_turns.enabled: true`, deterministic friendly/hostile limits, ordinary `npc_turns.enabled: false`. |
| Quest | `quest_checks.enabled: true`, `quest_checks.interval: 1` except the acceleration case, and confirmations handled by the active WebSocket client. |
| Long time/WYWA | Small explicit WYWA threshold, random events off, and scheduled events enabled through their normal runtime path. |
| Random event | Only the selected random-event category enabled with a deterministic always-run frequency; unrelated categories disabled. |
| Relationship housekeeping | Small explicit housekeeping interval when testing parsed relationship add/update/remove output. |

Record the effective `/api/config` or equivalent runtime configuration with every scenario so a pass is reproducible.

## 1. Vehicle travel

### Goal

Exercise boarding, ordinary riding, movement inside a vehicle, departure, stopping, redirecting, timed arrival, disembarkation, fixed-route validation, and carried objects.

### Fixture

Run:

```text
@@ QA FIXTURE SETUP ONLY. Create a location stub named QA West Platform connected to the player's current location. Create a vehicle location stub named QA Clockwork Tram with vehicle type rail tram and connect QA West Platform to it. Create a second fixed-route destination named QA East Platform and connect it to the tram's route. Create a portable item named QA Brass Travel Case at QA West Platform. Do not move the player. Return canonical names and IDs for all locations, exits, and the item.
```

After resolving and expanding the three location IDs, use the location edit API to set the tram's complete `vehicleInfo`: fixed destinations, tracked outside `vehicleExitId`, no active destination, and no trip timing. Preserve its current description and level in the required update payload. Verify that the tram's boarding exit and route destination IDs are valid before saving the fixture.

### Cases

- **VEH-1 Board:** Move to QA West Platform, then use the exit/button path to enter QA Clockwork Tram. Assert that `currentVehicle` resolves, the player is in the tram location, no trip begins, and ordinary boarding time is correct.
- **VEH-2 Carry item aboard:** Pick up QA Brass Travel Case, board, and verify it remains player-owned. Repeat from the fixture with prose instructing the case to move with an accompanying non-party NPC and verify both actor and item placement.
- **VEH-3 Depart:** Submit a player action explicitly telling the tram to depart for QA East Platform. Assert vehicle metadata contains one pending destination, `departureTime`, future `ETA`, preserved fixed routes, and no premature player relocation.
- **VEH-4 Ordinary ride:** While underway, wait or converse without changing route. Assert a normal turn, unchanged destination/ETA, advancing world time, and no duplicated departure.
- **VEH-5 Move inside vehicle:** Add an interior sublocation/room if necessary and move within the tram. Assert player movement without route mutation or spurious `<vehicleInfo>` changes.
- **VEH-6 Stop:** Restore the underway fixture, ask to stop, and assert timing clears or resolves according to the vehicle contract without fabricating an outside arrival.
- **VEH-7 Redirect:** Restore the underway fixture, redirect to the other allowed stop, and assert one new pending destination and recomputed ETA. Attempt an off-route destination and require a retry or explicit failure with no partial mutation. The off-route half is implemented as `tests/followup_api_playtest/scenarios/vehicle/VEH-7-off-route.json` with the immutable `vehicle-underway-eastbound` fixture; its parser and API propagation regressions are covered by focused Node tests. The allowed-route success half remains to be added during the broader rollout.
- **VEH-8 Timed arrival — complete:** `VEH-8-timed-arrival.json` restores the immutable underway fixture, advances to one minute before ETA and then across it, and performs an idempotent zero-minute follow-up. State-only attempt 1 passed 37/37 assertions: the underway exit stayed hidden, arrival finalized exactly once, destination/timing state normalized, the exit reappeared at the destination, and the carrier/item ownership invariants remained intact.
- **VEH-9 Disembark — complete:** `VEH-9-disembark.json` restores the underway fixture, crosses the scheduled ETA, and takes the ordinary event-driven vehicle exit. Live-verify attempt 2 passed 31/31 assertions: the structured response reported authoritative movement type `disembark`, the player reached the destination with zero additional time, exactly one player action and event summary were added, detailed tram route/timing metadata stayed normalized, and no realtime or changed error-log failures occurred.
- **VEH-10 Save/reload — complete:** `VEH-10-save-reload.json` saves the canonical active trip, advances the disposable runtime by five minutes, reloads the saved state, crosses the restored ETA, and performs a zero-minute duplicate check. State-only attempt 1 passed 46/46 assertions: hydration restored the exact player/vehicle/exit/time state, route timing and the tracked exit survived, the companion and carried-item ownership remained intact, and arrival finalized once without a second due event.

## 2. Cross-region exploration

### Goal

Exercise region-entry stubs, child location stubs, cross-region travel-time backfill, expansion, movement integrity, and model-selected unknown destinations.

### Fixture

```text
@@ QA FIXTURE SETUP ONLY. Use createRegionStub to create QA Frost March beyond the player's current location. Give it a clear test description and relative level 1. Within that target region create a child location stub named QA Border Lantern. Ensure a two-way exit from the current location to the new region entry. Do not expand either stub and do not move the player. Return the region, location, and exit IDs.
```

### Cases

- **REG-1 Direct region entry — complete:** `REG-1-direct-region-entry.json` restores the immutable pending Frost March doorway/child fixture and traverses the ordinary move endpoint. Live-verify attempt 4 passed 40/40 assertions: the player reached the single generated entrance, the pending region id became a live region, the preserved QA Border Lantern child remained an ordinary target-region stub, every map location id appeared once, the origin exit was rewired and backfilled from zero to five minutes, one event summary was added, and no unexpected realtime/log error occurred. The failed live attempts also exposed and repaired malformed region XML consumption: the complete document is now strictly parsed before mutation and parser retries regenerate from the original prompt plus the exact error rather than feeding a large rejected document back to a model that copied it verbatim.
- **REG-2 Child stub — complete:** `REG-2-child-stub.json` restores the immutable post-REG-1 `cross-region-expanded-frost-march` fixture and moves from March Start Marker through the preserved two-minute route to QA Border Lantern. Live-verify attempt 1 passed 44/44 assertions: the existing `loc_38` stub expanded in place inside QA Frost March, became visited, remained unique in the region map, preserved both canonical two-minute entrance links, moved the player once, advanced world time from minute 663 to 665, added one event summary, and produced no realtime or changed error-log failures. Human review confirmed the generated lantern checkpoint remained consistent with the saved frozen-frontier blueprint and did not invent a competing location.
- **REG-3 Dialogue movement — complete:** `REG-3-dialogue-movement.json` restores the immutable `cross-region-alias-companion` fixture and asks `Kuroha` to accompany the player through the direct travel-prose path. Live-verify attempt 3 passed 51/51 assertions: player-action canonicalized the alias to `QA Quartermaster`, expanded the existing `loc_38` destination stub for destination prose without prematurely moving either actor or advancing time, and returned the canonical companion list. The subsequent authoritative `/api/player/move` call moved both actors to QA Border Lantern exactly once, advanced time by the route's exact two minutes, preserved unique target-region membership and the canonical reciprocal exit, added one event summary without another player-action entry, and produced no realtime or changed error-log failures. Human review confirmed one coherent departure/walk/arrival sequence and one aliased character rather than an invented duplicate. This run also exposed and fixed sequential TinyBrain movement-event request growth: later sections now replace the transcript's single base-context snapshot in place while retaining earlier questions and accepted replies.
- **REG-4 Model-selected destination — complete:** `REG-4-model-selected-destination.json` restores the immutable expanded Frost March fixture and asks player-action to choose a named nonexistent destination without exit-button metadata. Live-verify attempt 3 passed 41/41 assertions: TinyBrain returned QA Aurora Cairn in QA Frost March with the exact requested three-minute travel time; authoritative post-prose generation created and fully expanded one destination, reciprocal three-minute exits, unique region-map membership, one player move, one player-action row, and one event-summary row. The clock advanced exactly three minutes, TinyBrain event checks did not apply duplicate movement, and no realtime or changed error-log failure occurred. Human review confirmed one coherent departure/walk/arrival, a plausible cairn in the intended region, no competing destination name, and no route-time contradiction. Failed attempts exposed a tool-boundary defect: the provider could emit and execute a registered tool omitted from the checkpoint schema. Explicit request schemas now act as execution allowlists, returning retryable `tool_not_declared` XML without invoking the tool; the destination lookup also preserves its `moreInfo`-only schema through base-context processing.
- **REG-5 Failure isolation — complete:** `REG-5-failure-isolation.json` restores the immutable `cross-region-ambiguous-destination` fixture, then supplies validly shaped authoritative fast-travel metadata naming a nonexistent canonical destination. Live-verify attempt 4 passed 23/23 assertions: `/api/chat` returned HTTP 400 with the missing destination id before launching any prompt, player location and world time were unchanged, the full location/region/exit projections were unchanged, neither player-action nor event-summary history was added, both same-named fixture stubs retained their original distinct region memberships, and no realtime error occurred. The initial ambiguity-based action was retired because the model could invent a region and thereby turn the input into a valid selection; the authoritative invalid-id case tests the same failure-isolation contract deterministically.
- **REG-6 Persistence — complete:** `REG-6-persistence.json` restores the immutable post-expansion `cross-region-expanded-frost-march` fixture, snapshots the region map, origin route, and child-stub identity, saves normally, advances the clock seven minutes as a deliberate perturbation, and reloads the saved state. State-only attempt 3 passed 57/57 assertions: the original time and player/world projections returned exactly; QA Frost March remained one unique live region with five unique, correctly owned map members; its entrance and QA Border Lantern retained canonical ids and stub state; all three entrance exits, the eleven origin exits, the five-minute cross-region pair, the one-minute March Path link, and the two-minute child pair retained their destinations and region ids; the pre/post region maps and stub payloads matched; and no realtime or changed-log error occurred. Hydration intentionally reconstructs exit-object audit timestamps, so the scenario compares route topology rather than treating regenerated `createdAt`/`lastUpdated` values as gameplay drift.

## 3. Map and Favorites fast travel

### Goal

Exercise route preview, visited/favorite eligibility, blank and prompted confirmation paths, travel-time accounting, companions, and arrival processing.

### Fixture

```text
@@ QA FIXTURE SETUP ONLY. Create two ordinary locations named QA Fast Travel Grove and QA Fast Travel Tower. Connect each to the player's current location with explicit two-way exits and distinct positive travel times. Create an NPC named QA Courier at the current location with alias Quickstep. Do not move anyone. Return all canonical IDs and exit IDs.
```

Visit each location normally once, return to the baseline location, set both `favorite=true`, and save the resulting visited fixture.

### Cases

- **FAST-1 Preview — complete:** The immutable `fast-travel-visited-favorites` fixture was created from the documented setup: deterministic exit APIs supplied distinct four- and nine-minute two-way paths, an `@@` tool prompt created QA Courier and set exact alias Quickstep, and no-side-effect setup visits expanded/visited/favorited both destinations before returning Baato to March Start Marker at the unchanged minute 663. `FAST-1-preview.json` state-only attempt 1 passed 43/43 assertions: each preview returned the canonical origin, destination, region, and exact directed shortest-path minutes while the complete player, character, location, clock, and history projections remained unchanged, with no realtime or changed-log error.
- **FAST-2 Blank confirmation — complete:** `FAST-2-blank-confirmation.json` reproduces the browser's blank flow by sending `# Baato moved to QA Fast Travel Grove.` as a travel-marked comment and then invoking the normal player teleport with travel-time accounting. Live-verify attempt 2 passed 47/47 assertions: the comment returned immediately with no prompt or player-action record, movement occurred only in the teleport step, the player moved from March Start Marker to the canonical Grove once, the clock advanced exactly four graph minutes, one travel event-summary row was added, QA Courier stayed at the origin, ordinary arrival processing returned no error, below-threshold WYWA correctly added no hidden or visible entry, and no realtime or changed-log error occurred.
- **FAST-3 Prompted confirmation — complete:** `FAST-3-prompted-confirmation.json` sends a nonblank Tower action through `/api/chat` with direct authoritative fast-travel metadata, then passes the canonical companion result into the normal teleport request. Live-verify attempt 1 passed 46/46 mechanical assertions: player-action classified the committed move as `destination`, returned no companions, emitted one player-action row, and left player/time at the origin; the following teleport alone moved Baato to the existing Tower, advanced exactly nine graph minutes, and added one travel summary. Below-threshold WYWA added no hidden or visible row, and no realtime or changed-log error occurred. Human review accepted one coherent March Start Marker-to-Tower trip with no Grove substitution or second movement claim.
- **FAST-4 Companion alias — complete:** `FAST-4-companion-alias.json` asks `Quickstep` to accompany Baato to the Grove under authoritative fast-travel metadata, then passes the returned canonical list unchanged to the teleport. Live-verify attempt 1 passed 48/48 mechanical assertions: player-action returned exactly `QA Courier`, both actors and time remained at the origin through prose generation, the teleport moved both actors to the Grove once and advanced exactly four graph minutes, one travel summary was added, the alias remained `Quickstep`, and neither the NPC flag nor the player's party-member list changed. No realtime or changed-log error occurred. Human review treated the prose's one generic courier as the aliased NPC, found no party-join claim, and found no second inter-location move.
- **FAST-5 WYWA — complete:** `FAST-5-wywa.json` restores the immutable visited/favorites baseline twice, ages the Grove visit by 31 minutes, and compares the two arrival contracts. Live-verify attempt 1 passed 58/58 mechanical assertions: an event-driven TinyBrain move committed the exact four-minute route, stored one hidden WYWA update, and suppressed the duplicate visible WYWA row because the same player-action already supplied destination prose; after reload, the browser-equivalent blank comment plus gameplay teleport again advanced exactly four minutes and stored one hidden plus one visible WYWA row. Both branches reached the Grove without realtime, arrival-processing, or changed-log errors. Human review accepted the first branch's coherent destination scene with Mina and the blank branch's one visible reunion scene, with no competing destination or second trip.
- **FAST-6 Story-tool contrast — complete:** `FAST-6-story-tool-contrast.json` advances beyond the WYWA threshold, marks the Grove's existing Mina hidden, and supplies the courier alias while teleporting Baato with `storyToolTeleport: true`. State-only attempt 1 passed 52/52 assertions: only Baato moved, the courier stayed at the origin, the clock did not advance, the response contained no arrival-processing result, history stayed byte-for-byte unchanged, no WYWA/player-action/event-summary row appeared, hidden Mina stayed hidden with unchanged last-seen fields, no prompt ran, and no realtime or changed-log error occurred.
- **FAST-7 Invalid target — complete:** `FAST-7-invalid-target.json` sends the same nonexistent canonical destination through both fast-travel preview and gameplay teleport. State-only attempt 1 passed 37/37 assertions: each endpoint returned its documented HTTP 404 payload, the complete tracked player, character, location, clock, and history projections remained unchanged across both requests, no player-action/WYWA/event-summary row appeared, no prompt ran, and no realtime or changed-log error occurred. This completes fast-travel coverage at 7/7 cases.

## 4. Checked containers

### Goal

Exercise failed, temporary-success, permanent-success, and already-open paths while confirming exactly one mechanical check and durable time/event behavior.

### Fixture

```text
@@ QA FIXTURE SETUP ONLY. Create a scenery container named QA Three-Lock Chest at the player's current location. It must be a container, require a check to open, and have pending contents consisting of two QA Silver Pins and one QA Blue Ledger. Do not open it. Return the chest ID and all persisted container flags.
```

Use a WebSocket forced-roll responder so `<f>` open actions can receive an exact low or high die value.

### Cases

- **CONT-1 Forced failure:** Call `POST /api/things/<chest>/container/open-check` with an action containing `<f>` and answer with the lowest roll. Assert `opened=false`, `permanentlyOpened=false`, `requiresCheckToOpen=true`, no contents are exposed/moved, exactly one successful check tool call is recorded, and time advances once.
- **CONT-2 Retry after failure:** Retry from the failed state with a different method. Assert the prior failure does not cache across prompts and a new check is made.
- **CONT-3 Temporary success:** Force a successful method that should not permanently remove the lock. Assert `opened=true`, `permanentlyOpened=false`, inventory can be fetched for that interaction, and the persistent flag remains true.
- **CONT-4 Permanent success:** Restore the fixture, force a successful destructive/key/lockpick method that permanently opens it, and assert `requiresCheckToOpen=false` persists through save/reload.
- **CONT-5 Already open:** Call open-check again after permanent success. Assert `opened=true`, `skipped=true`, no model/check invocation, and no time advancement.
- **CONT-6 Contents generation:** Fetch the container once, verify pending contents instantiate exactly once with counts 2 and 1, fetch again, and assert no duplicates.
- **CONT-7 Transfers:** Move one whole stack out, split it, move a partial stack back in, and verify containment metadata plus merge behavior.
- **CONT-8 Invalid moves:** Attempt self-containment, a containment cycle, scenery as contents, and an equipped item move. Each must fail atomically.

## 5. Inventory operations beyond pickup

### Goal

Exercise give, drop, stack split/merge, container transfer, consumption, status effects, and atomic invalid operations.

### Fixture

```text
@@ QA FIXTURE SETUP ONLY. Create a stack of four identical QA Copper Tokens, a portable QA Field Satchel container, and one consumable QA Focus Draught that applies a five-minute target status effect named QA Focused. Create an NPC named QA Quartermaster at the player's current location. Leave all things loose at the current location. Return canonical IDs and counts.
```

Use the give API to place the tokens, satchel, and draught in the player's inventory, then save the fixture.

### Cases

- **INV-1 Drop/pickup:** Drop the four-token stack, confirm ownership clears and location count is four, then pick it up through a normal player action. Assert one canonical stack returns to inventory.
- **INV-2 Split/merge:** Split one token from the stack, verify counts 3 and 1, merge them, and verify one stack of 4 with preserved checksum/stats.
- **INV-3 Give NPC:** Give a partial stack to QA Quartermaster. Assert exact counts and ownership for both actors, including save/reload.
- **INV-4 Container:** Put a whole or split token stack into QA Field Satchel and move it back out. Assert `containedThingIds`, `metadata.containerId`, player inventory, and automatic compatible-stack merging.
- **INV-5 Consume:** Submit a normal action drinking QA Focus Draught. Assert one `consumeItem` event, removal/decrement of the exact item, application of QA Focused once, visible prose agreement, and correct duration timestamp.
- **INV-6 Effect expiry:** Advance four minutes and then beyond five. Assert the effect remains before expiry, disappears once after expiry, and does not reapply.
- **INV-7 Atomic rejection:** Try to give scenery, split an invalid quantity, merge incompatible stacks, or move an unknown ID. Assert no partial ownership/count changes.

## 6. Equipment and modules

### Goal

Exercise equip, replacement, unequip, derived bonuses, invalid slots, equipped-item transfer rejection, and module installation when the modules mod is enabled.

### Fixture

```text
@@ QA FIXTURE SETUP ONLY. Create two equippable head-slot items named QA Bronze Circlet and QA Silver Circlet with different explicit attribute bonuses. Create one equippable body item named QA Padded Coat. If the modules mod is enabled, create a compatible QA Circlet Lens module and make the Bronze Circlet expose the required module slot. Leave everything at the current location and return IDs, slots, bonuses, and module-slot metadata.
```

Give all portable items to the player and record baseline derived attributes.

### Cases

- **EQUIP-1 Equip:** Equip QA Bronze Circlet into the exact supported head slot. Assert gear snapshot, ownership, and derived attributes change once.
- **EQUIP-2 Replace:** Equip QA Silver Circlet into the same slot. Assert Bronze returns unequipped, Silver becomes active, and bonuses are replaced rather than accumulated.
- **EQUIP-3 Unequip:** Clear the slot. Assert both items remain in inventory and derived stats return to baseline.
- **EQUIP-4 Invalid operations:** Try the wrong slot, an unknown item, an off-location item, and dropping/moving an equipped item. Require explicit errors and unchanged gear.
- **EQUIP-5 Module install/remove:** Install QA Circlet Lens, verify it is linked to the base item and hidden as a standalone visible inventory row where expected, confirm its effect, save/reload, remove it, and verify both inventory and bonus state restore correctly.

## 7. Commerce

### Goal

Exercise session eligibility, pricing, generated stock, buying, selling, haggling, refusal, currency shortfall, conclusion, and persistence boundaries.

### Fixture

```text
@@ QA FIXTURE SETUP ONLY. Create a living non-hostile merchant NPC named QA Merin with currency 30 at the player's current location. Create a player-sellable item named QA Amber Chip and a merchant item named QA Iron Flask. Give QA Iron Flask to QA Merin and leave QA Amber Chip loose for later assignment to the player. Ensure QA Merin is willing to trade. Return NPC and item IDs, currency, disposition, hostility, and willingness state.
```

Give QA Amber Chip to the player and record both currencies and inventories.

### Cases

- **TRADE-1 Session:** Start a trade session. Assert eligibility, finite expiry, canonical existing-item offers, valid positive prices, generated stock bounds, and merchant currency update.
- **TRADE-2 Buy:** Buy one merchant item. Assert exact item ownership and net currency transfer, one trade summary, session conclusion, and at most one queued merchant response turn.
- **TRADE-3 Sell:** Restore the fixture and sell QA Amber Chip. Assert it moves to barter inventory and the player receives the quoted amount.
- **TRADE-4 Mixed transaction:** Buy and sell in one commit. Verify net currency calculation and counts.
- **TRADE-5 Insufficient merchant currency:** Set merchant currency below the amount owed, attempt the sale, require the `merchant-insufficient-currency` 409 with no mutation, then accept the shortfall and verify capped payment plus item transfer.
- **TRADE-6 Haggle:** Submit a favorable and an insulting haggle from separate fixture restores. Assert opposed-check metadata, updated offers or refusal, correct chat entries, and no duplicate generated stock.
- **TRADE-7 Refusal expiry:** For a refused session, confirm new sessions fail until the configured world-minute expiry and succeed after it.
- **TRADE-8 Conclude:** Conclude without items before and after haggling. Assert only the haggled case triggers an NPC response.
- **TRADE-9 Eligibility failures:** Test dead, hostile, absent, and unwilling merchants. Each must reject without creating a session.

## 8. Processing, harvest, salvage, and crafting failures

### Goal

Cover every `/api/craft` mode and important failure/critical branches not exercised by ordinary crafting and repair.

### Fixture

```text
@@ QA FIXTURE SETUP ONLY. Create a processing station named QA Hand Mill, a crafting station named QA Workbench, a harvestable scenery source named QA Glowreed Patch, a salvageable item named QA Broken Lantern, two processable QA Grain Bundles, and suitable QA Wood and QA Resin materials. Leave scenery at the current location and portable items loose. Return all IDs, flags, levels, counts, and station types.
```

Give portable inputs to the player. Use inline roll overrides in crafting notes, which explicitly support `<integer>` tokens.

### Cases

- **CRAFT-1 Process:** Process grain at QA Hand Mill. Assert only model-listed selected inputs are consumed, output goes to inventory, exact authoritative duration advances once, and result prose echoes the mechanical outcome.
- **CRAFT-2 Harvest:** Harvest QA Glowreed Patch. Assert exactly one source target, recovered items enter inventory, source persists, `previouslyHarvestedItems` deduplicates, and `lastHarvested` records completion time.
- **CRAFT-3 Repeat harvest:** Harvest again later. Assert prompt context contains prior harvest history and no duplicate history entries.
- **CRAFT-4 Salvage:** Salvage QA Broken Lantern. Assert source consumption, recovered items, and source-labelled summary.
- **CRAFT-5 Scenery construction:** Craft scenery at QA Workbench. Assert output attaches to the location, is not equipped/in inventory, and carries no invalid gear-only fields.
- **CRAFT-6 Critical success:** Use `<20>` in notes. Assert one check, enhanced result/other effect as authored, exact inventory changes, and no duplicate item creation on TinyBrain retries.
- **CRAFT-7 Critical failure:** Restore and use `<1>`. Assert failure effects match prose and output, selected inputs are consumed only if the authoritative result says so, and no phantom crafted item appears.
- **CRAFT-8 Invalid requests:** Test offscreen input, equipped input, nonempty container input, multiple salvage targets, and harvest of a non-harvestable target. Require errors before mutation.

## 9. Broader combat

### Goal

Exercise player damage, friendly and hostile NPC turns, area attacks, opposed checks, effectiveness, status effects, incapacitation, revival, fleeing, hidden attackers, and combat persistence.

### Fixture

Use a temporary override with `combat_npc_turns.enabled=true`, one friendly and one hostile NPC slot, and ordinary `npc_turns.enabled=false` so combat gating is isolated.

```text
@@ QA FIXTURE SETUP ONLY. Create two hostile NPCs named QA Ash Beetle and QA Frost Beetle at the player's current location, both low level and alive. Give QA Ash Beetle a fire vulnerability and QA Frost Beetle a fire resistance. Create a living friendly NPC named QA Shieldhand at the same location with an attack ability and an alias Bulwark. Create a QA Fire Bomb area-attack item and a QA Bandage healing item. Return all IDs, health, defenses, vulnerabilities, resistances, abilities, hostility, and item IDs.
```

Give the two items to the player and save health snapshots for every actor.

### Cases

- **COMBAT-1 Hostile NPC attack:** Enter combat without killing either enemy and let the hostile NPC act. Assert a real `resolveAttack` tool result, exact player health loss, one attack summary, and prose tied to the actual attacker.
- **COMBAT-2 Friendly NPC attack:** Let QA Shieldhand act. Assert its attack resolves mechanically even with legacy prompt checks disabled and cannot borrow the player's or another ally's attack result. Backend conversion is complete in `tests/followup_api_playtest/scenarios/combat/COMBAT-2-friendly-npc-attack.json`, using the immutable `combat-elemental-skirmish` fixture and strict source cassette. Normalized structured assertions accept either supported attack tool while proving exact actor/target attribution and state application; live record, no-llama strict replay, independent live-Qwen verification, and human prose review pass. The separate UI checkpoint remains outside the current backend-only goal.
- **COMBAT-3 Area attack:** Use QA Fire Bomb against both beetles. Assert one shared roll, per-target defense/effectiveness, distinct damage, one grouped check-results row, no duplicate target, and no repeated damage on tool-cache reuse.
- **COMBAT-4 Opposed maneuver:** Grapple, shove, or disarm using an opposed skill. Assert both actors and skills are correct and the mechanical outcome controls prose.
- **COMBAT-5 Status attack:** Apply a timed combat status. Assert one application, modifiers, duration, and expiry.
- **COMBAT-6 Incapacitation:** Reduce an enemy to zero without declaring death. Require matching incapacitation state, no kill-only rewards, and persistent save/reload state.
- **COMBAT-7 Death:** Kill the other enemy. Assert zero health, `isDead=true`, deceased state, corpse countdown, XP once, and matching `deathIncapacitation` event.
- **COMBAT-8 Healing/revival:** Heal the player, stabilize the incapacitated actor, and test revival only where supported. Assert health/status ordering and no resurrection of a deliberately dead actor unless explicitly permitted.
- **COMBAT-9 Flee/combat movement:** Attempt a successful and failed escape from separate restores. Assert movement only on success, correct time, companions, and coherent combat state.
- **COMBAT-10 Save/reload:** Reload with active combat, statuses, damaged health, and a corpse. Assert all persist and the next actor does not receive a duplicate turn.

## 10. Party membership

### Goal

Exercise recruiting, dismissing, remote recruitment, aliases, movement representation, atomic validation, death persistence, and save hydration.

### Fixture

```text
@@ QA FIXTURE SETUP ONLY. Create a living NPC named QA Lark at the player's current location with alias Skylark. Create a second living NPC named QA Distant Moss at QA Fast Travel Grove or another existing off-location test destination, with alias Moss. Neither NPC may start in the player's party. Return both IDs, aliases, locations, and current party state.
```

### Cases

- **PARTY-1 Recruit local alias:** Through a normal player action, ask Skylark to join. Assert the tool/event uses the canonical QA Lark ID, party membership changes once, the NPC is removed from ordinary location membership, and prose reflects consent without inventing player follow-through.
- **PARTY-2 Move with party:** Travel and verify QA Lark remains a party member, is represented through party state rather than duplicated in destination `npcIds`, and appears in prompt/location client data correctly.
- **PARTY-3 Dismiss:** Dismiss QA Lark. Assert party removal and placement at the player's current location.
- **PARTY-4 Remote add:** Add Moss through `updatePartyMembers`. Assert an off-location NPC can join without appearing in the old or current location list as an ordinary NPC.
- **PARTY-5 Remote remove:** Remove Moss and assert it appears at the player's current location.
- **PARTY-6 Atomic rejection:** Submit a batch containing a valid add plus unknown, duplicate, already-member, and same add/remove targets. Each invalid batch must produce no partial membership changes.
- **PARTY-7 Dead actor:** Kill or incapacitate a disposable party member and verify the supported persistence/removal behavior, corpse visibility, and no selection as an accompanying living character.
- **PARTY-8 Save/reload:** Save with local and remote party configurations, reload, and verify `partyMembers`, `isInPlayerParty`, `wasEverInPlayerParty`, location lists, and aliases.

## 11. Quest lifecycle

### Goal

Exercise offer confirmation, acceptance, decline, objective progression, pause, failure/edit state, completion, and every major reward type exactly once.

### Fixture

Use a WebSocket confirmation client that can choose accept or decline per case.

```text
@@ QA FIXTURE SETUP ONLY. Create a living quest-giver NPC named QA Archivist at the player's current location. Create a portable item named QA Sealed Record at the current location. Create or reuse a test faction named QA Archive Circle and associate QA Archivist with it if supported. Then call createQuest with a concise quest requiring the player to pick up QA Sealed Record, give it to QA Archivist, and return to the current location. Include currency, XP, QA Archive Circle reputation, and QA Archivist disposition rewards in the generated quest if the quest generator supports them. Return canonical entity IDs and the quest confirmation result.
```

After acceptance, use `POST /api/quest/edit` to make the fixture deterministic if generation omitted required reward categories: preserve the generated quest ID, set explicit objectives, reward currency/XP, faction reward, and NPC disposition reward, and ensure `rewardClaimed=false`.

### Cases

- **QUEST-1 Decline:** Restore before creation, decline the WebSocket offer, and assert no quest, objective, reward, or stale confirmation remains.
- **QUEST-2 Accept:** Accept and assert exactly one active quest with canonical giver, objectives, reward preview, and no rewards applied yet.
- **QUEST-3 Partial objective:** Pick up QA Sealed Record. Assert only the matching objective completes and the quest remains active.
- **QUEST-4 Pause:** Pause through the edit API, perform the delivery action, and assert quest checks exclude it. Unpause and repeat from the proper state.
- **QUEST-5 Complete:** Give the record to QA Archivist and satisfy the return requirement. Assert every required objective completes, the quest moves to completed state, item/currency/XP/reputation/disposition rewards apply once, and visible reward prose agrees.
- **QUEST-6 Duplicate prevention:** Take another turn and force a quest-check interval. Assert no reward repeats and `rewardClaimed` remains durable.
- **QUEST-7 Failure/edit path:** Replace an objective with an impossible or explicitly failed condition, verify it remains incomplete, then edit it back without creating a second quest.
- **QUEST-8 Event acceleration:** Set a high interval, perform an action that emits `anyQuestObjectivesCompleted`, and assert the signal accelerates one quest check and resets the counter without a duplicate prompt.
- **QUEST-9 Save/reload:** Save after partial and complete states. Verify objective IDs/statuses, reward state, giver metadata, paused flag, and completed-list placement.

## 12. Need bars and status-effect lifecycle

### Goal

Exercise threshold crossings, active audience selection, passive time changes, recovery, consumable effects, modifiers, duration expiry, and TinyBrain need-bar XML validation.

### Fixture

```text
@@ QA FIXTURE SETUP ONLY. Create a consumable item named QA Restorative Meal that applies a ten-minute target status effect named QA Well Fed with one explicit need-bar delta and one attribute modifier. Create a living NPC named QA Tired Companion at the player's current location and add it to the player's party. Return IDs, generated status-effect fields, and active need-bar definitions for both actors.
```

Give the meal to the player. Use `GET/PUT /api/player/needs` and the NPC need routes to place selected bars immediately above and below meaningful configured thresholds. Do not clamp expected values in the test harness; use the bars' configured raw ranges.

### Cases

- **NEED-1 Passive decrease — complete:** Live-verify attempt 2 passed 50/50 structured assertions. One agreed one-minute strenuous action produced one small stamina decrease for both Baato and QA Tired Companion, combined those event deltas with the ordinary one-minute passive need tick, recorded two structured need-bar summary items plus one time-passed item, left the non-party QA Courier unchanged, and emitted no realtime or changed-log errors. Human review accepted one coherent shared activity with no narrated recovery or consumption.
- **NEED-2 Recovery — complete:** Live-verify attempt 4 passed 59/59 structured assertions after deterministically relocating nearby NPCs rather than constraining generated prose. One explicit one-minute short rest applied Rest +100 and a stamina fill only to Baato after passive rates, capped stamina at its configured maximum, left the meal and QA Well Fed status untouched, kept Baato at the origin, and emitted one matching structured summary. Human review accepted one quiet stationary minute without an invented second action.
- **NEED-3 Threshold — complete:** State-only attempt 2 passed 50/50 assertions. Rest moved from exactly 150 to the next representable JavaScript number below 150, switching one unique bar from `Tired` to `Very Tired` with the canonical `-5% to health and attributes` effect metadata. Reapplying the crossed value was state-idempotent, and all other actor, inventory, status, time, location, and history state stayed unchanged. Need-threshold effects are descriptive authoritative metadata; the runtime does not parse arbitrary effect prose into numeric stat modifiers.
- **NEED-4 Consume effect — complete:** Live-verify attempt 2 passed 64/64 structured assertions. From a deliberately low Food value, exactly one normal meal produced the configured immediate +700 change to 799.3 after passive drift, while the separately stored +5-per-minute effect did not tick early. The sole meal disappeared from inventory and the global thing map; one QA Well Fed instance started at minute 664 with ten-minute duration, Constitution +2, and Food +5/minute; max/current health rose by the derived four points; and one event summary plus one status summary captured the changes. Human review accepted exactly one meal and no second action/item.
- **NEED-5 Expiry — complete:** State-only attempt 2 passed 57/57 assertions. A deterministic ten-minute QA Well Fed instance retained duration 1 and its Constitution/Food modifiers after nine minutes, contributing exactly nine +5 Food ticks. The tenth minute applied its final +5 once, removed the status, and restored derived health; an eleventh minute applied baseline drift only. No duplicate status removal or status-summary row appeared.
- **NEED-6 Audience — complete:** Live-verify attempt 1 passed 75/75 structured assertions plus prompt/prose review. The endpoints exposed four unique player bars, three party bars with Mana absent, and two non-party bars with Food/Rest absent under the exact audience flags. After relocating both NPCs, the prompt's explicit location/party participant lists were empty and Baato remained its implicit player actor; one minor spell produced exactly Baato's applicable Mana -100, with no NPC TinyBrain entry and only passive remote drift.
- **NEED-7 Invalid TinyBrain response — complete:** The source-controlled forced-output fixture `tests/fixtures/need_bar_tinybrain_invalid_outputs.json` supplies one accepted planning response, then six character-phase failures: unknown bar, case-insensitive duplicate character, case-insensitive duplicate bar, invalid direction, invalid magnitude, and an unexpected XML child. Focused parser and staged-runner tests consume all eight fixture entries exactly once through the real `LLMClient` forced-output path, verify each semantic parser diagnostic, retain the accepted planning turn exactly once, discard every malformed assistant response from the retry transcript, retry only the character phase, and finally apply the valid structured stamina change.
- **NEED-8 Save/reload — complete:** State-only attempt 3 passed 87/87 assertions. Four distinctive raw values and a QA Well Fed status were advanced to minute 666 and duration 7, saved normally, deliberately overwritten/removed and advanced, then reloaded with exact current values, original starting baselines, status identity, `duration`, `appliedAt`, Constitution +2, Food +5/minute, derived health, clock, inventory, and persisted save notice intact. The next minute advanced every passive rate once, applied one Food status tick, and reduced duration to 6 at minute 667. The run exposed and fixed hydration replacing each persisted `initialValue` with its current raw `value`; focused Player round-trip tests protect that distinction.

## 13. Stealth and hidden NPCs

### Goal

Exercise hidden creation, automatic opposed perception, explicit search, hiding, reveal/hide events, combat reveal, corpse visibility, and save persistence.

### Fixture

```text
@@ QA FIXTURE SETUP ONLY. Create a living NPC named QA Veiled Scout at the player's current location with hiddenFromPlayer true, high stealth-oriented abilities, and alias Whisper. Create a second visible living NPC named QA Loud Decoy with low hiding ability. Return IDs, aliases, hidden flags, skills, and location membership.
```

Use `<f>` plus the WebSocket responder for deterministic low/high perception or hiding rolls when the applicable tool requests one.

### Cases

- **HIDE-1 Automatic failure — complete:** The immutable `stealth-hidden-npcs` fixture was created through two required `@@` calls and authoritative normalization, preserving hidden QA Veiled Scout (`char_40`, alias Whisper, Dexterity/Stealth 20/20) and visible QA Loud Decoy (`char_41`, 1/0) at March Start Marker. State-only attempt 1 passed 39/39 assertions: after a story-tool separation and ordinary return, mathematically inferior Wisdom/Perception 1/0 produced exactly one automatic opposed major failure, Scout stayed hidden with no sighting fields, the only new history row was `check-results` with `hiddenFromClient: true`, time did not advance, and no player-action, event-summary, prompt, realtime error, or changed error log appeared. Because the automatic route emitted no assistant prose, there was no narrative channel for an identity leak.
- **HIDE-2 Explicit search success — complete:** The declarative scenario uses the immutable stealth fixture, isolates unrelated NPCs, forces a 20 for Baato's explicit alias-targeted search, and requires one authoritative opposed check, one check-results row, `hiddenFromPlayer=false`, a location refresh, one player action, and one event summary. Live-record attempt 7 and independent live-Qwen attempt 9 passed 41/41 assertions with accepted single-search/reveal prose; strict replay attempt 8 consumed all 38 ordered completions with zero failures and no llama.cpp traffic. The run fixed a duplicate-roll defect by passing player-action check metadata through the XML event branch and reusing the exact actor/opponent/configured-skill match once. Omitted or alternate valid attributes no longer cause a second roll when the configured skill pair identifies the same check, while wrong skill pairs remain nonmatching. The source cassette SHA-256 is `0492b356b177f4acdec52498fc3d0f70f7ebce6a47d7432ff9d05fe169a7b0bc`.
- **HIDE-3 Explicit search failure — complete:** Live-verify attempt 1 passed 43/43 assertions and human review. The immutable fixture restored Scout at Dexterity/Stealth 20/20 and lowered Baato to Wisdom/Perception 1/0; an alias-targeted `<f>` search with injected die 1 produced exactly one critical-failure Perception-vs-Stealth tool result and one check-results row. Scout remained hidden at the same location with both last-seen fields null, no location refresh was emitted, and the response added only the expected action/summary bookkeeping without realtime or changed-log errors. The prose described an unsuccessful search without locating, identifying, approaching, revealing, or interacting with Scout.
- **HIDE-4 Visible NPC hides — complete:** The immutable stealth fixture and declarative scenario make QA Loud Decoy perform one promised hiding demonstration while Baato watches, with `<f>` supplying an exact actor die of 20. Live-record attempt 6 and independent live-Qwen attempt 8 passed 43/43 assertions and human review; strict no-llama replay attempt 7 consumed all 39 ordered completions with zero failures. The turn produced exactly one `resolveOpposedSkillCheck` for QA Loud Decoy versus Baato, one check-results row, one action/summary pair, one location refresh, and `hiddenFromPlayer=true` without movement or runtime errors. The repair added a structured TinyBrain checkpoint that selects the exact actors allowed to perform meaningful checked non-attack actions. Canonical names and aliases parse into canonical actors; an omitted tool `actor` is supplied only when the checkpoint selected exactly one actor, an explicit actor outside the selected set is rejected, and an actor cannot oppose itself. This changes structured prompting and domain validation only; no prose wording detector was added. The source cassette SHA-256 is `f4785f137ff4bbbf7b3f709b9e50c4d9c57460d78d04d7107ca54e4d9dc58bbf`.
- **HIDE-5 Attack reveal — complete:** The immutable stealth fixture makes QA Veiled Scout perform one precommitted controlled surprise attack while hidden, with `<1>` forcing a clean miss. Live-record attempt 5 and independent live-Qwen attempt 7 passed 42/42 assertions and human review; strict no-llama replay attempt 6 consumed all 39 ordered completions with zero failures. Exactly one `resolveAttack` result identifies Scout as attacker and canonical Baato id/name as defender, records die 1 and a miss, leaves Baato's health unchanged, reveals the living Scout in place, requests one location refresh, and stores one check/action/summary set without runtime errors. The run fixed zero-damage hits failing during post-resolution percentage formatting and miss summaries omitting their already-resolved defender id. Zero-damage formatting now uses authoritative attack-outcome health, and single-target summaries retain defender id plus maximum health. A mechanically passing record whose prose turned the miss into light contact was rejected and preserved with attempt 4; prompt guidance was corrected without adding any prose inspection. The source cassette SHA-256 is `827b157ccb7fbc30278527312a40ca3c5a815b3b2c350414a36687dfcb361e78`.
- **HIDE-6 Corpse visibility — complete:** State-only attempt 1 passed 59/59 assertions. The authoritative NPC update killed the already-hidden QA Veiled Scout while also requesting `hiddenFromPlayer=true`; the domain model normalized the result to zero health, `isDead=true`, `hiddenFromPlayer=false`, and a five-turn corpse countdown while retaining the corpse in its location. A second explicit concealment update still returned and persisted `hiddenFromPlayer=false`, and both the full NPC status and location client payload exposed exactly one visible corpse. Last-seen fields, time, history, realtime errors, and error logs remained unchanged. No production defect or model cassette was involved.
- **HIDE-7 Movement — complete:** `HIDE-7-hidden-movement.json` restores the immutable stealth fixture, lowers Baato's perception, and sends hidden Scout through one forced `npcDeparture` to Stairwell and one forced `npcArrival` back to March Start Marker. Live-record attempt 10 and independent live-Qwen attempt 12 passed 76/76 assertions; strict no-llama replay attempt 11 consumed all 19 ordered completions with no provider traffic. Both event legs returned canonical `QA Veiled Scout` update names, moved the same actor id, and preserved concealment and null last-seen fields. The forced event branch intentionally performs no arrival finalization, so the scenario then separates Baato with a story-tool teleport and returns him through normal player-arrival processing. That first shared-location transition produced exactly one client-hidden automatic opposed-check failure and left Scout concealed. The run fixed result builders leaking lowercase names from sanitized tracking sets by resolving stored keys back to authoritative actor names. It also strengthened the TinyBrain character-presence checkpoint to require `npcArrival` when current prose physically places an absent actor in the scene, including a hidden arrival, while excluding plans, memories, mentions, and offscreen actions. No prose matcher was added. The source cassette SHA-256 is `b8bc8ad5270ea9f65b73c70a64bbb1c0f34dc6d4d868a684c2a01a69130205b3`.
- **HIDE-8 Save/reload:** Verify hidden flags, last-seen tracking, location membership, and client filtering after hydration.

## 14. Long time advancement

### Goal

Exercise large durations, date/time transitions, need/status ticks, scheduled events, vehicle arrival, WYWA age calculation, and deterministic ordering.

### Fixture

```text
@@ QA FIXTURE SETUP ONLY. Create a visited test destination named QA Long Rest Lodge connected to the current location. Create a living NPC named QA Lodge Keeper there. Create a ten-minute status-effect consumable named QA Short Tonic. Schedule one event at the player's current location in 30 minutes and another at QA Long Rest Lodge in 45 minutes. Return all IDs and scheduled-event timing.
```

Visit and leave QA Long Rest Lodge once so it has valid visit timestamps. Configure a vehicle trip in a separate fixture to arrive during the long action when testing combined ordering.

### Cases

- **TIME-1 Multi-hour rest:** Drink QA Short Tonic, then submit a normal action sleeping/resting for eight hours. Assert parsed duration, exact world-minute advancement, status expiry, need ticks, date/time label changes, and no duplicate time application from event checks.
- **TIME-2 Midnight:** Start shortly before midnight and cross it. Assert day index, weekday/date, lighting, holiday, weather, and persisted player time are coherent.
- **TIME-3 Season boundary:** Use a disposable fixture near a configured season boundary and cross it. Assert season/weather recalculation once and correct prompt/client labels.
- **TIME-4 Scheduled ordering:** Cross both due times in one action. Assert due events resolve in canonical order, each once, with correct onscreen/offscreen visibility.
- **TIME-5 Vehicle arrival:** Cross a vehicle ETA during the action. Assert vehicle finalization occurs once and before later systems consume the final location where required.
- **TIME-6 WYWA age:** Remain away beyond threshold and return. Assert expected-arrival absence uses start time plus travel duration and WYWA applies only after the destination's affirmative pre-arrival snapshot.
- **TIME-7 Save/reload:** Save immediately before and after a boundary. Verify absolute-minute fields, remaining effect durations, scheduled-event resolution state, and visit timestamps.

## 15. Random and scheduled events

### Goal

Exercise guaranteed random-event dispatch, visible and offscreen scheduled resolution, interruption rewriting, skipped events, mutation tools, and idempotency.

### Fixture

Use a temporary override with random events enabled and the relevant frequency forced to a deterministic always-run value for the case; keep it disabled for scheduled-only cases.

```text
@@ QA FIXTURE SETUP ONLY. Create a living NPC named QA Bell Runner and a portable item named QA Brass Bell at the player's current location. Create another location named QA Offscreen Depot connected to the current location. Schedule a current-location event in 2 minutes in which QA Bell Runner rings QA Brass Bell, and an offscreen event at QA Offscreen Depot in 3 minutes that moves or alters a test object there. Return all IDs and scheduled-event records.
```

### Cases

- **EVENT-1 Random current-location:** Take an ordinary turn with deterministic random triggering. Assert one random-event prose entry, appropriate tools/events, and no second dispatch from the same turn.
- **EVENT-2 Random party/location/region categories:** Run each configured category from an isolated restore and verify its context and state changes are scoped correctly.
- **EVENT-3 Visible scheduled:** Advance past 2 minutes while present. Assert scheduled-event resolution, visible player prose, hidden summary, mutations, and `resolved=true` exactly once.
- **EVENT-4 Offscreen scheduled:** Move away before due time, advance past it, and assert hidden/offscreen processing without inappropriate visible prose.
- **EVENT-5 Long-action interruption:** Schedule an event inside a normal action's duration. Assert the interruption rewrite changes player-facing prose only, preserves time/movement/hidden/state XML, and folds into the same action instead of adding contradictory narration.
- **EVENT-6 Skipped event:** Create an event whose precondition is false by due time. Assert it is marked skipped/resolved only after validated final output and applies no mutation.
- **EVENT-7 Tool failure:** Make one scheduled mutation target invalid. Assert structured tool error handling, no duplicate successful calls, and coherent final status according to the scheduled-event contract.
- **EVENT-8 Save/reload/idempotency:** Reload after resolution and advance again. Assert no event replays.

## 16. Relationship and faction mutations

### Goal

Exercise NPC-to-NPC directed relationships, reciprocal updates, player dispositions, faction standing with witnesses, hostility transitions, summaries, and persistence.

### Fixture

```text
@@ QA FIXTURE SETUP ONLY. Create two factions named QA Lantern Guild and QA Cinder Guild with neutral initial relations. Create living NPCs QA Lantern Witness and QA Cinder Witness at the player's current location, each assigned to the correspondingly named faction. Create a third NPC named QA Private Contact at QA Offscreen Depot. Set no NPC-to-NPC relationship labels initially. Return all faction and NPC IDs, memberships, standings, dispositions, relationships, and hostility state.
```

If generation does not assign exact factions, use `updateObjectFields` on the NPC records after resolving faction IDs. Record all initial player standings and disposition values.

### Cases

- **REL-1 Directed relationship:** In a normal story action, cause QA Lantern Witness to trust QA Cinder Witness. Assert one directed label of six words or fewer and no reverse edge.
- **REL-2 Reciprocal relationship:** Establish different forward/reverse labels and assert both exact edges. Update one direction and ensure the other remains unchanged when omitted.
- **REL-3 Player disposition:** Help QA Lantern Witness in a witnessed concrete action. Assert the appropriate player-facing disposition delta once and a matching reason.
- **REL-4 Faction reputation witnessed:** Perform a Lantern Guild-relevant action with QA Lantern Witness present. Assert the standing delta and visible summary.
- **REL-5 No witness:** Restore and perform the same action without any Lantern witness/player/party member carrying that faction. Assert no faction standing change.
- **REL-6 Hostility transition:** Drive disposition/relationship across the configured hostile threshold and back. Assert `isHostileToPlayer`, combat/trade eligibility, and UI state use current dispositions rather than a stale raw flag.
- **REL-7 Housekeeping updates:** Trigger add, update, and remove relationship/tracker-style maintenance output. Assert player-visible relationship update entries are excluded from future prompt history.
- **REL-8 Save/reload:** Verify faction IDs, standings, directed relationship maps, dispositions, and hostility derivation.

## 17. Progression

### Goal

Exercise level-up gating, generated ability cards, partial preselection, sequential missing levels, invalid submissions, skill spending, and NPC/player separation.

### Fixture

No generated entity is required for the core flow. Optionally create a trainer for coherent prose:

```text
@@ QA FIXTURE SETUP ONLY. Create a living non-hostile NPC named QA Trainer at the player's current location. Do not change player level, XP, skills, abilities, or pending options. Return the trainer ID and the player's current progression summary.
```

### Cases

- **PROG-1 Level up:** Call `POST /api/player/levelup`. Assert level and max/current health update, a level-up entry is recorded, and pending ability selection is reported without silently assigning abilities.
- **PROG-2 Gameplay gate:** While pending, call `/api/chat` and `/api/player/move`. Require documented 409 responses with pending selection and no gameplay mutation.
- **PROG-3 Generate cards:** Call `GET /api/player/ability-selection`. Assert the configured number of unique option cards for the lowest missing level, excluding current/declined abilities.
- **PROG-4 Submit:** Select exactly `player_abilities_per_level` valid options. Assert assignment to the correct level, pending state advances or clears, and selected names are not added to declined abilities.
- **PROG-5 Invalid submissions:** Test wrong level, too few/many choices, duplicate names, unknown names, and duplicate declined names. Each must fail atomically.
- **PROG-6 Partial preselection:** Build a fixture with one existing ability at a missing level. Assert it appears selected, only the needed number of new options is generated, and it may be toggled off in favor of another valid option.
- **PROG-7 Multiple missing levels:** Raise the player several levels with gaps. Assert levels are handled lowest-first, sufficient levels are skipped, and gameplay remains gated until every gap is filled.
- **PROG-8 Skill spend:** Award enough XP/level-derived points, increase one valid skill, and assert formula-derived unspent points decrease. Test unknown skill and overspending errors.
- **PROG-9 NPC separation:** Level QA Trainer or another NPC. Assert NPC abilities remain auto-generated/assigned and no player modal/pending state is created.
- **PROG-10 UI:** Use Playwright to verify card selection, exact-count validation, submit state, sequential reopening, keyboard/focus behavior, and chat/travel blocking. Capture screenshots and console errors.
- **PROG-11 Save/reload:** Persist pending options, declined choices, and completed selections and verify hydration resumes the same level without regeneration drift.

## 18. Alternative prompt modes and rejection paths

### Goal

Exercise every chat dispatch prefix, history type, tool scope, slop behavior, interactive roll path, explicit rejection, and impossible-action handling.

### Fixture

```text
@@ QA FIXTURE SETUP ONLY. Create a living NPC named QA Prompt Witness and a portable item named QA Prompt Coin at the player's current location. Make no other changes. Return both IDs and the complete current location name.
```

This first `@@` request is itself recorded as setup, not as the `ALT-6` behavioral assertion.

### Cases

- **ALT-1 Question (`?`):** Ask a factual question about the visible fixture. Assert `user-question`/`storyteller-answer` history, no event/random/NPC resolution, no slop-remover pass, and no world mutation.
- **ALT-2 Creative (`!`):** Request a creative action and assert the creative template/family, permitted prose/events, and history type.
- **ALT-3 Forced event (`!!`):** Force one narrowly described event involving QA Prompt Coin. Assert it occurs once, through the forced-event path, without unrelated mutations.
- **ALT-4 Generic (`@`):** Ask for an in-context answer without mutation. Assert generic history/tool behavior and slop-remover bypass.
- **ALT-5 Elevated generic (`@@`):** Use a reversible mutation on QA Prompt Coin and verify full tool-loop execution plus tool-call-debug data. Restore afterward.
- **ALT-6 Highest/no-context variants (`@@@` and `\`):** Verify their documented context differences, mutation scope, history storage, and slop-remover bypass without leaking stale fixture information where context should be absent.
- **ALT-7 Interactive roll (`<f>`):** Submit a skill action that must call `resolveSkillCheck`, answer the WebSocket request with exact low and high rolls from separate restores, and assert the roll is stripped from stored action text and injected once into the matching check.
- **ALT-8 Explicit rejection:** Attempt an action the prompt should reject without mechanics, such as controlling an unrelated NPC or asserting impossible ownership. Assert a clear rejection response, user entry exclusion where specified, and no events/time/state changes.
- **ALT-9 Impossible checked action:** Attempt a physically impossible action that reaches plausibility/check handling. Assert failure prose and mechanics agree and no requested impossible mutation occurs.
- **ALT-10 Tool limits/errors:** Request an ambiguous object and an invalid `moreInfo` scene number or mutation. Assert structured `<toolError>`, diagnostic log, model recovery or clean completion, and no server crash.
- **ALT-11 Cancellation:** Cancel one long-running prompt and one pending `<f>` input. Assert prompt cleanup and no partial world mutation; test Stop & Undo separately if whole-turn rollback is desired.
- **ALT-12 History audit:** Fetch full and ordinary history. Verify each mode's entry types, hidden/excluded flags, and whether it appears in subsequent base context according to its contract.

## Follow-up execution order

Run the scenarios in this order to maximize early coverage of the recently changed code while keeping fixture complexity manageable:

1. Broader combat.
2. Checked containers.
3. Inventory and equipment.
4. Party membership.
5. Quest lifecycle.
6. Vehicle travel.
7. Cross-region exploration and fast travel.
8. Processing, harvest, salvage, and crafting failures.
9. Commerce.
10. Need bars, stealth, and long time advancement.
11. Random/scheduled events and relationship/faction changes.
12. Progression and alternative prompt modes.

After every repaired failure, rerun the exact failing case, the other cases in that scenario, and the relevant focused automated suites. At the end, reload the original baseline and run one ordinary stationary turn to confirm the test fixtures and configuration overrides did not leak into normal play.

## Required UI checkpoints

The API remains authoritative, but the following cases also require a headed or headless Playwright inspection because important behavior is client-visible:

- **Vehicle and maps:** exit visibility while underway, vehicle destination/ETA presentation, fast-travel preview and confirmation, final map location, and companion display.
- **Containers and inventory:** failed-open gating, permanent-open behavior, both inventory columns, stack counts, transfer summaries, and the absence of impossible drag targets.
- **Equipment/modules:** active slot, replaced item, derived-stat display, installed-module nesting, and hidden standalone module rows.
- **Commerce:** offer lists, counts/prices, currency totals, haggle history, refusal state, shortfall confirmation, and the final trade summary.
- **Combat:** player/NPC health, defeated/incapacitated state, grouped area-attack details, effectiveness multiplier, and absence of prose/mechanics disagreement.
- **Quests:** confirmation preview, partial objectives, pause state, completed placement, and reward presentation.
- **Needs/stealth:** threshold/status labels and strict absence of hidden NPC identity before reveal.
- **Progression:** ability cards, exact selection count, submit gating, sequential levels, and gameplay blocking.
- **Alternative modes:** entry types, error popup/rejection display, prompt cancellation state, and full-history visibility rules.

For each checkpoint, capture the relevant gameplay state rather than only the initial page. Visually inspect every screenshot and treat missing or contradictory UI state as a failed case even when the API snapshot is correct.

## Automated regression gate after a fix

After fixing a discovered defect:

1. Run syntax checks for every altered JavaScript file.
2. Use `rg --files tests` to select the focused suites for the affected subsystem; include parser, API, model, and UI tests when those layers changed.
3. Rerun the live case from its saved fixture.
4. Rerun all other cases in that scenario that share the changed path.
5. Run the TinyBrain runner/parser/event suites whenever a staged prompt, parser, or event application rule changed.
6. Run the browser test and inspect screenshots whenever player-visible rendering changed.
7. Update this document by checking off only cases that passed mechanically, narratively, after persistence, and without new console/server errors.
