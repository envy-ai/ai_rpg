# Tactical Battles Brainstorm

This document expands the tactical conflict idea from `gameplay_improvement_brainstorm.md`. It is a brainstorm, not an implementation spec. The core premise is an optional structured battle layer for players who want more tactical depth while preserving the normal freeform prose mode.

## Core pitch

Tactical battles would turn some conflicts into structured scenes with explicit participants, zones, positioning, cover, objectives, turn order, action choices, morale, conditions, abilities, and consequences. The LLM would still narrate and improvise, but the server would own the mechanical state so outcomes stay consistent and debuggable.

The system should support classic fights, but it should not be limited to "kill every enemy." Good tactical scenes can be escapes, chases, rescues, stealth collapses, negotiations under pressure, vehicle boarding actions, monster hunts, duels, sieges, riots, investigations gone wrong, or survival encounters.

## Goals

- Make combat-focused play deeper without forcing tactical play on every player.
- Give equipment, abilities, skills, party tactics, cover, and terrain more visible value.
- Make conflict outcomes easier to audit than pure prose combat.
- Support objectives besides defeating opponents.
- Keep the system setting-agnostic: swords, firearms, magic, drones, psychic powers, mechs, vehicles, social pressure, or improvised tools should all fit.
- Let the LLM describe the scene and make NPC choices, while deterministic server logic owns state changes where possible.
- Allow tactical scenes to escalate naturally from normal prose when a conflict becomes important.

## Non-goals

- Do not replace the default narrative action loop.
- Do not require a grid or exact distances for the first version.
- Do not make every hostile encounter tactical.
- Do not turn the LLM into the sole source of mechanical truth.
- Do not require setting-specific combat rules in the base system.
- Do not hide important state changes inside narration without structured records.

## Player-facing flow

### Entering tactical mode

Possible entry paths:

- The player explicitly chooses a tactical option before or during a fight.
- A config flag prompts for tactical mode when a major combat begins.
- Certain enemies, quests, bosses, faction operations, or dangerous random encounters request tactical mode.
- The player uses a slash command or UI action to convert the current conflict into a tactical scene.
- The LLM proposes tactical mode, but the server and/or player confirms it.

Important behavior:

- Tactical mode should be opt-in by default.
- The player should see why the scene is tactical: stakes, known enemies, objective, and expected complexity.
- The system should support "resolve narratively instead" as an escape hatch before a scene starts.

### Scene setup

The setup step would summarize:

- Participants: player, party, allies, enemies, bystanders, neutral factions.
- Objective: defeat, escape, protect, capture, survive, disable, negotiate, reach, delay, hold, steal, rescue, or discover.
- Battlefield: zones, notable terrain, exits, hazards, cover, visibility, elevation, weather, vehicles, chokepoints, light level.
- Starting positions: each participant starts in a zone with stance and cover information.
- Stakes: what happens if the player wins, loses, flees, delays, or causes collateral damage.
- Time pressure: rounds, countdown clocks, reinforcements, fire spreading, ritual progress, vehicle departure, alarm level, weather worsening.

### During tactical play

Each round could present:

- Current objective and progress.
- Turn order or active-side indicator.
- Party and enemy status.
- Zone map or zone list.
- Available actions.
- Recommended or remembered party tactics.
- Recent mechanical changes.
- A freeform command box for unusual plans.

Player actions should remain natural-language capable, but the UI can offer structured shortcuts:

- Move to zone.
- Take cover.
- Attack.
- Aim.
- Defend.
- Help ally.
- Use ability.
- Use item.
- Interact with scenery.
- Grapple/restrain.
- Flee.
- Rally.
- Talk/threaten/deceive.
- Ready/hold action.
- Change tactic.

### Ending tactical mode

Exit conditions:

- Objective completed.
- Player or enemies flee.
- Negotiation succeeds.
- Morale breaks.
- Countdown resolves.
- Player chooses to hand back to narrative mode.
- Scene becomes impossible to continue because participants leave or are incapacitated.

The end summary should record:

- Winner or outcome type.
- Objective result.
- Health, status, need, item, XP, currency, quest, faction, and disposition changes.
- Dead, incapacitated, captured, escaped, or recruited NPCs.
- Location changes and damage.
- New exits, hazards, or discoveries.
- Time elapsed.
- Follow-up consequences.

## Tactical scene model ideas

### TacticalScene

