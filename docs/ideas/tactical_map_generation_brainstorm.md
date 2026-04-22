# Tactical Map Generation Brainstorm

This document expands the tactical battles brainstorm into the harder problem of generating tactical maps for arbitrary locations. It is a brainstorm, not an implementation spec. The core premise is that tactical maps cannot be produced by a generic room generator alone because locations can be anything: a tavern, a jungle canopy, a moving train, a starship bridge, a dreamscape, a marketplace riot, a flooded cave, a courtroom, a caravan, a battlefield trench, or the inside of a huge vehicle.

The likely answer is an LLM-assisted semantic map pipeline: the LLM interprets the current location and conflict into tactical zones, edges, cover, hazards, interactables, exits, deployment areas, and objectives; the server validates that structure; the UI renders it with deterministic layout rules.

## Core problem

The tactical battle system needs a map that is playable, legible, and mechanically useful. But the source material is generated prose plus arbitrary game state. A procedural generator can make "a forest clearing" or "a dungeon room," but it cannot reliably infer the important combat affordances of every generated location.

The map generator needs to answer questions like:

- Where can characters stand?
- Which areas connect?
- What blocks movement?
- What blocks sight?
- What is cover?
- What is dangerous?
- Where are exits?
- Where do reinforcements arrive?
- What can be interacted with?
- Where do objectives live?
- What terrain matters mechanically?
- What can be hidden, climbed, crossed, opened, broken, repaired, or used?

These are semantic questions. They need local story context, setting context, known exits, scenery, weather, light, vehicles, participants, objectives, and genre assumptions.

## Goals

- Generate playable tactical maps for arbitrary generated locations.
- Use the LLM for semantic interpretation, not for uncontrolled mechanical mutation.
- Keep the server authoritative for validation, persistence, and tactical legality.
- Start with zone maps rather than exact grids.
- Make maps inspectable and editable enough for debugging.
- Preserve known exits, scenery, vehicle metadata, and location facts.
- Fail loudly when map output is invalid instead of silently inventing a weak map.
- Support verticality, vehicles, interior/exterior spaces, hazards, and unusual terrain.
- Allow future visual renderers without making visual coordinates the source of truth.

## Non-goals

- Do not require image generation for tactical maps.
- Do not make tactical map art the mechanical truth.
- Do not assume rectangular rooms, dungeon grids, or fantasy terrain.
- Do not require exact feet/meters distances in the first version.
- Do not silently create exits, objects, or hazards in world state just because a tactical map mentions them.
- Do not let the LLM place participants in invalid locations without validation.
- Do not make every location pre-generate a tactical map.

## Recommended direction

The strongest direction is a semantic zone graph with optional layout hints.

The LLM produces a tactical map as structured data:

- Zones.
- Connections.
- Barriers.
- Cover.
- Hazards.
- Interactables.
- Exits.
- Deployment areas.
- Objective anchors.
- Visibility and elevation.
- Optional relative coordinates for display.

The server validates the graph and uses deterministic rendering to lay it out. The UI can start with cards/list/graph rendering, then later support canvas/SVG layouts. The server should treat the graph as the mechanical source of truth; coordinates are display hints only.

This avoids brittle procedural map generation while keeping the LLM in the part of the problem it is best suited for: interpreting arbitrary prose into useful tactical affordances.

## Alternatives

### 1. Pure procedural maps

The server generates maps from templates: rooms, corridors, clearings, streets, vehicles, caves.

Pros:
- Deterministic.
- Easier to validate.
- Easier to test for simple terrain.

Cons:
- Fails on arbitrary generated locations.
- Loses important story-specific details.
- Requires a large template library.
- Produces generic maps that do not feel connected to the current scene.

### 2. LLM-authored semantic zone graph

The LLM converts location context into a structured tactical graph. The server validates it and renders it.

Pros:
- Handles arbitrary locations.
- Keeps maps tied to prose and scene context.
- Supports unusual spaces and objectives.
- Can remain setting-agnostic.

Cons:
- Needs strict schema and validation.
- Needs repair/retry loops.
- May produce too many or too few zones without constraints.

### 3. LLM-authored grid

