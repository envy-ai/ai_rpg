# FactionHousekeepingPrompt

The standard prompt and TinyBrain program return a compact list of proposed new faction concepts and short faction plans/current next steps. TinyBrain uses nine private reasoning questions followed by one final synthesis. `FactionHousekeepingPrompt.js` remains a pure XML contract helper; [FactionHousekeepingService](FactionHousekeepingService.md) runs the automatic prompt, fully authors proposed factions, atomically installs them, and saves the plans for shared base context. This is separate from existing quest/tracker/relationship housekeeping. It does not execute offscreen faction activities or narrate a game turn.

Worksheet and proposal parsing collect up to ten actual independent field, list, record and reference errors through [ResponseValidation](ResponseValidation.md). Required/duplicate/unexpected fields and invalid text can be reported together. Reference checks require readable declarations, and missing-plan coverage is deferred when the plans container itself is ambiguous. Rejected partial proposals never leave the parser; malformed XML and invalid roots still fail before field validation.

The canonical design is the [Mermaid source](../ideas/faction_housekeeping_flow.mmd), [offline HTML chart](../ideas/faction_housekeeping_flow.html), and [SVG chart](../ideas/faction_housekeeping_flow.svg).

## Editable templates and rendering

Render `prompts/faction-housekeeping.xml.njk` with a Nunjucks environment configured with `throwOnUndefined: true`. Set `factionHousekeepingTinyBrain: false` for the standard prompt. Shared context, policy, numbered questions, standard worksheet, and TinyBrain program live in `prompts/_includes/faction-housekeeping*.njk`.

Supply `factionHousekeeping` explicitly; no live-world getters or implicit context collectors run:

| Field | Shape and meaning |
| --- | --- |
| `intendedTone`, `currentSituation` | Required text describing intended tone and current situation; no tonal evaluation score is required. |
| `objectives`, `threads`, `factions` | Arrays of `{ id, description }` with existing IDs. Faction descriptions should include organizational stakes, means, local presence, and relevant recorded roles. |
| `pendingDevelopments` | Array of `{ reference, threadId, commitment, exposure, description }`. `commitment` is `committed` or `tentative`; `exposure` is `public` or `pending`. Include unseen help and threats. |
| `publicPassages` | Array of `{ reference, text }` pointing to actual stored passages delivered to the player. These alone can substantiate meaningful public context. |
| `deadlines` | Array of `{ reference, threadId, description, publicPassageReferences }`, with a nested list of supplied passage references proving communication. An empty list means no supplied communication evidence. |
| `knownFacts` | Array of `{ reference, visibility, description }`; visibility is `public` or `private`. Private continuity may be revealed prospectively, but does not prove player exposure. |

All arrays are required and may be empty. The renderer escapes every supplied text value. These are authoring inputs rather than the saved plan schema. The service collects current organizations/objectives/trackers, recorded private continuity, saved tentative plans and scheduled commitments, settled current-turn outcomes, and actual public story passages. Public prose includes named NPC roles. Shared diagnostic/hidden filters and hidden-note stripping keep private text separate from public evidence. An empty deadlines list supplies no pre-verified exception; the worksheet may still cite an actual public passage for a deadline that remains active in current facts/status. Source meaning and awareness judgments remain qualitative.

