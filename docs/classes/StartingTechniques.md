# StartingTechniques

`generateStartingTechniques({ actors, config, setting, location, clientId, explicitTechniques })`
authors the initial learned repertoire of actual newly created protagonists and
NPCs. It runs after their existing skill, ability, inventory and equipment setup.
Player ability offers may remain pending; only current established facts qualify
the initial repertoire. Ordinary characters can receive an empty repertoire.
This helper is never a load migration, startup dummy-player initializer, or a way
to retrofit a selected existing protagonist.

One logical, logged `starting_techniques` prompt handles each supplied character batch.
It receives an explicit whitelist of character facts, equipped/inventory item
identity, current formula variables, active resource pools, public technique
catalogue, public disciplines and setting rules. It never serializes the whole
configuration, Globals, private provenance or historical action receipts.
Generation reuses equivalent common techniques by discipline and semantic key;
quantity copies receive independent learned state while sharing common catalogue
definitions. Unique techniques cannot be shared between owners.

The strict response is `<startingTechniques>` containing exactly one `<actor>`
per requested actor. Each actor has its exact `<actorId>` and a `<techniques>`
collection. A `<technique>` contains either an existing `<techniqueId>` or a
JSON `<candidate>`, optionally with JSON `<candidateDiscipline>`.
Candidates omit `id` and `provenance`; the server creates them. A new discipline
also omits its ID/provenance and its candidate omits `disciplineId`. Otherwise the
candidate names an existing discipline ID. New definitions contain only revision
1. Empty collections are explicit accepted results. Duplicate/unknown fields,
attributes, mixed text, missing actors, invalid JSON and invalid mechanics fail.

Creation shares `getTechniqueCreationInstructions()` and recipe proposal parsing with first-use discovery. Ordinary healing supplies a semantic `revision.recipe` selector from the actor's bounded `balanceAuthoring` context; it does not supply numeric effects, costs, failure costs or metadata. The actor-aware learning batch compiles and validates each candidate before acquiring anything. A proposed common recipe must qualify for every intended learner; the engine does not substitute another skill or resource. Nonhealing candidates retain their complete mechanics schema.
Initial learning itself establishes durable explicit access to each learned
technique's discipline, including when its existing access requirements would
reject a rank-1 baseline skill. This exception applies only to the initial
repertoire and also bypasses each revision's acquisition requirements (including
ability, class, race, skill, and level gates). Ordinary later learning retains
both discipline and acquisition gates. Use-time requirements, uniqueness, and
mechanics/reference validation remain enforced. Access records have generation
provenance and commit atomically with learned entries. Baseline rank-1 skills
alone still do not grant later specialist access; magic is not globally public.
Costs, checks, effects, resource directions and canonical formula variables are
validated before acquisition. Learning pays
no cast costs, applies no effects, advances no time and consumes no NPC action.
Equipment grants remain separate from learned knowledge.
Ability-owned permanent statuses may also grant pinned techniques. Initial
repertoire prompts see those granted sources and ability attachment summaries;
they must not duplicate or permanently learn a technique merely to make an
ability grant executable. Independent learned training remains valid when
established character facts justify it.

Discipline naming and unresolved-example validation share the first-use
authoring helpers in [TechniquePrompt](TechniquePrompt.md). New categories should
name reusable setting-grounded practices and reuse existing disciplines where
appropriate. Copied placeholder names/descriptions fail within the existing
parse-and-correct loop before batch learning.

Standard mode uses the existing full-batch XML response. `PromptRetryPolicy`
owns its single configured semantic/XML attempt budget. Requests disable inner
XML retries and tools. Every response attempt logs its complete conversation
and field-level correction; transport failures propagate without becoming parse retries.

With effective `ai.tinybrain: true`, the `starting_techniques` family first asks
for a compact `<startingTechniquePlan>` roster. It contains exactly one `<actor>`
per requested active actor and a `<techniques>` collection, including explicit
empty collections. Batch actor blocks require the exact `<actorId>`; a single
actor omits it because the server already knows the owner. Each roster
`<technique>` has only nonblank text `<discipline>`, `<name>` and `<description>`.
Duplicate discipline/name pairs within one actor, missing actors, unexpected
fields and malformed XML retry the roster checkpoint. `parseStartingTechniquePlan`
exports this strict parser. Known common catalogue techniques use their canonical names.

The existing TinyBrain runner then iterates the approved roster, requesting
exactly one complete `<technique>` per checkpoint with the same ID-or-candidate
contract as standard mode. The actor and roster are not repeated in the answer.
Descriptions may expand, while the approved technique/discipline identities
must match. Guidance requires executable mechanics to implement the approved
concept rather than adding unrelated bonuses to bypass validation; unsupported
passive triggers and automatic counterattacks must not be promised.

Each expansion parses against detached already accepted discipline identities
and prepares the entire cumulative actor batch before accepting that checkpoint.
Failed candidates cannot alter the accepted proposals or world state. Common
semantic reuse, managed healing recipes and unique ownership retain their
ordinary service validation. Corrections identify the actor and technique and
retry only that entry. A local result builder checks roster completion without
another model call; only then does the caller commit the final prepared batch.
Empty repertoires, disabled/dead actors and explicit known techniques preserve
their normal completion-receipt behavior. One fixed fact prefix, log, progress
group and queue reservation cover the full staged run, with no native tools.
The configured effective retry budget applies separately to roster and each
technique. `ai.tinybrain_prompts.starting_techniques: false` retains standard
batch generation; omission enables this family under the effective master switch.

`TechniqueService.prepareLearningBatch(groups)` stages the entire response in
local catalogue/receipt maps and prepared learned entries. No rejected candidate
can leak from an earlier entry in the same response. `commitLearningBatch` checks
the original effective authoring policy and world/actor state and synchronously installs the whole batch, with
actor-write rollback on failure. It creates ordinary learning receipts and a
strict `initialization` completion receipt for every actor, including empty
repertoires. The fixed operation ID is
`<actor ID>:starting-technique-initialization`. Completed actors skip generation
on retries and retain their personal upgrades. These receipts persist in the
ordinary saved technique service state.

Reviewed protagonist owners record `techniquesReady` only after successful
initialization. Single/location/region NPC generation uses
`initializeGeneratedNpcTechniques` after gear and quantity expansion and preserves
the original error cause with `NPC_TECHNIQUE_INITIALIZATION_FAILED`, bypassing
the existing NPC prose fallback catches. Hostile arrival construction remains
synchronous: the committed spawn receives initial authoring before arrival
narration. If that later prompt fails, the actual spawn remains and the error
propagates; it is not silently replaced or charged an action. Retrying the exact
same arrival initializes only committed NPCs at that destination whose saved
hostile-arrival provenance matches and whose initialization receipt is missing.
Other arrivals and save loads do not retrofit old NPCs or respawn this group.
