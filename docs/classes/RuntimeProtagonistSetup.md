# RuntimeProtagonistSetup

Generic canonical protagonist construction and initialization shared by reviewed new-game and existing-world setup. Creates Player through the normal constructor/default attributes/skill synchronization; initializes faction standings, generated inventory, abilities and pending canonical choices using existing functions. Optional stage callbacks record successful checkpoints and let explicit retries resume pending stages.

Ability initialization uses `resolvePlayerAbilitySelectionState` and leaves its offers for the normal player choice flow. It records `abilitiesReady` only after that operation succeeds, preserves existing abilities on retry, and does not run an NPC post-generation prompt or assign choices automatically.

Initial technique authoring then calls `generateStartingTechniques` with this new
actor and records `techniquesReady` after success. Pending player ability offers
do not block authoring from the current established concept/training. The shared
saved completion receipt prevents regeneration or resetting personal upgrades
when owner checkpoint persistence needs a retry. See [StartingTechniques](StartingTechniques.md).

`apiScope.commitExistingWorldProtagonist` acquires the gameplay lifecycle barrier without clearing world/history. It validates a detailed existing location or living non-NPC same-world protagonist, creates/registers and initializes a new actor or selects the actual existing actor, then invokes binding callbacks and uses canonical active-player/world-time setters. Callback failures propagate. No HTTP self-call, whole-state transplant or direct mod mutation of closure-local state is used.

The `protagonistConstructed` checkpoint identifies actors actually created by that
setup owner. Only those actors resume unfinished initialization on a retry;
selecting an existing protagonist does not generate historical knowledge.

Reviewed character concept adaptation passes supported personality type/traits/notes and narrative goals to the normal Player constructor. Backstory remains canonical character description prose. Mechanical fields are reviewed independently; no source-world inventory, abilities, status, currency or registry objects are transplanted. Canonical selected-world attribute/skill/class/race names are validated by the draft owner before commit.

`apiScope.withCanonicalPreparation(callback)` holds the existing gameplay/runtime replacement barrier around explicit focused canonical entity preparation without replacing runtime. It validates a callback, rejects busy gameplay, propagates failures and always releases the barrier. The story owner separately freezes/rechecks reviewed story/history before entering; no public GET or background world writer uses it.

`tests/runtime_protagonist_setup.test.js` reproduces the player-versus-NPC ability boundary, verifies existing abilities remain intact, and checks that failed offer generation propagates its original error without recording readiness.
