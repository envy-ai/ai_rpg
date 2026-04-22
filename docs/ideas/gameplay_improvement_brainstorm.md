# Gameplay Improvement Brainstorm

This document collects gameplay-focused ideas that could improve the AI RPG without committing to an implementation plan. Ideas are grouped by rough effort and are intended to be revisited, narrowed, and turned into focused specs later.

## Guiding principles

- Make world state legible enough that players understand why things happened.
- Give players stronger verbs without turning the game into a rigid menu system.
- Let the LLM improvise, but anchor important outcomes in persistent state.
- Prefer mechanics that work across settings rather than fantasy-specific assumptions.
- Surface consequences early and clearly instead of hiding them in prose.

## Low-effort ideas

### 1. Rest, camp, and wait actions

Add first-class affordances for passing time intentionally: rest briefly, wait until morning/evening, camp for the night, or recover for a configurable duration. The project already has minute-based world time, status ticking, need bars, health regeneration, weather, offscreen activity, and vehicle arrivals, so a focused action layer could make those systems feel more player-facing.

Benefits:
- Gives players a clear recovery loop.
- Makes hunger/rest/weather/status effects matter without extra narrative burden.
- Provides a natural place to surface random events or interrupted rest.

Likely anchors:
- `Globals.advanceTime(...)`
- `Player.applyStatusEffectNeedBarsToAll()`
- `/api/chat`, `/api/player/move`, and slash command time helpers
- `docs/classes/Player.md`, `docs/classes/Globals.md`, `docs/slashcommands/TimeCommand.md`

Risks:
- Rest can trivialize danger if there is no interruption or cost model.
- Needs setting-agnostic wording and configurable recovery behavior.

### 2. Stakes preview before risky actions

When a player action triggers a plausibility or attack check, show a concise "likely stakes" preview before resolving: relevant skill/attribute, expected difficulty band, possible costs, and likely upside. This could be optional or available through a button/action rather than forced on every turn.

Benefits:
- Reduces "I did not know that would be hard" frustration.
- Helps players learn the system's skill and attribute language.
- Makes failure feel more fair.

Likely anchors:
- Existing plausibility checks and `ActionResolution`
- Chat UI insight rendering
- `docs/api/chat.md`

Risks:
- Adds an extra interaction step if made mandatory.
- The preview must not promise an exact outcome the LLM later contradicts.

### 3. Player agenda notes

Let the player maintain a short active agenda: current goal, constraints, preferred tone, and party plan. Inject it into base context as player-authored intent rather than hidden story state.

Benefits:
- Helps the LLM respect long-running intent.
- Gives players a low-friction way to steer without using generic prompts.
- Could reduce "forgotten plan" failures.

Likely anchors:
- Chat UI Story Tools
- Save metadata or current player metadata
- Base-context prompt rendering

Risks:
- Needs clear distinction from quests and hidden plot summaries.
- Stale agenda text could overconstrain the LLM.

### 4. Companion tactics defaults

Give party members lightweight default tactics: cautious, aggressive, protective, support, stealthy, avoid combat, conserve resources. These can be shown in the party panel and included in prompt context for NPC turn/action generation.

Benefits:
- Makes party members feel less passive.
- Reduces repeated manual instructions.
- Works across genres if phrased as behavior, not class mechanics.

Likely anchors:
- `Player` party fields and personality/goals
- NPC turn handling in `/api/chat`
- Player/NPC edit modal docs

Risks:
- LLM may over-apply tactics unless prompt guidance is concise.
- Needs persistence per NPC.

### 5. Action verb shortcuts

Add contextual verbs for common object and NPC interactions: inspect, use, eat/drink, read, open, harvest, salvage, talk, threaten, recruit, dismiss, give, trade, follow, attack, flee. These should produce editable chat text rather than opaque commands.

Benefits:
- Helps players discover what is possible.
- Improves mobile play by reducing typing.
- Makes item/scenery flags more visible.

Likely anchors:
- Thing flags such as `isHarvestable`, `isSalvageable`, `isContainer`
- Existing inventory/location context menus
- `/api/chat` and slash command conventions

Risks:
- Too many verbs can clutter menus.
- Generated action text must remain editable so players retain agency.

### 6. Rumor and opportunity cards

Use current region, factions, NPC goals, random-event seeds, and hidden plot notes to surface a few diegetic hooks: rumors, jobs, threats, strange weather, faction requests, or nearby opportunities.

Benefits:
- Helps players who feel stuck.
- Turns existing hidden world state into playable direction.
- Can be refreshed without forcing a quest.

Likely anchors:
- Random event seeds
- Faction and quest systems
- Plot summary/plot expander hidden entries
- Location and region response payloads

Risks:
- Hooks should not reveal secrets too directly.
- Needs dedupe so the same rumor does not reappear constantly.

## Medium-effort ideas

### 7. Consequence ledger