A new persistent scene state could track:

- `id`
- `locationId`
- `regionId`
- `status`: setup, active, resolving, complete, abandoned
- `round`
- `phase`
- `objective`
- `stakes`
- `participants`
- `zones`
- `turnOrder`
- `activeParticipantId`
- `clocks`
- `log`
- `createdAtWorldMinutes`
- `updatedAtWorldMinutes`

Persistence matters because the player may save/load mid-battle, switch tabs, or recover from a server restart. Tactical scene state should be serialized with saves if active.

### TacticalParticipant

Each participant can reference an existing `Player` or NPC and add battle-local state:

- Actor id.
- Side: player, ally, enemy, neutral, environmental, unknown.
- Zone id.
- Stance: exposed, in cover, hidden, prone, mounted, restrained, guarding, fleeing.
- Intent or tactic.
- Initiative.
- Action availability.
- Morale.
- Threat/attention.
- Temporary tactical tags.
- Objective role: target, protector, carrier, hostage, leader, minion, hazard operator.

Existing `Player` health, status effects, attributes, skills, gear, abilities, dispositions, faction, party membership, and needs should remain authoritative. Tactical participant state should not duplicate durable character state unless it is explicitly battle-local.

### TacticalZone

Zones avoid the complexity of a full grid while still supporting positioning.

Zone fields could include:

- `id`
- `name`
- `description`
- `rangeBand` or relative location.
- `adjacentZoneIds`
- `cover`: none, light, heavy, total.
- `visibility`: clear, dim, obscured, dark.
- `elevation`: low, level, high.
- `hazards`: fire, smoke, unstable, magical, toxic, slippery, exposed, crowded.
- `features`: doors, windows, machinery, vehicles, consoles, rubble, barricades, ledges, water, trees.
- `exitIds` or linked location exits.
- `control`: player, ally, enemy, contested, neutral.

Zones can be generated from the current location description, scenery, exits, weather, and current participants.

See `docs/ideas/tactical_map_generation_brainstorm.md` for a deeper brainstorm on LLM-assisted generation of these zone maps for arbitrary locations.

### Clocks

Tactical clocks would make battles about more than hit points:

- Reinforcements arrive in 3 rounds.
- A vehicle leaves in 5 rounds.
- A building collapses in 4 rounds.
- A ritual completes in 6 rounds.
- Fire spreads each round.
- Alarm level rises after loud actions.
- A hostage is moved if enemies gain control.
- Visibility drops as smoke thickens.

Clocks should be visible when the player has a reason to know them, and hidden only when secrecy genuinely matters.

## Mechanical directions

### Action economy options

Option A: Light action economy.

- Each participant gets one meaningful action per turn.
- Movement can be included with the action when plausible.
- Simple and fast, but less tactical.

Option B: Two-action economy.

- Each participant gets two actions: move, attack, defend, help, interact, use item, use ability.
- More tactical choices without becoming too crunchy.
- Good default candidate.

Option C: Flexible intent economy.

- Player describes a plan.
- Server/LLM maps it to effort, risk, and checks.
- Most natural, but harder to make predictable.

Recommendation for a first real design: start with a two-action economy for tactical scenes, while preserving a freeform action box that can map unusual plans onto one or two actions.

### Initiative and turn order

Possible approaches:

- Player side then enemy side.
- Individual initiative using attributes/skills.
- Dynamic initiative based on surprise, stance, and action.
- Popcorn initiative where the active side chooses who goes next.

Side-based turns are easiest to present and fastest for party play. Individual initiative is more familiar for tactical RPGs but can slow down large encounters.

### Ranges and movement

Use zones rather than exact distances:

- Same zone.
- Adjacent zone.
- Far zone.
- Out of scene.

Weapons and abilities can care about range:

- Melee requires same zone.
- Thrown/short range works adjacent.
- Long range can hit far zones with penalties or cover effects.
- Area effects target a zone.

Movement can be one zone per move action by default, with abilities, vehicles, flight, mounts, terrain, or encumbrance modifying that.

### Cover and visibility

Cover can affect attack difficulty or damage:

- No cover: normal.
- Light cover: minor defense bonus.
- Heavy cover: major defense bonus.
- Total cover: cannot be targeted directly unless flanked, destroyed, bypassed, or affected by area effects.

Visibility can affect targeting, stealth, and ranged attacks:

