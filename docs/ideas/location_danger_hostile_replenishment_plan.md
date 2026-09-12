# Location Danger and Hostile Replenishment Implementation Plan

## Scope and source of truth

This plan incorporates the complete user-visible design conversation beginning with the request for a mutable `1`–`5` location danger rating. Later corrections override earlier proposals. Ideas that were discussed and then rejected or left undecided are recorded near the end so they cannot silently return as requirements.

The feature exists to keep wilderness, dungeons, hostile territory, and other unsettled places from remaining permanently cleared. Code supplies occasional new hostile presence. The LLM retains control over who appears, why they are there, and whether tension becomes violence.

## Confirmed design

- Evaluate procedural hostile presence only when the player arrives at a different, previously visited location.
- Compare living hostile occupancy with `Location.generationHints.numHostiles`. Any positive deficit is eligible, even if one or more previous hostiles remain.
- Make one hostile-presence decision per arrival. Do not roll independently for every vacant slot.
- On a successful decision, let the focused generator choose a count from `1` through the full deficit.
- Use two possible sources: wild danger and controlling-faction danger.
- Choose wild or faction origin with a weighted random roll based on the sources' contributions.
- `Location.dangerLevel` is an unbounded stored integer base value. `Region.dangerModifier` is an unbounded stored integer that defaults to `0`. Clamp only their sum to produce the effective wild rating used by probability and weighting.
- `Faction.violenceLevel` remains an integer from `1` through `5`. Effective wild and faction ratings contribute exactly `rating - 1`; rating `1` contributes zero.
- Derive faction danger from the player's standing with the controlling faction and that faction's physical-violence predisposition through the behavior matrix below.
- Do not mechanically suppress faction presence because of a truce, ceasefire, quest, promise, or other special story condition.
- Procedurally created “hostile” NPCs are potential adversaries for population accounting. Their presence does not start combat or require them to attack.
- Keep `dangerLevel`, `dangerModifier`, `violenceLevel`, derived danger, contributions, probabilities, and roll results out of ordinary base context.
- The ordinary storyteller remains free to create attacks or hostile NPCs in any location, including a rating-1 safehouse, when the story supports it.
- Use elapsed time since the destination's prior visit only to calculate probability at arrival. Do not add time-based scheduling, periodic checks, or offscreen danger simulation.
- Do not add a separate event-danger source. Events alter a location's base danger, a region's danger modifier, faction standing or violence, territorial control, hostile capacity, or actual occupants.

## Current baseline in the uncommitted tree

The current tree already contains:

- Persisted `Location.dangerLevel`, strictly validated as an integer from `1` through `5` and defaulted to `1` for legacy saves.
- Persisted `Faction.violenceLevel` with the same validation and legacy default.
- Location and faction API mutation paths.
- Location danger in the current-location view, location image details, and location edit modal.
- Faction violence in faction details, emblem details, faction creation/editing, and World Profile faction editing.
- Explicit omission of both stored ratings from ordinary base-context summaries.

The current strict `1`–`5` validation on `Location.dangerLevel` is now obsolete. Implementation must replace it with finite-integer validation that permits values above `5` and below `0`. The tree does not yet contain persisted `Region.dangerModifier`; add it with a missing/null legacy default of `0`.

The tree does not yet contain:

- Generated danger or violence ratings; generated records still receive the default `1` unless a user edits them.
- Arrival eligibility or probability calculations.
- Hostile-deficit replenishment.
- The faction behavior matrix.
- Wild-versus-faction source selection.
- Focused hostile-presence generation.
- Event or tool operations for changing danger at location or regional scope.
- Region danger persistence, APIs, tool exposure, event handling, or UI.

The NPC behavioral-disposition work is mostly implemented, including generation, strict parsing, retry feedback, `createNpc`, persistence, context rendering, and the edit modal. Two corrections remain in this plan: preserve literal `N/A`, and restore cache-compatible action-suggestion context.

## Meaning of the stored ratings

### Location wild danger

`Location.dangerLevel` describes recurring ambient pressure from creatures and other locally appropriate hostile occupants. It is unrelated to enemy level and does not promise combat. New generation assigns a starting value from `1` through `5`, but subsequent tools and events may move the persisted base above `5` or below `0`.

| Generated/effective rating | Meaning for procedural replenishment |
|---:|---|
| 1 | Stable or settled; contributes no automatic wild presence. |
| 2 | Low; occasional predators, squatters, scouts, or similar occupants. |
| 3 | Moderate; hostile occupation tends to return. |
| 4 | High; clearing the area is often temporary. |
| 5 | Relentless or overrun; ambient danger strongly favors renewed presence. |

The ordinary storyteller never receives this rubric. Rating `1` does not mean that attacks are forbidden or discouraged.

### Region danger modifier and effective wild rating

Add persisted `Region.dangerModifier`, an unbounded finite integer that defaults to `0` for new regions and missing/null legacy values. It modifies every location directly owned by that region without rewriting the locations' stored base values.

```text
rawWildDanger = location.dangerLevel + location.region.dangerModifier
effectiveWildRating = clamp(rawWildDanger, 1, 5)
```

This clamp is explicitly required for calculation only. Never write the clamped result back to either model. A location at base `7` in a region with modifier `-3` has effective wild rating `4`; if the regional condition ends, its base remains `7`. A location at base `-2` in a region with modifier `+4` has effective wild rating `2`. This preserves local variation through large regional changes instead of flattening every location onto the same stored boundary.

