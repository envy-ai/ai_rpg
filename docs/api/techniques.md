# Techniques API

All routes use authoritative `Player` and `TechniqueService` state. Invalid requests return `{error, stack}` for the existing error modal.

Panel responses include `balanceAuthoring`, the applicable managed healing recipe,
actual skill/attribute choices, resource profiles and configured improvement steps.
Authoring endpoints use a server-owned editor origin. A managed revision must
retain its saved policy and canonical formulas. Personal requests require
`convertToCustom: true` to deliberately remove that managed policy; an omitted
metadata field alone cannot silently convert a learned managed technique.
Semantic improvements may submit `improvement: {stepId}` instead of complete
mechanics. Preview returns the formula-preserving `authoredMechanics` alongside
the existing numerically resolved `mechanics` response; clients save their draft
or authored mechanics, never the calculated preview values.

| Endpoint | Contract |
| --- | --- |
| `GET /api/techniques?actor=ID&catalog=true` | Defaults to the current player. Returns actor identity/control flags, explicit discipline access, disciplines, separate `disciplineIcons[id]` presentation metadata, `disciplineEditContext`, grouped available/blocked techniques and their pinned sources, visible colocated targets, and authoritative formula facts. `catalog=true` additionally returns definitions for the existing authoring UI. Only the current player's panel has `canUse: true`. |
| `PUT /api/techniques/access` | `{actorId, disciplineAccess}` replaces explicitly authored access after validating referenced disciplines. |
| `PUT /api/techniques/disciplines` | Atomic combined editor save: `{actorId,edits:[{id,name,description}],accessIds:[id],accessReason?,expected}`. `accessIds` is the actor's complete explicit-access set. `expected` is the original GET `disciplineEditContext`. Returns the usual panel payload plus `disciplinesChanged` and `accessChanged`. Only names/descriptions are shared edits; existing access provenance is retained and only new grants require a reason. Unknown/duplicate IDs, malformed fields or stale baselines reject without partial metadata/access changes. |
| `POST /api/techniques/disciplines` | Creates a strict discipline with a shared first-three-word name ID and collision suffix when no ID is supplied, or returns the existing complete-normalized-title canonical discipline without overwriting its metadata/access rules. Ambiguous canonical titles reject. |
| `POST /api/techniques/catalog` | Creates one strict definition with revision mechanics. Missing ID uses the shared first-three-word technique-name allocator with numeric collision suffixes. New candidate `unique` is rejected with removal guidance; actors may share the definition ID. |
| `POST /api/techniques/preview` | `{actorId, mechanics}` validates and evaluates a draft revision's costs/effects/formulas without learning, spending or applying effects. Returns the resolved `mechanics` plus costs and optional failure costs. |
| `POST /api/techniques/:id/use-preview` | `{actorId,sourceId?,targetIds,weaponItemId?,utilitySelections?}` returns authoritative selected-source costs, failure costs, target count, resolved effects and selected weapon without a roll or mutation. Area `perTarget` costs and native weapon charge payment appear here. |
| `PUT /api/techniques/:id/catalog` | `{actorId,mechanics,expectedCatalogRevision,convertToCustom?}` appends one shared catalogue revision after an exact latest-revision guard. It does not repin existing owners or grants. |
| `POST /api/techniques/:id/personal-reset/preview` | `{actorId,expectedDefinitionRevision,expectedPersonalRevision,expectedCatalogRevision,targetDefinitionRevision}` returns a before/after mechanics review. The target may be the actor's pinned base (reset) or a newer base (rebase). |
| `POST /api/techniques/:id/personal-reset` | The reviewed fields above plus `operationId?` and editor `provenance` append one personal revision, update only this actor's base pin and record an immutable receipt. Exact guards reject stale reviews; identical operation replay returns the original receipt. |
| `GET /api/techniques/summon-templates` | Returns saved typed summon templates for the current/selected actor's editor. |
| `POST /api/techniques/summon-templates` | `{actorId,name,description,level,attributes,skills,...}` validates and saves one explicit typed template. Inline authored summon templates also install on a successful first cast. |
| `POST /api/techniques/:id/learn` | `{actorId, definitionRevision?, provenance?, operationId?}` acquires catalogue knowledge through the common service. Authoring provenance defaults to `editor`. Returns actor panel data and the acquisition receipt. |
| `PUT /api/techniques/:id/personal` | `{actorId, mechanics, evidenceIds?, provenance?, operationId?}` appends that actor's next personal revision. Editor changes do not rewrite catalogue revisions or other actors. Returns panel data and the revision receipt. |

Use submits an ordinary `/api/chat` action with `metadata.techniqueUse` (also accepted on the latest user message): `{actorId, techniqueId, sourceId, definitionRevision?, personalRevision?, targetIds, weaponItemId?, utilitySelections?}`. `utilitySelections` is keyed by effect ID and chooses an existing destination, actor or template ID as required. `actorId` must be the current player; targets must be colocated under party presence rules. It shares ordinary turn gates, time advancement, NPC scheduling, logging and errors. There is no direct heal/use mutation endpoint. The exact source and pins are checked before commit. Replaying a committed request returns the original receipt even if equipment has since changed.

Chat returns structured `techniqueUses` (complete saved receipts) and `techniqueChanges` (acquisitions/revisions/evidence), alongside existing event and refresh payloads. Clients refresh actor/location views from these structures rather than parsing prose.

Standard `createThing` tool authoring accepts pinned `techniqueGrants` for equipment access or teaching. The server assigns missing grant IDs from the referenced technique name through the shared first-three-word allocator with numeric collision suffixes and binds the newly created item as the grant source; unknown catalogue revisions fail before generation. The registry-backed `updateObjectFields` path exposes the same authoritative grant field for existing items.


`disciplineEditContext` is `{worldId,disciplines:[{id,name,description}],
disciplineAccess:[{disciplineId,provenance}]}`. The runtime world ID changes on
reset/hydration and is not persisted. The combined editor checks this identity,
the baseline metadata for each edited discipline and the previous actor access
(including provenance). Unrelated discipline edits may coexist. Existing
`PUT /api/techniques/access` remains available for direct access-only callers;
the character UI uses the combined endpoint. API validation errors preserve the
original stack for the shared error modal.
