# Travel Planner and Journey Risk Brainstorm

This document expands the travel planner and journey risk idea from `gameplay_improvement_brainstorm.md`. It is a brainstorm, not an implementation spec. The core premise is that long-distance travel should become a visible journey with plans, risks, rest, food, lodging, foraging, and possible interruptions instead of a single time jump that leaves the party exhausted and starving.

## Core pitch

Travel should ask "how do you make the journey?" rather than only "where do you go?" The player can choose speed, caution, route, lodging, camping, food strategy, foraging, hunting, vehicle use, and tolerance for risk. The system then advances time, resolves resource use and skill checks, updates needs/status effects, and surfaces meaningful encounters or complications along the route.

The goal is not to make every short exit tedious. It is to make long trips, dangerous terrain, scarce supplies, and harsh weather feel like real gameplay.

## Goals

- Prevent long fast-travel actions from automatically exhausting or starving the party.
- Make food, water, rest, shelter, weather, terrain, safety, currency, and vehicles matter during travel.
- Give the player meaningful choices between speed, safety, cost, recovery, and opportunity.
- Use existing route and travel-time data instead of inventing a parallel travel graph.
- Support setting-agnostic lodging: inns, stations, safehouses, caravansaries, monasteries, camps, docks, hostels, bunkhouses, guest rites, or vehicle berths.
- Make hunting, foraging, scavenging, water collection, and local navigation skill checks matter.
- Allow dangerous areas to generate travel encounters without turning every trip into a fight.
- Preserve normal one-click movement for short or trivial travel.

## Non-goals

- Do not make the player micromanage every meal.
- Do not require survival gameplay for every setting or campaign.
- Do not replace normal exit traversal.
- Do not silently erase consequences of poor preparation.
- Do not make random encounters a flat roll unrelated to terrain, danger, weather, faction control, or travel mode.
- Do not require exact hex/grid travel in the first version.
- Do not hide important travel costs or risks from the player.

## Player-facing flow

### Short movement

For nearby exits with modest travel time, the current move flow can remain:

- Click exit.
- Advance exit travel time.
- Apply existing time-based need/status processing.
- Show the travel summary.

The travel planner should appear when the journey is long, crosses multiple exits, enters dangerous territory, uses a vehicle route, or the player explicitly opens it.

### Journey planning

The planner could show:

- Destination.
- Known route and route alternatives.
- Total travel time before rest/foraging/lodging adjustments.
- Known stops along the way.
- Known danger bands.
- Weather and light expectations.
- Vehicle state and route constraints.
- Party needs and critical status effects.
- Supply estimate.
- Currency estimate for paid lodging or transport.
- Encounter risk estimate.
- Expected recovery or fatigue.

The player then chooses a travel posture and resource plan.

### Journey execution

Execution should produce a concise journey report:

- Route taken.
- Time elapsed.
- Rest/lodging/camping decisions.
- Food/water consumed.
- Foraging/hunting/scavenging results.
- Need and status changes.
- Skill checks and outcomes.
- Random encounters or avoided encounters.
- Weather or terrain complications.
- Arrival state.
- Any interrupted journey state if the trip did not complete.

### Interrupted journeys

If a travel encounter, hazard, failed skill check, vehicle issue, or story event interrupts the trip, the player should arrive in an intermediate state:

- Current location or temporary travel scene.
- Remaining destination.
- Distance/time remaining.
- Reason for interruption.
- Options to continue, camp, turn back, resolve the encounter, repair, hide, negotiate, or change route.

## Travel modes

### Safe lodging

Use known settlements, stations, inns, hostels, faction outposts, temples, docks, vehicle berths, or other setting-appropriate stops. This mode spends currency or favors to reduce exhaustion and improve recovery.

Strengths:
- Best recovery.
- Lower encounter risk in civilized or protected areas.
- Good for social hooks and rumors.

Costs:
- Currency, faction standing, or obligations.
- Not always available.
- May expose the party to local laws, enemies, debt, theft, or social complications.

### Camp normally

Use carried supplies and make camp when travel time exceeds a rest threshold.

Strengths:
- Reliable when no lodging exists.
- Moderate recovery.
- Works in wilderness or ruins if conditions allow.