Use only the location's immediate owning region in the first version. Do not aggregate modifiers from parent regions unless that behavior is separately approved.

Implement one canonical helper, such as `resolveEffectiveLocationDanger(location)`, that resolves null defaults, the immediate region, the raw sum, and the calculation-only `1..5` clamp. Arrival planning, API enrichment, chat-tool results, event summaries, diagnostics, and UI data must all consume this helper rather than repeating the formula.

### Faction physical violence

`Faction.violenceLevel` describes general willingness to use physical force, independent of morality, goals, and current standing toward the player.

| Rating | Meaning |
|---:|---|
| 1 | Avoids physical violence; relies on criticism, exclusion, sanctions, refusal of service, or similar pressure. |
| 2 | Uses violence only in exceptional circumstances. |
| 3 | Will use guards, arrests, mercenaries, or limited force when sufficiently antagonized. |
| 4 | Routinely answers serious opposition with violence. |
| 5 | Predatory, exterminatory, or naturally violent. |

## Data model, generation, and migration

### Location

- Change `Location.dangerLevel` validation from integer `1..5` to any finite integer. Do not clamp the stored value.
- Missing or null saved values hydrate as `1`.
- `toJSON()` and `getDetails()` retain the unbounded stored base. Location API enrichment adds response-only `regionDangerModifier` and `effectiveDangerLevel` values from the canonical resolver.
- Full-location and stub-expansion generation require `<dangerLevel>` from `1` through `5`; the broader runtime range exists for later mutations, not for initial generation.
- Missing, fractional, nonnumeric, or initially out-of-range generated values fail strict parsing and return the exact error through the shared retry conversation.
- Stub promotion applies the newly generated base danger rather than retaining a placeholder default.

### Region

- Add persisted `Region.dangerModifier` as any finite integer, defaulting missing/null values to `0`.
- Include it in `toJSON()`, `fromJSON()`, region detail/API serialization, save hydration, direct editing, and relevant summary payloads.
- Extend `PUT /api/regions/:id` with optional `dangerModifier`; omitted preserves the current value and explicit null stores the default `0`.
- New and generated regions start at `0`; do not ask the LLM to invent a modifier during ordinary region generation.
- Do not clamp the stored modifier or rewrite child location danger values when it changes.

### Faction

- Keep `Faction.violenceLevel` strictly limited to integers `1` through `5`, with missing/null legacy values treated as `1`.
- Require `<violenceLevel>` in core faction generation and the World Profile faction-draft generation path.
- Describe it as willingness to use physical force, independent of morality, friendliness, or current player standing.
- Strictly retry missing or invalid output with the exact parser error.
- Preserve an already supplied value during faction autofill.

Update `PUT /api/locations/:id` to accept any finite integer `dangerLevel`, with null storing `1`. Keep `PUT /api/factions/:id` and faction-create routes at integer `1..5`, with null storing `1`. All routes validate the complete request before mutation and surface invalid values without partial changes.

All three fields may appear in their specialized task suffixes, tool results, and edit payloads. They remain absent from the reusable ordinary base-context prefix.

## Faction behavior matrix

Translate the player's numeric standing into an antagonism band, then combine that band with `violenceLevel`. The matrix deliberately contains a dead zone: mild dislike plus moderate violence does not create systemic faction hostiles.

Antagonism bands are:

| Band | Name | Meaning |
|---:|---|---|
| 0 | Non-hostile | Neutral or positive toward the player. |
| 1 | Dislikes | Slightly negative. |
| 2 | Unfriendly | Meaningful friction. |
| 3 | Hostile | Considers the player an enemy. |
| 4 | Severe enemy | Actively wants the player stopped. |
| 5 | Extermination | Committed to destroying the player. |

The original brainstorm used `0` as an inactive matrix result and briefly described violence on a `0`–`5` scale. The actual persisted schema and the later agreed contribution rule use `1`–`5`. The normalized implementation matrix below represents an inactive result as faction-danger rating `1`, whose contribution is zero.

| Antagonism ↓ / Violence → | 1 | 2 | 3 | 4 | 5 |
|---|---:|---:|---:|---:|---:|
| Non-hostile | 1 | 1 | 1 | 1 | 1 |
| Dislikes | 1 | 1 | 1 | 1 | 2 |
| Unfriendly | 1 | 1 | 2 | 3 | 4 |
| Hostile | 1 | 2 | 3 | 4 | 5 |
| Severe enemy | 1 | 2 | 4 | 5 | 5 |
| Extermination | 1 | 3 | 4 | 5 | 5 |

Required examples:

- Mercenaries at violence `3` who only slightly dislike the player produce faction danger `1`, contribution `0`, and no automatic faction presence.
- The same mercenaries at the Hostile band produce faction danger `3`, contribution `2`.
- A nonviolent scholars' guild at violence `1` produces no physical contribution even at Extermination antagonism.
- Intelligent undead at violence `5` and Dislikes produce faction danger `2`, contribution `1`.
- Intelligent undead at violence `5` and Hostile produce faction danger `5`, contribution `4`.

Store the standing thresholds in a new merged definition file, `defs/location_danger.yaml`, rather than hard-coding them in the service:

