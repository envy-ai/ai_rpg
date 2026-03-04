# Vehicles (Design Brainstorm)

## Goals

- Make travel feel meaningful: speed, safety, capacity, stealth, and narrative tone all change with the chosen vehicle.
- Treat travel as a system, not a teleport: add routes, services, schedules, and hazards.
- Let _any_ world entity act as a vehicle (items, scenery, NPCs, locations, regions).
- Support both diegetic travel (ride, sail, fly) and magical/abstract travel (portals, living paths).
- Enable emergent gameplay: heists, smuggling, escort contracts, convoy warfare, and mobile bases.

## Core Concepts

- **Vehicle Profile**: Common stat block used across all vehicle types.
  - Speed / time-cost modifier.
  - Capacity (passengers + cargo slots).
  - Safety / encounter bias (e.g., ambush risk, exposure to elements).
  - Stealth / detectability.
  - Reliability (breakdown chance, maintenance needs).
  - Fuel / stamina / charge and consumption rate.
  - Access rules (ownership, keys, reputation, skill checks).
- **Vehicle Instance**: A specific, stateful vehicle (durability, fuel, location, owner, cargo).
- **Route**: A travel path with stops, schedule, and services (can be attached to NPCs, locations, or regions).
- **Vehicle Mode**: The narrative + rules context when traveling (mounted, aboard ship, convoy, portal transit).

## Universal System Hooks (Cross-Cutting)

- **Travel Actions**: Standardize on `travel`, `board`, `ride`, `pilot`, `dock`, `disembark`, `tow`.
- **Requirements**: Skills (riding, sailing), items (keys, tickets), faction standing, or NPC permission.
- **Risk & Events**: Vehicle-specific random event tables (storms, breakdowns, stowaways, bandits).
- **Combat**: Optional combat-on-vehicle (chases, boarding actions, ramming, disabling).
- **Persistence**: Vehicle instances persist in saves and are returned to their last known location.
- **Prompt Context**: Prompts include available vehicles, their capabilities, and travel constraints.

## Vehicle Profile (Proposed Data Shape)

- `VehicleProfile`
  - `id`, `name`, `type` (`item`, `scenery`, `npc`, `location`, `region`)
  - `speedMultiplier`, `timeCostModifier`
  - `cargoSlots`, `passengerSlots`
  - `safetyRating`, `stealthRating`, `reliabilityRating`
  - `fuelType`, `fuelCapacity`, `fuelBurnRate`
  - `accessRules` (skills, items, reputation, permissions)
  - `allowedTerrain` / `blockedTerrain`
  - `requiresPilot`, `crewSize`, `minSkill`
  - `tags` (airship, caravan, subterranean, aquatic, arcane)

## Items as Vehicles

### Feature Ideas

1. **Mount Items** — Saddles or harnesses that turn a creature into a rideable mount.
2. **Foldable Vehicles** — Pocket skiffs, collapsible gliders, instant bicycles.
3. **Consumable Transit** — Single-use teleport scrolls, emergency wing tokens, smoke-ride charms.
4. **Modular Vehicles** — Chassis + engine + upgrades; assemble a cart or glider from parts.
5. **Cargo Carriers** — Pack frames or wagons that add inventory capacity but slow travel.
6. **Terrain Bypass Gear** — Ice skates for frozen rivers, sand skimmers for dunes.
7. **Summonables** — Whistles/charms that call a vehicle from storage or a stable.
8. **Vehicle-as-Weapon** — Lance-optimized mount gear, explosive ram sleds.
9. **Magic Anchors** — Items that spawn temporary portals or stepping-stones.
10. **Ticket Items** — Tickets/permits for scheduled transports (trains, ferries, airships).

### Implementation Sketch

- Add `vehicleProfile` to item definitions or as a tag in `Thing` metadata.
- On `use`, spawn or attach a `VehicleInstance` to the player with active stats.
- Use `VehicleInstance` durability + fuel as a stateful `StatusEffect`-like tracker.
- Allow upgrades via crafted items that patch the vehicle profile (engine upgrades, armor).
- Item-based vehicles can create temporary exits or apply travel modifiers for the next action.

## Scenery as Vehicles

### Feature Ideas

1. **Ziplines and Ropeways** — One-way fast traversal across hazards.
2. **Elevators & Lifts** — Vertical travel linking sub-level locations.
3. **Conveyor Networks** — Industrial belts moving cargo and players.
4. **Wind Currents** — Gliding paths that require a glider item.
5. **River Currents** — Natural “routes” that carry rafts downstream.
6. **Rotating Rooms** — Puzzle rooms where stepping on a platform rotates exits.
7. **Portal Arches** — Static scenery that opens travel to other locations or regions.
8. **Siege Towers** — Move within a battle map to reach fortifications.
9. **Beast Trails** — Living paths (migrating grass platforms, moving mushrooms).
10. **Gravity Lanes** — Magical rails that move anyone who steps inside.

### Implementation Sketch

- Model rideable scenery as `Thing` with `sceneryVehicleProfile` + `transportAction`.
- When used, it triggers a `LocationExit` resolution with `isVehicle` and `vehicleType` set.
- Allow scenery vehicles to have cooldowns, schedules, or one-way flags.
- Use event checks to reroute or disable scenery (collapsed bridge, broken lift).

## NPCs as Vehicles

### Feature Ideas

