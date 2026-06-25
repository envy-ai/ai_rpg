# Improvement Prompt Existing Feature Context

This is a prompt-audit note for the periodic `improvement_prompt`. The recent
logs show it repeatedly suggests systems that already exist, or suggests broad
versions of systems where only a narrower enhancement is missing. Add a compact
version of this context to `prompts/_includes/improvement-prompt.njk` when tuning
that prompt.

## Logs Reviewed

Completed suggestion logs:

- `logs/2026-06-24T14-20-13-665Z_improvement_prompt_improvement_prompt.log`
- `logs_prev/2026-06-24T00-04-47-841Z_improvement_prompt_improvement_prompt.log`
- `logs_prev/2026-06-24T00-58-05-737Z_improvement_prompt_improvement_prompt.log`
- `logs_prev/2026-06-24T10-44-19-217Z_improvement_prompt_improvement_prompt.log`

`logs/ERROR_chatCompletionError_improvement_prompt_1782310730064.log` was a
canceled request and did not contain a usable suggestion response.

## Suggested Prompt Context

The improvement prompt should know the following, because its own visible
`game-improvement-suggestions` entries are intentionally excluded from future
prompt context:

```xml
<implementedSystemAwareness>
Do not suggest these as brand-new systems. You may suggest concrete improvements
to them only if you name the specific missing behavior beyond the current
implementation.

- Need bars, health, and status effects already exist for players and NPCs. They
  persist in saves, tick with world time, can be modified by status effects, and
  appear in player/NPC UI plus event-summary/What changed rows.
- Skill and combat checks already exist through resolveSkillCheck,
  resolveOpposedSkillCheck, resolveAttack, and resolveAreaAttack. They create
  visible check-results rows with expandable roll/details, support inline roll
  controls, and are reused by crafting and checked container opening.
- Plot trackers already exist. They support countdown, numerical_count,
  x_out_of_total, percentage, and short_string values, persist in saves, appear
  in base context, show in the sidebar, include hidden-player toggles, progress
  fills, hover details, edit/delete controls, and update/remove tools.
- Scheduled events and offscreen resolution already exist through scheduleEvent,
  ScheduledEvent persistence, due-event sweeps, local visible prose, off-location
  hidden summaries, the /scheduled diagnostic command, while-you-were-away
  prompts, offscreen NPC activity state, Mystery Boxes, Mystery Threads, and
  Scene Summaries.
- Factions and reputation already exist. Active factions, faction relations,
  player standings, reputation tiers, faction UI, quest reputation rewards,
  event-driven faction reputation changes, and location/region controlling
  faction fields are implemented.
- Social state already exists through numeric dispositions, short relationship
  labels, relationship prompt context, the Relationships graph, relationship
  housekeeping summaries, and the setRelationship tool.
- World time, seasons, calendars, dynamic regional weather, weather/lighting
  image variants, travel times, map/favorites fast travel, vehicle ETAs, and
  time-driven need/status/scheduled-event processing already exist.
- Inventory and crafting support already includes item stacks, count badges,
  split/merge/separate stack actions, AI item search, AI stack-combine
  suggestions, containers, mobile/modal drag transfers, craft/process/salvage/
  harvest flows, exact selected-input consumption, item weights/values, and
  item tooltip mechanics.
- Quest, XP, currency, faction-reputation, and NPC-disposition rewards already
  exist, with visible event summaries and quest edit UI.
- Prompt/debug UX already includes the prompt progress dock, prompt viewers,
  cancel/retry controls, chat bubble filtering, turn What changed drawers,
  Story Tools, full-history search, scene summaries, and mystery continuity
  tools.
</implementedSystemAwareness>
```

## Repeated False Negatives

These are suggestions from the reviewed logs that should be treated as already
covered at the system level:

- "No skill check framework" or "no skill check transparency": tool-based skill,
  opposed-skill, attack, and area-attack checks are implemented and logged as
  visible `check-results`.
- "No faction reputation tracking": factions, standings, tiers, quest rewards,
  and event-driven reputation changes are implemented.
- "No visible countdown/deadline tracker": `Tracker` supports countdowns and
  visible sidebar cards, while hidden trackers can be toggled into view.
- "No weather system": dynamic region weather and weather/lighting image
  variants exist.
- "Needs are invisible": player cards show health and need bars, NPC/player
  views expose status/needs, and need changes render in event summaries.
- "Inventory duplicate cleanup is missing": manual stack merge/split/separate,
  automatic same-name/checksum actor merges, AI search, and AI stack-combine
  suggestions exist.
- "No offscreen event resolution": scheduled events, due-event resolution,
  while-you-were-away prompts, offscreen NPC activity, and mystery/story
  continuity records exist.
- "Relationship tracking is absent": numeric dispositions, sparse relationship
  labels, relationship graph UI, prompt context, and relationship-update
  summaries exist.

## Already suggested and planned

These features aren't in the game yet, but are planned and don't need to be
mentioned again:

- First-class rest/wait/fast-forward actions and scene compression remain
  proposals. The underlying time, needs, weather, vehicle, and scheduled-event
  processing exists.
- Action economy, fatigue budgets, and enforced encumbrance are not general
  gameplay systems. Item weight is stored and prompt-visible, but carry limits
  are not enforced as a documented mechanic.
- Food spoilage, meal-prep costs, caloric needs by race, and supply planning are
  not dedicated systems. Need bars provide the current hunger/rest substrate.
- General light-source radius, fuel, and darkness mechanics are not a dedicated
  subsystem. Items can describe lighting effects and status effects can model
  illumination, but there is no global light manager.
- Recipe discovery, known-craftables, and blueprint journals are not dedicated
  player-facing systems. Crafting exists, but a recipe log would be new.
- Hidden consequence discovery, information-leak feedback, gossip propagation,
  and threshold-triggered NPC social initiative are not automatic broad systems.
  They should build on dispositions, relationships, trackers, scheduled events,
  and mystery tools.
- Faction presence, patrol rates, law levels, economy pressure, and automatic
  diplomacy drift are future faction extensions. Current factions track records,
  relations, standings, tiers, rewards, and territorial ownership.
- A travel planner with route modes, lodging/camping/foraging choices, expected
  need impacts, and risk previews remains a proposal. Current travel already has
  route times, maps, vehicles, time advancement, weather, needs/status processing,
  and scheduled-event arrival handling.
- Need threshold wording, duplicate XP reports, and inconsistent time references
  should be framed as tuning or bugfix ideas for existing systems, not requests
  to add those systems from scratch.

## Prompt-Tuning Guidance

When the improvement prompt produces ideas, prefer this filter:

- If the idea is "add X" and X is listed above as implemented, rewrite it as a
  concrete improvement to X or omit it.
- If the idea is only adjacent to an implemented system, name the missing layer.
  For example, suggest "add a recipe discovery log" rather than "add crafting."
- Prefer UI surfacing, tuning, deduplication, automation, or stricter prompt
  guidance over broad claims that the game lacks mechanics already documented in
  current implementation docs.