- Clear.
- Dim.
- Obscured.
- Dark.
- Blinded/smoke/fog/sandstorm/magical interference.

Existing weather and light-level systems could feed this.

### Morale

Morale gives non-lethal outcomes and makes enemies behave believably.

Morale can change when:

- Leader falls.
- Side takes heavy losses.
- Objective becomes impossible.
- Player intimidates or negotiates.
- Reinforcements arrive.
- Escape route opens or closes.
- Faction loyalty matters.
- A terrifying ability or environmental event happens.

Morale outcomes:

- Fight on.
- Fall back.
- Surrender.
- Flee.
- Protect leader.
- Take hostage.
- Bargain.
- Panic.
- Switch sides.

### Conditions and status effects

Tactical conditions should integrate with existing `StatusEffect` where durable, but some effects may remain scene-local:

- Scene-local: flanked, exposed, hidden, overwatched, suppressed, guarded, marked, pinned.
- Durable status effects: bleeding, poisoned, burning, stunned, terrified, inspired, exhausted, blessed, hacked, shielded.

The split matters because "behind cover" should not become a persistent character status after the scene ends.

### Damage and injury

The existing attack and damage systems can remain the base. Tactical mode could add:

- Advantage/disadvantage-like modifiers from cover, flanking, morale, range, elevation, and visibility.
- Objective damage to vehicles, doors, barriers, rituals, machines, shields, or scenery.
- Partial success outcomes: hit but expose yourself, miss but force movement, wound but break weapon, pin target but spend ammo.
- Non-lethal damage and capture outcomes.

### Resources

Depending on setting and config, tactical scenes could track:

- Ammunition.
- Charges.
- Consumables.
- Spell/ability uses.
- Vehicle fuel or integrity.
- Noise/heat/alarm.
- Stamina/fatigue.
- Morale.

This should start conservative. Resource tracking that is not already represented in items, abilities, or status effects can become bookkeeping quickly.

## Role of the LLM

The LLM is strongest at scene interpretation, NPC intent, descriptive narration, and creative consequences. The server should own durable state, validation, and mechanical application.

Good LLM responsibilities:

- Generate initial tactical scene setup from current location, NPCs, scenery, weather, and action.
- Suggest zones and objectives.
- Interpret unusual player actions into possible checks and action costs.
- Choose enemy plans from visible tactical state.
- Narrate mechanical outcomes.
- Propose environmental complications.
- Produce structured output for state changes.

Good server responsibilities:

- Validate scene state.
- Validate legal actions.
- Resolve skill checks and attacks.
- Apply health/status/item/location/quest/faction changes.
- Enforce turn order and action economy.
- Persist tactical state.
- Fail loudly when structured output is invalid.

Hard boundary:

- The LLM should not be allowed to silently move actors, invent damage, remove items, finish objectives, or kill NPCs without structured output that the server parses and applies.

## Prompt ideas

Potential prompt labels:

- `tactical_scene_setup`: create zones, objectives, stakes, participants, and clocks.
- `tactical_player_action_interpretation`: map freeform player intent into candidate tactical actions and checks.
- `tactical_enemy_turn`: choose NPC/enemy actions based on visible state and tactics.
- `tactical_outcome_narration`: narrate server-resolved mechanical outcomes.
- `tactical_scene_resolution`: summarize aftermath and follow-up consequences.

Output should be strict XML or structured tool calls with required sections. Invalid output should fail or retry explicitly.

## UI ideas

### Battle panel

A dedicated battle panel could show:

- Objective and clocks.
- Round and active side/participant.
- Zone list or simple zone map.
- Participants grouped by side.
- Health bars, conditions, morale, stance, and cover.
- Available actions for selected actor.
- Recent battle log.
- Freeform action input.

### Zone display

First version could be a list/card layout:

- Zone name.
- Description.
- Cover/visibility/hazards.
- Participants in the zone.
- Adjacent zones.
- Interactables.

Later versions could add a diagram or canvas map, but a list is easier to build and test.

The deeper tactical map generation brainstorm explores a semantic zone graph as the mechanical source of truth, with visual graph/canvas renderers as later display layers.

### Action composer

The composer should combine structured controls and freeform input:

- Buttons for common actions.
- Target picker.
- Zone picker.
- Ability/item picker.
- Freeform plan field.
- Preview of likely checks or action cost.

### Battle log

A battle log should record:

- Player decisions.
- NPC actions.
- Rolls/checks.
- Damage and status changes.
- Movement.
- Objective progress.
- Clock changes.
- Event summaries.

This log should be useful after save/load and for debugging.

## Integration with existing systems

### Chat

Tactical mode can still append chat entries, but not every micro-action should flood the main narrative. Options:

- Keep a compact battle log in the tactical panel.
- Append major round summaries to chat.
- Append final aftermath to chat.
- Let the player expand detailed logs when needed.

### Events

`Events` can still process aftermath or major narration, but tactical mode should avoid double-applying movement, damage, item changes, or status effects already resolved by tactical mechanics.

Potential rule:

- During tactical turns, use tactical-specific structured outcomes for mechanical changes.
- Use normal event checks for final aftermath and non-mechanical narrative consequences only when safe.

### Abilities

Abilities become much more valuable if they include tactical metadata:

- Action cost.
- Range.
- Target type.
- Area.
- Cooldown or use limit.
- Required conditions.
- Effects.
- Narrative tags.

Existing abilities may need a compatibility layer so older saves still work.

### Gear and things

Items and scenery can become tactical features:

- Weapons determine range, damage, and special effects.
- Armor affects defense, mobility, resistances, or cover use.
- Consumables become tactical actions.
- Scenery becomes cover, hazards, obstacles, objectives, or interactables.
- Containers may matter for access to items mid-battle.

### Skills and attributes

Tactical mode could use:

- Attack skills and damage attributes.
- Defense/evasion skills.
- Mobility/athletics.
- Stealth.
- Perception.
- Tactics/leadership.
- Medicine.
- Engineering/arcana/hacking equivalents from setting skills.
- Social skills for morale, surrender, intimidation, negotiation, deception.

Skill selection should be definition-driven where possible and fail clearly if a generated tactical action references a missing skill.

### Need bars and time

Most tactical rounds should probably not advance large amounts of world time, but battles can still affect needs:

- Exhaustion/fatigue after long fights.
- Hunger/thirst usually unchanged per round, but affected by long sieges or survival scenes.
- Fear/stress/sanity/morale-like need bars can change quickly.
- Rest-related needs may matter after a battle.

### Factions and disposition

Tactical outcomes should influence:

- Witnessed faction reputation.
- NPC dispositions.
- Surrender/capture/recruitment.
- Collateral damage.
- Whether a faction escalates or de-escalates.

Existing witness gating for faction reputation should stay relevant.

### Vehicles

Vehicle tactical scenes are a strong fit:

- Boarding actions.
- Chase scenes.
- Turret/weapon stations.
- Engine room sabotage.
- Navigation hazards.
- Vehicle zones such as deck, bridge, cargo hold, engine bay, exterior.
- Timed arrival/escape clocks.

This could reuse `VehicleInfo` while adding battle-local vehicle damage or objectives.

## Tactical scene types

### Skirmish

Small fight with a few zones and straightforward defeat/flee/capture objectives. Best first candidate.

### Ambush

Starts with hidden enemies, surprise, bad positioning, and escape or survive objectives.

### Boss or elite fight

One major enemy with clocks, phases, minions, hazards, or weak points.

### Chase

Zones represent distance bands, obstacles, routes, and pursuers. Objective is escape, catch, or delay.

### Siege or holdout

Defend a location until a clock resolves. Terrain, barricades, morale, supplies, and reinforcements matter.

### Rescue

Reach and protect a target while enemies, hazards, or clocks interfere.

### Heist collapse

A stealth or social scene turns tactical after an alarm, with objectives around escape, evidence, hostages, or guards.

### Social standoff

Not all tactical conflicts need weapons. Zones can be factions/positions in a room; actions can be persuade, expose, threaten, rally, distract, or protect reputation. This may be later-scope.

## Enemy and ally behavior

NPC behavior should use visible state plus personality/goals:

- Cowards seek cover or flee.
- Fanatics hold positions.
- Protectors guard leaders or civilians.
- Predators isolate weak targets.
- Professionals focus objectives.
- Disorganized enemies panic under pressure.
- Rivals taunt or duel.
- Allies follow configured party tactics unless directly commanded.

This connects naturally to companion tactics defaults from the gameplay brainstorm.

## Configuration ideas

Possible config options:

- Enable tactical mode.
- Prompt before tactical scenes.
- Tactical mode default: off, ask, auto for major fights.
- Max participants before simplified handling.
- Max tactical rounds before escalation/simplification prompt.
- Use side initiative or individual initiative.
- Allow tactical mode for non-combat conflicts.
- Show roll details.
- Auto-summarize every N rounds.
- Difficulty modifiers for cover/range/morale.

## Data and persistence considerations

Persistent state likely needs:

- Active tactical scene.
- Scene participants and battle-local state.
- Zones and clocks.
- Round/action log.
- Links to chat entries.
- Any pending LLM/tactical prompt context.

Save/load should preserve an active tactical scene. If the underlying world changed incompatibly, load should fail loudly or mark the scene invalid with a clear recovery option.

## Error handling principles

- Invalid tactical scene data should throw explicit errors during development.
- Missing actor/location/thing references should surface clearly.
- LLM output that references unknown zones, missing actors, invalid skills, or impossible actions should retry or fail, not silently ignore.
- Mechanical changes should be applied once.
- Duplicate damage/status/item changes should be detected.
- If tactical mode cannot continue, the user should get a clear "scene cannot continue" message and an option to resolve narratively.

## Testing ideas

Unit-level:

- Tactical state validation.
- Zone adjacency and movement legality.
- Action cost validation.
- Cover/range modifier resolution.
- Initiative ordering.
- Clock advancement.
- Scene serialization/hydration.

Integration:

- Start tactical scene from current chat state.
- Resolve player action with attack.
- Resolve non-attack objective action.
- Enemy turn applies movement and damage once.
- Save/load mid-battle.
- End scene and emit aftermath summary.

Playwright:

- Open tactical panel.
- Select zone/target/action.
- Run a deterministic forced-output skirmish.
- Confirm chat summary and sidebars update.
- Confirm mobile layout remains usable.

Fixtures:

- Deterministic small skirmish.
- Ambush with hidden enemy.
- Objective scene with a countdown.
- Vehicle boarding scene.

## Rollout options

### Slice 1: Tactical scene viewer only

Generate and display scene setup: participants, zones, objective, stakes, and clocks. No tactical resolution yet.

Pros:
- Low risk.
- Makes the LLM setup prompt testable.
- Useful as a better combat briefing.

Cons:
- Does not yet deliver tactical gameplay.

### Slice 2: Skirmish mode with side turns

Support a basic fight: zones, move, attack, defend, use item, flee, simple enemy turn, and aftermath.

Pros:
- Real gameplay value.
- Keeps scope bounded.

Cons:
- Still needs careful UI and state validation.

### Slice 3: Objectives and clocks

Add countdowns, protect/reach/escape objectives, morale, and hazards.

Pros:
- Makes tactical scenes distinct from normal combat.

Cons:
- More complex LLM and UI behavior.

### Slice 4: Party tactics and abilities

Integrate companion tactics, tactical ability metadata, cooldowns, and ally autonomy.

Pros:
- Makes party and progression systems matter.

Cons:
- Requires ability compatibility and more balance work.

### Slice 5: Advanced scene types

Add chases, sieges, heists, vehicle battles, and social standoffs.

Pros:
- Broad, setting-agnostic tactical toolkit.

Cons:
- Each scene type may need custom UI and prompt guidance.

## Strong first implementation candidate

The strongest first tactical feature would likely be a small skirmish mode:

- Opt-in only.
- Current location only.
- Player side vs enemy side.
- Zone list, not grid.
- Two-action economy.
- Move, attack, defend, use item, interact, flee.
- Simple cover/range modifiers.
- Basic morale.
- Round log.
- Save/load active scene.
- Final aftermath summary.

This would prove whether tactical state, UI, prompt interpretation, and event integration can coexist without committing to the full advanced system.

## Open questions for a future spec

1. Should tactical mode be explicitly player-triggered, automatically suggested, or automatically entered for certain encounters?
2. Should the first version use side initiative or individual initiative?
3. Should battle actions appear in main chat, a separate battle log, or both?
4. Should abilities be retrofitted with tactical metadata, or should tactical mode initially treat abilities as freeform special actions?
5. Should non-combat tactical conflicts be part of version one or deferred?
6. Should the server resolve all rolls, or should the LLM propose difficulty and the server roll?
7. How much tactical state should be visible to the player versus hidden for surprise?
8. Should tactical mode support multiple current players later, or remain single-current-player plus party?
