# Gameplay Improvement Brainstorm

This document collects gameplay-focused ideas that could improve the AI RPG without committing to an implementation plan. It is an idea/archive/design document, not a release history. Ideas that are implemented are retained here for rationale and cross-reference; open ideas are framed as proposals.

Status labels:

- **Proposal**: not implemented as a dedicated system, though existing code may provide useful anchors.
- **Partially supported**: current systems cover some of the behavior, but the idea would still need a focused design.
- **Implemented**: current behavior exists; the section preserves the design rationale and points to current docs.

## Guiding principles

- Make world state legible enough that players understand why things happened.
- Give players stronger verbs without turning the game into a rigid menu system.
- Let the LLM improvise, but anchor important outcomes in persistent state.
- Prefer mechanics that work across settings rather than fantasy-specific assumptions.
- Surface consequences early and clearly instead of hiding them in prose.

## Low-effort ideas

### 1. Rest, camp, and wait actions - Proposal

Add first-class player affordances for passing time intentionally: rest briefly, wait until morning/evening, camp for the night, or recover for a configurable duration. This should be a gameplay-facing layer, not just an admin-style time command.

Current support already exists for minute-based world time, status ticking, need bars, health/status recovery hooks, weather, due scheduled events, and vehicle arrivals. A focused rest action would make those systems feel intentional instead of incidental.

Benefits:

- Gives players a clear recovery loop.
- Makes hunger, rest, weather, and status effects matter without extra narrative burden.
- Provides a natural place to surface random events, interruptions, or unsafe-rest warnings.

Likely anchors:

- `Globals.advanceTime(...)`
- `Player.applyStatusEffectNeedBarsToAll()`
- `/api/chat`, `/api/player/move`, and `/time`
- `ScheduledEvent` due-event processing
- Need-bar and status-effect docs

Risks:

- Rest can trivialize danger if there is no interruption, shelter, or cost model.
- Needs setting-agnostic wording and configurable recovery behavior.
- Long waits should fail loudly when required time-processing dependencies are unavailable.

### 2. Stakes preview before risky actions - Proposal

When a player action is likely to trigger a mechanical check, offer a concise "likely stakes" preview before resolving: relevant skill/attribute, expected difficulty band, possible costs, and likely upside. This could be optional or available through a button/action rather than forced on every turn.

Current behavior records post-action `ActionResolution`, `plausibility`, `plausibilities`, and visible prompt-excluded `check-results` entries after checks resolve. This idea is specifically about pre-action visibility, not replacing the existing check records.

Benefits:

- Reduces "I did not know that would be hard" frustration.
- Helps players learn the system's skill and attribute language.
- Makes failure feel more fair.

Likely anchors:

- `ActionResolution` / `check-results` shapes in `docs/api/common.md`
- `resolveSkillCheck(...)`, `resolveOpposedSkillCheck(...)`, `resolveAttack(...)`
- Plausibility insight rendering in chat UI
- `/api/chat` regular prose tool flow

Risks:

- Adds an extra interaction step if made mandatory.
- The preview must not promise exact odds or outcomes that later tool resolution may contradict.
- Previews should not leak hidden information, such as concealed NPC opposition.

### 3. Player agenda notes - Proposal

Let the player maintain a short active agenda: current goal, constraints, preferred tone, and party plan. Inject it into base context as player-authored intent rather than hidden story state.

Current systems have NPC goals, NPC `characterArc`, hidden player-action notes, Story Tools, scene summaries, and generic prompt history controls. None of those are a clean player-owned "what I am trying to do next" field.

Benefits:

- Helps the LLM respect long-running player intent.
- Gives players a low-friction steering surface without rewriting prompts.
- Could reduce "forgotten plan" failures.

Likely anchors:

- Chat UI Story Tools or a compact Play-tab control
- Save metadata or current-player metadata
- Base-context prompt rendering

Risks:

- Needs clear distinction from quests, NPC goals, hidden plot summaries, and GM-private mystery notes.
- Stale agenda text could overconstrain the LLM.

### 4. Companion tactics defaults - Proposal

Give party members lightweight default tactics: cautious, aggressive, protective, support, stealthy, avoid combat, conserve resources. These can be shown in the party panel and included in prompt context for NPC turn/action generation.