```yaml
faction_standing_thresholds:
  dislikes_below: 0
  unfriendly_below: -20
  hostile_below: -40
  severe_enemy_below: -60
  extermination_below: -80

arrival_probability_by_rating:
  1:
    half_life: null
    cap: 0
  2:
    half_life: 30 days
    cap: 0.25
  3:
    half_life: 7 days
    cap: 0.50
  4:
    half_life: 2 days
    cap: 0.67
  5:
    half_life: 12 hours
    cap: 0.80
```

Apply the strict “below” comparisons from most severe to least severe:

| Numeric standing | Antagonism band |
|---:|---|
| `standing >= 0` | Non-hostile |
| `-20 <= standing < 0` | Dislikes |
| `-40 <= standing < -20` | Unfriendly |
| `-60 <= standing < -40` | Hostile |
| `-80 <= standing < -60` | Severe enemy |
| `standing < -80` | Extermination |

Exact boundary behavior follows the requested inequalities: `-20` is Dislikes, `-40` is Unfriendly, `-60` is Hostile, and `-80` is Severe enemy.

Load this file through `DefinitionLoader.loadMergedDefinitionFile()` so enabled mods may override individual thresholds through the normal defs-overlay system. Add a focused loader/validator that requires all five finite numeric values and requires this strict order:

```text
dislikes_below > unfriendly_below > hostile_below
  > severe_enemy_below > extermination_below
```

Invalid or missing definitions must fail startup/reload validation with the offending path. Validate `half_life` through `Utils.parseDurationToMinutes()`; ratings `2` through `5` require positive durations, while rating `1` requires `null`. Caps must be finite probabilities from `0` through `1`, rating `1` must have cap `0`, and caps must increase with rating. Do not clamp standing values; the existing faction-standing system intentionally permits values outside `-100..100`.

Treat a missing or null `dangerLevel` or `violenceLevel` from legacy/runtime data as rating `1`, and a missing or null `dangerModifier` as `0`. Other invalid values still raise explicit validation errors. This is an authorized compatibility rule, not a general numeric fallback.

`Player.getFactionStanding()` returns `null` when no entry exists. Treat that missing entry as standing `0` and therefore Non-hostile. Any present non-finite value indicates invalid state and must raise an explicit error rather than being treated as neutral.

Only a faction that controls the destination can contribute. For the first implementation, use an explicit `Location.controllingFactionId`. A null location controller is currently ambiguous because both locations and regions have control fields: it does not distinguish “inherit regional control” from “explicitly uncontrolled.” Do not silently infer regional faction control. A later schema may add an explicit `inherit | none | faction` control mode.

## Truces and special conditions

Do not add a nonaggression override to the matrix. Faction danger depends only on:

- the player's standing with the faction;
- the faction's violence predisposition;
- the faction's control of the destination.

A truce remains in ordinary story context and may change behavior without erasing faction presence. Generated faction members may patrol, challenge or search the party, honor a ceasefire, negotiate, provoke, or attack depending on the complete scene. Standing changes caused by diplomacy naturally change the matrix result; a truce that leaves standing negative does not do so by itself.

Declared war, assassination contracts, quest flags, and similar conditions also remain LLM-interpreted story facts for the first version. Do not impose a minimum antagonism band for them in deterministic code.

## One arrival, one decision

Create a focused service such as `LocationHostileArrivalService.js`. Keep its calculation pure where practical and inject randomness for deterministic tests.

### Trigger boundary

Run once for an actual player transition from one location id to another, including final vehicle arrival. Snapshot `wasVisitedBeforeArrival` before movement mutates the destination's `visited` field. If that snapshot is not exactly `true`, do not run the probability calculation or hostile generation. First visits never trigger replenishment; initial generation already supplies their starting population.

Do not trigger on:

- same-location actions;
- UI refreshes;
- save loading;
- companion-only relocation;
- intermediate travel progress;
- background time advancement.

Direct movement, cross-region movement, expanded stubs, and completed vehicle travel must converge on one canonical arrival hook. Give the transition an arrival id so duplicate route handlers or repeated HTTP requests cannot produce multiple decisions.

That hook must cover freeform movement, exit-button movement, While You Were Away processing, and standard/TinyBrain destination narration without letting any of them make an additional roll. Do not implement this through the existing consumable random-event pools; hostile replenishment is durable population behavior with its own arrival decision.

### Ordering

Story-created occupants have priority over mechanical replenishment. The intended order is:

1. Resolve and expand the destination if necessary.
2. Complete the movement and ordinary arrival flow.
3. Apply any story/event-created NPC arrivals associated with that arrival.
4. Count current hostile occupancy.
5. If there is a deficit, make the one procedural hostile-presence roll.
6. If successful, commit the selected source before invoking the LLM.
7. Generate and validate `1..deficit` occupants in one focused request.
8. Recheck the arrival id, session/world identity, destination, occupancy, controlling faction, faction violence, and standing before committing drafts.
9. Commit the full generated batch atomically.
10. Present a distinct arrival/presence beat. Newly generated NPCs do not receive an NPC turn until the player's following turn.

If the existing movement architecture cannot apply story/event arrivals before the check without duplicating narration, refactor the shared arrival boundary rather than placing competing checks in route-specific handlers.

### Capacity and hostile count

Use `Location.generationHints.numHostiles` as the intended maximum maintained by this supplemental system.