Create a persistent ledger of promises, debts, threats, timers, unresolved consequences, and faction obligations. Unlike quests, these can be softer and may originate from event checks or explicit player notes.

Benefits:
- Makes emergent story consequences trackable.
- Gives the LLM a structured memory of unresolved pressure.
- Helps players resume a save after time away.

Likely anchors:
- `Events` outcome handling
- `SceneSummaries`
- `SettingInfo` and save metadata
- Story Tools UI

Risks:
- Over-recording minor details would create noise.
- Needs clear merge/update behavior to avoid duplicates.

### 8. Travel planner and journey risk

Expand travel from exit buttons into a journey planning loop: route, travel time, region danger, weather, vehicle status, known stops, camping/inn options, food and water planning, and likely interruption chance. Use the existing directed exit graph and travel-time data. See `docs/ideas/travel_planner_journey_risk_brainstorm.md` for an expanded brainstorm.

Long-distance fast travel should not mean the player blindly walks until exhausted and starving. A realistic journey would include paid lodging where available, camping when necessary, meal breaks, hunting, foraging, water collection, and decisions about whether to push through or spend more time recovering. Hunting and foraging can be skill-checked activities whose outcomes determine how much travel time is diverted, how much rest is recovered, what quality of food is found, whether supplies are consumed, and whether the party attracts attention.

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
- `Location.findShortestTravelTimeMinutes(...)`
- `LocationExit.travelTimeMinutes`
- `VehicleInfo`
- Need bars and status effects
- Player inventory/currency
- Plausibility skill checks
- Region weather and random-event seeds
- Region/world map UI

Risks:
- Travel graph integrity is already strict; planner errors should fail loudly.
- Unknown stubs need careful display so mystery remains mystery.
- Automated camping/eating should not erase all consequences of harsh terrain or poor preparation.
- Hunting/foraging needs configurable setting-appropriate skill names and outcomes.
- Random encounters during travel should be weighted by route danger and travel mode, not a flat interruption chance.

### 9. Location comfort and danger profile

Give each location a small setting-agnostic profile: safety, shelter, visibility, crowd level, resource abundance, and hostility. These values can inform rest safety, random events, need drift, stealth, and social outcomes.

Benefits:
- Makes locations matter mechanically beyond descriptions.
- Creates a reusable input for prompts and UI.
- Supports both cozy and dangerous play styles.

Likely anchors:
- `Location` metadata/generation hints
- Random event checks
- Need bars and status effects

Risks:
- Must avoid arbitrary hidden numbers that players cannot inspect.
- Generated profiles need validation and save migration.

### 10. Lightweight trade and barter loop

Let NPCs or locations expose simple trade inventories or desired goods. Start with setting-agnostic barter: wants, offers, reputation modifier, and refusal reason.

Benefits:
- Gives currency and item value more gameplay use.
- Makes factions and NPCs more interactive.
- Creates reasons to revisit locations.

Likely anchors:
- Player/NPC inventory and currency
- Thing value metadata
- Faction standing
- NPC dispositions

Risks:
- Inventory mutation must be exact and auditable.
- LLM-generated prices should not silently overwrite explicit values.

### 11. Project and downtime system

Support longer activities such as crafting a special item, researching lore, training a skill, building shelter, repairing a vehicle, earning money, or improving faction standing. Projects would have stages, time cost, requirements, and visible progress.

Benefits:
- Gives players a constructive loop between adventures.
- Uses minute-based time meaningfully.
- Creates natural hooks for NPC help and complications.

Likely anchors:
- Quest/objective model
- Crafting and processing routes
- Time advancement helpers
- Player skill/attribute progression

Risks:
- Scope can grow quickly if projects become their own game inside the game.
- Requires clear cancellation/failure behavior.

### 12. Encounter aftermath cleanup

After combat or major conflict, offer a focused aftermath step: loot, stabilize allies, interrogate, flee, hide bodies, harvest resources, report to faction, or rest. This would reduce awkward manual cleanup after intense scenes.

Benefits:
- Makes combat consequences more complete.
- Provides structured recovery without making combat mandatory.
- Helps the LLM remember obvious post-fight actions.

Likely anchors:
- Attack checks and damage application
- Corpse persistence/countdown
- Item drops, status effects, quest outcomes

Risks:
- Needs to work for non-combat conflicts too.
- Should remain optional, not a forced modal after every fight.

### 13. Visible weather and lighting image variants

Use image-editing-capable ComfyUI workflows to create visible time-of-day and weather variants of location images. The game already tracks world-time lighting and regional weather, so the edit prompt can be built automatically from existing location image metadata, location description, current lighting label, weather name, and weather description without running an additional LLM prompt.

Generated variants should be cached per location by the base/source image plus a normalized lighting/weather key, for example `daylight__light-rain` or `night__heavy-fog`. When the player revisits the same location under the same conditions, the UI can reuse the cached edited image instead of generating another one. If the location is altered in a way that affects its visual identity, the variant cache should be cleared so future weather/lighting edits derive from the updated location image.

