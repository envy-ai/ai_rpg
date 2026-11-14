# StartingTechniques

`generateStartingTechniques({ actors, config, setting, location, clientId, explicitTechniques })`
authors the initial learned repertoire of actual newly created protagonists and
NPCs. It runs after their existing skill, ability, inventory and equipment setup.
Player ability offers may remain pending; only current established facts qualify
the initial repertoire. Ordinary characters can receive an empty repertoire.
This helper is never a load migration, startup dummy-player initializer, or a way
to retrofit a selected existing protagonist.

One logical, logged `starting_techniques` prompt handles each supplied character batch.
Server-supplied `explicitTechniques` are detached-prepared before either response
mode calls a model. Invalid fixed IDs or other fixed-input failures stop there
with their original cause; a model retry cannot repair server-owned inputs.
Generated roster and technique errors still use the normal correction budget.
It renders the ordinary prepared shared base context (via
`wrapTaskInBaseContext`), so it reuses the cached prefix: Strata holds one
cache, and a separate reduced context moved its pin and evicted the main
conversation, costing ~20 s re-reads before and after. The task after the
base-context end marker supplies the exact location and character facts for
standard and TinyBrain requests. The task supplies
character qualification and ability/status grants, equipped/inventory item
identity, current formula variables, active resource pools, public technique
catalogue and public disciplines. It never serializes the whole configuration,
Globals, private provenance or historical action receipts. The renderer
uses the native synchronous base-context builder because this task does not
consume the background NPC memory selection used by narrative base prompts.

Task facts are nested `<startingTechniqueContext>` XML, including real child
elements for lists and objects. The native compact technique projection shares
formula schema and recipe policies once while retaining each actor's values,
resource profiles, available source mechanics and discipline access. The public
catalogue uses the same `buildTechniqueCatalogueOutlineGroups` summary projection
as ability attachment authoring. Its nested XML has discipline groups and every
public technique's exact ID, name and stored short description when available.
A missing short description stays absent; full descriptions and mechanics are
never substituted into this summary. An exact catalogue ID resolves complete
canonical mechanics and effects during native batch preparation. Prompt guidance
asks the model to reference that ID instead of guessing omitted mechanics. New candidates still
need complete mechanics. Actor-owned and granted source effects remain in the
actor context. Actor facts retain actual skills, attributes, abilities, grants, needs,
inventory and gear. There is no arbitrary actor or catalogue limit, and no
prompt truncation. The same fixed fact prefix is reused at every
TinyBrain checkpoint; accepted checkpoint responses still follow the runner's
normal transcript rules.
Generation reuses normalized-title canonical disciplines (preserving their ID and access rules), then equivalent catalogue techniques by discipline and semantic key;
quantity copies receive independent learned state while sharing catalogue
definitions. Saved legacy `unique` metadata does not limit sharing.

The strict response is `<startingTechniques>` containing exactly one `<actor>` per requested actor. Each actor has its exact `<actorId>` and an optional `<disciplines>` collection. Each `<discipline>` supplies an existing `<disciplineId>` OR new name/description/accessRequirements/publicAccess, followed by `<techniques><technique>` entries. Each child references `techniqueId` or contains a complete nested `candidate` without IDs/provenance or repeated disciplineId. New definitions contain only revision 1. The engine allocates technique IDs from each actual candidate name through the shared first-three-word allocator, adding numeric collision suffixes; saved and returned IDs remain authoritative. Empty/omitted actor disciplines are valid. Repeated parent IDs or normalized names append entries in encounter order and retain first canonical metadata. Detached parent lookup spans actors, so later blocks may reference an earlier new parent's title-derived ID.

Empty optional techniqueId and parent disciplineId leaves mean omission before branch validation; references/candidates and existing/new metadata still obey their conditional requirements. Shared [TechniqueXml](TechniqueXml.md) preserves optional empty values, zero/false, strict duplicates/attributes/unknown fields, nested formulas and list semantics. Every requested final actor ID remains required; only a sole TinyBrain roster actor may omit it.