```text
hostileDeficit = hostileCapacity - livingHostileCount
```

Count every living, non-deleted NPC assigned to the destination for whom the existing `isActorDispositionHostile(npc, currentPlayer, Player.dispositionDefinitions)` resolver returns true. Include hidden hostiles and hostiles created by the ordinary storyteller or event system. Exclude dead and departed NPCs.

Do not count from the persisted raw `npc.isHostile` flag. That field remains compatibility and initial-seeding data; current player-relative hostility is canonically derived from disposition thresholds. Procedurally generated hostile NPCs may still be created with `isHostile: true` so construction seeds the appropriate hostile dispositions.

If capacity is absent, zero, or the deficit is not positive, record the reason and make no roll. Do not add a second repopulation-capacity field in the first version.

Leaving one hostile alive must not block replenishment. If capacity is `4` and one living hostile remains, the generator may add between `1` and `3` occupants after a successful arrival decision.

### Contributions

```text
locationBaseDanger = destination.dangerLevel ?? 1
regionDangerModifier = destination.region.dangerModifier ?? 0
wildRating = clamp(locationBaseDanger + regionDangerModifier, 1, 5)
wildContribution = wildRating - 1

factionRating = matrix(standingBand, controllingFaction.violenceLevel)
factionContribution = factionRating - 1
```

When there is no valid explicit controlling faction, `factionContribution` is zero. If both contributions are zero, no procedural presence can occur.

### Presence probability

There is one presence roll for the arrival. Use the larger current source rating to choose the time curve, then use the prior-visit snapshot to measure absence:

```text
effectiveRating = max(wildRating, factionRating)
elapsedMinutes = currentWorldMinute - priorLastVisitedTime

arrivalChance(1, elapsedMinutes) = 0
arrivalChance(rating, elapsedMinutes) =
  cap[rating] * (1 - 2 ^ (-elapsedMinutes / halfLifeMinutes[rating]))
```

This is a capped saturation half-life: after one half-life the probability is half the cap, after two it is three quarters of the cap, and it approaches but never exceeds the cap. The configured curves are therefore:

| Effective rating | Half-life | Cap | Chance after one half-life | Chance after two half-lives |
|---:|---:|---:|---:|---:|
| 1 | — | 0% | 0% | 0% |
| 2 | 30 days | 25% | 12.5% | 18.75% |
| 3 | 7 days | 50% | 25% | 37.5% |
| 4 | 2 days | 67% | 33.5% | 50.25% |
| 5 | 12 hours | 80% | 40% | 60% |

Using the higher rating for the arrival curve keeps the total probability capped at `80%`, even when both wild and faction sources are severe. Contributions do not stack the presence probability; they select the source after the roll succeeds.

Read `priorLastVisitedTime` from `Globals.getPlayerArrivalLastVisitedTimeBeforeMove(destination)`, not from the destination after movement has updated it. Use `Globals.getTotalWorldMinutes()` for the current value. A first visit is unconditionally ineligible. A null or missing prior timestamp uses level-1 probability behavior—zero chance and no roll—even if legacy data says the location was visited; the completed arrival stamps it, so later revisits have a defined interval. A negative elapsed interval is invalid state and must raise an explicit error rather than being changed to zero. Zero elapsed time produces zero probability naturally.

Remove the previous plan's invented `0.15` per-contribution slot probability and the source-specific combined-probability formula. Neither is compatible with this capped total-arrival curve.

### Source selection

If the presence roll succeeds, select the primary source using the exact agreed weights:

```text
wildWeight = wildRating - 1
factionWeight = factionRating - 1
```

The probability of each eligible source is its weight divided by the sum of both weights. Save the chosen source and relevant faction id in the arrival's pending-attempt record before generation. LLM retries, request retries, or save/reload recovery must not reroll a wild result into a faction result.

The source is primary rather than exclusive. A faction patrol may use trained local beasts; wild creatures may reflect a war or magical disaster. The generator may combine those details when they fit, while keeping the chosen source recognizable.

### Generated count

The runtime supplies the authoritative deficit. The focused generator must choose an integer from `1` through that deficit. It cannot decline a successful presence decision and cannot exceed `numHostiles`.

Generate the group in one batch. Do not make one LLM request per vacant slot and do not preselect an exact count in code. This preserves room for one powerful creature or several weaker actors.

## Focused hostile-presence generation

Add standard and TinyBrain versions of the focused task because anything handled in the standard prompt path must also be handled in TinyBrain. Reuse a canonical base-context prefix and add task instructions through an include/suffix. Do not specify `<maxTokens/>`; use the configured default. Log every attempt with `LLMClient.logPrompt()` under a dedicated label.

The runtime supplies:

- selected source: `wild` or `faction`;
- authoritative maximum count equal to the deficit;
- destination and region fiction relevant to that source;
- location/region `enemyConcepts` for wild presence;
- selected faction's public identity, description, goals, tags, and assets for faction presence;
- names of living and dead local NPCs for duplicate avoidance;
- ordinary context containing truces, negotiations, quests, and recent events.

Do not supply numeric danger, numeric violence, derived faction danger, contribution weights, probabilities, or roll results. The generator does not need those facts after code has selected a source.

The task must require:

- one to the supplied maximum number of new NPC entries;
- locally and narratively plausible occupants;
- faction membership for a faction-sourced group;
- `isHostile: true` for procedural population accounting;
- no automatic attack or forced combat;
- no resurrection of defeated named enemies and no accidental duplicates;
- every normal required NPC field, including exactly one direct, nonblank `<disposition>`.

Presentation may place the newcomers in plain sight, hidden, distant, asleep, entrenched, or otherwise poised for a scene. The system guarantees occupants after a successful roll; it does not guarantee an ambush or an immediate attack.

TinyBrain responses must receive syntax validation through their parser. All generation paths use configured retries, log rejected responses, and append the exact parser error to the next LLM correction prompt.

Construct unregistered NPC drafts first. Validate the entire response, then recheck world state and commit the batch atomically. If a commit step fails, restore every affected registry and location-membership entry and surface the backtrace in the normal client error modal.

Persist generation provenance on each mechanically created NPC, including the arrival/pending-attempt id and `wild` or `faction` source. This supports diagnosis and prevents later code from confusing replenished actors with resurrected named NPCs.

If all LLM retries fail, preserve the pending attempt and its chosen source, keep the completed movement intact, and surface the error. A retry of that same arrival resumes generation from the saved decision rather than rolling again. It must never leave a partially registered group or silently treat the failed generation as “nothing happened.”

## Mutation by events and tools

Events need explicit state operations because the ordinary storyteller does not see the private ratings.

### Direct chat tools

Expose the new fields through every existing direct-edit tool that supports the corresponding class:

- Add `dangerLevel` to the `location` allowlist for `updateObjectFields`.
- Add `dangerModifier` to the `region` allowlist for `updateObjectFields`.
- Add `violenceLevel` to the `faction` allowlist for `updateObjectFields`.
- Add `violenceLevel` to `upsertFactionFields` for both `create` and `update`.

Update the allowlist constants, generated tool descriptions, argument normalizers, executor paths, XML tool-result rendering, and returned `updatedFields` metadata together. Location danger and region modifiers accept any finite integer and are stored without clamping. Faction violence remains an integer from `1` through `5`. A null location danger normalizes to `1`, a null region modifier to `0`, and a null faction violence value to `1`; all other malformed values return a tool-visible error without mutation.

Direct tools set exact values. They do not apply deltas. `updateObjectFields` must report the stored old/new value and, for location or region danger changes, the affected current effective wild rating where it can be resolved. Existing tool atomicity applies: validate all submitted fields before changing any of them.

`alterLocation` remains the narrative alteration tool and does not gain a separate numeric argument. If its resulting story establishes a danger change, the normal event pass may emit `danger_level_change`; callers that know an exact stored value should use `updateObjectFields`.

### Danger-level event type

Add one event type named `danger_level_change`, rendered in XML as `<dangerLevelChange>`. It may adjust either one location's base danger or one region's danger modifier:

```xml
<dangerLevelChange>
  <targetType>location|region</targetType>
  <target>exact location or region name</target>
  <direction>increase|decrease</direction>
  <amount>positive integer</amount>
  <reason>brief established cause</reason>
</dangerLevelChange>
```

Allow multiple entries in one event-check response. The parser must require all five direct child elements, reject unknown target types or directions, and require a strictly positive integer amount. Syntactic rejection participates in the standard and TinyBrain event-parser retry flow with the exact error returned to the LLM.

Register the type in the canonical event-type map, grouped event-check definitions, XML schema include, parser/aggregation dispatch, handler map, history-summary metadata, and event-type documentation. Do not implement it as an unrelated post-processing pass.

Resolve `target` by id or unambiguous exact name. A location entry applies the signed amount to `Location.dangerLevel`. A region entry applies it once to `Region.dangerModifier`; it does not loop over or rewrite child locations. Both stored values may cross `0`, `1`, or `5` in either direction and are never clamped. Unknown or ambiguous runtime targets fail visibly without mutation.

The handler appends applied records to `context.dangerLevelChanges` with target type/id/name, signed amount, reason, stored before/after values, and effective wild rating before/after when applicable. Render these in the normal event-summary/notification flow and refresh the current location/region views when affected. Persist through the normal save path.

The event prompt should choose this event only when the narrated events establish a meaningful environmental or regional danger change. It must not change danger merely because an ordinary hostile appears or dies.

Keep exact-value changes available through `updateObjectFields`; the event type is deliberately increase/decrease only.

Examples of durable changes:

- Destroying a nest or closing a portal lowers wild danger.
- A monster migration or spreading corruption raises wild danger.
- Establishing strong patrols can lower wild danger.
- An invasion or rebellion changes faction control and may also change wild danger.
- A planar breach, magical storm, monster plague, recurring curse, or crashed-creature transport can change wild danger temporarily or permanently, or spawn actual occupants directly.
- Making peace changes faction danger when it changes standing; no special danger rewrite is otherwise needed.
- Killing one patrol changes occupancy and usually leaves the underlying ratings unchanged.

Existing faction NPCs do not disappear when standing, control, or diplomacy changes. Their behavior changes through ordinary story context. If standing or control changes while a faction-sourced generation request is in flight and the matrix no longer permits that source, precommit revalidation cancels that pending commit without selecting a replacement source.

The region modifier replaces the earlier proposal to mutate every child location or add a regional danger floor. Increasing it raises effective danger across varied locations while preserving the stored differences between them; decreasing it later reverses the regional pressure without reconstructing old location values.