Benefits:

- Makes party members feel less passive.
- Reduces repeated manual instructions.
- Works across genres if phrased as behavior, not class mechanics.

Likely anchors:

- `Player` party fields, NPC goals, personality, and `characterArc`
- NPC turn handling in `/api/chat`
- Party and NPC edit UI docs

Risks:

- LLM may over-apply tactics unless prompt guidance is concise.
- Needs persistence per NPC.
- Party tactics should not override explicit player instructions or NPC agency.

### 5. Action verb shortcuts - Proposal

Add contextual verbs for common object and NPC interactions: inspect, use, eat/drink, read, open, harvest, salvage, talk, threaten, recruit, dismiss, give, trade, follow, attack, flee. These should produce editable chat text or open the relevant existing flow rather than becoming opaque hidden commands.

Current UI already has specialized affordances for several domains, including containers, crafting/process/salvage/harvest, location modification, barter, map travel, NPC editing, and contextual object actions from enabled mods. This idea is about a unified player-facing verb layer that makes those possibilities easier to discover.

Benefits:

- Helps players discover what is possible.
- Improves mobile play by reducing typing.
- Makes item/scenery flags more visible.

Likely anchors:

- Thing flags such as `isHarvestable`, `isSalvageable`, `isContainer`, `isCraftingStation`, and mod-owned Thing fields
- Existing inventory/location/context menus
- `/api/chat`, crafting routes, container routes, and barter routes

Risks:

- Too many verbs can clutter menus.
- Generated action text must remain editable so players retain agency.
- Shortcuts that mutate state directly need exact auditability and should reuse existing endpoints.

### 6. Rumor and opportunity cards - Proposal

Use current region, factions, NPC goals, random-event seeds, mystery threads, scene summaries, and hidden plot notes to surface a few diegetic hooks: rumors, jobs, threats, strange weather, faction requests, or nearby opportunities.

Benefits:

- Helps players who feel stuck.
- Turns existing world state into playable direction.
- Can be refreshed without forcing a quest.

Likely anchors:

- Random event seeds
- Faction and quest systems
- Mystery boxes/threads and scene summaries
- Plot summary/plot expander hidden entries
- Location and region response payloads

Risks:

- Hooks should not reveal secrets too directly.
- Needs dedupe so the same rumor does not reappear constantly.
- Should distinguish soft opportunities from committed quests.

## Medium-effort ideas

### 7. Consequence ledger - Proposal

Create a persistent ledger of promises, debts, threats, timers, unresolved consequences, and faction obligations. Unlike quests, these can be softer and may originate from event checks, player notes, or Story Tools edits.

Current systems already provide parts of this: quests track explicit objectives, event/status summaries explain recent changes, `ScheduledEvent` tracks timed future events, `MysteryBox`/`MysteryThread` track GM-private continuity, and `SceneSummaries` support recall. The ledger proposal is a player-visible soft-pressure layer that sits between quests and hidden continuity.

Benefits:

- Makes emergent story consequences trackable.
- Gives the LLM a structured memory of unresolved pressure.
- Helps players resume a save after time away.

Likely anchors:

- `Events` outcome handling
- `Quest` for harder objectives
- `ScheduledEvent` for timed pressure
- `MysteryBox`, `MysteryThread`, and `SceneSummaries`
- Story Tools UI

Risks:

- Over-recording minor details would create noise.
- Needs clear merge/update behavior to avoid duplicates.
- Must decide which entries are player-visible and which remain GM-private.

### 8. Travel planner and journey risk - Proposal

Expand travel from exit buttons into a journey planning loop: route, travel time, region danger, weather, vehicle status, known stops, camping/inn options, food and water planning, and likely interruption chance. Use the existing directed exit graph and travel-time data. See `docs/ideas/travel_planner_journey_risk_brainstorm.md` for the expanded brainstorm.

Long-distance fast travel should not mean the player blindly walks until exhausted and starving. A realistic journey would include paid lodging where available, camping when necessary, meal breaks, hunting, foraging, water collection, and decisions about whether to push through or spend more time recovering. Hunting and foraging can be skill-checked activities whose outcomes determine how much travel time is diverted, how much rest is recovered, what quality of food is found, whether supplies are consumed, and whether the party attracts attention.