Creation shares `getTechniqueCreationInstructions()` and recipe proposal parsing with first-use discovery. Ordinary healing supplies a semantic `revision.recipe` selector from the actor's bounded `balanceAuthoring` context; it does not supply numeric effects, costs, failure costs or metadata. The actor-aware learning batch compiles and validates each candidate before acquiring anything. A proposed common recipe must qualify for every intended learner; the engine does not substitute another skill or resource. Optional standard damage uses the same semantic envelope with explicit target/check choices. Deliberate custom damage retains its complete mechanics schema even when standard damage is available. The engine supplies known recipe/effect IDs, fresh revision 1 and unambiguous singleton selectors.
Initial learning itself establishes durable explicit access to each learned
technique's discipline, including when its existing access requirements would
reject a rank-1 baseline skill. This exception applies only to the initial
repertoire and also bypasses each revision's acquisition requirements (including
ability, class, race, skill, and level gates). Ordinary later learning retains
both discipline and acquisition gates. Use-time requirements and
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

With effective `ai.tinybrain: true`, the `starting_techniques` family first asks for a compact `<startingTechniquePlan>` roster. Each actor contains grouped `disciplines`: an existing parent ID or new metadata once, plus child techniques containing only nonblank `name` and `description`. A single actor omits actorId because the server already knows it; batch actors use exact IDs. Empty/omitted disciplines are valid. The parser validates and resolves parent metadata once in a detached catalogue, combines repeated parents by canonical identity while preserving child encounter order, and rejects duplicate technique names within one actor/parent. It returns the existing flat actor roster with resolved parent metadata attached to each planned child.

The existing TinyBrain runner then iterates the approved roster, requesting
exactly one complete `<technique>` per checkpoint with the same child ID-or-candidate contract as standard mode. The server wraps it in the approved parent group before shared parsing; the model never repeats actor, roster or parent metadata.
Descriptions may expand, while the approved technique/discipline identities
must match; discipline titles compare through the shared normalized snake_case key, so punctuation/spacing variants retain one canonical identity. Guidance requires executable mechanics to implement the approved
concept rather than adding unrelated bonuses to bypass validation; unsupported
passive triggers and automatic counterattacks must not be promised.

Each expansion parses against detached already accepted discipline identities
and prepares the entire cumulative actor batch before accepting that checkpoint.
Failed candidates cannot alter the accepted proposals or world state. Common
semantic reuse and managed healing/damage recipes retain their
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
repertoires. An actor may omit disciplines instead of emitting an empty disciplines container; actor coverage and identity requirements remain unchanged. The fixed operation ID is
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

## File-backed generation schemas

Standard output uses `starting-techniques.schema.xml`. TinyBrain roster and per-technique requests explicitly select `starting-technique-plan.schema.xml` and `starting-technique.schema.xml`; a roster schema never leaks into expansion or local final assembly. Candidates/disciplines use the shared [TechniqueXml](TechniqueXml.md) typed codec and file refs. Escaped JSON model-output candidates are no longer accepted in this authoring path. Save/catalogue JSON remains unchanged. First-use text plans and native `disciplineXml` payloads share this nested XML codec; native tools retain outer JSON arguments.

The custom TinyBrain parsers also declare their output contracts as `startingTechniquePlan` and `technique`. The runner therefore retains the same response root through checkpoint scope and retries, including when an injected completion adapter relies on scope instead of selecting its own file schema.

The final response parser aggregates independent actor records, candidate entries and missing-actor coverage through [ResponseValidation](ResponseValidation.md), up to ten distinct issues for the complete rejected response. Standard batches and TinyBrain expansion checkpoints share this parser and retain contextual causes. A readable known actor ID counts toward coverage even when its mechanics fail, avoiding a second misleading missing-actor error. The compact TinyBrain roster planner and actor-aware learning-batch preparation keep their existing dependency ordering. No partial response is accepted or committed.