Dedicated mutation prompts or tool results may receive current values in their task-specific suffix/results. Do not add these values to the reusable base-context prefix.

## NPC behavioral disposition contract

NPC generation must emit the exact singular element:

```xml
<disposition><!-- N/A if sentient. If non-sentient, a brief behavior blurb. --></disposition>
```

Sentient NPCs store the literal trimmed value `N/A`. Animal-level creatures and less-intelligent monsters store short free text describing behavior toward the player and other NPCs. Guidance examples include:

- `extremely aggressive; attacks anything other than its own kind on sight, including other animals or NPCs`
- `extremely territorial; assumes warning posture for a turn or two, then attacks`
- `ornery; becomes aggressive without warning if bothered or approached too closely`
- `flees if approached, attacks only if cornered`
- `flees immediately if it perceives the party in the same location`
- `neutral; walks away if bothered, attacks only if attacked or intentionally provoked`

Tell ordinary storytelling to follow a real disposition unless there is a good reason not to. Omit literal `N/A` from ordinary base context and offscreen NPC-memory context.

Required consistency work:

- Require exactly one direct, nonblank `<disposition>` in every NPC generator and parser.
- Send the exact parser error back to the LLM when generation is rejected for a retry.
- Preserve a caller-supplied disposition seed; a generated `N/A` must not overwrite it with `null`.
- Keep `disposition` distinct from the existing numeric `dispositions` relationship map.
- Accept and forward it through the strict storyteller `createNpc` tool schema and executor.
- Persist it in saves and expose it through the NPC API.
- Load and submit it from the NPC edit modal, showing literal `N/A` when stored.
- Include it conditionally in both regular and TinyBrain context and in the specialized offscreen NPC-memory path.
- Retain the older NPC parser fields covered by the repaired harness: starting need levels, applicability, starting health, AI notes, visibility, and disposition.

## Action-suggestion cache correction

The action-suggestion feature should receive the same canonical base-context prefix as the other compatible prompt paths. Do not remove hidden NPCs, objects, exits, trackers, region secrets, plot analysis, mystery data, or other player-hidden facts before rendering, because changing that context breaks the cache.

Instead, add a task-specific instruction telling the LLM not to base any recommendation on information explicitly hidden from the player. This instruction belongs after the stable cached prefix. Tests must compare the rendered prefix with the canonical base context as well as checking that the instruction exists.

## UI behavior

Keep the current visible and editable fields:

- Current-location header shows the effective `Danger: N/5` used by the arrival curve.
- Location details and the image lightbox show effective danger, stored location base danger, and the immediate region modifier so the displayed value is explainable.
- The location edit modal accepts any finite integer base danger and surfaces server validation errors.
- Region details show `Danger modifier: +N`, `0`, or `-N`; the region edit modal accepts any finite integer modifier.
- Faction details and emblem tooltips show `Violence: N/5` separately from player standing.
- Active-game faction create/edit and World Profile faction create/edit preserve the value.
- Generated location/faction values and edited region modifiers appear without a reload.
- Event/tool mutations refresh any affected open view.

Do not expose encounter probabilities, faction-matrix calculations, contribution weights, or eligibility internals in the ordinary UI. Showing effective wild danger with its location base and region modifier does not expose faction danger. A player-relative composite wild-plus-faction display remains unapproved follow-up work.

## Observability and idempotency

Record a structured server diagnostic for each actual arrival check:

- arrival id and destination id;
- whether the destination was previously visited;
- hostile capacity, living count, and deficit;
- location base danger, immediate region id/modifier, raw sum, clamped effective wild rating, and wild contribution;
- controlling faction id, antagonism band, violence level, matrix result, and contribution;
- elapsed absence, selected half-life/cap, calculated total arrival probability, presence roll, and source roll;
- pending-attempt id and selected source;
- generated NPC ids after commit;
- explicit skip or failure reason.

Keep diagnostics out of LLM context and player-facing prose. Never manually delete log files.

Use one generation lock per destination or the existing movement serialization boundary. After LLM generation, revalidate the arrival, active save/session, occupancy, location danger, region modifier, control, faction violence, standing, and pending-attempt identity. This retains the strongest safeguards from both independent reviews without adding their time simulators.

## Verification

### Model, migration, and generation

- Location base danger round-trips at negative, zero, `1..5`, and greater-than-`5` integers without clamping.
- Region danger modifiers round-trip at negative, zero, and positive integers and default missing/null values to `0`.
- Faction violence round-trips at all five allowed values.
- Missing/null legacy location danger and faction violence hydrate as `1`; loading an old save never causes retroactive spawning.
- Invalid strings and fractions fail for all three fields. Out-of-range faction violence fails; finite location base and region modifier integers have no stored range limit.
- Full-location and stub-expansion generation require and apply `<dangerLevel>`.
- Core faction and World Profile generation require and apply `<violenceLevel>`.
- Missing/invalid generated ratings retry with the exact parser error.
- Faction autofill preserves a supplied rating.

### Matrix and source calculations