Costs:
- Consumes supplies.
- Encounter risk depends on danger, concealment, weather, watch quality, fire/light, and party tactics.
- Recovery may be reduced in harsh conditions.

### Hunt, forage, or scavenge

Spend time and make checks to reduce supply cost or find better food/water.

Strengths:
- Can offset limited supplies.
- Creates skill-based travel gameplay.
- Can discover tracks, landmarks, resources, clues, or hazards.

Costs:
- Takes time away from travel and rest.
- Failure can increase exhaustion, risk, or wasted time.
- Noise, scent, tracks, or separation can attract danger.
- Results depend heavily on terrain, weather, season, region resources, and skill availability.

### Push hard

Minimize travel time and skip or shorten rest.

Strengths:
- Fastest arrival.
- Useful for urgent quests, pursuit, escape, clocks, or vehicle departures.

Costs:
- Increased exhaustion and need pressure.
- Higher injury, morale, mistake, and encounter risk.
- Lower foraging success because the party is moving quickly.

### Travel cautiously

Move slower, scout ahead, avoid roads when needed, choose safer camps, keep watches, and reduce surprise.

Strengths:
- Lower ambush and hazard risk.
- Better chance to notice tracks, patrols, weather shifts, and hidden paths.
- Useful in hostile regions.

Costs:
- More elapsed time.
- More meals/supplies consumed unless offset by foraging.
- May miss time-sensitive opportunities.

### Hire transport or guide

Pay for a caravan, boat, train, shuttle, mount, guide, escort, or local route expert.

Strengths:
- Can reduce risk or travel time.
- Can bypass difficult terrain.
- Creates social hooks and faction interactions.

Costs:
- Currency or favors.
- Availability depends on location and setting.
- Guide/transport quality can vary.
- Betrayal, delay, breakdown, or route control can become complications.

### Vehicle journey

Use an existing vehicle location or region.

Strengths:
- Leverages `VehicleInfo` routes and ETA state.
- Supports long trips, fixed routes, timed arrivals, and onboard scenes.
- Can combine travel with rest, crafting, social interaction, or tactical encounters.

Costs:
- Vehicle route constraints.
- Possible fuel, repair, crew, docking, or navigation issues depending on setting.
- Vehicle may be intercepted, delayed, damaged, or rerouted.

## Resources and recovery

### Food and water

The planner can estimate and resolve:

- Meals needed.
- Water needed.
- Quality of food.
- Spoilage or scarcity.
- Shared supplies for party members.
- Special dietary requirements if a setting/mod defines them.

For a first implementation, supplies could be abstracted rather than requiring exact item stacks. Later versions could consume actual inventory items tagged as food/water/rations.

### Rest

Rest quality should depend on:

- Lodging or camp quality.
- Shelter.
- Weather.
- Safety.
- Watch schedule.
- Noise/light discipline.
- Current injuries/status effects.
- Bedrolls, tents, vehicles, rooms, or other gear.
- Hostile region/faction pressure.

Rest can affect:

- Fatigue/exhaustion need bars or status effects.
- Health regeneration.
- Some status duration processing.
- Morale.
- Party member behavior.
- LLM narration of arrival state.

### Currency and services

Paid travel choices can create meaningful spending:

- Lodging.
- Meals.
- Stabling/parking/docking.
- Guides.
- Escorts.
- Bribes/tolls.
- Ferries.
- Repairs.
- Medical treatment.
- Vehicle fuel/maintenance.

Costs should be transparent before confirmation when known.

## Skill checks

Travel checks should use existing skill/attribute systems and avoid hardcoded genre assumptions where possible.

Possible check categories:

- Navigation: find efficient route, avoid getting lost, estimate time.
- Survival: camp quality, fire, water, weather readiness.
- Hunting/foraging/scavenging: food and useful resources.
- Perception/scouting: notice ambushes, hazards, tracks, shortcuts.
- Stealth: avoid patrols, keep camp hidden, move quietly.
- Athletics/endurance: push hard, difficult terrain, forced march.
- Animal handling or vehicle handling: mounts, caravans, ships, aircraft, walkers, trains, or other setting travel.
- Social/local knowledge: find lodging, negotiate guide rates, know safe roads.
- Medicine: manage injuries during travel.
- Engineering/repair: vehicle or equipment issues.

