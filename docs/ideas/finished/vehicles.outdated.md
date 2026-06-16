# Vehicles (Archived Design Notes)

This is an older vehicle brainstorm, not the current implementation spec. Use it for design context and future-idea mining, then verify current behavior in:

- `docs/classes/VehicleInfo.md`
- `docs/classes/Location.md`
- `docs/classes/Region.md`
- `docs/classes/LocationExit.md`
- `docs/api/common.md`
- `docs/api/chat.md`
- `docs/ui/maps.md`
- `docs/slashcommands/VehicleStatusCommand.md`

## Current Vehicle Behavior

The implemented vehicle system is centered on `VehicleInfo`, `Location`, `Region`, and `LocationExit`.

- A `Location` or `Region` is a vehicle when it has non-null `vehicleInfo`; `isVehicle` is derived from that field.
- `VehicleInfo` stores `terrainTypes`, `icon`, `currentDestination`, `pendingDestination`, fixed-route `destinations`, `ETA`, `departureTime`, and `vehicleExitId`.
- A `LocationExit` can be marked with `isVehicle` and optional `vehicleType`, but that marks the edge as a vehicle boarding/disembark/travel edge. It does not by itself make the destination a vehicle.
- Vehicle locations and vehicle regions can move by retargeting the tracked outside exit referenced by `vehicleInfo.vehicleExitId`.
- Positive `<moveTurnResult><vehicleInfo><travelTime>` starts a timed trip by setting `pendingDestination`, `departureTime`, and `ETA`; final destination resolution and exit retargeting happen during due-arrival processing.
- `0` or omitted vehicle travel time moves the vehicle immediately.
- Due vehicle arrivals are processed through the same positive world-time advancement paths that also handle needs, statuses, and scheduled events.
- `Player.currentVehicle` exposes the active onboard vehicle, destination label, pending destination, remaining time, and `isUnderway` / `hasArrived` / `isArriving` state for prompts and diagnostics.
- `/vehicle_status` reports the current player's active vehicle route and trip state.
- Location, region, and stub edit APIs validate vehicle metadata through `VehicleInfo`.
- Region generation can create large vehicle location stubs and huge vehicle region-entry stubs with vehicle metadata and tracked vehicle exits.
- Region and world maps render vehicle icons and omit vehicle exits while a vehicle is underway or waiting for arrival finalization.
- `Thing` has an `isVehicle` flag for item/scenery classification, but there is no implemented `VehicleProfile`, fuel, cargo, ownership, durability, crew, or item-driven vehicle movement system.

## Current Limits

These older ideas are not current behavior:

- A universal `VehicleProfile` stat block shared by items, scenery, NPCs, locations, and regions.
- A separate `VehicleInstance` entity with durability, fuel, owner, cargo, or maintenance state.
- Vehicle choice as a general travel modifier for speed, safety, stealth, risk, or encounter odds.
- Fuel, stamina, charge, repair, breakdowns, or vehicle wear.
- Passenger/cargo capacity rules.
- NPC transport-service schedules, fares, permissions, or route timetables.
- Vehicle combat, chases, ramming, boarding actions, or disabling rules.
- Vehicle ownership, theft, registration, keys, tickets, or faction permits.
- UI for selecting among multiple available vehicles for ordinary travel.

Future work should build on `VehicleInfo` and existing directed exits instead of adding a parallel travel graph.

## Original Goals Worth Preserving

- Make travel feel meaningful: speed, safety, capacity, stealth, and narrative tone can change with the vehicle.
- Treat travel as more than teleportation by supporting routes, services, schedules, hazards, and visible trip state.
- Keep vehicle concepts setting-agnostic: ships, trains, mounts, portals, living paths, airships, caravans, elevators, and stranger equivalents should fit.
- Enable scenario hooks such as smuggling, escorts, convoy trouble, mobile bases, and vehicle-centered quests.

## Outdated Core Concepts

The original brainstorm used broader terms than the current code:

- **Vehicle Profile**: Proposed common stats such as speed, cargo/passenger capacity, safety, stealth, reliability, fuel, access rules, terrain rules, pilot requirements, and tags. Current code only has `VehicleInfo`, which is route/trip/display metadata.
- **Vehicle Instance**: Proposed stateful entity with durability, fuel, location, owner, and cargo. Current vehicle state lives on a vehicle `Location` or `Region`.
- **Route**: Proposed scheduled paths with stops and services. Current fixed routes are just `VehicleInfo.destinations` entries, including `pending-region:<region>` tokens for unresolved region destinations.
- **Vehicle Mode**: Proposed narrative/rules context such as mounted, aboard ship, convoy, or portal transit. Current prompts can see `Player.currentVehicle`, but there is no general rules mode layer.

