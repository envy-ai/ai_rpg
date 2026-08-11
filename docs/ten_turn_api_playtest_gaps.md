# Ten-Turn API Playtest Coverage Gaps

This document records notable supported gameplay actions that were not exercised during the ten-turn backend API playtest completed on 2026-08-08. It is a follow-up testing checklist, not a list of known defects.

The playtest did cover ordinary NPC interaction, dialogue-triggered movement with an alias companion, scenery inspection with an ability, ordinary crafting, repair work, direct movement, single-target attacks that missed and killed, persistent enemy death, item pickup, stationary play, and elapsed-time processing. The three dedicated movement checks performed immediately before the ten turns are not counted as part of the ten-turn coverage below.

The comprehensive fixture, execution, assertion, persistence, and evidence plan for every item below is in [ten_turn_api_playtest_followup_plan.md](ten_turn_api_playtest_followup_plan.md).

## Untested or only partially tested actions

- [ ] **Vehicle travel:** board a vehicle, move inside it, disembark, depart, stop, redirect, reach an ETA, and carry objects through vehicle travel.
- [ ] **Cross-region exploration:** enter another region, expand destination stubs, discover new locations or exits, and travel to a model-selected unknown destination.
- [ ] **Map and Favorites fast travel:** preview a route, confirm travel, account for graph travel time, move companions, and run arrival processing through the teleport-backed path.
- [ ] **Checked containers:** attempt a locked or checked container, exercise success and failure, permanently unlock it when applicable, and move items into and out of it.
- [ ] **Inventory operations beyond pickup:** drop or give items, split and merge stacks, move items through containers, consume an item, and apply its status effect.
- [ ] **Equipment:** equip, replace, and unequip gear; verify derived attribute changes and installed item-module behavior.
- [ ] **Commerce:** open a barter session, generate or refresh merchant stock, buy, sell, haggle, reject an offer, and exercise temporary trade refusal expiry.
- [ ] **Other crafting modes:** process, harvest, salvage, construct scenery, fail a crafting action, and produce a critical failure. Ordinary crafting and repair were covered.
- [ ] **Broader combat:** run friendly and hostile NPC attacks, damage the player, use area and opposed attacks, inflict status effects, heal, incapacitate without killing, revive, flee, and move during combat. NPC attack behavior was covered by automated tests but not by the final live playthrough because NPC turns were disabled.
- [ ] **Party membership:** recruit and dismiss party members and reconcile an off-location party member. Alias-based accompaniment without changing membership was covered.
- [ ] **Quest lifecycle:** intentionally accept a quest, advance multiple objectives, fail or pause one, complete it, and receive item, currency, reputation, and disposition rewards. A generated quest was declined during the playtest, but a complete quest flow was not exercised.
- [ ] **Need-bar and status-effect lifecycle:** reach meaningful hunger or fatigue thresholds, apply automatic penalties, recover, expire timed effects, and verify status-driven mechanical changes.
- [ ] **Stealth and hidden NPCs:** hide, run opposed perception, reveal or fail to reveal a hidden NPC, preserve concealment after failure, and attack from concealment.
- [ ] **Long time advancement:** rest or sleep, cross time-of-day, day, or season boundaries, trigger scheduled events and vehicle arrivals, and produce substantial while-you-were-away changes.
- [ ] **Random and scheduled events:** enable and trigger a random event; schedule an event; resolve it onscreen and offscreen; and interrupt a long player action. Random events were disabled during the playtest.
- [ ] **Relationship and faction mutations:** change NPC-to-NPC relationships, player-facing dispositions, faction standing, witnessed reputation, and hostility state.
- [ ] **Progression:** level up, spend skill points, select level-up abilities, and verify gameplay blocking while an ability selection is pending.
- [ ] **Alternative prompt modes:** exercise question (`?`), creative (`!`), forced-event (`!!`), generic/admin, interactive `<f>` roll, explicit rejection, and impossible-action paths.

## Suggested priority for a follow-up session

1. Live NPC combat turns, player damage, incapacitation, and recovery.
2. Checked containers plus give, drop, consume, equip, and stack operations.
3. Vehicle travel and cross-region/stub expansion.
4. Full quest acceptance, objective progression, completion, and rewards.
5. Barter, harvest, salvage, processing, and long-duration event handling.
6. Stealth, progression, relationships, factions, and alternative prompt modes.
