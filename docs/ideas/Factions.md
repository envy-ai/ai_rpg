# Faction System (Design Draft)

## Goals

- Create systemic, emergent conflict and cooperation across regions and NPCs.
- Make player choices matter through reputation shifts and world-state changes.
- Provide repeatable content loops (quests, patrols, trade, politics) without fixed lore.

## Core Concepts

- **Faction**: An organization with goals, assets, and relationships to other factions.
- **Standing**: Player-specific reputation with each faction (numeric + tier).
- **Presence**: How strongly a faction operates in a region/location (influence, patrols, services).
- **Relations**: Diplomatic ties between factions (allied, neutral, hostile, rival) with a short relationship note.
- **Assets**: Controlled resources, outposts, NPCs, or services that provide systemic effects.

## Data Model (Proposed)

- `Faction`
  - `id`, `name`, `tags` (ideology/archetype), `goals`, `homeRegionName`
  - `relations`: map of `factionId -> { status, notes }` (`status` is allied/neutral/hostile/rival)
  - `assets`: list of outposts, trade routes, leaders
  - `reputationTiers`: thresholds + perks/penalties
- `FactionStanding` (per player)
  - `factionId`, `value` (-100..100), `tier`, `lastChangedAt`, `flags` (banned, sworn, undercover)
- `FactionPresence`
  - `regionId`/`locationId`, `factionId`, `influence` (0..100), `lawLevel`, `patrolRate`, `services`
- `FactionEvent`
  - `type`, `factionId`, `targetFactionId?`, `locationId?`, `effects` (standing deltas, resource shifts)

## Engagement Features (10)

1. **Reputation Tiers & Perks**
   - Unlock discounts, safe houses, special dialogue, and faction-only items.
2. **Territory Control**
   - Factions control regions; control changes alter encounter tables and law enforcement.
3. **Dynamic Diplomacy**
   - Alliances/hostilities shift based on events; player actions can influence treaties.
4. **Faction Contracts (Quest Lanes)**
   - Repeatable quests tied to faction goals; branching outcomes affect standings.
5. **Economic Pressure**
   - Faction trade routes change prices, scarcity, and crafting inputs.
6. **Patrols and Checkpoints**
   - Presence spawns patrols; high law level means inspections and fines.
7. **Leadership & Succession**
   - Leaders can be removed/installed, causing ideology shifts and new policies.
8. **Infiltration & Cover**
   - Undercover status allows access but risks exposure; exposure triggers manhunts.
9. **Faction Warfare Events**
   - Large-scale events (raids, sieges) change region state and NPC populations.
10. **Recruitment & Party Ties**

- High standing unlocks faction companions, training, or passive buffs.

## Systemic Behavior Rules

- Standing changes from quests, combat, theft, or aid.
- Influence drift over time (decay, growth from events, suppression from rivals).
- Relations gate NPC default disposition toward the player.
- Faction presence modifies random events (patrols, ambushes, aid caravans).

## Integration Touchpoints (Existing Systems)

- **Player**: add `factionStanding` map; surface standing in `getStatus()`.
- **Quests**: add `factionId` and `reputationDelta` on completion/failure.
- **Events**: add faction outcomes in event checks to update standing/presence.
- **NPC Generation**: add `factionId` on NPCs; default dispositions from relations.
- **Region/Location**: add `controllingFactionId` and `presence` in metadata.
- **Globals**: store `factions`, `getFactionById`, and helpers for standing changes.
- **Save/Load**: include factions, standings, and presence in serialize/hydrate.

## Implementation Sketch

1. Add a faction-generation prompt and parse the XML at new-game time.
2. Add standing changes to quest completion and combat outcomes.
3. Extend random events to include faction patrols and conflicts.
4. Add UI hooks for standing tiers and region control indicators.
5. Persist faction state in save files.

## Suggested Fixes for Coherence

- Use a single standing scale and tier table to avoid mixed systems.
- Make all faction-driven prompts log via `LLMClient.logPrompt`.
- Add list of factions to base-context.xml.njk and the function that prepares its context. The list should include each faction's name, short description, and relations with the other factions.
- Player class faction standings should be listed

## TODO: Remaining Implementation Steps (Detailed)

1. **Finalize XML schema + generation prompt**
   - Add an LLM prompt that generates factions at new-game time (no defs file).
   - Make the faction count configurable via `config.factions.count` (default 5, set to 0 to disable generation).
   - Define a canonical standing scale (e.g., -100..100) and shared tier thresholds.
   - Add validation rules for relations (`allied|neutral|hostile|rival`, with required notes) and tier ordering.

2. **Core model wiring**
   - Ensure `Faction.js` is loaded in the appropriate bootstrap file (likely `server.js`) and expose via `Globals.factions`.
   - Add helper functions to `Globals`: `getFactionById`, `getFactionByName`, `adjustFactionStanding`, `getFactionStandingTier`.

3. **Player standings**
   - Extend `Player` with a `factionStandings` map (`factionId -> { value, tier, lastChangedAt, flags }`).
   - Add methods: `getFactionStanding(factionId)`, `setFactionStanding(factionId, value)`, `adjustFactionStanding(factionId, delta)`.
   - Include standings in `Player.getStatus()` and `Player.toJSON()`; hydrate in `Player.fromJSON()`.

4. **Region/location presence**
   - Add `controllingFactionId` and `factionPresence` metadata to `Region` and `Location`.
   - Define a shared presence schema: `{ influence, lawLevel, patrolRate, services }`.
   - Update serialization to include presence data and controlling faction info.

5. **Quest integration**
   - Add optional `factionId` and `reputationDelta` fields to `Quest` and its serialization.
   - When quests complete/fail, apply standing deltas via `Player.adjustFactionStanding`.

6. **Event checks + outcomes**
   - Extend event prompts to capture faction involvement (patrols, raids, diplomatic changes).
   - Add parsing and handler steps in `Events` to apply standing/presence changes.

7. **NPC generation + disposition**
   - Add `factionId` to NPC generation templates and stored NPC metadata.
   - Derive default disposition toward the player from faction relations and player standing tiers.

8. **UI/UX surfaces**
   - Add faction summaries to `base-context.xml.njk` for LLM context.
   - Expose faction list and standings in client UI (overview panel, tooltips, etc.).

9. **Persistence**
   - Update save/load pipelines to persist factions, standings, presence, and relations.
   - Ensure new fields remain backward-compatible with existing saves.

10. **Testing + validation**
   - Add unit tests for standing adjustments and tier resolution.
   - Add smoke tests for save/load integrity with faction data.