Outcomes should affect multiple axes, not just success/failure:

- Time spent.
- Distance covered.
- Supply use.
- Food/water quality.
- Rest quality.
- Encounter risk.
- Injury/status chance.
- Discovery of hooks.
- Morale or disposition changes.

## Hunting, foraging, and scavenging outcomes

A structured outcome could include:

- `result`: excellent, good, mixed, poor, failed, dangerous.
- `timeSpentMinutes`.
- `foodValue`.
- `waterValue`.
- `supplyOffset`.
- `restPenaltyMinutes`.
- `riskDelta`.
- `discoveredThingNames`.
- `complication`.
- `narrativeSummary`.

Examples:

- Excellent: enough good food, clean water, signs of a shortcut, little rest loss.
- Good: enough basic food, some rest loss.
- Mixed: food found but poor quality, extra time spent, minor risk.
- Poor: little food, fatigue from effort.
- Failed: no useful supplies, time lost.
- Dangerous: the party finds supplies but attracts attention, triggers a hazard, or splits up.

The player should see the tradeoff: a successful forage may still reduce rest because it took hours.

## Random encounters during travel

Travel encounters should be "journey events," not only combat.

Encounter types:

- Hostile ambush.
- Suspicious travelers.
- Faction patrol.
- Weather event.
- Terrain hazard.
- Lost route.
- Broken equipment.
- Vehicle delay.
- Resource discovery.
- Strange landmark.
- Merchant or guide opportunity.
- Refugee or traveler in need.
- Rival party.
- Evidence, tracks, rumors, or clues.
- Disease, poison, exposure, or contamination.
- Moral dilemma.

Encounter probability should consider:

- Region danger.
- Location comfort/danger profile.
- Route type.
- Weather and light level.
- Travel mode.
- Party stealth/scouting.
- Camp visibility.
- Faction control and reputation.
- Recent events.
- Vehicle type.
- Random event seeds.
- Player choices such as "push hard" or "travel cautiously."

The system should distinguish:

- Avoided encounters: detected and bypassed.
- Foreshadowed encounters: signs noticed, player chooses response.
- Immediate encounters: interruption begins now.
- Background events: something happens offscreen and is reported on arrival.

## Route and leg model ideas

### JourneyPlan

Possible fields:

- `originLocationId`
- `destinationLocationId` or destination stub/region target
- `route`
- `mode`
- `lodgingPolicy`
- `campPolicy`
- `foragePolicy`
- `supplyPolicy`
- `riskTolerance`
- `vehicleId`
- `estimatedMinutes`
- `estimatedCost`
- `estimatedSupplyUse`
- `estimatedRecovery`
- `estimatedEncounterRisk`

### JourneyLeg

Each leg could represent one exit or route segment:

- `fromLocationId`
- `toLocationId`
- `exitId`
- `baseTravelTimeMinutes`
- `terrainTags`
- `regionId`
- `danger`
- `weather`
- `lightWindow`
- `knownStop`
- `vehicleContext`

### JourneyStop

Stops can be known locations or generated/temporary concepts:

- Settlement lodging.
- Roadside inn.
- Campsite.
- Water source.
- Vehicle berth.
- Faction post.
- Safehouse.
- Hazard shelter.

Known stops should prefer existing locations. Temporary stops should not necessarily become permanent locations unless something important happens there.

### JourneyResult

Execution can return:

- `completed`
- `currentLocationId`
- `remainingRoute`
- `advancedMinutes`
- `worldTime`
- `timeProgress`
- `needBarChanges`
- `statusChanges`
- `currencyChanges`
- `itemsConsumed`
- `itemsFound`
- `checks`
- `encounters`
- `summary`
- `interruptedReason`

## LLM and server responsibilities

The server should own:

- Route lookup.
- Travel-time math.
- Currency/item/need/status mutation.
- Skill check rolls.
- Encounter probability resolution when deterministic enough.
- Persistence.
- Validation.

The LLM can help with:

- Setting-appropriate travel stop descriptions.
- Journey narration.
- Foraging result flavor.
- Encounter seed generation.
- Complication suggestions.
- Interpreting unusual player travel plans.
- Creating temporary travel scenes when interrupted.