## Original Entity Ideas

### Items

Original item-vehicle ideas included saddles, harnesses, foldable vehicles, single-use transit items, modular vehicle parts, cargo carriers, terrain-bypass gear, summon charms, vehicle weapons, magic anchors, and ticket items.

Current project fit:

- Item or scenery records can be flagged `isVehicle`, but that is descriptive/classification metadata today.
- A future item-driven vehicle should probably create, reveal, board, or modify a vehicle `Location`/`Region` and its tracked `LocationExit` rather than inventing an unrelated travel object.
- Ticket, key, permit, fuel, or upgrade items would need explicit mechanics and persistence rules; they do not exist in the current vehicle layer.

### Scenery

Original scenery-vehicle ideas included ziplines, ropeways, lifts, conveyors, wind currents, river currents, portal arches, siege towers, living paths, and gravity lanes.

Current project fit:

- Fixed traversal can already be represented as normal or vehicle-marked `LocationExit` records.
- If scenery should become an active moving vehicle, it would need to drive or attach to a vehicle `Location`/`Region` with `VehicleInfo`.
- Cooldowns, schedules, one-way behavior beyond ordinary exit directionality, and disabled/broken transit states remain future mechanics.

### NPCs

Original NPC-vehicle ideas included rideable beasts, porters, taxi services, ferrymen, guided tours, convoy leaders, smugglers, forced transport, co-pilots, and rival rides.

Current project fit:

- NPCs do not currently expose `transportService`, `mountProfile`, schedules, fares, or crew effects.
- Future NPC transport should likely create/use vehicle exits or vehicle locations and route access through existing party, faction, disposition, and prompt/tool systems.
- Forced travel already has general movement/event pathways, but not NPC-specific vehicle ownership or service rules.

### Locations And Regions

This is the part closest to current code.

Original ideas included ships, airships, trains, caravan camps, siege engines, giant-creature settlements, crawlers, floating fortresses, pocket dungeons, astral stations, traveling islands, caravan regions, habitats, mystic planes, war fleets, storm fronts, living forests, and dimensional trainlines.

Current project fit:

- Vehicle `Location` and `Region` records are real.
- A region vehicle can contain multiple locations, making it a good current match for trains, ships with interiors, space habitats, or mobile settlements.
- Movement is tracked through `VehicleInfo.currentDestination`, `pendingDestination`, `ETA`, `departureTime`, `destinations`, and `vehicleExitId`, not through a separate `mobilityProfile`.
- World-scale adjacency changes, seasonal docking windows, border changes, and moving weather regions remain design ideas.

## Future Design Threads

These ideas remain useful, but should be implemented as extensions of the current vehicle primitives:

- **Travel planning:** choose route, pace, vehicle use, lodging, supplies, and risk using the existing directed exit graph and `VehicleInfo` trip state.
- **Economy and trade:** use vehicles for bulk hauling, route control, destination shortages, and arbitrage only after cargo/ownership rules exist.
- **Quests and events:** add escort trips, repairs, fuel searches, stowaways, storms, checkpoints, and convoy trouble through scheduled events and travel-prose/event systems.
- **Faction dynamics:** model faction-owned routes, route access, blockades, permits, and sabotage through explicit faction/quest checks.
- **Survival and needs:** let vehicles affect exposure, rest, hunger, thirst, or shelter after those effects have concrete rules.
- **Combat and hazards:** chases, boarding, crashes, and vehicle damage need a combat/hazard contract rather than ad hoc travel prose.

## Questions For Future Work

1. What minimal vehicle stats are worth adding without duplicating normal exits, status effects, inventory, or scheduled events?
2. Should item/scenery/NPC vehicles become true vehicle owners, or should they always adapt into vehicle `Location`/`Region` records?
3. How should access rules be represented: skills, items, faction standing, quest flags, NPC disposition, or a shared requirement object?
4. Should active journey state become its own persisted object, or can `VehicleInfo` plus scheduled events cover the needed cases?
5. How should the UI present vehicle choices without cluttering ordinary adjacent travel?