- Every cell in the normalized matrix is covered.
- Definition loading accepts the configured thresholds and probability curves, and rejects missing, nonnumeric, incorrectly ordered, or invalid entries.
- Standing values at `0`, `-20`, `-40`, `-60`, and `-80`, plus values immediately on either side, resolve to the exact specified bands.
- Rating `1` always contributes zero; ratings `2` through `5` contribute `1` through `4`.
- Mild dislike plus violence `2` or `3` yields no faction contribution.
- Extermination antagonism plus violence `1` yields no faction contribution.
- A truce does not change the deterministic matrix result.
- No explicit location controller yields zero faction contribution.
- Effective wild danger clamps `location base + immediate region modifier` to `1..5` without mutating either stored value.
- Parent-region modifiers are not included.
- Arrival planning, API payloads, tool results, event summaries, and UI projections return the same effective value from the canonical resolver.
- Effective rating uses the larger of the wild and faction ratings.
- Rating `1` always produces zero arrival probability.
- Each configured half-life reaches exactly half its cap; two half-lives reach three quarters of the cap.
- Probability approaches but never exceeds the configured cap, including when both sources are active.
- Missing legacy visit time uses level-1 zero-probability behavior with an explicit diagnostic, while a negative elapsed interval raises an error.
- Source selection follows the exact `rating - 1` weights and its chosen result survives retries.

### Arrival and population

- Initial entry into an unvisited location does not run replenishment.
- A missing or non-affirmative pre-arrival visit snapshot does not run replenishment.
- Null/missing location danger or faction violence values contribute as rating `1`; null/missing region modifiers contribute as `0`; other invalid values fail explicitly.
- A later arrival at capacity makes no probability or generation call.
- Hidden living NPCs who are disposition-hostile to the current player count; dead, deleted, departed, and non-hostile NPCs do not.
- A stale raw `npc.isHostile` flag cannot override the canonical disposition-derived result.
- One survivor still leaves the correct deficit and remains eligible.
- One arrival makes one presence roll, regardless of deficit size.
- Duplicate handlers and concurrent requests cannot roll the same arrival twice.
- A successful generator returns between one and the full deficit.
- The final committed population never exceeds the capacity based on the immediate precommit recount.
- Story/event-created hostiles are applied and counted before mechanical replenishment.
- Faction presence is created without starting combat.
- Generated NPCs first become eligible for NPC turns on the player's following turn.

### Prompt, failure, and save behavior

- Ordinary base context contains no location base danger, region modifier, effective wild danger, faction violence, derived faction danger, or probability data.
- Safe locations add no language discouraging story-driven hostile creation.
- Focused generation receives the selected source and relevant fiction but no ratings or odds.
- Standard and TinyBrain parsers reject malformed output and send exact feedback on retries.
- Exhausted retries preserve the source decision, keep completed movement, surface a client error with backtrace, and leave no partial NPC state.
- Save/reload preserves ratings, generated occupants, and any pending attempt without rerolling it.
- `N/A` disposition persists but is absent from base and memory contexts.
- Action suggestions preserve the canonical cached prefix and include the hidden-information instruction only in the suffix.

### Events, API, and browser

- `updateObjectFields` accepts location `dangerLevel`, region `dangerModifier`, and faction `violenceLevel`, rejects invalid fields atomically, and reports stored/effective results.
- `upsertFactionFields` accepts and validates `violenceLevel` on both create and update.
- Location API responses preserve the unbounded base and include response-only immediate-region modifier and effective danger fields; region API responses persist and expose the modifier.
- `danger_level_change` strictly parses location/region targets, increase/decrease direction, positive integer amount, and reason in standard and TinyBrain paths.
- A location event changes only the stored location base; a region event changes only the stored region modifier.
- Event changes may cross below `0` or above `5` without altering the stored result.
- Unknown/ambiguous targets and malformed event entries produce visible failures without partial mutation.
- Applied event summaries contain target, signed delta, reason, stored before/after, and effective before/after values.
- Edit and reload location base danger, region modifier, and faction violence through desktop and mobile modals.
- Location, region, and faction view surfaces render the correct values at desktop and mobile widths.
- A tool/event mutation refreshes an already open affected view.
- A deterministic successful arrival displays the new presence in a distinct beat and does not grant it an immediate NPC turn.

## Explicitly rejected or deferred proposals

The following appeared in the visible brainstorm but are not part of the confirmed first implementation:

- **Rejected:** `nextRepopulationAt`, `clearedAtWorldMinute`, periodic evaluations, continuous accumulated hazard, deterministic scheduled thresholds, and any other offscreen scheduler. Elapsed absence now affects the single arrival roll but never triggers work on its own.
- **Rejected:** requiring a location to be completely clear before it can replenish.
- **Rejected:** independent rolls for each vacant hostile slot.
- **Rejected:** placing danger in general storyteller context or using it to discourage attacks in safe places.
- **Rejected:** treating generated hostile presence as automatic combat.
- **Rejected:** a separate `eventDanger` rating/source.
- **Rejected:** truce/nonaggression mechanically zeroing faction danger.
- **Rejected:** the simplified `standing <= -25` faction gate from the earlier draft of this plan.
- **Rejected:** the earlier invented `0.15` per-contribution slot probability and source-specific combined-chance formula.
- **Rejected:** using the existing consumable random-event pools as the replenishment mechanism.
- **Rejected:** a context-only first phase in which the LLM may simply decide that no hostile presence returns.
- **Deferred:** a separate repopulation-eligibility field; `numHostiles` and rating `1` cover the first version.
- **Replaced:** region-wide child-location rewrites and regional danger floors. Persisted `Region.dangerModifier` now supplies reversible regional pressure while preserving location variation.
- **Deferred:** explicit region-control inheritance mode.
- **Deferred:** a player-visible composite wild-plus-faction danger rating and source breakdown.
- **Deferred:** deterministic world seed/counter random streams beyond the saved per-arrival decision.
- **Deferred:** optional persisted `dangerReason` and `dangerLastChangedAt` audit metadata. The rejected `hostilesClearedAt` and `nextRepopulationAt` fields belonged to the discarded clock design.
- **Deferred:** scheduled events for concrete future promises such as reinforcements arriving tomorrow; they may create NPCs through the event system but do not belong to the ambient danger calculation.