Runtime historical evidence is bounded to whole review turns and exact older references needed by saved plans/current facts; the service labels deferred history and current supplements. Missing passages prove neither awareness nor absence of prior communication. Preserve exact supplied public-passage IDs in `awarenessConstraints` while exposure or communicated-deadline conditions remain relevant, so later reviews can retrieve their sources. Inline hidden blocks remain private facts, and ordinary public prose is supplied once with references from the current situation. See the [service history projection](FactionHousekeepingService.md#context-and-generation) for selection, budget, and cursor rules shared by standard and TinyBrain generation.

## Private reasoning and final output

Both modes consider the same nine reasoning steps. Standard mode considers them internally; TinyBrain requests one private XML worksheet section per checkpoint:

1. `pendingDevelopments`: inspect commitments and tentative proposals first.
2. `awareness`: assess each thread's material development and meaningful public context.
3. `factionInvolvement`: identify evidence of organizational intersection with current objectives.
4. `roles`: characterize contextual, potentially overlapping roles.
5. `supportAssessment`: judge future support, opposition, both, or neither.
6. `existingFactionFit`: consider existing factions' stake, means, and local presence first.
7. `newFactionProposals`: propose a draft faction only for an unmet role.
8. `futureActivities`: describe prospective attempts, target, place, timing/conditions, introduction, and awareness constraint.
9. `continuityCheck`: identify revisions or withholding required before any future application.

Each private TinyBrain section has this lightweight structure, with repeated entries only where useful:

```xml
<awareness>
  <assessment>The latest material change still needs meaningful public context.</assessment>
  <entries>
    <entry>
      <references><reference>thread_1</reference><reference>development_1</reference></references>
      <finding>The committed development has no supplied public passage.</finding>
      <recommendation>Introduce its visible effects before another discretionary development on this thread.</recommendation>
    </entry>
  </entries>
</awareness>
```

`assessment`, `finding`, and `recommendation` are nonblank text-only fields. `references` contains zero or more nonblank text-only `reference` elements and may be omitted when empty. `entries` may be empty or omitted, with the required assessment explaining why. These sections are private reasoning and are never concatenated into the final result.

After the continuity check, a final synthesis consolidates revisions and withholds invalid, redundant, or unsupported ideas. Standard mode returns only this same compact final schema:

```xml
<factionHousekeepingProposal>
  <newFactions>
    <faction>
      <localRef>draft:river-patrons</localRef>
      <name>River Patrons</name>
      <concept>Local ferrymen fund a crossing to protect trade; their barges fill the otherwise unmet access role.</concept>
    </faction>
  </newFactions>
  <factionPlans>
    <factionPlan>
      <factionRef>draft:river-patrons</factionRef>
      <role>Potential ally for objective_1.</role>
      <plan>Offer a voluntary crossing at the river when the party approaches.</plan>
      <nextSteps><step>Introduce a public ferry service naturally if the party seeks another route.</step></nextSteps>
      <awarenessConstraints>Introduce thread_1 meaningfully before further discretionary developments; no publicly communicated deadline supports an exception.</awarenessConstraints>
    </factionPlan>
  </factionPlans>
</factionHousekeepingProposal>
```

Both lists may be empty or omitted; the factionHousekeepingProposal root remains required. `newFactions/faction` contains only `localRef`, `name`, and a brief reusable `concept` covering the unmet role, organizational stake, means, and plausible local presence. These are potential creation inputs, **not applied faction records** or full Faction CRUD data. A local reference uses `draft:` followed by letters/digits/hyphens/underscores, starting with a letter or digit, and allocates no persistent ID.

`factionPlans/factionPlan` contains `factionRef`, `role`, `plan`, `nextSteps` (one or more text-only `step` elements), and `awarenessConstraints`. Include only existing or proposed factions with relevant specific plans/current next steps, rather than a roster of every organization. Combine each faction's relevant roles/actions into one brief plan. A justified wait for public context is a valid next step. Plans retain relevant thread/objective references, intended targets, place, conditions/timing, plausible introduction, and specific exposure/deadline constraints where needed. After service commit, actual faction IDs replace draft references and these plans enter shared base context as intended attempts, never accomplished facts or proof of player awareness.

The parser returns a typed `proposal` projection: `{ newFactions: [{ localRef, name, concept }], factionPlans: [{ factionRef, role, plan, nextSteps, awarenessConstraints }] }`. It requires unique draft references, exactly one matching plan for every proposed new faction, unique plan references, and exact existing faction IDs or matching draft references. Unknown references fail. Every text field is nonblank and text-only. Uniquely named fields may arrive in any order; attributes and missing required, unknown, or duplicate fields fail. All nested structure uses XML rather than JSON. Source evidence, prose semantics, and game feasibility still require review; parser acceptance applies nothing.

The policy preserves victories, losses, and agency, avoids compulsive balancing/rescue, and considers unseen committed help/threats before adding equivalents. A member's personal agenda does not automatically establish organizational involvement. Roles may overlap; pure evil remains valid. Existing factions are preferred only when plausible; new ones fill an unmet role. No past plot or unknown mystery may receive a retroactive faction explanation; already recorded private facts remain available for prospective revelation.

Awareness is per thread: material development → meaningful public context → next discretionary development. It requires neither acknowledgment, quest acceptance, nor a comprehension score. Mystery may conceal a cause. Natural consequences may introduce a thread; independent threads proceed independently, without forced messengers or backlog catch-up.

**Deadline rule:** only a deadline already communicated to the player, supported by an actual public-passage reference, may proceed despite pending exposure. A player may ignore that known deadline and face consequences. Hidden internal clocks cannot bypass the gate, including during long travel or sleep. Committed facts remain preserved; tentative proposals may be discarded.

## Pure helpers and staged handoff

- `parseFactionHousekeepingSection(response, sectionName)` validates one section and returns `{ value, normalizedResponse }` for checkpoint-local correction.
- `parseFactionHousekeepingProposal(response, knownFactions = [])` validates the compact standard/final synthesis response and references. Pass existing faction IDs or supplied faction records with `id`; the default empty list permits only matching new-faction draft references. It returns `{ value, normalizedResponse, proposal }`, with XML in `value`/`normalizedResponse` and the typed projection in `proposal`.
- `buildFactionHousekeepingProposal({ checkpointValues, templateContext })` requires nine worksheet answers plus one accepted synthesis record, then revalidates and returns **only** the final synthesis XML against `templateContext.factionHousekeeping.factions`. It does not concatenate reasoning or replace the synthesis model request.

The registered `faction_housekeeping` TinyBrain family uses the same metadata label and effective model-override routing. `ai.tinybrain_prompts.faction_housekeeping` defaults to enabled under the effective master switch; setting it false retains the standard prompt. The service registers `faction_housekeeping_section: parseFactionHousekeepingSection` and `faction_housekeeping_proposal: parseFactionHousekeepingProposal` locally, plus the `faction_housekeeping_proposal` result builder. The tenth `llmparse` passes `factionHousekeeping.factions` to the final parser. All ten boundaries permit local correction; accepted earlier responses remain in the conversation. The synthesis completion resolves continuity revisions rather than repeating or concatenating worksheets.

### Outer wrapper versus staged program

Render and parse `faction-housekeeping.xml.njk` **once** to capture its fixed system prompt and generation prompt. The latter already contains serialized context/guidance, the program-start marker, and the initial program. Pass that extracted generation prompt as the runner's `initialRenderedTemplate`. Rerender only `_includes/faction-housekeeping.tinybrain.njk` after each checkpoint; the runner preserves the fixed prefix itself. Its parser adapter therefore returns the already captured system prompt and treats each input as a bare generation prompt, following the `StartingTechniques` integration pattern:

```js
const outer = parseXMLTemplate(promptEnv.render('faction-housekeeping.xml.njk', templateContext));
const runner = new TinyBrainPromptRunner({
    promptEnv,
    parseXMLTemplate: program => ({
        systemPrompt: outer.systemPrompt,
        generationPrompt: program
    }),
    complete, // Explicit caller-owned completion callback; log every actual attempt.
    retryAttempts,
    toolDefinitions: [],
    metadataLabel: 'faction_housekeeping',
    parsers: {
        faction_housekeeping_section: parseFactionHousekeepingSection,
        faction_housekeeping_proposal: parseFactionHousekeepingProposal
    },
    resultBuilders: {
        faction_housekeeping_proposal: buildFactionHousekeepingProposal
    }
});
const result = await runner.run({
    initialRenderedTemplate: outer.generationPrompt,
    templateContext,
    renderState: templateContext.__tinyBrainState,
    programTemplateName: '_includes/faction-housekeeping.tinybrain.njk'
});
```

Passing the whole wrapper through this bare-program adapter, or using the wrapper as `programTemplateName`, leaves trailing `]]></generationPrompt></template>` after the terminal result marker and fails the runner's terminal contract. The correct path makes ten successful completions, then returns the accepted compact synthesis locally with no additional model call. Parser retries can add attempts within those ten stages.

The [runtime service](FactionHousekeepingService.md) registers during server startup. It uses its own `faction_housekeeping.interval`, defaulting to 11, against the existing positive eligible housekeeping-turn counter, with no offset. Reviews run on eligible turns 11/22 by default; ordinary housekeeping retains its own interval and no extra counter/save schema is added. Standard and TinyBrain attempts use their existing logged correction mechanisms. New factions undergo detached full authoring before atomic commit; successful compact plans replace the complete prior plan list and persist with a separate review boundary. No activity engine, exposure ledger, scheduled mutations, or automatic player-standing changes are added. Parser acceptance alone still applies nothing.

## Verification

The focused contract test checks standard/staged reasoning and synthesis guidance, ten-checkpoint parser wiring, escaped context/public-evidence separation, compact final output/typed projection, matching/unknown/duplicate references, empty final lists, and malformed/invalid section rejection with later valid acceptance. A mocked full-runner case verifies the fixed-wrapper/bare-program handoff completes all ten stages and returns only the compact synthesis without an extra completion. Runtime integration coverage is described in [FactionHousekeepingService](FactionHousekeepingService.md).

```bash
systemd-run --wait --collect --pipe -p MemoryMax=16G -p MemorySwapMax=0 -p "WorkingDirectory=$PWD" node --test tests/faction_housekeeping_prompt.test.js
```

These tests make no model calls and do not change game state. They do not demonstrate model quality, actual retry execution, automatic scheduling, save persistence, or faction activity application.

### Saved-game model preview (2026-10-30)

An isolated process read the latest named Exis save from `2026-10-30T13-41-12-995Z`, at The Central Core Chamber. It supplied seven factions, saved plots/trackers, and 170 public passages, with hidden/offscreen records separated from public evidence. No save was hydrated into the live server and no proposals were applied. The local Strata model produced ten accepted stages in 85.2 seconds, using twelve responses after two XML corrections. Its compact result proposed no new factions and plans for the Iron Root Consortium and Void-Eater Cult.

The standalone harness initially mishandled the outer wrapper at terminal assembly. After correcting the wrapper/program boundary described above, the captured responses were replayed through the full runner without more model calls; final assembly and parsing succeeded. The source-save hashes remained unchanged. A mocked full-runner regression covers the corrected handoff.

Inspection noted that the model used the private 30% homestead-fortification value when describing player awareness. The player can nevertheless know that the homestead is unfortified without knowing its exact percentage; tracker-specific knowledge restrictions were therefore withdrawn for playtesting. The model also chose an offscreen minor raid followed by an aftermath introduction. These are actual model proposals for refinement, not approved world changes. This save has no dedicated faction-activity/exposure ledger, so empty structured pending/deadline inputs do not prove absence of narrative activity.

The full raw responses, context, worksheet, final XML/JSON, input manifest, logs and offline report are retained under `tmp/faction-housekeeping-preview/`. The preview report and final XML were also copied to Zanarkand's Downloads. These ignored artifacts describe the earlier read-only preview; they do not verify the later automatic runtime integration.

Structural correction errors identify the actual element path and distinguish missing, duplicate, empty, unexpected and malformed-list fields. Each gives a valid repair; optional list omission is never described as a missing required field. Unknown/duplicate faction references and missing next steps likewise name the failing field and repair without changing reference or plan requirements.
