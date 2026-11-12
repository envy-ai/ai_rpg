# StatusEffectXml

`StatusEffectXml.js` is the complete nested XML boundary shared by NPC alteration
and [StatusEffectRepair](StatusEffectRepair.md). It reuses `TechniqueXml`'s typed
scalar/list parser, constructs detached `StatusEffect` values, and validates
existing technique references through `TechniqueService`.

`renderStatusEffectXml(effect)` writes an `<effect>` containing the supported
canonical fields: `id`, `name`, `description`, `duration`, `appliedAt`, attribute
and skill fixed/percentage modifiers, per-minute `needBars` (optional `delta` and `percentDelta`, requiring at least one),
`needBarMaximums` (`needBarMaximum` children with `name` and finite `percentModifier`), `maxHealthPercent`,
`techniqueGrants`, and `techniqueProvenance`. Nested records use XML elements;
there is no embedded JSON. Names and descriptions are XML-escaped.

`parseStatusEffectXml(node, { existing, actor, path, requireComplete })` returns a
canonical detached effect. Complete authored effects require a nonblank name
and description. Optional scalar omission, self-closing elements and blank
leaves have the same semantics; explicit numeric zero and boolean false remain
values. Empty list containers retain their meaning. Invalid populated fields,
unknown fields, duplicates and malformed nested structures reject with the
relevant field path and native validation cause.

When an owning actor is provided, newly authored or changed attribute, skill and
need-bar identities must match its actual configured choices (including the
special `Health` need rate and configured but currently inactive targets). Unchanged saved entries retain their legacy
identities. Errors identify the rejected field and list the valid alternatives.

When `existing` is provided, omitted fields retain their original values. IDs,
applied-at clocks and technique provenance are server-owned; populated returns
must preserve them. Existing nonempty technique grant lists retain their IDs,
source links, provenance and revision pins. Object field order does not change
identity. Detached validation does not allocate new status IDs; normal owner
application allocates IDs for genuinely new effects.

NPC alteration matches returned effects to their original intrinsic or
ability-owned scope before calling the codec and validates the combined proposed
owner lists for duplicate status/ability IDs and conflicting grant identities
before any application. Omitted intrinsic/ability wrappers preserve existing
lists; explicitly empty wrappers clear them. Repair binds the target on the
server; a response cannot select a different owner by supplying an ID.

See `tests/status_effect_xml_roundtrip.test.js` for complete mechanics,
identity/provenance, grant links, explicit zeros and the alteration boundary.

Percentage rate components add to fixed rates per world minute. Health uses the
effective maximum HP; non-Health needs use their authored base range. Capacity
percentages refer to that same base range and preserve fill percentage while
unit costs and recovery remain unchanged. Repair preserves populated rate and
maximum lists, including zeros, alongside existing identities and clocks.