Current travel support includes directed `LocationExit.travelTimeMinutes`, shortest-route helpers, map/favorites fast-travel previews, vehicle ETA/departure state, time advancement, need/status processing, weather, and scheduled-event arrival processing. The planner would make those costs and tradeoffs visible before a long trip begins.

The planner could present route modes such as:

- Safe lodging: spend currency at inns, stations, ports, monasteries, caravansaries, or other setting-appropriate stops when known.
- Camp normally: consume carried supplies, recover a moderate amount, and accept baseline encounter risk.
- Hunt/forage while traveling: attempt skill checks to reduce supply cost, with time/rest/food-quality tradeoffs.
- Push hard: minimize elapsed travel time while increasing need, exhaustion, injury, morale, or random-encounter risk.
- Travel cautiously: move slower, rest better, scout ahead, and lower ambush risk in dangerous territory.

Benefits:

- Makes travel time and vehicles more strategic.
- Gives world maps more gameplay value.
- Clarifies why a trip took time or triggered events.
- Prevents long fast-travel actions from feeling like an automatic starvation/exhaustion trap.
- Creates meaningful skill-check uses for survival, hunting, navigation, perception, local knowledge, or setting-specific equivalents.
- Makes food, water, currency, weather, shelter, and danger matter during travel without requiring the player to narrate every meal.

Likely anchors:

- `Location.findShortestTravelTimeMinutes(...)` and `Location.findShortestTravelRoute(...)`
- `LocationExit.travelTimeMinutes`
- `VehicleInfo`
- Need bars and status effects
- Player inventory/currency
- Skill-check tools and `ActionResolution`
- Region weather and random-event seeds
- Region/world map UI

Risks:

- Travel graph integrity is already strict; planner errors should fail loudly.
- Unknown stubs need careful display so mystery remains mystery.
- Automated camping/eating should not erase all consequences of harsh terrain or poor preparation.
- Hunting/foraging needs configurable setting-appropriate skill names and outcomes.
- Random encounters during travel should be weighted by route danger and travel mode, not a flat interruption chance.

### 9. Location comfort and danger profile - Proposal

Give each location a small setting-agnostic profile: safety, shelter, visibility, crowd level, resource abundance, and hostility. These values can inform rest safety, random events, need drift, stealth, and social outcomes.

Benefits:

- Makes locations matter mechanically beyond descriptions.
- Creates a reusable input for prompts and UI.
- Supports both cozy and dangerous play styles.

Likely anchors:

- `Location` metadata/generation hints
- Region weather and controlling faction
- Random event checks
- Need bars and status effects
- Rest/camp and travel-planner proposals

Risks:

- Must avoid arbitrary hidden numbers that players cannot inspect.
- Generated profiles need validation and save migration.
- Profiles should not duplicate richer authored descriptions.

### 10. Lightweight trade and barter loop - Implemented

The current game has a setting-agnostic NPC trade and barter loop. Non-hostile, alive, willing NPCs at the current location or in the party can open barter sessions. NPCs have persisted barter stock separate from normal inventory, temporary trade refusals, generated/daily-refreshed stock, LLM-authored prices, haggling with opposed checks, exact server-side item/currency mutation, and visible trade summaries.

Current behavior:

- `POST /api/npcs/:id/trade/session` starts or refreshes a quoted barter session.
- `POST /api/npcs/:id/trade/haggle` reruns valuation with haggle context and can make the merchant temporarily refuse trade.
- `POST /api/npcs/:id/trade/commit` validates the whole transaction, transfers items/currency, records a trade summary, and queues merchant follow-up behavior.
- `POST /api/npcs/:id/trade/conclude` closes a session without item transfer.
- `Player` persists `barterInventory`, `willingToTrade`, `tradeRefusalExpiresAt`, `barterStockUpdatedAt`, and `barterProfile`.

Archive rationale:

- Keeps inventory mutation deterministic and auditable while letting the LLM provide valuation, stock flavor, willingness, and haggle reactions.
- Makes currency and item value useful without requiring every NPC to carry a full shop schema.
- Gives factions, dispositions, and NPC personality a practical interaction surface.

Reference docs:

- `docs/api/npcs.md`
- `docs/classes/Player.md`
- `docs/ideas/trade_barter_system_plan.md`