The LLM outputs a tile grid with walls, cover, hazards, and actors.

Pros:
- Familiar tactical representation.
- Easier to render once valid.

Cons:
- Harder for the LLM to keep coherent.
- Exact spatial output is brittle.
- Arbitrary locations still need semantic interpretation first.
- Grid size and tile meaning become design commitments early.

### 4. Image-generated battlemap plus extraction

Generate an image, then either use it as decoration or attempt to infer mechanics from it.

Pros:
- Visually rich.
- Fun for screenshots and immersion.

Cons:
- Not reliable as mechanical truth.
- Hard to validate.
- Image-generation latency and style drift.
- Accessibility and editing issues.

Recommendation: use option 2 as the canonical path. Later, option 4 can produce decorative art from the validated semantic map, not the other way around.

## Canonical map model

### TacticalMap

Possible fields:

- `id`
- `locationId`
- `source`: generated, edited, imported, regenerated
- `scale`: intimate, room, building, street, wilderness, vehicle, abstract
- `orientation`: optional text such as north/upstage/forward/aft/uphill
- `zones`
- `connections`
- `barriers`
- `interactables`
- `deploymentAreas`
- `objectiveAnchors`
- `mapNotes`
- `visibilityNotes`
- `generationContextHash`
- `createdAtWorldMinutes`
- `updatedAtWorldMinutes`

The map can be embedded in a `TacticalScene` or cached against a `Location` when useful. For a first version, scene-local maps are safer because the same location may need different tactical maps depending on objective, participants, weather, lighting, or where the fight starts.

### Zone

Possible fields:

- `id`
- `name`
- `description`
- `role`: approach, center, flank, high_ground, low_ground, objective, exit, cover, hazard, vehicle, interior, exterior, hidden, transition
- `cover`: none, light, heavy, total, mixed
- `visibility`: clear, dim, obscured, dark, blocked, mixed
- `elevation`: low, level, high, vertical, unstable
- `capacity`: small, medium, large, crowd, unknown
- `terrainTags`
- `hazards`
- `features`
- `linkedExitIds`
- `linkedThingIds`
- `isObjectiveArea`
- `isDeploymentArea`
- `layoutHint`

### Connection

Possible fields:

- `id`
- `fromZoneId`
- `toZoneId`
- `movementCost`: normal, slow, difficult, blocked, special
- `relation`: adjacent, near, far, above, below, inside, outside, across, through, around
- `requiresCheck`: boolean
- `checkHints`
- `coverDuringMovement`
- `visibilityAcross`
- `barrierIds`
- `notes`

Connections can be directed when needed: climbing down may differ from climbing up, entering smoke may differ from leaving it, or opening a sealed hatch may be one-way during a scene.

### Barrier

Barriers separate zones or block actions:

- Door.
- Gate.
- Barricade.
- Wall.
- Window.
- Rubble.
- Cliff.
- River.
- Forcefield.
- Crowd.
- Vehicle hull.
- Smoke bank.
- Fire line.
- Magical threshold.

Possible fields:

- `id`
- `name`
- `betweenZoneIds`
- `blocksMovement`
- `blocksSight`
- `blocksSound`
- `durability`
- `openable`
- `destructible`
- `bypassActions`
- `linkedThingId`

### Interactable

Interactables are tactical affordances. They do not necessarily become durable `Thing` objects unless the scene outcome creates or alters world state.

Examples:

- Cover object.
- Lever.
- Console.
- Door controls.
- Vehicle controls.
- Explosive barrel.
- Hanging sign.
- Chandelier.
- Broken pipe.
- Alarm bell.
- Campfire.
- Shrine.
- Hostage cage.
- Market stall.
- Stack of crates.
- Medical kit.
- Reactor panel.

Possible fields:

- `id`
- `name`
- `zoneId`
- `type`
- `description`
- `possibleUses`
- `risk`
- `requiredCheckHints`
- `singleUse`
- `linkedThingId`
- `createsWorldStateOnUse`

### Deployment area

Deployment areas determine starting placement:

- Player start.
- Party start.
- Enemy start.
- Neutral/civilian area.
- Reinforcement entry.
- Escape route.
- Hidden ambush position.

Possible fields:

