# Vehicles 2 (Setting-Agnostic Brainstorm)

This doc is a player-facing–first brainstorm for adding vehicles to the game across items, scenery, NPCs, locations, and regions. The goal is a broad mix of travel, ownership, and world-building options that can flex to any setting.

## Player-facing feature ideas (priority)

- **Acquisition + ownership:** buy, craft, steal, inherit, win in quests, or get faction-issued vehicles; optional registration/ownership disputes.
- **Travel + routing:** choose vehicles per route; unlock new paths (water, air, rough terrain); faster travel with tradeoffs (risk, fuel, exposure).
- **Party + crew:** seats/crew slots, passenger comfort, party-wide buffs/penalties, and shared travel decisions.
- **Cargo + logistics:** vehicle storage, hauling limits, mounted inventory, and trade route gameplay.
- **Upgrades + customization:** modular parts, vanity skins, enchantments, armor plating, engine swaps, and unique “signature” vehicles.
- **Maintenance + durability:** wear and tear, repair loops, refuel/restock mechanics, and emergency fixes mid-journey.
- **Risk + events:** breakdowns, ambushes, storms, checkpoints, or smuggling inspections; vehicle-centric mini-quests.
- **Social + faction hooks:** faction permits, black-market upgrades, stolen vehicle bounties, and vehicle reputation/legend.
- **Discovery:** new vehicle types as regional or cultural flavor (e.g., desert skimmers, river barges, mountain beasts).

## Vehicle archetypes by entity type

### Items (portable or equippable vehicles)

- Foldable boats, collapsible gliders, hoverboards, exo-suits, or “ride tokens” for summoned mounts.
- Vehicle kits that transform items or scenery into temporary transport.
- Consumable boosters (speed bursts, emergency repairs, stealth cloaks).

### Scenery (parked, docked, or fixed vehicles)

- Docked ships, parked wagons, airship moorings, railcars, or sled stations at a location.
- Interactive scenery: board, stow gear, repair, or upgrade from a fixed spot.
- Broken vehicle set pieces that seed quests (salvage, rebuild, escort).

### NPCs (rideable or driver characters)

- Rideable beasts, trained drivers, sentient vehicles, or hired pilots.
- NPC-led convoys or caravans that move between locations on a schedule.
- Relationship-driven perks: loyal driver reduces risk; reckless pilot increases speed but raises hazard chance.

### Locations (vehicle hubs)

- Stables, docks, garages, hangars, caravanserai, ferry terminals, and repair shops.
- Location services: rentals, refueling, upgrades, storage, and crew hiring.
- Location events: vehicle races, inspections, or permits to access restricted routes.

### Regions (vehicle-dependent zones)

- Oceans, skyways, desert trails, underground tunnel networks, or orbital belts.
- Region rule: some regions require a vehicle type or offer vehicle-specific advantages.
- Region-level hazards: storms, bandit choke points, reefs, sand seas, or anti-air zones.

## Travel + encounter loop ideas

- **Route selection:** choose a safe/slow route or risky/fast shortcut.
- **Mid-journey events:** breakdowns, ambushes, weather, tolls, or rescue encounters.
- **Outcome variations:** arrive early with reputation bumps, or arrive late with damage/fuel loss.

## Progression + customization

- Tiered vehicle classes with unique perks (speed, cargo, stealth, survivability).
- Modular attachment slots (cargo racks, weapon mounts, navigation aids).
- Story progression unlocks special vehicle types or “legendary” variants.

## Economy + crafting hooks

- Vehicle crafting lines that use rare materials, encouraging exploration and trade.
- Salvage and repair loops for ruined vehicles in the world.
- Rental and escort services to create ongoing money sinks and risk-reward decisions.

## Light implementation considerations

- **Data model:** vehicle entity type, size, capacity, speed tier, terrain tags, durability, fuel/charge, crew slots, and ownership.
- **Travel rules:** exits or paths can require vehicle tags; vehicle choice adjusts travel time and event odds.
- **UI:** a vehicle card (current vehicle, condition, cargo) plus a quick “board/ride” action.
- **Prompt/event hooks:** include vehicle context in travel prompts; add vehicle-specific hazards and rewards.
- **Persistence:** store vehicle state with owner or location; preserve condition and loadout.
- **Balancing:** cap early access to advanced vehicles; trade speed for risk and upkeep.

## Open questions

- How strict should vehicle requirements be for travel: hard locks or soft risk modifiers?
- Should vehicles be single-owner, party-owned, or location-owned (rentals)?
- What is the right minimum set of stats to keep vehicles meaningful but not overwhelming?
- How does vehicle loss work: temporary downtime, permanent loss, or insurance system?
