# GeneratedNpcTechniques

New NPC XML may contain an optional `startingTechniques` collection with distinct
`techniqueId` children. `parseGeneratedNpcTechniques(node, { quantity })` validates
the direct fields, catalogue references, and quantity groups before NPC creation.
Unknown IDs and duplicate entries are errors. A quantity group cannot share a
unique technique. Omission or an empty collection selects no existing definitions
in this XML; automatic initial authoring may still propose appropriate techniques.
Rejection names the NPC and the offending `<startingTechniques>/<techniqueId>[index]`, explains that only exact canonical technique IDs are valid, and gives a listed ID or omission as a repair. Discipline IDs/names, skills and technique display names are not translated into technique IDs. When the public catalogue is empty, the prompt explicitly asks for an omitted or empty collection. Shared single, region, location, hostile-presence and TinyBrain NPC prompts show public technique IDs in nested XML outside their response scaffold; no JSON catalogue is embedded in the XML example.

`applyGeneratedNpcTechniques(actor, techniqueIds)` learns these existing common
definitions through `TechniqueService.learn`, with stable actor/technique operation
IDs and generation provenance. Initial learning pays no use cost and does not cast.
Prerequisites remain authoritative. Failures retain their original cause and use
`NPC_TECHNIQUE_INITIALIZATION_FAILED` so the existing NPC fallback paths cannot
silently conceal missing technique mechanics.

Single, location, and region NPC generation call
`initializeGeneratedNpcTechniques(actors, options)` after skills, abilities,
equipment and quantity expansion. It batches
[StartingTechniques](StartingTechniques.md) authoring, including the XML-selected
existing definitions in the same atomic initial acquisition response. Appropriate
novel definitions can therefore exist before the character's first action. Each
character receives independent learned state. Hostile presence construction keeps
its synchronous existing-reference acquisition and rollback; automatic novel
authoring follows the committed spawn before arrival narration.

The shared prompt include `_includes/npc-starting-techniques.njk` supplies public
catalogue definitions for sparse, role-appropriate reuse. Automatic initial
authoring uses one prompt per character batch, rather than one extra prompt per
individual copy. Later techniques still use ordinary discovery, training and
story acquisition; existing saved characters are not retroactively initialized.