- `id`
- `side`
- `zoneIds`
- `visibility`: visible, hidden, suspected, unknown
- `constraints`
- `notes`

### Objective anchor

Objective anchors link tactics to win/loss conditions:

- Capture this zone.
- Reach this exit.
- Protect this NPC.
- Disable this interactable.
- Hold this barricade.
- Stop this ritual.
- Escape through this route.
- Keep enemies out of this area.

Possible fields:

- `id`
- `type`
- `zoneId`
- `participantId`
- `interactableId`
- `clockId`
- `description`

## LLM-assisted generation pipeline

### 1. Gather map context

Inputs should include:

- Current location name, description, short description, base level.
- Region name, weather, light, parent hierarchy, vehicle status.
- Known exits and directions.
- Location items and scenery.
- NPCs, party, hostiles, bystanders.
- Current player action or tactical trigger.
- Tactical objective and stakes.
- Relevant quest/faction context.
- Known hazards or status effects.
- Vehicle interior/exterior metadata if applicable.
- Existing map cache, if regenerating.

Avoid dumping all history. The map prompt needs concrete local affordances more than full narrative memory.

### 2. Ask for a map plan, not prose

The prompt should explicitly ask for structured output only. The LLM should identify map concepts, then emit final map XML/JSON. Any reasoning should be outside the final block or omitted if strict parsing requires it.

Important prompt constraints:

- Preserve known exits.
- Include at least one player deployment area.
- Include enemy deployment areas when enemies are known.
- Include 3-8 zones for a first version unless the scene genuinely needs more.
- Keep every zone tactically distinct.
- Make the graph connected unless isolation is intentional and explained.
- Do not invent permanent world-state changes.
- Do not create objects as durable inventory/scenery unless explicitly requested.
- Prefer semantic map affordances over exact measurements.

### 3. Server validation

Validate before use:

- Required fields exist.
- IDs are unique.
- References resolve.
- Every connection references valid zones.
- Deployment zones exist.
- Objective anchors reference valid targets.
- Known exits are represented or explicitly omitted with a reason.
- Player start is valid.
- Participant placement zones exist.
- The graph is connected enough for the scene.
- Zone count is within configured bounds.
- No unknown durable object IDs are referenced.
- Hazards and barriers have valid types.
- Movement costs and cover values are from known enums.

Invalid output should produce a clear error. For LLM-generated maps, the system can run a repair prompt using the validation errors and original output.

### 4. Repair loop

If validation fails, send the structured validation errors back to a map-repair prompt. The repair prompt should return a full corrected map, not a patch, to avoid partial merge ambiguity.

Rules:

- Limit repair attempts.
- Preserve valid known-world references.
- Log every attempt via `LLMClient.logPrompt()`.
- If repair fails, fail the tactical-map generation and let the user retry or choose narrative resolution.

### 5. Mechanical normalization

After validation:

- Normalize cover/visibility/elevation values.
- Derive default movement costs.
- Derive range bands from graph distance if needed.
- Stamp generation metadata.
- Place participants using deployment areas.
- Build display layout hints if absent.

This is not a fallback map generator. It is a normalization step over a valid semantic map.

### 6. Render

Render from the semantic graph. The first UI can be a zone list plus connections. Later renderers can use SVG/canvas.

## Rendering strategies

### Phase 1: Zone cards

Display each zone as a card:

- Zone name.
- Cover/visibility/elevation chips.
- Hazards.
- Interactables.
- Participants.
- Adjacent zones.

Pros:
- Easiest to implement.
- Good for accessibility.
- Avoids coordinate layout complexity.

Cons:
- Feels less like a battle map.
- Spatial relationships are less immediate.

### Phase 2: Graph map

Render zones as nodes and connections as edges.

Pros:
- Shows movement topology clearly.
- Works for arbitrary and abstract spaces.
- Supports vertical or weird maps better than a grid.

Cons:
- Needs layout constraints to avoid messy graphs.
- Less familiar than square grids.

### Phase 3: Abstract area map

Render zones as irregular areas or boxes with approximate positions.

Pros:
- Feels more map-like.
- Can show interior/exterior, high/low ground, and choke points.

