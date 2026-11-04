# TechniqueXml

`TechniqueXml.js` shares typed nested XML decoding and authoring guidance across ability attachments, initial learned techniques, first-use authoring and narrative learning events. It does not install mechanics or replace domain validation.

- `parseTechniqueXmlValue(node, declaration, path)` decodes the existing finite typed contracts, rejecting attributes, unknown/duplicate fields, mixed object text, malformed booleans/numbers and JSON in object fields.
- `parseTechniqueDisciplineGroupXml(node, options)` resolves an enclosing parent before decoding its child entries; it returns `{ disciplineId, candidateDiscipline?, techniques }` using existing service DTOs.
- `flattenTechniqueDisciplineGroups(groups, { disciplines?, maxTechniques? })` appends grouped entries in encounter order, staging canonical parents in the supplied detached catalogue. Repeated IDs or normalized titles append children and retain the first canonical metadata.
- `resolveTechniqueDisciplineHeader` and the exported typed group/header/entry declarations share this contract with TinyBrain rosters and event authoring.
- `writeTechniqueXmlValue(node, value, declaration)` builds the same typed nested XML from authoritative DTOs, including native-tool normalization.
- `getTechniqueXmlInstructions()` supplies shared XML mechanics examples, semantic healing/optional standard damage recipe rules, requirements, costs, checks, effects, formula guidance and the failure-cost omission distinction.

Parser errors include the field path and a correction for the rejected shape. Unsupported-field guidance uses the known schema (including enclosing `discipline`, forbidden repeated child parent IDs and server-owned fields), rather than classifying error messages. Numeric-only leaves request numeric text; formula-capable amount leaves also describe the formula-child alternative. Existing mechanics and optional-leaf omission rules remain enforced.

Typed object/list fields, discipline groups and technique entry siblings collect up to ten distinct actual problems through [ResponseValidation](ResponseValidation.md). Invalid partial decoding always throws before returning a DTO. Parent-dependent checks wait for a valid parent; malformed XML still fails at the strict document parser. Grouped attachment errors retain the status/discipline/technique path.

Model-output objects/lists use child elements throughout. Numeric amounts support either scalar text or a formula object with optional typed bindings. Existing saved/catalogue DTOs and HTTP JSON are unchanged. Omitted `failureCosts` retains normal costs; an empty list explicitly permits free failure. Domain parsers and detached learning/attachment preparation still validate actual actor facts, references, mechanics and application atomicity.

Optional and conditionally required leaves use an explicit shared `optionalEmptyLeaf` declaration: self-closing, explicitly empty and whitespace-only elements mean omission. Explicit zero, false and populated numeric/formula values remain values. The writer unwraps the same declarations. Attributes, unknown children, invalid nonempty scalar values and duplicate fields still reject, including an empty occurrence followed by a populated one.

| Context | Empty leaves treated as omitted |
| --- | --- |
| Authored candidate / parent | Candidate `unique`; parent `disciplineId`, `name`, `description`, `publicAccess` |
| Fresh revision / target | Inner `revision` (singleton defaults to 1); `target.allowDead` |
| Requirement | `id`, `name`, `minimum`, `present` |
| Check | Every field except `kind` |
| Cost | `needId`, `direction` |
| Effect | `amount`, `damageMode`, `stacking`, `refreshPolicy`, `potency` |
| Attachment or technique status | Attribute/skill `modifier`, `percentModifier`; `maxHealthPercent` |
| Outer attachment status / entry | Status `name`; entry `techniqueId`, `definitionRevision` |
| Nested status technique grant | Grant `id` only |
| Provenance | `sourceId`, `private`, `worldMinute`, `operationId` |
| Recipe | `kind`, `recipeId`, `skillName`, `attributeName`, `resourceProfileId`, `effectId` |
| Formula binding | `name` (required by domain for skill/attribute bindings) |

This converts empty leaves into absent DTO properties; existing domain validators still require the fields selected by a requirement/check/cost/effect/recipe kind. A skill check still needs its skill/difficulty, a need cost its need ID, a damage/healing effect its amount, a damage effect its damage mode, and each modifier entry at least one magnitude. Statuses still need mechanics. Required identity/name/description fields, kind discriminators other than the recipe's conditional kind/ID pair, formula text and binding variable/kind, pinned technique-grant references, and all managed balance snapshot leaves remain strict. Empty object wrappers remain objects, and list omission/emptiness semantics are unchanged.

Named layouts live in `schemas/xml/technique-candidate.schema.xml`, `technique-authoring-discipline.schema.xml`, `starting-technique.schema.xml` and `ability-attachments.schema.xml`. Optional ID/reference/candidate branches remain conditional domain rules. Inner effect statuses permit only the existing finite technique grant references, not recursive newly authored candidates. Outer ability status names may be omitted when the existing StatusEffect parser accepts them.

A single fresh candidate revision may omit its known revision number; decoding supplies 1. Recipe kind/selectors use child elements; consistent canonical recipe/effect IDs remain optional inputs. Shared first-use layouts add `technique-intent.schema.xml` and `technique-provenance.schema.xml`. Engine preparation supplies reserved candidate/discipline identities and provenance; native tools keep their outer JSON protocol and carry the identical authored XML group in `disciplineXml`; saved/editor JSON DTOs remain unchanged.

## Discipline-first authoring

```xml
<disciplines>
  <discipline>
    <disciplineId>existing_discipline_id</disciplineId>
    <techniques><technique><techniqueId>existing_technique_id</techniqueId></technique></techniques>
  </discipline>
  <discipline>
    <name>New reusable practice</name><description>Setting-grounded category.</description>
    <accessRequirements/><publicAccess>false</publicAccess>
    <techniques><technique><candidate><!-- name, description, semanticKey, revisions --></candidate></technique></techniques>
  </discipline>
</disciplines>
```

An existing parent supplies only `disciplineId`; a new parent supplies its metadata instead. Empty parent name/description leaves mean omission: an existing-ID header may omit both, and a repeated canonical title may omit its known description. Genuinely new parents still require name and description, and populated metadata alongside an ID remains invalid. Child candidates never repeat `disciplineId`, IDs or provenance, and no sibling `candidateDiscipline` model field exists. Reference entries must belong to the enclosing canonical parent. Ability statuses and starting actors contain `disciplines`; first-use operations and novel learning events contain one `discipline` directly, with exactly one child. `definitionRevision` pins attachment catalogue references only. New candidate revisions remain revision 1. Empty actor/status collections are valid; a present parent needs a child.

Canonical lookup spans the accepted response, including later statuses or actors. An earlier newly defined parent can be referenced by its assigned title-derived ID later in that response. Repeated normalized titles retain canonical metadata/rules even if later proposals differ. Existing technique-level uniqueness and acquisition rules remain authoritative; grouping adds no automatic deduplication. Decoding never installs world catalogue or actor state.