Benefits:
- Makes world time and weather immediately visible instead of only textual.
- Reuses existing descriptive state and avoids extra LLM latency/cost.
- Gives ComfyUI image editing a high-impact use beyond first-pass generation.
- Makes revisiting familiar places feel different as conditions change.

Likely anchors:
- `Globals.getWorldTimeContext(...)`
- Region `resolveCurrentWeather(...)`
- Location `imageId` and generated-image metadata
- `/api/images/request` and image job queueing
- `ComfyUIClient`
- Location edit/alteration paths that currently clear or replace images

Risks:
- Image-edit workflows need a stable source image and model-specific prompt/denoise settings.
- Variant generation should not block travel or chat; stale/base images may need to remain visible while a variant job runs.
- Cache invalidation must be strict enough that altered locations do not keep visually obsolete weather variants.
- Indoor or weather-sheltered locations should avoid outdoor weather edits unless explicitly marked as weather-exposed.

## High-effort ideas

### 14. Fronts, clocks, and world pressures

Model major threats or opportunities as clocks: faction war escalates, a storm approaches, a villain completes a ritual, a caravan leaves, a disease spreads, a festival begins. Clocks advance through time, player actions, and offscreen activity.

Benefits:
- Gives the sandbox stronger momentum.
- Makes time passage meaningful.
- Helps the LLM maintain long arcs without railroading.

Likely anchors:
- Factions
- Offscreen NPC activity
- World time
- Plot summary/expander
- Event checks

Risks:
- Requires strong UI because invisible clocks feel unfair.
- Needs guardrails so clocks do not explode into too many background prompts.

### 15. Relationship arcs

Turn dispositions, memories, goals, and party history into explicit relationship arcs with stages, turning points, trust breaks, reconciliations, rivalries, and loyalties.

Benefits:
- Makes NPCs feel persistent and responsive.
- Gives party management emotional weight.
- Creates emergent story without relying only on prose memory.

Likely anchors:
- NPC dispositions and memories
- `wasEverInPlayerParty`
- `persistWhenDead`
- Scene summaries

Risks:
- Needs careful summarization so arcs do not bloat prompts.
- LLM-generated relationship changes should be explainable.

### 16. Faction operations layer

Let factions run visible operations: patrols, recruitment, propaganda, trade, sabotage, relief, diplomacy, raids, investigations. Player actions and reputation affect what operations appear or resolve.

Benefits:
- Makes factions more than standings.
- Creates setting-agnostic recurring content.
- Gives regions a stronger political identity.

Likely anchors:
- `Faction`
- Region controlling faction
- Random events
- Offscreen prompts

Risks:
- Can become hard to debug if too much happens offscreen.
- Requires clear witness/reputation rules.

### 17. Scenario director

Add a director layer that watches player behavior and world state, then proposes setting-appropriate pacing beats: quiet discovery, danger, social complication, resource pressure, revelation, or consequence. It should suggest, not override, the event system.

Benefits:
- Improves pacing in long sessions.
- Helps avoid endless neutral "look around" turns.
- Can use existing random-event and plot-expander infrastructure.

Likely anchors:
- `Events`
- Random event seeds
- Plot expander
- Chat history summaries

Risks:
- Must not feel like invisible railroading.
- Needs strong opt-out/config controls.

### 18. Tactical conflict mode

For players who want crunch, offer an optional structured conflict loop: zones/range, cover, positioning, party tactics, morale, special abilities, and objective-based win conditions. Keep normal prose mode as default. See `docs/ideas/tactical_battles_brainstorm.md` for an expanded brainstorm.

Benefits:
- Gives combat-focused play more depth.
- Makes abilities and gear more meaningful.
- Can support non-combat conflicts if generalized as "structured scenes."

Likely anchors:
- Attack checks
- Skill checks
- Abilities
- Location/scenery
- Party tactics

Risks:
- High complexity and testing burden.
- Could fight the freeform LLM style if not optional.

### 19. Setting-specific rule modules

Allow a setting to opt into custom rule modules: cyberpunk heat, survival exposure, political influence, mystery clues, horror stress, ship travel, school schedules, investigation boards, or faction economies.

Benefits:
- Keeps the core engine setting-agnostic while supporting richer genres.
- Gives mods and settings a path to deeper mechanics.
- Avoids overloading the base game with every possible rule.

Likely anchors:
- `SettingInfo`
- Mod loader and defs overlays
- Config validation
- Prompt context injection

Risks:
- Requires strict contracts so modules do not corrupt saves.
- Documentation and validation become important quickly.

## Best first candidates

These ideas look like the strongest near-term gameplay payoff:

1. Rest, camp, and wait actions.
2. Player agenda notes.
3. Companion tactics defaults.
4. Consequence ledger.
5. Travel planner and journey risk.
6. Location comfort and danger profile.