1. **Mount NPCs** — Rideable beasts with temperament and stamina.
2. **Carriers** — NPC porters that carry the player through dangerous zones.
3. **Taxi Services** — Drivers, ferrymen, gondoliers, courier escorts.
4. **Guided Tours** — NPC-led routes that reveal hidden locations.
5. **Giant/Friendly Monster Transit** — Hitch a ride on a massive creature.
6. **Convoy Membership** — Join NPC-led caravans for safe travel.
7. **Smuggling** — NPCs hide you in cargo to pass guarded borders.
8. **Kidnapping/Forced Travel** — NPCs can drag players to a location (story trigger).
9. **Co-Pilots** — NPC crew improve speed or safety on ships/airships.
10. **Rival Rides** — Chase scenes where NPCs ride opposing vehicles.

### Implementation Sketch

- Add `transportService` or `mountProfile` to NPC definitions.
- Allow NPCs to expose routes (`routeId`, `schedule`, `fare`, `requirements`).
- Tie service availability to NPC schedules and disposition.
- Use follower/party mechanics to attach NPC drivers to a travel action.
- Gate access via faction reputation or quest flags.

## Locations as Vehicles (Mobile Bases)

### Feature Ideas

1. **Airships & Ships** — Location is the deck; interiors are sub-locations.
2. **Moving Trains** — Each car is a location; stops are locations you can disembark to.
3. **Caravan Camps** — A mobile camp that periodically relocates on the map.
4. **Siege Engines** — A battle platform with interior stations (pilot, gunner).
5. **Giant Turtles** — The “town” is on the creature’s back.
6. **Subterranean Crawlers** — Drill rigs that move between underground nodes.
7. **Floating Fortresses** — A defensible base that travels to high-value regions.
8. **Pocket Dungeons** — Locations that “teleport” when powered.
9. **Astral Stations** — Dock at orbital points above regions.
10. **Nomad Settlements** — Markets that only appear when the location arrives.

### Implementation Sketch

- Treat the vehicle as a `Location` with a `mobilityProfile` (route + schedule + anchor points).
- Update its region or map position as time advances; update exits dynamically at each stop.
- Use `LocationExit` to represent boarding/disembarking and to gate travel at dock times.
- Manage sub-locations as child nodes that remain “inside” the vehicle during movement.
- Provide a “travel state” banner in prompts so narration accounts for motion.

## Regions as Vehicles (World-Scale Motion)

### Feature Ideas

1. **Traveling Island Region** — A region that drifts across the world map.
2. **Caravan Region** — A cluster of moving locations that act as a mobile region.
3. **Space Habitat** — Orbiting region that docks with surface regions on schedule.
4. **Mystic Plane** — Region shifts between anchor points in the world.
5. **Migratory Mega-Region** — Seasonal migration that opens/locks routes.
6. **War Fleet** — Region comprised of multiple ships; travels between coastal nodes.
7. **Storm Front Region** — A moving weather entity that redefines local travel rules.
8. **Living Forest** — A region that “walks” and changes border exits.
9. **Dimensional Trainline** — Region that only intersects other regions at set times.
10. **Nomadic Empire** — Political region that changes borders as it moves.

### Implementation Sketch

- Give `Region` a `mobilityProfile` with `route`, `anchorRegions`, and `dockWindows`.
- When the region moves, update adjacency for all `Region` exits and map overlays.
- Allow travel _with_ the region (stay aboard) or _to_ the region (dock/portal).
- Use seasonal or event-driven triggers to reposition region anchors.

## Vehicles in Systems (Extended Ideas)

- **Economy & Trade**
  - Caravans provide bulk transport and introduce trade surges at destinations.
  - Vehicle ownership unlocks regional arbitrage loops (buy low, haul, sell high).

- **Quests & Events**
  - Escort missions, convoy ambushes, and rescue missions mid-journey.
  - “Fix the engine” or “secure fuel” arcs to keep a vehicle moving.

- **Faction Dynamics**
  - Factions own major routes; reputation grants access to exclusive vehicles.
  - Sabotage or blockade routes to shift power.

- **Survival & Needs**
  - Vehicles can reduce exposure or speed up rest recovery.
  - Hunger/thirst impact on long voyages; ration systems for ships.

- **Exploration**
  - Vehicles unlock new terrain types (ocean, sky, desert, void).
  - “Soft-gates” exploration without hard teleportation.

## Prompting & Narrative Guidance

- Include **available vehicles** and their constraints in travel prompts.
- Explicitly log all new prompts that introduce vehicle context.
- Encourage narration that reflects the vehicle mode (e.g., swaying ship, rumbling crawler).

## Incremental Implementation Plan (Suggested)

1. **Add vehicle profile support to items and scenery** with minimal fields (speed, capacity, access).
2. **Extend travel resolution** to allow vehicle selection and apply time/safety modifiers.
3. **Introduce transport services** on NPCs with schedules and fares.
4. **Add mobile location** support (airship/trains) with dynamic exits.
5. **Add mobile region** support for large-scale moving hubs.

## Open Questions

1. How should vehicle combat interact with the existing encounter system?
2. Should vehicle wear/tear be global or localized to a given save/player?
3. What’s the default handling of abandoned vehicles (despawn, persistent, reclaimable)?
4. How do we expose vehicle options in the UI without cluttering travel flows?