Remaining extension ideas:

- Location-owned markets or vending/trading points.
- Better persistent merchant specialties through `barterProfile`.
- Rumor/opportunity cards that point at available traders without auto-opening trade.

### 11. Project and downtime system - Proposal

Support longer activities such as crafting a special item, researching lore, training a skill, building shelter, repairing a vehicle, earning money, or improving faction standing. Projects would have stages, time cost, requirements, and visible progress.

Current crafting/process/salvage/harvest and location-modification flows cover immediate activities. This proposal is for multi-session progress that can survive interruptions and produce consequences over time.

Benefits:

- Gives players a constructive loop between adventures.
- Uses minute-based time meaningfully.
- Creates natural hooks for NPC help and complications.

Likely anchors:

- Quest/objective model
- Crafting and processing routes
- `ScheduledEvent` for future milestones
- Time advancement helpers
- Player skill/attribute progression

Risks:

- Scope can grow quickly if projects become their own game inside the game.
- Requires clear cancellation, interruption, and failure behavior.

### 12. Encounter aftermath cleanup - Proposal

After combat or major conflict, offer a focused aftermath step: loot, stabilize allies, interrogate, flee, hide bodies, harvest resources, report to faction, or rest. This would reduce awkward manual cleanup after intense scenes.

Benefits:

- Makes combat consequences more complete.
- Provides structured recovery without making combat mandatory.
- Helps the LLM remember obvious post-fight actions.

Likely anchors:

- Attack checks and damage application
- Corpse persistence/countdown
- Item drops, status effects, quest outcomes
- Action verb shortcuts
- Rest/camp actions

Risks:

- Needs to work for non-combat conflicts too.
- Should remain optional, not a forced modal after every fight.
- Must not duplicate event summaries or loot flows.

### 13. Visible weather and lighting image variants - Implemented

The current game supports visible weather/lighting variants for location images when ComfyUI is the active image engine and a usable base location image exists. The Adventure UI can show the base image immediately, request the current display variant, and swap to a cached or newly generated variant without replacing `location.imageId`.

Current behavior:

- `POST /api/images/location-variant/request` resolves conditions from world time, location weather exposure, and regional weather.
- Variants require `imagegen.engine: "comfyui"` and use the effective `imagegen.workflow.edit` profile.
- The server renders a deterministic edit prompt locally from `templates/location-weather-variant-image-prompt.njk`; no LLM prompt-writing call is used.
- `Location.imageVariants` stores display-only cached variants keyed by source image plus normalized lighting/weather.
- Base image regeneration, uploads, visual location edits, vehicle visual edits, and weather-exposure edits clear obsolete variants.

Archive rationale:

- Makes world time and weather immediately visible instead of only textual.
- Reuses existing descriptive state and avoids extra LLM latency/cost.
- Keeps base location art authoritative while letting presentation vary by conditions.

Reference docs:

- `docs/api/images.md`
- `docs/classes/Location.md`
- `docs/classes/ComfyUIClient.md`
- `docs/ideas/finished/visible_weather_image_variants_plan.md`

Remaining extension ideas:

- Stronger indoor/sheltered prompt tuning.
- User controls for when variants should be generated.
- Better diagnostics for unsupported engines or missing workflow templates.

## High-effort ideas

### 14. Fronts, clocks, and world pressures - Proposal

Model major threats or opportunities as clocks: faction war escalates, a storm approaches, a villain completes a ritual, a caravan leaves, a disease spreads, a festival begins. Clocks advance through time, player actions, and offscreen activity.

Current `ScheduledEvent` support can already resolve future events at specific times and locations. This idea is a broader visible pressure model with states, progress, and player-facing context.

Benefits:

- Gives the sandbox stronger momentum.
- Makes time passage meaningful.
- Helps the LLM maintain long arcs without railroading.

Likely anchors:

- `ScheduledEvent`
- Factions
- Offscreen NPC activity
- World time
- Plot summary/expander
- Event checks

Risks:

- Requires strong UI because invisible clocks feel unfair.
- Needs guardrails so clocks do not explode into too many background prompts.
- Progress changes must be explainable and inspectable.

### 15. Relationship arcs - Proposal

