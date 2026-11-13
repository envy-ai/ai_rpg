# TechniqueSelectionContext

`TechniqueSelectionContext.js` separates concise character repertoire lists from
selected authoritative mechanics. It does not execute, learn or improve a
technique, allocate IDs, pay costs or change world state.

The base context uses `TechniqueService.getTechniqueSummaries(actors)`, a
lightweight projection over the same learned/equipped/status identity union as
`getAvailable`. Each player, local NPC and party block renders its own
`<techniques>` Markdown list, for example `* Mana Bolt - Fires a damaging bolt of mana`.
Names and summaries are XML-escaped and newlines normalized for one list row.
When a row's canonical name matches multiple techniques owned/granted to that
actor through case-insensitive, trimmed names or aliases, only that ambiguous
row adds its canonical ID: `* Mana Bolt [technique_2] - Fires a damaging bolt`.
Unambiguous rows keep the existing format; collisions across different actors
do not add IDs. A canonical name matching another technique's alias also counts,
while repeated aliases for the same identity do not. Distinct techniques remain
separate rows, without aliases or full mechanics in the roster. The standalone
event-authoring selection roster uses the same optional IDs.
Missing legacy summaries omit the description, retaining the name and any needed ID; there is no invented or
full-description fallback and no automatic backfill request. Blocked identities
remain listed; availability is explained when details are selected.

## Selection contract

`parseTechniqueSelections(response,{actors})` returns `{value,normalizedResponse}`
from strict child-only XML:

```xml
<techniqueSelections>
  <selection>
    <actor>exact character name, alias or ID</actor>
    <technique>exact technique name, alias or ID</technique>
    <kind>use</kind>
  </selection>
</techniqueSelections>
```

An empty root means no additional detail. Omitted/null/blank `kind` means `use`;
populated values are `use` or `discover`. Unknown fields, attributes, malformed
XML, duplicate selections and non-string kinds reject. Exact canonical IDs win;
names/aliases match case-insensitively. Reserved `player`, `the player` and `you`
resolve only to the current player when present in the supplied actor roster.
Ambiguity reports concrete canonical choices; no record is silently selected.

`use` must identify a currently owned/granted technique, including blocked ones.
Standard lookup and TinyBrain selection guidance direct `use` to that actor's
`<techniques>` entries and shown disambiguating IDs; ability names alone are not
technique references. Unambiguous technique names still work, and strict
canonical-ID and ambiguity validation remains unchanged.
`discover` may identify a public catalogue entry in an accessible discipline, or
an explicitly proposed human-readable new name. An unknown canonical-looking
`technique_...` reference always fails, including discovery. Selection never
establishes acquisition qualification or creates placeholder mechanics.
Accessible disciplines include active owned-ability status grants through the
same service projection used by actual learning/prerequisite validation. Their
access disappears on removal/expiry; selection creates no permanent access grant.

## Selected facts

`renderSelectedTechniqueDetails(selections,{actors,purpose})` returns readable
nested XML, with no JSON leaves. It includes only selected technique definitions
and their actual actor sources: pinned revisions, full description, mechanics,
resolved normal/failure costs, source choices, availability and blockers.
Shared formula-variable schema is emitted once; each actor retains current values.
Weapon/charge/utility choices appear only when selected mechanics need them.
Discovery or `purpose: 'authoring'` additionally supplies actual qualification,
active resources, accessible discipline/catalogue identities, applicable recipe
choices and saved improvement/evidence facts. Shared recipe policy and utility
catalogues are emitted once across selected actors. Sibling techniques' full
definitions and mechanics are excluded.

Every lookup rebuilds current facts. Later requested snapshots explicitly
supersede earlier facts for that actor/technique; results are not cached across
resource/source changes. The existing executor still revalidates exact mechanics,
sources, targets, costs and current state before committing.

## Callers

- Standard prose uses the read-only native `getTechniqueDetails({actor,technique,kind?})`
  in its existing tool conversation before `useTechnique` or novel authoring.
  Existing native permissions, budgets and execution restrictions remain intact.
- Main TinyBrain actions add one no-tools `technique_selection` checkpoint before
  each existing initial/draft/revision resolution-plan checkpoint: up to three
  selections, only where those plans already run. Server post-parse hooks retain
  the selected XML as authoritative user messages before planning. Main selection
  resolves the fresh local roster, including actors reached/created by prior
  committed mechanics. The twelve TinyBrain native lookup names are unchanged.
- TinyBrain events select authoring references only before a stage whose allowed
  tags include `techniqueChange`. Transit, tracker-only and excluded categories
  skip it. Standard XML and legacy grouped events run one preparatory selection
  when authoring is eligible, not one per category; legacy facts go only to the
  technique-change group. These selections concern completed learning,
  improvement or evidence and never re-resolve committed casts.
- Event rosters come from the supplied base context, including its origin or
  section location override. They do not switch silently to the player's later
  destination. `requestTechniqueAuthoringDetails` uses the existing bounded parse
  retries, event profile and `LLMClient.logPrompt` for every attempt. TinyBrain
  selection questions, parser errors and injected facts use the native run log.

Starting repertoire generation and standalone NPC intent preparation retain their targeted self-contained authoring contexts. Ability attachments use the separate catalogue-only lookup below; they do not apply scene use/discover eligibility.
No prompt count or output cap is introduced beyond the explicit selection phases;
there is no actor/technique/source truncation or save-format change.

## Ability catalogue lookup

`renderTechniqueCatalogueOutline({definitions?,disciplines?})` groups every definition by its canonical parent using ID, quoted name and stored short description only. Whitespace is normalized to one row; missing legacy summaries render ID/name alone. Missing canonical parents fail explicitly. No definition count is capped and full descriptions are not substituted.

`parseCatalogueTechniqueSelections(response,{definitions?})` accepts one strict `<techniqueSelections>` root with repeated scalar `<techniqueId>` children, or an empty root. It returns `{value: ids, normalizedResponse}` and rejects unknown/duplicate IDs, attributes and extra fields. Actor and discipline identities are already known and are not requested.

`renderSelectedCatalogueTechniqueDetails(ids,{definitions?})` renders only selected definitions through the native `compactTechniqueCatalogue` projection and existing nested XML renderer. Details contain the latest canonical mechanics and exclude historical revisions, artwork, provenance and managed policy snapshots. The optional definitions snapshot lets callers pin exactly the revisions supplied to the model.

Ability attachment lookup accepts catalogue identities independently of current ownership/discipline access because an ability status may grant source-bound access. Selection supplies facts without granting, executing or modifying anything. The ability authoring layer owns selected-grant and captured-revision validation; ordinary manual DTOs retain the native domain contract. See [AbilityAttachmentAuthoring](AbilityAttachmentAuthoring.md).
