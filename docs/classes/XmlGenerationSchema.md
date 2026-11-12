# XmlGenerationSchema

`XmlGenerationSchema.js` loads editable named schema files from `schemas/xml/`.
Generation layouts live in files, including mod fragments; the compiler contains
no per-prompt/item field allowlist. `LLMClient` attaches a named file explicitly
through `xmlSchema` while the existing XML token guard is enabled.

## File format

```xml
<roster>
  <item multiple="true">
    <name>Item name, written by the model</name>
    <description>Item description, written by the model</description>
    <notes optional="true">Additional text</notes>
    <tag optional="true" multiple="true">A tag</tag>
  </item>
</roster>
```

Children are unordered. A declaration is required exactly once by default;
`optional="true"` permits omission, `multiple="true"` permits one or more, and
both permit zero or more. False restores the default flag behavior. Schema-only
bare `optional`/`multiple` flags are shorthand for true; generated output is never
repaired by that shorthand parser. Elements named optional/multiple remain legal.
Leaf text describes the value, not a value to copy or a type/enum validator.
`text="true"` explicitly permits text as well as declared child elements, for existing scalar-or-object contracts such as numeric/formula amounts and text-or-list concepts. Child cardinality still applies, so scalar alternatives declare their object children optional; the final typed parser rejects invalid mixed values. Other containers cannot also declare leaf text.

`markup="true"` explicitly declares a rich-text payload with unrestricted balanced nested tag names. It cannot declare competing schema children. This preserves existing location-description HTML and slop-remover hidden tags. Only descendants inside that payload escape child-name/cardinality checking; matching closes, CDATA recursion and the outer schema remain guarded. This is not a document-wide wildcard. Unknown metadata, duplicate child
names and malformed definitions fail explicitly.

`<item ref="item.schema.xml"/>` reuses the same-name root from another file;
local optional/multiple flags control that occurrence. File references remain
within the schema directory, reject symlink escapes, and detect cycles.
`partial="true"` on a reference makes only the referenced root's direct children
optional. It clones those child declarations with minimum zero without changing
the referenced schema, child maximums, or nested requirements. For example,
`<item ref="item.schema.xml" partial="true"/>` permits omitted item name and
description, while a present charge pool must still contain its required fields.
`partial="false"` preserves the referenced requirements. This flag requires
`ref`, including when false, and an explicit true/false value.

Success-degree item merging inherits omitted fields from an accepted base item.
An ordinary item reference requires name/description, so this shallow reference
flag preserves that partial contract without duplicating the canonical item and
mod field layouts. It supplies no values and does not relax nested validation or
full item generation.

`<extensions source="thingFields"/>` inserts the children of explicitly supplied
compiled fragment roots. Missing extension sources fail rather than enabling an
unchecked wildcard. These extension roots conventionally use `<fields>`.

`loadXmlGenerationSchema(file, { baseDirectory, extensions })` reads named files;
`compileXmlGenerationSchema(source, { resolveReference, extensions })` supports
isolated compilation. Compiled nodes expose name, min, max, children, leaf description, allowText and markup. Runtime occurrences/counts never mutate those declarations.
`loadXmlGenerationSchemaRootName(file, { baseDirectory })` uses the same safe
file resolution and strict XML parsing to read only the document root name.
It does not resolve references or invoke runtime extension providers. LLMClient
uses this metadata for root-scoped final tool-call policy checks with live guarding
disabled or deterministic output; active guards compile the full schema once.

## Request scope and correction

Use `chatCompletion({ xmlSchema: "items.schema.xml", xmlSchemaExtensions })` or
`LLMClient.withXmlOutputScope` with the same options. Extensions can be a map or a
lazy provider, evaluated only when the guard is active. `xmlSchemaDirectory` is
an explicit alternate root for isolated callers/tests. A schema implies XML;
combining it with explicit plain output fails. Plain nested scopes clear an
inherited schema. Per-stage explicit references keep TinyBrain roster/final shapes
separate. A null reference clears inherited selection; no prompt-name heuristic
silently assigns a schema.

The live scanner rejects unknown children, singleton duplicates, wrong nesting,
container text and premature parent closes. It first tries sampled alternatives.
It ignores unrelated XML before the first schema root opens and after it closes.
Actual EOS before that opening requests the required wrapper through the existing
validation correction budget, rather than forcing an unopened root.
For ordinary invalid markup, only genuine alternative exhaustion can trigger deterministic structure: rewind
to the rejected/pending markup start, open the first missing required child in
schema order, otherwise close the current element. Values always come from the
model. An empty required text field can still fail its ordinary domain validator;
no placeholder, numeric default or semantic value is forced.

Forced prefixes are explicitly synthetic, have no sampled token ID/probability,
are logged/count-charged, and reuse existing assistant-prefill continuation.
Token/continuation limits and cancellation remain enforced. Repeated forced
prefixes fail clearly. A completed root with no current frame/missing requirement
cannot be fixed by inventing or reopening a root. Token-limit/cancel/stop-string
termination cannot trigger EOS forcing; only validated actual EOS can.

Verified actual EOS has a separate schema policy: deterministically close satisfied frames upward, open the first missing required field and resume for its value, or finish locally when the root closes. A finite tag batch is one existing force/completion action. Ordinary generation stops at the first valid schema-root boundary, discarding its same-chunk suffix. Final validators still reject empty/invalid values and missing business counts. Tool-capable streams wait for ordinary termination to rule out native calls before truncation. See [guard completion](XmlClosingTagGuard.md#actual-eos-with-incomplete-xml).

Strict final XML and semantic validators remain authoritative. Coverage now includes the ordinary new-game generation tree, conditional calendar/season prep, factions, world blueprints/details, character followups, starting techniques/ability mechanics, deferred startup choices/intro, name corrections and structured asset/summary helpers. Actual prose-only stages explicitly select plain output. The [coverage inventory](../superpowers/plans/2026-10-31-new-game-generation-schemas.md) distinguishes reachable generation, deterministic helpers and out-of-scope work; this is not a claim that every gameplay prompt has a schema.
See [ThingGenerationSchema](ThingGenerationSchema.md) and the
[implementation plan](../superpowers/plans/2026-10-31-file-xml-generation-schemas.md).

Start and haggle barter pricing explicitly select `barter-prices.schema.xml`.
It declares the prompt's singleton outer fields and sibling `playerItems`,
`merchantItems` and `newStock` wrappers, each with zero or more `item` children.
Nested offer wrappers and invented fields such as `haggleOutcomeNote` are rejected
during generation. Empty `haggleResponse` is valid; scalar value requirements,
conditional refreshed currency, item references and stock bounds remain the
existing barter parser's responsibility. There is no separate TinyBrain barter
family. Marked model-output guard failures use the existing bounded barter
correction conversation; see [PromptRetryPolicy](PromptRetryPolicy.md).

Craft success-degree generation selects `craft-success-degree.schema.xml` for
craft/process/repair/upgrade, `salvage-success-degree.schema.xml` for salvage, and
`harvest-success-degree.schema.xml` for harvest. Shared file fragments describe
the selected result, optional echoed plausibility and abilities. Inheritable
result fields and partial output items may be omitted; explicit empty wrappers
remain meaningful. Item references include the active mod field extensions.
The final merged parser still validates the selected level, time and mode-specific
source IDs/quantities or consumption names before any outcome is applied.