## Conversation coverage map

This map records where each substantive part of the visible exchange landed:

1. The original mutable `1`–`5` danger goal, permanent-clearing problem, and desire to preserve LLM judgment are in **Scope**, **Confirmed design**, and **Meaning of the stored ratings**.
2. The safe-area attack example and decision to hide danger from base context are in **Confirmed design** and **Focused hostile-presence generation**.
3. The distinction between intrinsic wilderness danger and player-relative faction danger is in **Meaning of the stored ratings** and **Faction behavior matrix**.
4. The weighted wild/faction roll and exact `rating - 1` rule are in **Contributions**, **Presence probability**, and **Source selection**.
5. The question about event danger and the decision to fold events into location base danger, the region modifier, control, standing, violence, capacity, or occupants are in **Mutation by events and tools**.
6. Terra/high's saved-roll, generation-lock, retry, prompt-leak-test, and post-generation revalidation ideas are retained in **Focused hostile-presence generation**, **Observability and idempotency**, and **Verification**. Its periodic scheduler and clear-only occupancy rule are rejected.
7. Astra/light's atomic draft commit, session/world revalidation, explicit migration, and duplicate-enemy safeguards are retained. Its accumulated time hazard, state-transition accounting, and mechanical nonaggression override are rejected.
8. The arrival-only correction, surviving-hostile edge case, `numHostiles` deficit, generator-selected `1..deficit` count, and next-turn eligibility are in **One arrival, one decision**.
9. The full standing/violence behavior matrix and mercenary, scholars, and undead examples are in **Faction behavior matrix**.
10. The final truce boundary—presence may remain while the LLM interprets the ceasefire—is in **Truces and special conditions**.
11. The exact NPC `<disposition>` contract, examples, `N/A` behavior, base-context omission, generation retry feedback, `createNpc` support, repaired parser coverage, and edit modal are in **NPC behavioral disposition contract**.
12. The review correction requiring cache-stable action-suggestion context plus an instruction against player-hidden information is in **Action-suggestion cache correction**.
13. The later field/UI implementation and the audit finding that gameplay behavior is still absent are in **Current baseline** and **UI behavior**.
14. The last-visited half-life curves, caps, first-visit exclusion, and null-as-level-1 behavior are in **Presence probability**, the defs schema, and **Verification**.
15. Unbounded location base danger, the persisted region modifier, calculation-only clamping, direct tool exposure, and the location/region danger-change event are in **Region danger modifier and effective wild rating**, **Data model, generation, and migration**, and **Mutation by events and tools**.

Progress notes, server restart messages, and unrelated worktree changes do not create danger-system requirements and are therefore not duplicated as implementation steps.

## Remaining decisions before implementation

No required probability or faction-threshold input remains unspecified. The standing bands, half-lives, caps, saturation formula, and source weighting are now defined.

Region-control inheritance is a deliberate first-version limitation rather than a blocking omission. The plan uses only explicit location control because null currently cannot distinguish inheritance from deliberately uncontrolled territory. If region-only control must affect faction presence in the first release, add an explicit control-mode rule before implementation.

A player-visible composite wild-plus-faction danger display remains optional follow-up scope. The required region-wide danger behavior is now fully specified through the persisted region modifier and `danger_level_change` event.

## Implementation order

1. Add and strictly validate `defs/location_danger.yaml`, including the confirmed standing thresholds and half-life/cap table.
2. Correct literal `N/A` persistence and restore cache-compatible action-suggestion context.
3. Extend location and faction generation schemas, standard/TinyBrain parsers, retry feedback, and promotion paths to assign ratings.
4. Implement and exhaustively test the pure faction matrix, probability, source-weight, hostile-count, and arrival-plan functions.
5. Implement strict draft-only focused generation with standard/TinyBrain paths and prompt logging.
6. Refactor one canonical arrival boundary so story/event occupants are counted first and each arrival has one durable idempotent decision.
7. Add precommit revalidation, destination locking, atomic NPC registration, pending-attempt recovery, and visible failure propagation.
8. Expose location danger, region danger modifier, and faction violence through the existing direct-edit chat tools; add the strict standard/TinyBrain `danger_level_change` event parser, handler, summaries, and refreshes.
9. Add the region modifier UI and verify client refreshes plus all danger/violence/disposition editors against live endpoints.
10. Add integration, save/load, cache-prefix, failure-recovery, and browser coverage.
11. Update class, API, prompt, event, movement, and UI documentation from planned behavior to implemented behavior.

Do not call the feature complete until arrival replenishment, event mutation, save persistence, matrix behavior, prompt privacy, idempotency, and failure rollback/recovery pass together.
