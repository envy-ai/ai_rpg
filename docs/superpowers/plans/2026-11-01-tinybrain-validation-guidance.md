# TinyBrain optional fields and validation guidance audit

## Scope and acceptance

Audit the 18 families registered in `TinyBrainPromptFamilies.js`, their shared
checkpoint parsers, local result builders and directly reached final validators.
Treat an empty optional scalar XML leaf like omission wherever omission already
has an accepted meaning. Preserve required and conditional fields, meaningful
empty collections/objects, explicit zero/false, malformed populated values,
duplicate checks and existing presentation tolerance. Make correction errors
identify the actual field/problem and a valid repair without weakening rules.

This is an isolated source review and focused mocked verification. It does not
restart a server, load a game, invoke a model or claim every runtime error in the
application was audited. Starting-technique and ability-attachment XML already
have the earlier shared `TechniqueXml` corrections in this source snapshot.

## Implementation sequence

1. Read family templates, shared runner/parser/builder documentation and actual
   checkpoint/final contracts; record per-family coverage below.
2. Fix optional scalar normalization at its shared parser boundary. Preserve
   nested structures and enforce conditional selectors after normalization.
3. Replace misleading combined field errors with exact path/problem/repair
   guidance. Keep the original semantic contract and retry ownership.
4. Review API, event and item-generation final parsing reached by these families.
5. Run syntax checks, targeted mocked parser/runner regressions and independent
   audit; document coverage and limitations. Existing staged-file SHA256 values
   are captured before editing in `tmp/edit-baselines-source.json`.

## Findings and decisions

- Container check selectors and WYWA need values permit omission but rejected
  empty leaves. Normalize these through the existing missing-value meaning.
- Resolution-plan XML has the same discrepancy for unused selectors and other
  optional scalar schema fields. Apply omission rules to empty scalar leaves,
  with duplicate/structure checks retained before normalization.
- Thing generation omits count as one and relative level as null; empty leaves
  previously rejected count or converted relative level to zero. Align with
  omission, preserving explicit zero and existing nonempty numeric handling.
- Shared hidden-discovery XML defaults a blank optional hiddenFromPlayer leaf
  to false. Explicit true still requires a valid discoveryDifficulty; visible
  targets still reject a populated difficulty. Nested empty content stays invalid.
- Offscreen scheduled events accept blank optional proseForPlayer leaves as
  omission; player-present events still require actual prose and populated
  offscreen prose still fails.
- Faction worksheet field errors incorrectly describe optional collections as
  required and hide the actual missing/duplicate/unexpected field. Split these
  diagnostics and provide an element path and specific repair.
- An empty WYWA travelDestination is an object, rather than an optional scalar.
  Keep its existing structured destination contract; arrival checkpoints still
  require literal HERE. No no-value object semantics are invented.

## Family coverage

The following are the reviewed family boundaries, rather than a claim that all
errors in every downstream class were audited. Parser names without a module
prefix refer to `TinyBrainPromptParsers.js`; local builder names refer to
`TinyBrainResultBuilders.js`. All routed templates were inspected. Prose audit
users share `revision_decision`: false accepts omitted/blank issues, while true
requires actual issues. Required prose remains nonblank and rejects N/A; the
WYWA optional-prose sentinel remains its explicit no-prose contract.