Cons:
- Requires more layout logic.
- Coordinates still should not become mechanical truth.

### Phase 4: Grid projection

Optionally project the zone graph into a grid for players who want that style.

Pros:
- Familiar tactical RPG feel.

Cons:
- Hardest to keep consistent for arbitrary locations.
- May overpromise precision the system does not actually model.

Recommendation: start with zone cards plus graph map. Treat area maps or grids as later visualizations of the same semantic model.

## Handling arbitrary location types

### Indoor rooms

Map zones can represent:

- Entry.
- Main floor.
- Bar/counter.
- Balcony.
- Kitchen/back room.
- Stairs.
- Windows/exits.
- Cover clusters.

### Wilderness

Map zones can represent:

- Trail.
- Tree line.
- Ridge.
- Stream.
- Dense brush.
- Clearing.
- Campsite.
- Rock outcrop.

### Urban streets

Map zones can represent:

- Street center.
- Alley.
- Rooftop.
- Market stalls.
- Doorways.
- Crowd.
- Vehicles.
- Barricade.

### Vehicles

Map zones can represent:

- Cockpit/bridge.
- Passenger/cargo area.
- Engine room.
- Exterior/deck/roof.
- Hatch/airlock.
- Turret/weapon station.
- Damaged section.
- Escape route.

Vehicle maps may need forward/aft/port/starboard orientation instead of compass directions.

### Multi-level spaces

Use elevation and directed connections:

- Balcony above floor.
- Ladder to roof.
- Shaft down to machinery.
- Cliff ledge.
- Tree canopy.
- Stairwell.

Do not require a 3D grid. Model tactical effects: sight, movement cost, fall risk, cover, and range.

### Abstract/social spaces

For social standoffs, zones might be social positions rather than physical areas:

- Speaker's dais.
- Crowd.
- Faction delegation.
- Evidence table.
- Exit corridor.
- Guard line.

This should probably be later-scope, but the schema should not prevent it.

## Map generation prompt shape

Possible prompt sections:

- `<currentLocation>`
- `<knownExits>`
- `<sceneryAndObjects>`
- `<participants>`
- `<weatherAndLight>`
- `<objective>`
- `<constraints>`
- `<outputSchema>`

Possible final output:

```xml
<tacticalMap>
  <scale>room</scale>
  <orientation>front door at south</orientation>
  <zones>
    <zone id="z1">
      <name>Front Entry</name>
      <description>...</description>
      <role>approach</role>
      <cover>light</cover>
      <visibility>clear</visibility>
      <elevation>level</elevation>
      <features>
        <feature>doorway</feature>
      </features>
    </zone>
  </zones>
  <connections>
    <connection id="c1">
      <from>z1</from>
      <to>z2</to>
      <movementCost>normal</movementCost>
      <relation>adjacent</relation>
    </connection>
  </connections>
  <deploymentAreas>
    <deploymentArea id="d_player">
      <side>player</side>
      <zone>z1</zone>
    </deploymentArea>
  </deploymentAreas>
</tacticalMap>
```

The real schema can be JSON or XML. XML may fit existing prompt parsing patterns; JSON may fit stricter schema validation. Either way, the output must be complete and validated.

## Server-side validation details

### Graph validation

Check:

- At least 2 zones for tactical scenes.
- At least 1 player deployment area.
- Connections do not reference missing zones.
- Graph is connected for normal scenes.
- Isolated zones must be marked as hidden, inaccessible, or special.
- Bidirectional movement is explicit or derivable.
- Directed edges are allowed only when tagged.

### Known exit validation

Known exits should be represented as:

- A zone feature.
- A linked exit on a zone.
- An objective anchor.
- A deployment/reinforcement area.
- Or explicitly omitted as irrelevant.

This matters because tactical maps should not make the player forget available exits.

### Object validation

If the map references existing scenery/items:

- `linkedThingId` must resolve.
- The thing must be in the current location or otherwise context-valid.
- The map may add battle-local interactables without durable IDs.
- Durable world objects are only created through normal thing/event creation flows.

### Participant validation

Participants must start in valid deployment zones. Hidden enemies can be placed in hidden/suspected zones, but the server should know their actual zone if they are tactically active.