Turn dispositions, memories, goals, party history, and existing NPC `characterArc` fields into explicit relationship arcs with stages, turning points, trust breaks, reconciliations, rivalries, and loyalties.

Current support includes NPC dispositions, memories, goals, and persisted `characterArc` with short-term and long-term personal arc text. The proposal is not to replace those fields, but to add relationship-specific progression that can be inspected and updated consistently.

Benefits:

- Makes NPCs feel persistent and responsive.
- Gives party management emotional weight.
- Creates emergent story without relying only on prose memory.

Likely anchors:

- NPC dispositions and memories
- NPC goals and `characterArc`
- `wasEverInPlayerParty`
- `persistWhenDead`
- Scene summaries

Risks:

- Needs careful summarization so arcs do not bloat prompts.
- LLM-generated relationship changes should be explainable.
- Relationship stages should not fight existing disposition definitions.

### 16. Faction operations layer - Proposal

Let factions run visible operations: patrols, recruitment, propaganda, trade, sabotage, relief, diplomacy, raids, investigations. Player actions and reputation affect what operations appear or resolve.

Benefits:

- Makes factions more than standings.
- Creates setting-agnostic recurring content.
- Gives regions a stronger political identity.

Likely anchors:

- `Faction`
- Region controlling faction
- Faction relations and reputation tiers
- Random events
- Offscreen prompts
- Scheduled events or fronts/clocks

Risks:

- Can become hard to debug if too much happens offscreen.
- Requires clear witness/reputation rules.
- Needs a visible state model so operations do not feel arbitrary.

### 17. Scenario director - Proposal

Add a director layer that watches player behavior and world state, then proposes setting-appropriate pacing beats: quiet discovery, danger, social complication, resource pressure, revelation, or consequence. It should suggest, not override, the event system.

Benefits:

- Improves pacing in long sessions.
- Helps avoid endless neutral "look around" turns.
- Can use existing random-event and plot-expander infrastructure.

Likely anchors:

- `Events`
- Random event seeds
- Plot expander
- Scene summaries
- Mystery threads and active clocks/fronts, if implemented

Risks:

- Must not feel like invisible railroading.
- Needs strong opt-out/config controls.
- Should not duplicate the separate visible game-improvement-suggestion prompt path.

### 18. Tactical conflict mode - Proposal

For players who want crunch, offer an optional structured conflict loop: zones/range, cover, positioning, party tactics, morale, special abilities, and objective-based win conditions. Keep normal prose mode as default. See `docs/ideas/tactical_battles_brainstorm.md` for an expanded brainstorm.

Benefits:

- Gives combat-focused play more depth.
- Makes abilities and gear more meaningful.
- Can support non-combat conflicts if generalized as "structured scenes."

Likely anchors:

- Attack and area-attack tools
- Skill-check tools
- Abilities
- Location/scenery
- Party tactics

Risks:

- High complexity and testing burden.
- Could fight the freeform LLM style if not optional.
- Needs a clear exit back to normal prose mode.

### 19. Setting-specific rule modules - Proposal

Allow a setting or mod to opt into custom rule modules: cyberpunk heat, survival exposure, political influence, mystery clues, horror stress, ship travel, school schedules, investigation boards, or faction economies.

Current mod infrastructure already supports defs overlays, prompt hooks, chat tools, XML events, settings fields, entity fields, UI hooks, and validators. This idea is about packaging genre rules around those existing contracts rather than adding every possible mechanic to the base game.

Benefits:

- Keeps the core engine setting-agnostic while supporting richer genres.
- Gives mods and settings a path to deeper mechanics.
- Avoids overloading the base game with every possible rule.

Likely anchors:

- `ModLoader`
- `ModExtensionRegistry`
- `SettingInfo`
- Config validation
- Prompt context injection

Risks:

- Requires strict contracts so modules do not corrupt saves.
- Documentation and validation become important quickly.
- Setting-owned rule state needs clear persistence rules.

## Strongest still-open candidates

These ideas look like the strongest near-term gameplay payoff among proposals that are not already implemented:

1. Rest, camp, and wait actions.
2. Player agenda notes.
3. Companion tactics defaults.
4. Consequence ledger.
5. Travel planner and journey risk.
6. Location comfort and danger profile.
7. Stakes preview before risky actions.
