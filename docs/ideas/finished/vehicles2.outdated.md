# Vehicles 2 (Outdated Setting-Agnostic Brainstorm)

This archive brainstorm explored a broad, player-facing vehicle system across items, scenery, NPCs, locations, and regions. It predates the current implementation. Use the current docs for authoritative behavior, especially [VehicleInfo](../../classes/VehicleInfo.md), [Location](../../classes/Location.md), [Region](../../classes/Region.md), [LocationExit](../../classes/LocationExit.md), [common API shapes](../../api/common.md#vehicleinfo-vehicleinfotojson), [map UI notes](../../ui/maps.md), and [`/vehicle_status`](../../slashcommands/VehicleStatusCommand.md).

## Current Project Behavior

Vehicles currently exist as travel-aware metadata on locations and regions, not as a standalone `Vehicle` entity.

- `Location.isVehicle` and `Region.isVehicle` are derived from whether `vehicleInfo` is present.
- `VehicleInfo` stores the implemented vehicle state: `terrainTypes`, `icon`, `currentDestination`, `pendingDestination`, fixed-route `destinations`, `ETA`, `departureTime`, and `vehicleExitId`.
- Region vehicles represent large moving interiors, such as ships or trains with multiple onboard locations. Location vehicles represent a single vehicle location.
- `Player.currentVehicle` exposes the active vehicle context for prompts and UI. When both apply, the containing vehicle region takes priority over the current location.
- Vehicle movement supports immediate retargeting and timed trips. Timed trips use `pendingDestination`, `departureTime`, and `ETA`; arrival finalization resolves the destination and retargets the tracked vehicle exit.
- Vehicle exits are hidden from map/location payloads while a vehicle is underway or has reached its ETA but still needs arrival finalization.
- `LocationExit.isVehicle` and `LocationExit.vehicleType` describe a travel edge, such as boarding or disembarking. They do not by themselves mean the destination is a vehicle.
- Maps and the Adventure UI render vehicle icons, underway destination text, remaining travel time, progress, and vehicle current-location context.
- Location, region, and stub editors can edit vehicle metadata, including fixed routes and pending-region route entries.
- `/vehicle_status` displays the current player's active vehicle route, destination, ETA, vehicle exit, icon, and terrain tags.
- `Thing.isVehicle` exists as a persisted item/scenery flag and prompt/UI hint, but the canonical moving-vehicle route/timing model is still `VehicleInfo` on locations or regions.

## Not Implemented From This Brainstorm

The following ideas remain archive context rather than current behavior:

- A first-class vehicle entity type with ownership records.
- Registration, theft/bounties, insurance, or faction-issued ownership disputes.
- Capacity, seats, crew slots, cargo holds, mounted inventory, or passenger comfort rules.
- Durability, fuel/charge, repair loops, maintenance downtime, or breakdown mechanics.
- Modular vehicle upgrades, armor, engines, vanity skins, or signature-vehicle progression.
- Player vehicle selection per route with automatic speed/risk/fuel modifiers.
- Vehicle-specific economy systems such as rentals, escort services, salvage lines, or trade-route logistics.
- Hard terrain gating based on vehicle tags beyond what prompts, exits, stubs, and generated vehicle destinations express.

## Original Player-Facing Idea Space

- **Acquisition and ownership:** buy, craft, steal, inherit, win in quests, or get faction-issued vehicles; optional registration or ownership disputes.
- **Travel and routing:** choose vehicles per route; unlock paths across water, air, rough terrain, or other setting-specific terrain; trade faster travel for risk, fuel, or exposure.
- **Party and crew:** seats, crew slots, passenger comfort, party-wide buffs/penalties, and shared travel decisions.
- **Cargo and logistics:** vehicle storage, hauling limits, mounted inventory, and trade-route gameplay.
- **Upgrades and customization:** modular parts, vanity skins, enchantments, armor plating, engine swaps, and unique signature vehicles.
- **Maintenance and durability:** wear and tear, repair loops, refuel/restock mechanics, and emergency fixes mid-journey.
- **Risk and events:** breakdowns, ambushes, storms, checkpoints, smuggling inspections, and vehicle-centric mini-quests.
- **Social and faction hooks:** faction permits, black-market upgrades, stolen-vehicle bounties, and vehicle reputation.
- **Discovery:** new vehicle types as regional or cultural flavor, such as desert skimmers, river barges, mountain beasts, starships, portals, or trains.

## Original Archetypes By Entity Type

### Items

- Foldable boats, collapsible gliders, hoverboards, exo-suits, or ride tokens for summoned mounts.
- Vehicle kits that transform items or scenery into temporary transport.
- Consumable boosters for speed bursts, emergency repairs, or stealth.

In current behavior, items and scenery can be flagged with `Thing.isVehicle`, but that flag is not the moving route/timing system.

### Scenery

- Docked ships, parked wagons, airship moorings, railcars, or sled stations at a location.
- Interactive scenery for boarding, storing gear, repair, or upgrades.
- Broken vehicle set pieces that seed salvage, rebuild, or escort quests.

In current behavior, a parked or docked vehicle that should move should usually be modeled as a vehicle location/region plus a tracked `vehicleExitId`; inert set dressing can remain scenery.

### NPCs

- Rideable beasts, trained drivers, sentient vehicles, or hired pilots.
- NPC-led convoys or caravans that move between locations on a schedule.
- Relationship-driven perks where a loyal driver reduces risk or a reckless pilot increases speed and hazards.

In current behavior, NPCs can narratively operate vehicles, but the implemented route/timing state does not live on NPC records.

### Locations

- Stables, docks, garages, hangars, caravanserai, ferry terminals, and repair shops.
- Location services such as rentals, refueling, upgrades, storage, and crew hiring.
- Location events such as races, inspections, or permits to access restricted routes.

In current behavior, single-location vehicles are implemented by storing `vehicleInfo` on a `Location`.

### Regions

- Oceans, skyways, desert trails, underground tunnel networks, orbital belts, ships, trains, or other vehicle interiors.
- Region rules where some areas require a vehicle type or offer vehicle-specific advantages.
- Region-level hazards such as storms, choke points, reefs, sand seas, or anti-air zones.

In current behavior, large vehicles are implemented as vehicle regions when `Region.vehicleInfo` is present.

## Original Travel And Encounter Loop Ideas

- **Route selection:** choose a safe/slow route or risky/fast shortcut.
- **Mid-journey events:** breakdowns, ambushes, weather, tolls, or rescue encounters.
- **Outcome variations:** arrive early with reputation bumps, or arrive late with damage/fuel loss.

In current behavior, timed vehicle trips and pending destinations exist, but the explicit route-risk/damage/fuel outcome system described here is not implemented.

## Original Progression And Economy Ideas

- Tiered vehicle classes with perks such as speed, cargo, stealth, or survivability.
- Modular attachment slots such as cargo racks, weapon mounts, or navigation aids.
- Story progression unlocks special vehicle types or legendary variants.
- Vehicle crafting lines that use rare materials to encourage exploration and trade.
- Salvage and repair loops for ruined vehicles.
- Rental and escort services as money sinks with risk/reward tradeoffs.

In current behavior, these remain possible future systems. They should be designed against the current `VehicleInfo` model rather than assuming this brainstorm's broader data model exists.