| Registered family | Actual parsers/builders/final boundaries and rules reviewed |
| --- | --- |
| `player_action` | `PlayerActionResolutionPlan.parsePlayerActionResolutionPlan/parseValue` (optional selectors/scalars, required actor/intent/type/conditional appliesOn, modifier zero and nonempty targets); compact destination/movement/vehicle/duration/prose/hidden checkpoint contracts; `PlayerActionTinyBrainResult` normalization/building; API `parsePlayerActionProseFromXml`, structured destinations and time parser. Vehicle/location and hidden notes already normalize absent optional text; required durations and movement constraints stay enforced. Technique entries delegate to the earlier shared technique parser work. |
| `event_checks` | `Events.parseTinyBrainEventXmlStage`, `_requireTinyBrainXmlEventFields`, `_mapXmlEventNodeToLegacyRaw`, `_parseXmlEventCheckResponse`; required nested fields and final combat/quest signals, done sentinel, section allowlists, signatures and shared raw mapping. Optional vehicleType, status level, quest giver/status reason, removed-tracker newValue already give omission/blank the same value. Required field errors now show the nested path and repair; existing camel/snake/flat-case and unknown-tag handling remain unchanged. This is the XML boundary audit, not every event application branch. |
| `need_bar_event_checks` | Final-stage `parseNeedBarCharactersResult` plus `Events._parseNeedBarPromptResponse` handoff. Empty character root is valid; a listed affected character requires a real bar with ID/direction/change/reason. Aliases and direction/magnitude pairing remain enforced. There are no optional scalar gaps in the strict generated affected-bar block. |
| `quest_reward_prose` | `exact_xml_root('rewardPlan')` (root boundary only), required prose/revision, `buildQuestRewardResult`, `parseQuestRewardResult`. Engine builds indexed exact reward rows; count, unique indices and exact included rewards stay required. The planning root parser does not validate each presentation as a semantic reward proof. |
| `game_intro` | Required prose/revision, `buildGameIntroResult`, `parseGameIntroResult` and game-intro API integration. introProse remains required; no optional scalar fields. |
| `random_event` | `parseNarrativeScope`, required prose/revision; `buildTurnResultFromApprovedProse` for no travel, `parseTurnNarrativeResult` for generated travel, API prose/destination/time parsing. Optional before/during/after already accept empty/omitted text; travel choice and player-facing travel prose remain required. |
| `creative_mode_action` | Same narrative-scope/prose/builder/final travel boundaries as random_event. Existing authoritative creative-action semantics are unchanged. |
| `npc_action` | Required prose/revision, `buildTurnResultFromApprovedProse`, `parseTurnNarrativeResult({allowTravel:false})`, API prose parsing. No optional scalar gap; no invented empty narration. |
| `craft_player_action` | Required prose, conditional other-effect prose, time reasoning, `buildCraftResult`, `parseCraftNarrativeResult`; API canonical duration handling. No-effect description already optional/blank-safe; actual requested other effect and authoritative elapsed duration stay required. |
| `location_modify_player_action` | Same prose/time stages, `buildLocationModificationResult`, `parseLocationModificationNarrativeResult` and API result consumption. Optional otherEffectDescription already allows omission/blank; builder emits its established N/A when absent. |
| `location_things_generation` | `LocationThingGenerationPlan` roster/document/rarity/approved-name validators; server `parseThingsXml`, `validateParsedThingCandidateBatch`, location `parseAndValidateThings/prepareLocationThingEntries`. Blank count/relativeLevel and shared hidden flag fixed. Registered scalar blank/N/A skips, explicit numeric/boolean values, empty structured collections, optional collection children and cause-effect text normalization already work. Roster entries still require name/kind/rarity/description; count/rarity and whole-Thing business checks are unchanged. Existing permissive numeric/field behavior was not tightened. |
| `starting_techniques` | `StartingTechniques.parseStartingTechniquePlan/parseStartingTechniques` and staged cumulative preparation registration; scalar optional actor ID and technique ID already accept blank where omitted IDs are allowed. Candidate mechanics/discipline/recipe errors remain covered by the previous `TechniqueXml`/`Technique`/attachment audit already present in this snapshot. No new mechanics changes in this audit. |
| `faction_housekeeping` | `FactionHousekeepingPrompt.parseFactionHousekeepingSection`, `parseFactionHousekeepingProposal`, final builder reparse; `requireFields/requireText/requireList`. Omitted/empty entries/references/newFactions/factionPlans lists already equivalent. Supplied plan/entry objects retain required fields and next steps. Structural and faction-reference diagnostics now identify the exact path/problem and valid repair, without calling optional lists mandatory. |
| `player_action_open_container` | `parseContainerOpenCheckPlan`, required prose/revision, yes/no permanence, required time/duration; `buildContainerOpenResult`, `parseContainerOpenNarrativeResult`, API `parseContainerOpenResultXml`. Blank unused selector leaves now equal omitted N/A. Each actor still needs skill or attribute; reason/opponent/difficulty, success/false, one authoritative check and failure/permanent-open constraints stay strict. |
| `scene_summarize` | `parseSceneSummaryBoundaries`, `parseSceneSummaryEntry`, `buildSceneSummaryResult`; existing details omission/blank becomes an empty list, while supplied quote objects require character/text. Unique ascending in-range boundaries and assigned start indices stay required; terminal marker is engine-owned. |
| `while_you_were_away` | Character/arrival update validators, allowlisted name selection, exact moves root, optional/required prose, `buildWhileYouWereAwayResult`, `parseWhileYouWereAwayStagedResult`, API `parseWhileYouWereAwayResponse` and destination/need-value consumption. Blank need value now equals omitted/N/A no-op including canonical comparison. Empty update/move/need-change collections stay valid; populated entries, names, updates and arrival HERE stay required. Supplied travelDestination objects still require their existing meaningful structure. Staged mismatch diagnostics now name the differing XML path and restore repair. |
| `scheduled_event_resolution` | Applicability, tool-plan/argument, summary and prose parsers, `buildScheduledEventResult`, `parseScheduledEventStagedResult`, `scheduled_event_runtime.parseScheduledEventResultXml`/deterministic call conversion. Direct-update/tool lists already accept omission/empty; required object/field/value and name/arguments remain meaningful. Explicit JSON zero/false/empty object/list values are retained. Existing JSON tool payload protocol is unchanged; no prompt was converted or introduced. Summary/applicability remain required on their branches; offscreen blank proseForPlayer leaves now equal omission, while player-present prose remains required. |
| `scheduled_event_interruption_rewrite` | Required prose/revision, `buildScheduledEventInterruptionResult`, `parseScheduledEventInterruptionRewrite`, API final reparse. Non-prose canonical equality remains authoritative; optional hidden/time/vehicle data cannot be erased or invented. Builder only replaces player-facing prose on its supported turnResult input. Rejected non-prose changes name the differing XML path and request restoration. |

