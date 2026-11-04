# Semantic healing and optional standard damage authoring

User decisions: add a standard damage recipe using the existing healing amount and resource-cost formulas as the initial baseline, with separately configurable damage coefficients. Preserve intentional custom damage formulas as a general supported alternative, including when the standard recipe is available. No repair-specific warnings or semantic policing of unusual otherwise-valid choices.

## Contract

Model-authored standard recipes identify their semantic kind (`healing` or `damage`) and only the meaningful selected skill, attribute and resource profile. Questions omit recipe IDs, stable effect IDs, numeric compiled costs/effects/balance snapshots and known revision numbers. Valid voluntarily supplied canonical known values remain accepted; actual kind/ID conflicts reject. At actor-aware preparation the engine resolves recipe kind to canonical recipe ID, fills only genuinely singleton eligible selections, and supplies fresh revision 1 and deterministic effect IDs. Zero choices fail explicitly; multiple choices require a valid selection. Choosing the standard damage branch is deliberate resource-backed authoring, not an automatic conversion of physical/custom techniques to Mana.

The existing canonical compiler/editor DTO remains separate from simplified model input. Known catalogue references send only their canonical IDs and retain saved mechanics. Stored managed-healing snapshots/digests, historic formulas and trusted editor records are unchanged. New standard damage has its own saved coefficient snapshot and recipe identity, so later policy edits do not reinterpret it.

Standard healing retains existing self/single pure-healing restrictions. The optional standard damage recipe initially handles pure self/single damage with a real nonautomatic check. Existing deliberate custom damage, area and mixed damage/status mechanics keep their existing formula/cost/target support; there is no silent fallback from an invalid selected recipe to custom/free mechanics and no new resource pool.

## Implementation

1. Extend TechniqueBalancePolicy with independent standard damage coefficients, compilation/validation and semantic-input normalization; retain exact old healing snapshot representation.
2. Share nested XML authoring across TechniqueXml, attachments, starting techniques, standalone first-use and player standard/TinyBrain/native first-use adapters. Native tool argument names and JSON string DTO protocol remain unchanged; actual first-use XML responses contain nested objects rather than JSON leaves. Keep authoritative DTO/save JSON unchanged.
3. Resolve known fields at engine preparation boundaries. Preserve stable IDs through correction retries and retain all existing final/domain checks.
4. Update named model-output schemas and positive recipe examples; remove redundant fields from requested output. Custom formula guidance remains available deliberately.
5. Test old healing snapshots/digests, new standard damage snapshots/config, actual singleton/multiple/zero choices, resource/check validation, retained custom/area/mixed formulas and standard/TinyBrain/native XML authoring.

No live model calls, save edits, configuration-profile activation, restarts or new-game tests are part of this implementation turn. Root coordinates any later requested runtime work.

## Verification and boundaries

Focused mocked checks passed: core recipe/config/saved-healing compatibility 18; first-use nested XML/native adapters 9; starting-technique standard/TinyBrain 10; persisted pending singleton selectors 1; existing attachment/authoring regressions 30. The critic found no blockers. Production JavaScript syntax checks and named recipe/intent schema loading passed; shipped YAML parses and retains independent damage defaults.

Pending attachment entries freeze resolved selector choices, not uncommitted coefficients. Application recompiles/revalidates current policy as before; installed managed revisions continue to use their immutable saved snapshots. Standard damage still requires explicit target/check choices; omitted allowDead keeps the existing false default. No live-generation success is claimed, and active runtime/profile state is unchanged.