### Mechanical enum validation

Values such as cover, visibility, elevation, movement cost, hazard type, and role should be enums. Unknown values should fail validation and repair rather than becoming silent text tags.

## Map reuse and caching

Potential strategies:

### Scene-local only

Generate a map for each tactical scene and discard/archive it afterward.

Pros:
- Always tailored to the current objective and participants.
- Avoids stale maps when locations change.

Cons:
- Repeated battles in the same location regenerate similar maps.

### Location-level cached tactical map

Cache a base tactical map on the location and adapt it for each scene.

Pros:
- Consistency across repeat visits.
- Faster after first generation.
- Useful for map editing.

Cons:
- Stale if location description/scenery/exits change.
- May not fit every objective.

### Base map plus scene overlay

Cache a base map, then generate scene-specific deployment areas, hazards, objectives, and temporary interactables.

Pros:
- Best long-term model.
- Preserves location identity while allowing tactical variation.

Cons:
- More complex validation and invalidation.

Recommendation: first version can use scene-local maps. Long-term, base map plus scene overlay is likely strongest.

## Regeneration and editing

Players or developers may need to fix bad maps.

Useful actions:

- Regenerate map from same context.
- Regenerate with instruction.
- Edit zone names/descriptions.
- Add/remove connections.
- Mark cover/visibility/hazards.
- Reassign participant start zones.
- Link/unlink known exits.
- Save as location base map.

The editor can be later-scope, but regeneration with additional instructions would be useful early.

## Quality heuristics

A good generated tactical map has:

- 3-8 meaningful zones for small/medium scenes.
- At least two viable movement choices.
- At least one feature that matters besides attacking.
- Clear exits.
- Cover or terrain where appropriate.
- A reason for the objective's location.
- Deployment areas that match the narrative.
- Hazards that fit the location.
- No excessive generic zones like "left side" and "right side" unless the space is genuinely simple.
- No invented major world facts that contradict the location description.

Bad map signs:

- All zones are equivalent.
- Every connection is fully connected to every other zone.
- The objective is unreachable.
- Known exits are missing.
- Cover is everywhere or nowhere with no reason.
- The map ignores important scenery.
- Participants start in nonsensical places.
- The graph is too large for the encounter.

## LLM self-critique and repair

The map prompt could include a brief self-check before final output:

- Are all known exits represented?
- Is the graph playable?
- Are zones distinct?
- Is the objective reachable?
- Are deployment areas valid?
- Are hazards and cover grounded in location context?

The final output should still be parsed and validated by the server. The self-check is not a substitute for validation.

## Integration with tactical battles

### TacticalScene

`TacticalScene` can reference:

- `tacticalMapId`
- active map version
- participant zone placements
- objective anchors
- clocks tied to zones/interactables

### Tactical actions

Map data drives:

- Legal movement.
- Range checks.
- Cover and visibility modifiers.
- Interaction targets.
- Flee/escape routes.
- Reinforcement entry.
- Area effects.
- Hazard exposure.

### Battle log

The battle log should record map-relevant changes:

- Moved from zone A to zone B.
- Took cover in zone C.
- Opened barrier D.
- Destroyed interactable E.
- Fire spread into zone F.
- Enemy reinforcements entered through zone G.

## Integration with existing game systems

### Location

Use location descriptions, short descriptions, exits, random events, status effects, generation hints, things, NPCs, and vehicle info as source material.

### Region and weather

Weather and light can affect visibility, hazards, cover quality, and movement. Outdoor tactical maps should reflect region weather when applicable.

### Things and scenery

Existing things can become linked tactical features. Battle-local interactables should not become durable things unless an event explicitly creates them afterward.

### Vehicles

Vehicle locations and vehicle regions need special orientation, route exits, and onboard zones. A generated vehicle map should preserve `VehicleInfo.vehicleExitId` and any known inside/outside exits.

### Events

Normal event checks should not double-apply map changes. Tactical map state changes should be handled through tactical-specific structured outcomes, then summarized.

### Save/load

Active tactical maps must serialize with active tactical scenes. Cached location maps need invalidation metadata if location description, exits, or scenery change.

## UI ideas

