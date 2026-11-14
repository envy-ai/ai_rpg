# TechniquePromptContext

Weapon facts retain exact equipped item IDs and their current mechanics. Utility
destinations and summon-template descriptors are deduplicated once in the compact
`utilityCatalog`; actor records retain their eligible existing summons and dead
targets. Conflicting canonical descriptors reject instead of silently choosing
one. Runtime selections reference these IDs without repeating computed values.

`TechniquePromptContext.js` builds prompt-only projections without changing saved
techniques, receipts, or the client/editor DTOs.

`compactTechniquePromptContext(fullContexts)` returns
`{balancePolicies,formulaVariableSchema,utilityCatalog,actors}`. Shared recipe and improvement
schemas appear once under their policy digest. `formulaVariableSchema` contains
one `{key,kind,name?}` definition per canonical variable; each actor's
`formulaVariables` is a key-to-current-value map containing only its own sources.
Eligible skill and attribute names derive from the shared schema entries whose
keys occur in that actor's map; separate per-actor name lists are not repeated.
Actor records retain applicable resource profiles, accessible disciplines, and all available
or blocked technique sources. Source IDs, item identity, revision pins, target and
check definitions, costs/failure costs, effects, resolved resource vectors,
availability, blockers and saved improvement choices remain present. Formula UI
labels, icon metadata and managed policy snapshots are omitted from prompts;
authoritative mechanics remain in the service. Conflicting schemas for one policy
digest, conflicting variable metadata, duplicate actor variable keys, invalid
canonical definitions, and nonfinite values raise an error. No actor, technique,
or source count is capped.

`compactTechniqueActorFacts(actorFacts,{includeFormulaFacts=true})` retains
qualification, health/incapacity, and ability identities/descriptions. The
default also retains level, actual skills and attribute modifiers. Main authoring
sets `includeFormulaFacts:false` because the shared or supplemental technique
context already supplies those exact facts in its variable maps.
Active need bars contain only identity, name, value, bounds and explicit payment
direction. Threshold scripts, appearance metadata and unrelated need-generation
instructions are not authoring inputs.

`compactTechniqueCatalogue(definitions)` retains public catalogue identity and
the latest revision's acquisition/use requirements, targets, checks, costs,
failure costs and effects. Historical revisions and managed policy snapshots are
not repeated; saved `unique` metadata is not projected. Catalogue reuse sends its canonical ID and the engine selects and
validates the actual definition.
This detailed projection is reserved for selected canonical acquisition/detail
lookups. Broad prompt-facing catalogues use
`buildTechniqueCatalogueOutlineGroups` from [TechniqueSelectionContext](TechniqueSelectionContext.md),
retaining only ID, name and stored short description under each discipline.

[StartingTechniques](StartingTechniques.md) uses these compact projections for
both response modes and renders targeted facts as nested XML after the ordinary
shared base context. It uses the shared
[catalogue summary](TechniqueSelectionContext.md#ability-catalogue-lookup) as
nested XML for every public identity, with exact ID/name and stored short
description only.
The actor-owned and granted source mechanics remain complete; there is no
catalogue cap or change to authoritative validation.

The shared base context uses lightweight per-character Markdown repertoire lists
from `TechniqueService.getTechniqueSummaries`, with names and `shortDescription`.
Only rows whose canonical names are ambiguous among that actor's technique
names/aliases also display an inline canonical ID; unique rows remain unchanged.
It does not serialize this complete projection globally. Main player actions and
event authoring obtain selected authoritative XML through
[TechniqueSelectionContext](TechniqueSelectionContext.md). That renderer compacts
the selected actor contexts together, emits shared schemas/policies once, and
filters out sibling techniques' mechanics before rendering. Existing targeted standalone callers can still use the complete projection without a base dump. Ability attachments instead use a complete summary-only catalogue outline for lookup, then render only selected canonical definitions. Their actor projection retains authoring/formula/resource facts with `techniques: []`, excluding old owned-source mechanics and unselected grants.

Actor projections also retain `chargeItems: [{itemId,name,chargePool,equipped}]` for owned visible charged items. Resolved charge cost vectors preserve exact itemId, pool mode/unit and amount/capacity/current-value facts. Model selection never asks for already known pool balances or chooses a replacement when the selected item is empty.
