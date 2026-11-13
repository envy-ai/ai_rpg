# Main Quest Line Brainstorm

This is a brainstorm document, not an implementation spec. It proposes an optional, persistent main quest line: a campaign spine that runs through a whole save, survives plot-analysis rewrites, advances through stages, and reaches an ending, without the authoring overhead of the `story-authoring` (Stories) mod.

## Current project status

There is no main quest system. Several existing systems cover parts of it:

| Existing system | What it gives a main quest | Where it falls short |
|---|---|---|
| `Quest` | Objectives, quest checks, rewards, level anchoring, pause, UI | Flat and reactive; no stages or follow-on quest |
| Plot analysis (`plotThreads`, `isCurrentFocus`) | A current-focus thread, complications | Rewritten every few turns, so it can drop the main plot |
| Plot summary / plot expander | Hidden direction notes | Not structured; it doesn't know when a stage is done |
| `MysteryThread` | Hidden truth plus fixed `constraints` | Capped, and about secrets rather than progress |
| `Tracker` and `ScheduledEvent` | Countdowns and timed consequences | Nothing ties them to a storyline |
| Faction housekeeping plans | What antagonist factions intend to do next | Not tied to a storyline |

The missing piece is one object that holds these together over a whole campaign.

## Decisions so far

| Question | Decision |
|---|---|
| When does it start? | The player can start it at any time. When a game starts, a popup asks whether to start it now. |
| Core code or mod? | Core, because it changes the base context, plot analysis and quest checks. |
| Relationship to the Stories mod | Out of scope for now. |
| Can the player write the main goal? | Yes. If left blank, the system generates one. |
| Is the pressure clock visible? | Visible but vague (for example, "The Drowned Choir grows bolder"). Exact numbers stay hidden. |
| Is replanning announced? | No. Replanning is silent and GM-private. |

## Starting the main quest

### Popup at game start

When the player first reaches the chat page after a new game, show a modal:

- **Title:** "Main quest"
- **Body:** one or two sentences explaining that the main quest is an optional storyline that runs alongside free play.
- **Optional goal field:** "What does your character want? (leave blank to let the story decide)". Example placeholder: "Find my missing sister."
- **Buttons:** "Start now" and "Not now".

Details:

- The popup appears once per save. The save records the answer (for example `mainQuest.offerState: "pending" | "declined" | "started"`), so reloading doesn't show it again.
- The popup appears after the opening scene has rendered, so the player can read the intro before deciding.
- "Not now" closes the modal with no further prompting. It does not disable the feature; the player can start it later.
- "Start now" runs spine generation as a background job with normal prompt-progress feedback. The player can keep playing while it generates.
- If generation fails, show the error and leave the offer pending, so the start action stays available. Do not silently fall back to a no-quest state.

### Starting later

A "Start main quest" action is available while no main quest is active:

- a button in the quest panel
- a slash command (for example `/mainquest start [goal]`)

The same action works for older saves that predate the feature. For a save with history, generation uses the plot summary, scene summaries, active quests, known NPCs and factions, so the spine builds on what has already happened instead of ignoring it.

After a main quest ends, the action becomes available again to start a new one. The save keeps a history of finished main quests.

## Shape: a fixed spine with flexible routes

**1. Stages are defined by outcomes, not routes.** Each stage says what must become true in the world, not how the player gets there. For example, "the player knows who forged the seal" or "the dam cult loses its patron." Any route that achieves it counts: stealth, diplomacy, violence or bribery. This is the main defence against railroading.

**2. Stages refer to roles, not specific NPCs.** A stage might need "the informant" or "the betrayer." Each role is bound to an NPC or faction when the story first needs it. If that NPC dies or turns hostile, the role is recast or the stage is replanned, so one dead NPC can't break the questline. This also handles later stages needing NPCs and locations that don't exist yet.

**3. Detail is generated as needed, the way stub regions are.** At start, generate:

- the premise (built from the player's goal when given)
- the hidden truth
- the antagonist or opposing force
- 4–7 stage outlines
- 2–3 possible endings

Only the current stage and the next one get full detail. Later stages are rewritten from what actually happened. Facts the player has already learned are locked, using the same idea as `MysteryThread.constraints`.

**4. Each stage becomes an ordinary `Quest` when it starts.** The stage quest carries `questLineId` / `stageId`. That reuses quest checks, rewards, level anchoring, the quest panel, pause and the edit tooling. The `MainQuest` object only holds what sits above the stages:

- premise and player goal
- hidden truth
- stages and their exit conditions
- role bindings
- pressure clock
- endings
- history of actual outcomes

**5. Advancement checks.**

- The normal quest check completes visible stage objectives.
- A separate `main-quest-check` prompt runs on the plot-analysis schedule. It handles the player getting around a stage another way, decides when to move to the next stage, and triggers replanning when the player has gone off the expected path.
- Replanning is silent. The player sees new stage quests and changed pressure text, not a "the story has shifted" notice.

**6. Pressure and failing forward.** The antagonist acts if the player ignores the main quest:

- a Tracker countdown, shown to the player only as vague descriptive text
- ScheduledEvents for consequences
- the antagonist faction's housekeeping plans, seeded from the main quest

Missing a deadline makes the world worse and moves the story on (the "Fronts" idea in `gameplay_improvement_brainstorm.md`). It doesn't end the game.

**7. Prompt integration.**

- Add a `<mainQuest>` block to the base context with the current stage's player-facing text, its hidden direction, and an instruction to offer hooks rather than steer the player.
- Plot analysis gets the main quest as a pinned thread it cannot drop or rewrite.
- The main quest doesn't count against the soft quest limit or the mystery caps.
- TinyBrain prompt families need matching handling.

**8. Endings.** When a final stage resolves, pick or write the ending that fits what happened, generate an epilogue, then return to sandbox play.

## Risks

1. **Plot analysis could undo it.** It rewrites `plotThreads` each run, so without the pinned thread it would keep dropping or rephrasing the main plot.
2. **Every scene could become about the main quest.** If the main quest is injected strongly every turn, the sandbox disappears. Prominence should vary: stronger after a stretch of turns with no progress, quieter otherwise.
3. **Level scaling.** `Quest` fixes a quest's level from where it was generated. Stage quests probably need levels set against expected progression instead, or late stages will be trivially easy or impossibly hard.
4. **Mystery caps.** The hidden truth fits naturally as a `MysteryThread`, but would use one of the 3 active slots unless exempt.
5. **Starting mid-campaign.** Building a spine from an existing save depends on plot and scene summaries being good enough. Generation should fail loudly when it can't build a coherent premise, rather than producing a generic one.
6. **Popup timing.** The popup must not block or race with the opening scene's background jobs (event checks, housekeeping). Show it only after the opening turn has settled.

## Open questions

- Should the popup also appear when loading an older save that has never been offered a main quest? (Leaning: no; the quest panel button is enough.)
- How many stages by default, and should that be configurable in `config.yaml`?
- Should the player be able to abandon an active main quest, and does that count as one of the endings?
