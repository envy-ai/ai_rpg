# Day/Night Cycle (Design Draft)

## Goals

- Add world rhythm that changes danger, services, and NPC behavior.
- Support stealth, travel planning, and time-sensitive events.
- Provide consistent time context for prompts, logs, and UI.
- Tie time-of-day to a named calendar with seasons that shape the world.

## Core Concepts

- **World Time**: A canonical clock (day number + time of day) shared across systems.
- **Calendar**: Named months/weeks/holidays generated per setting.
- **Season**: Seasonal phase that affects day length, weather, and faction behavior.
- **Time Segment**: Named ranges such as dawn, day, dusk, night.
- **Lighting**: Environmental visibility modifiers derived from time segment and location.
- **Schedules**: NPC and service availability keyed to time segment.
- **Events**: Time-gated encounters, quests, and ambient changes.

## Data Model (Proposed)

- `WorldTime`
  - `dayIndex`, `timeMinutes`, `segment`, `phase`
  - `calendarDate` (`year`, `monthName`, `dayOfMonth`, `weekday`, `seasonName`)
  - `cycleLengthMinutes`, `segmentBoundaries`
- `CalendarDefinition`
  - `yearName`, `months`, `weekdays`, `seasons`, `holidays`
- `CalendarMonth`
  - `name`, `lengthDays`, `seasonName` (optional), `notes`
- `CalendarSeason`
  - `name`, `startMonth`, `startDay`, `dayLengthMinutes`
  - `weatherBias`, `encounterBias`, `factionBehaviorBias`
- `TimeSegment`
  - `name`, `startMinute`, `endMinute`, `ambientLight`, `encounterBias`, `serviceBias`
- `Schedule`
  - `entityId`, `entityType` (npc/location/service)
  - `availabilityBySegment` (map)
  - `behaviorBySegment` (map)
- `TimeEvent`
  - `id`, `name`, `triggerAt` (segment or absolute time), `effects`

## Engagement Features (10)

1. **Visibility Modifiers**
   - Night reduces sight ranges; dawn/dusk add partial cover benefits.
2. **NPC Routines**
   - Merchants close at dusk; guards change shifts; nocturnal NPCs emerge.
3. **Travel Strategy**
   - Safer daytime travel vs faster but riskier night travel.
4. **Timed Quests**
   - Delivery windows or nightly rituals that unlock special outcomes.
5. **Ambush Patterns**
   - Certain enemies only hunt at night; bandit activity peaks at dusk.
6. **Service Availability**
   - Inns, healers, or markets offer limited hours.
7. **Seasonal Weather & Rituals**
   - Weather, wildlife, or rituals vary by season and time segment.
8. **Stealth Advantages**
   - Night provides stealth bonuses for specific actions.
9. **Faction Behavior**
   - Rival patrols shift schedule; black-market services appear at night and intensify in certain seasons.
10. **Calendar Events**
    - Festivals and named holidays unlock special quests, markets, and NPC routines.

## Systemic Behavior Rules

- Time advances per player action (configurable tick size).
- Segment changes trigger re-evaluation of NPC schedules and services.
- Location modifiers (indoors, cave, city) can override ambient light.
- Seasons adjust day length, weather probability, and faction behavior bias.
- Events can be queued at a segment boundary, calendar date, or specific time.

## Integration Touchpoints (Existing Systems)

- **Globals**: store `worldTime`, calendar definition, helpers for segment/season resolution, and time advancement.
- **Player**: track rest state, time-based buffs, and action time costs.
- **NPC Generation**: add schedule defaults by archetype and season.
- **Quests**: add time windows and calendar-date triggers.
- **Events**: gate or prioritize events based on current segment and season.
- **Prompts**: include time, date, and season context in base prompt to guide narration.
- **UI**: expose current time, date, season, and upcoming transitions.

## Implementation Sketch

1. Define world time and calendar schemas; generate a named calendar per setting at game start.
2. Add time tracking + calendar definition to Globals and save/load pipelines.
3. Add segment/season calculator helpers and time advancement API.
4. Hook time advancement into action processing and rest.
5. Update prompts to include time + date + season context.
6. Phase 2: Attach schedule data to NPCs and services (with seasonal variations).

## Suggested Fixes for Coherence

- Use a single time source for all systems (no duplicated clocks).
- Keep time advancement deterministic and logged in one place.
- Ensure all LLM prompts using time context are logged via `LLMClient.logPrompt`.

## TODO: Remaining Implementation Steps (Detailed)

PHASE 1

1. **Schema + generation**
   - Define `CalendarDefinition` for months, weekdays, seasons, and holidays.
   - Generate a named calendar per setting at game start (not config-driven).
   - Add `time.cycleLengthMinutes`, `time.segmentBoundaries`, and `time.tickMinutes`.
   - Provide default segments: dawn, day, dusk, night.

2. **Core time utilities**
   - Add `Globals.worldTime` and `Globals.calendarDefinition`.
   - Add helpers: `advanceTime(minutes)`, `getTimeSegment()`, `getSeason()`, `formatTime()`, `formatDate()`.
   - Centralize time advancement in a single function to keep logs consistent.

3. **Persistence**
   - Include `worldTime` + calendar definition in save files and restore on load.

4. **Action integration**
   - Time spent doing actions is already supplied in an event prompt, but not used. Use it.
   - Advance time after actions and report segment/season changes.

5. **UI hooks**
   - Add a small time + date indicator and segment/season transition notifications.

6. **Prompt context**
   - Update base prompt context to include time/segment/season/date and lighting.

PHASE 2 7. **NPC + services schedules**

- Add default schedule templates per NPC archetype and location type.
- Resolve availability based on current segment and season.

8. **Event gating**
   - Add time-window checks to event selection and quest triggers.
   - Support calendar-date triggers (holidays, solstices, etc.).

9. **Testing + validation**
   - Unit tests for segment/season resolution and time advancement.
   - Smoke test: rest until morning, verify schedules and events refresh.