## Shared control flow and boundaries

`TinyBrainPromptRunner` parser registration, completion-step parsing, post-parse
ordering, retry instruction construction and checkpoint assignment were reviewed.
Rejected XML remains in the correction conversation with the precise parser
error; accepted assignments are installed only after parsing/post-parse succeeds.
No new broad warning, retry budget, fallback or mutation behavior was added.
`llmresult` local builders do not invoke a final-model finalParser: reviewed
builders consume accepted values and ordinary consumers retain their downstream
parsing. No guarantee is claimed that unused finalParser callbacks run.

Shared builders preserve required approved prose, explicit revision false, fixed
mechanics, XML escaping/CDATA, expected rosters and accepted update blocks.
Empty optional text already stays optional there. `TinyBrainXmlResponse` strict
envelope selection and the existing XML retry helper are unchanged; malformed
final envelopes and existing repeated/unclosed-response feedback remain owned by
those components. Prose semantics and arbitrary mod-owned validators are outside
this parser-boundary audit, as are unrelated runtime infrastructure errors.

## Verification

All six changed JavaScript modules pass `node --check`: shared checkpoint
parsers, resolution plans, faction worksheets, event XML, shared hidden metadata
and server Thing parsing. A standalone documentation inventory check confirms
one explicit row for each of the 18 router keys. New audit links resolve; the
isolated copy intentionally lacks some pre-existing compact/ideas link targets.

The test agent ran the final focused nine-file batch under the required transient
16 GB/no-swap scope: **95/95 passed**. The evidence is in
`tmp/tinybrain-validation-stage-20261101T021154Z/tmp/tinybrain-validation-tests.log`. Changed production and test JavaScript files also passed syntax checks. Cases cover blank selectors and WYWA values, retained zero/false,
required/nested/duplicate rejection, Thing count/relative-level defaults, hidden
metadata conditions, scheduled-event optional offscreen prose, and pathful
faction correction feedback retaining rejected XML without accepting a failed
checkpoint. The final run also revalidated the diagnostic-only invariant
feedback edits and added staged location-Thing generation and TinyBrain event
XML integration (34 additional passing cases).

Static independent review found no blockers in scalar normalization, conditional
requirements, collection preservation or diagnostic changes. The source audit
performs no live model or game execution. Mocked checks do not establish a
successful new live game.

The coordinator applied the staged changes after the successful ability-validation live run ended, verifying each original file against its recorded pre-edit hash and each copied file against the tested staged content. All ten applied JavaScript production/test files passed syntax checks. `tmp/tinybrain-validation-integration-receipt.json` records the applied hashes and evidence. A subsequent authorized restart activated these broader changes for `new-game-schema-test-7`. That run failed on attachment discipline references and conflicting new-discipline fields; see the [ability validation follow-up](2026-10-31-ability-attachment-validation-guidance.md#follow-up-run-with-tooltip-and-broader-tinybrain-changes). It does not establish a successful full-game pass for these changes.