### Zone list plus mini graph

First UI:

- Left: zone cards.
- Right: simple graph.
- Participant icons/chips inside zones.
- Edge labels for difficult movement or barriers.
- Click zone to inspect cover, hazards, interactables, exits.

### Map inspector

Developer/admin view:

- Raw map JSON/XML.
- Validation status.
- Known exits coverage.
- Unlinked objects.
- Graph connectivity.
- Regenerate/repair controls.

### Player-facing map controls

- Select destination zone.
- Select target in zone.
- Take cover in current zone.
- Interact with feature.
- Inspect exits.
- Toggle hazard/visibility overlays.
- Show legal moves.

### Accessibility

The zone list should be fully usable without the graph. The graph is a visual enhancement, not the only way to understand tactical state.

## Prompt logging and debugging

Every map generation and repair prompt should log via `LLMClient.logPrompt()`.

Debug artifacts should include:

- Source context.
- Raw LLM output.
- Validation errors.
- Repaired output.
- Final normalized map.
- Generation context hash.

This will be important because bad tactical maps can make battles feel unfair or impossible.

## Testing ideas

Unit-level:

- Schema validation.
- Graph connectivity.
- Known exit coverage.
- Participant placement.
- Enum validation.
- Reference validation for thing IDs and exit IDs.
- Map normalization.
- Save/load active map.

Fixture prompts:

- Tavern brawl.
- Forest ambush.
- Rooftop chase.
- Starship bridge.
- Moving train.
- Market riot.
- Cave with water hazard.
- Vehicle interior with outside exit.
- Abstract social standoff.

Integration:

- Generate tactical map from current location.
- Repair invalid LLM map.
- Start tactical scene with participant placement.
- Move between zones.
- Use cover/visibility in attack calculation.
- End scene and ensure battle-local map objects do not pollute world state.

Playwright:

- Open tactical map panel.
- Inspect zone list.
- Click graph zone.
- Move a participant.
- Confirm legal moves update.
- Confirm mobile layout works.

## Rollout options

### Slice 1: Map generation preview

Generate a tactical map from the current location and show the zone list. No tactical mechanics yet.

Pros:
- Tests prompt and validation.
- Useful as a debugging artifact.

Cons:
- Not yet gameplay.

### Slice 2: Scene-local map for skirmish mode

Generate a map when a tactical skirmish starts. Use it for movement, range, cover, and deployment.

Pros:
- Directly supports the first tactical battle slice.

Cons:
- Requires integration with participant placement and action legality.

### Slice 3: Repair and regeneration UI

Expose validation errors and regeneration controls.

Pros:
- Makes LLM map failures manageable.

Cons:
- More developer-facing UI work.

### Slice 4: Location base maps plus scene overlays

Cache validated maps for locations and generate tactical overlays per scene.

Pros:
- Consistent repeat battles.

Cons:
- Needs invalidation and editing rules.

### Slice 5: Advanced visual renderer

Add SVG/canvas area rendering, overlays, and optional decorative generated art.

Pros:
- More immersive.

Cons:
- Higher UI and testing cost.

## Strong first implementation candidate

The strongest first tactical-map feature would likely be a map preview and validator:

- Generate scene-local tactical map for the current location.
- Use LLM-authored semantic zone graph.
- Validate graph and known references.
- Show zone cards and adjacency.
- Log prompt/output/validation.
- Allow retry with an instruction.
- Do not start full tactical combat yet.

This isolates the hardest uncertainty: whether the LLM can reliably convert arbitrary location context into playable tactical maps.

## Open questions for a future spec

1. Should tactical maps be generated only when tactical mode starts, or can players preview them before committing?
2. Should the canonical output be XML for consistency with existing prompts or JSON for stricter schema validation?
3. How many zones should be allowed by default?
4. Should known exits be mandatory in every tactical map?
5. Should participant placement be generated with the map or in a separate prompt?
6. Should maps be cached per location, per scene, or both?
7. Should players be allowed to edit generated tactical maps?
8. Should the first renderer be zone cards only, graph only, or both?
9. How should hidden zones and hidden enemies be represented in player-facing UI?
10. How should generated maps handle contradictory or vague location descriptions?