Hard boundary:

- The LLM should not silently apply food, time, need, health, item, or location changes without structured output that the server validates and applies.

## Prompt ideas

Potential prompt labels:

- `journey_plan_options`: summarize route options and setting-appropriate travel strategies.
- `journey_forage_check`: produce structured foraging/hunting/scavenging outcome context after server rolls.
- `journey_encounter_seed`: select or describe a travel encounter based on risk inputs.
- `journey_interruption_scene`: create an intermediate scene when travel is interrupted.
- `journey_arrival_summary`: narrate completed travel with structured mechanical summary.

All prompt-backed paths should use `LLMClient.logPrompt()` and strict structured output validation where practical.

## UI ideas

### Travel planner panel

Show:

- Destination and route.
- Time estimate.
- Route risk.
- Travel mode selector.
- Lodging/camp/forage policy.
- Supply/currency estimate.
- Party readiness warnings.
- Weather/light preview.
- Encounter-risk explanation.
- Confirmation button.

### Route detail

For each known leg:

- From and to.
- Travel time.
- Region.
- Known danger.
- Known stop availability.
- Weather or light concerns.
- Vehicle constraints.
- Unknown/stub warning when applicable.

### Journey report

After travel:

- One prose summary.
- Mechanical changes grouped by category.
- Checks rolled.
- Supplies/currency used.
- Rest and need changes.
- Encounters avoided or triggered.
- Arrival state.

### Interrupted journey UI

If interrupted:

- Current situation.
- Remaining route.
- Reason for interruption.
- Options: continue, camp, turn back, resolve, hide, negotiate, repair, reroute.

## Integration with existing systems

### Location and exit graph

Use:

- `Location.findShortestTravelTimeMinutes(...)`
- Directed exits.
- `LocationExit.travelTimeMinutes`
- Existing strict graph integrity checks.

Malformed graph data should fail loudly rather than being silently skipped.

### World time

Use:

- `Globals.advanceTime(...)`
- Existing time transition summaries.
- Minute-canonical `worldTime`.
- Existing due-arrival processing for vehicles.

### Need bars and status effects

Travel should go through normal elapsed-time need/status processing, then apply additional journey outcomes such as poor rest, good lodging, hunger mitigation, exposure, injury, or morale effects.

### Inventory and currency

Possible first slice:

- Currency for lodging/guides.
- Abstract supply estimate.

Later slice:

- Consume actual inventory items tagged as food/water/rations.
- Generate found food/water as items when useful.
- Use containers and party inventories.

### Regions and weather

Use region weather definitions, seasonal light descriptions, and random event seeds to influence:

- Travel pace.
- Camp quality.
- Forage difficulty.
- Encounter risk.
- Visibility.
- Hazards.

### Vehicles

Vehicle trips should respect:

- `VehicleInfo.currentDestination`
- `VehicleInfo.pendingDestination`
- `VehicleInfo.ETA`
- `VehicleInfo.departureTime`
- fixed-route destinations
- hidden exits during underway/finalizing states

Journey planning can make vehicle trips clearer by showing onboard rest, route timing, stops, and risks.

### Random events

Travel risk can build on existing random-event infrastructure:

- Region seeds.
- Location/region event types.
- Forced random events.
- Weather/light event summaries.

Travel-specific event checks should avoid duplicate movement/time application.

### Quests, factions, and relationships

Travel can create or resolve:

- Escort obligations.
- Delivery deadlines.
- Faction checkpoints.
- Reputation changes from visible choices.
- Party disposition changes from hardship or good planning.
- Quest deadlines and missed opportunities.

## Config ideas

Possible config options:

- Enable journey planner.
- Minimum travel minutes before planner is suggested.
- Minimum route legs before planner is suggested.
- Default travel mode.
- Enable abstract supplies.
- Enable inventory-based food/water consumption.
- Enable travel encounters.
- Encounter frequency multiplier.
- Inn/lodging cost formula.
- Camp rest recovery formula.
- Foraging skill preference list.
- Region danger weighting.
- Vehicle journey planner behavior.
- Whether dangerous travel should pause for confirmation.

## Persistence considerations

Most completed journeys may not need durable journey objects beyond chat/event summaries. Interrupted or multi-stage journeys may need active state:

- Destination.
- Remaining route.
- Selected mode.
- Supplies/cost already consumed.
- Checks already resolved.
- Encounter or interruption state.
- Vehicle state if relevant.
- Original request metadata.

Active journey state should be saved if the player can save/load during an interruption.

## Error handling principles

- Missing routes should be reported clearly.
- Unknown destination names should use existing stub/region behavior, not ad hoc fallback.
- Missing skills referenced by a travel plan should fail or request a valid substitute.
- Currency/item consumption should be all-or-nothing for each confirmed journey stage.
- Need/status changes should be emitted in visible summaries.
- If a travel prompt produces invalid structured output, retry or fail visibly.
- Do not clamp travel costs, need changes, or risk values silently.

## Testing ideas

Unit-level:

- Route estimate over directed exits.
- Travel mode modifiers.
- Lodging cost calculation.
- Camp rest calculation.
- Forage outcome normalization.
- Encounter risk weighting.
- Active journey serialization.

Integration:

- Long direct route with lodging.
- Long route with camping and supplies.
- Foraging success offsets supply use but costs rest time.
- Foraging failure increases fatigue/time.
- Dangerous route triggers interruption.
- Vehicle trip reports ETA and onboard rest.
- Save/load interrupted journey.

Playwright:

- Open planner from map or exit.
- Choose travel mode.
- Confirm journey.
- Inspect journey report.
- Confirm sidebars update needs/time/currency.
- Confirm mobile planner layout is usable.

Fixtures:

- Safe two-leg route.
- Dangerous wilderness route.
- Urban route with paid lodging.
- Vehicle route.
- Route with missing travel-time sentinel values.

## Rollout options

### Slice 1: Travel estimate and warnings

Show route time, expected need impact, current party risk, and warning if the journey is long enough to cause exhaustion/starvation. No new mechanics yet.

Pros:
- Low risk.
- Immediately explains the current problem.

Cons:
- Does not solve long-travel hardship yet.

### Slice 2: Lodging and camp policy

Add safe lodging and normal camping options for long trips. Apply currency/supply/rest outcomes and journey summaries.

Pros:
- Directly addresses the starvation/exhaustion issue.
- Mechanically bounded.

Cons:
- Requires cost/recovery rules.

### Slice 3: Foraging and hunting checks

Add skill-checked food/water/resource gathering during travel, with time/rest/risk tradeoffs.

Pros:
- Adds meaningful survival gameplay.
- Makes skills matter.

Cons:
- Needs setting-aware skill mapping and structured outcomes.

### Slice 4: Travel encounters and interruptions

Add danger-weighted travel encounters, avoided encounters, and interrupted journey state.

Pros:
- Makes dangerous travel exciting.
- Connects travel to random events and world state.

Cons:
- Requires careful duplicate movement/time prevention.

### Slice 5: Full route planner

Add route alternatives, known stops, guide/transport options, vehicle trips, faction checkpoints, and map integration.

Pros:
- Turns travel into a major strategic system.

Cons:
- Larger UI and state-management scope.

## Strong first implementation candidate

The strongest first feature would likely be "long travel care plans":

- Trigger only when travel exceeds a configurable minute threshold.
- Show estimated time and need impact.
- Offer three modes: safe lodging when available, camp with supplies, push hard.
- Apply normal time advancement.
- Apply rest/need/currency/supply adjustments.
- Emit a journey report.
- Do not yet add random encounters or route alternatives.

This slice would fix the immediate exhaustion/starvation problem while creating a foundation for foraging, danger, and full planning later.

## Open questions for a future spec

1. Should food/water start as abstract supplies or actual inventory items?
2. Should travel planning be required for long trips or just suggested?
3. How should the game decide that lodging is available along a route?
4. Which skill definitions should map to hunting, foraging, navigation, and camping in arbitrary settings?
5. Should party members contribute skill checks automatically?
6. Should travel encounters interrupt the route before arrival, or can some be summarized after arrival?
7. How much risk should be visible before travel?
8. Should player-selected travel policies persist as defaults?
9. Should vehicles allow better rest by default, or should that depend on vehicle metadata?
10. Should harsh travel create durable status effects, need changes, or both?

