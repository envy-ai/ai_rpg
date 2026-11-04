# New-game generation schema coverage

Scope: ordinary `/api/new-game`, conditional canonical helpers it reaches, and deferred startup ability choices/intro. Reviewed setup reuses those helpers; unrelated Stories authoring is outside this change. Existing final parsers, retry/cancellation budgets and atomic application remain authoritative. No model, service, deployment or configuration actions belong to implementation verification.

## Approach and acceptance

1. Trace the route and nested generators; classify actual model output as structured XML, plain text or native tool calls.
2. Store layouts under `schemas/xml/`, with named reusable mechanics and mod fragments. Attach schemas explicitly at shared production callsites and select each TinyBrain checkpoint's actual shape.
3. Add only reusable grammar needed by existing parsers: scalar-or-object text containers and alternative document roots when genuinely accepted. Keep conditional mechanic/ID/reference/count constraints in domain validators.
4. Extract the typed ability-attachment XML codec for starting-technique candidates and disciplines. Migrate those model responses from escaped JSON to nested XML; keep HTTP/save/domain DTO JSON unchanged. A new discipline remains the candidate's sibling.
5. Verify parser-valid examples, empty/omitted optional collections, enabled mod fields, default/conditional paths, TinyBrain checkpoints and plain scope isolation. Review a coverage inventory independently before deployment.

Acceptance: each reachable structured response has a named file; each reachable plain response explicitly bypasses XML guarding; schema requiredness never excludes a response the existing parser intentionally accepts. Structural constraints supplement rather than replace value/domain validation. Native tool responses retain their own contracts.

## Actual Luminex settings snapshot

`tmp/new-game-schema-settings.json` records the reviewed form/current setting. Form: Exis, Human Android Engineer, level 3, 31 named skills, custom seven attributes, month 5/day 1/09:00. Active Luminex setting has a calendar and hide/perception selections, seven requested factions and no preconfigured factions. Thus calendar generation/hide-perception backfill are conditional coverage, while skill detail, faction generation, region/entrance expansion, character setup and level-3 startup choices are relevant. Configurable population/content counts and enabled mods determine nested calls; no fixed model-call count is assumed.

## Implemented coverage inventory

| Reachable family/helper | Output contract | Planned named schema or handling |
| --- | --- | --- |
| Calendar generation | `calendarDefinition` months/weekdays/seasons/holidays | `calendar-definition.schema.xml` |
| Existing calendar season image descriptions | `seasonImageDescriptions` and seasonal entries | `season-image-descriptions.schema.xml` |
| Setting hide/perception preparation where missing | `settingMechanics` | `setting-mechanics.schema.xml` |
| Skill details by name / shared skill generation | `skills/skill` | `skills.schema.xml` |
| Faction creation | `factions/faction` organization fields | `factions.schema.xml` |
| Whole-roster sparse directed relationships | `factionRelationships` | `faction-relationships.schema.xml` |
| Faction reputation (shared generator branch) | `factionReputationTiers` standing fields | `faction-reputation.schema.xml` |
| Initial player faction standing | `initialFactionStandings` | `initial-faction-standings.schema.xml` |
| Region full/stub blueprint, weather, locations/exits/vehicles/secrets | `region` | `region.schema.xml`, reusable regional fragments |
| Region entrance selection | `entrance` | `region-entrance.schema.xml` |
| Region/location name collision or banned-name replacement | `locationNames` / `regionNames` | `location-names.schema.xml` / `region-names.schema.xml` |
| Region important NPCs / location residents/hostiles | `response` with NPC/hostile profiles, memories and replacements | `npc-generation.schema.xml`, shared `npc`/`hostile`/replacement files and file-backed player mod fields |
| NPC attribute priorities / initial skill allocation | `npcs/npc` attribute/skill entries | `npc-progression.schema.xml` |
| NPC abilities / initial player abilities | `npcs/npc/abilities` | `npc-abilities.schema.xml` |
| NPC aliases | `npcs/npc` aliases | `npc-aliases.schema.xml` |
| NPC/player equipment selection after inventory | `items/item/itemName,slotName` | `equip-best.schema.xml`; empty/incomplete selections retain existing parser behavior |
| Context memory chooser when recall limit is smaller than generated memories | `memoriesToRecall/npc` | `memories-to-recall.schema.xml`; default three generated memories are below default recall limit |
| NPC/player inventory | `items/item` | existing `items.schema.xml` + existing item mod fragments |
| Full entrance location detail | `location` | `location.schema.xml` |
| Location thing planning / expansion | `thingsPlan` / `things` | existing per-stage named schemas; preserve isolation |
| Region/existing-exit suggestions, travel times and stubs if invoked | actual helper-specific XML | separately named exit/travel schemas |
| Player/NPC starting techniques, standard | `startingTechniques/actor/techniques/technique` | `starting-techniques.schema.xml`, shared typed nested XML mechanics |
| Starting techniques, TinyBrain roster / expansion | `startingTechniquePlan` / `technique` | `starting-technique-plan.schema.xml` / `starting-technique.schema.xml` |
| Ability attachments, owned and pending | `abilityAttachments/statusEffects/statusEffect/techniqueEntries` | `ability-attachments.schema.xml`, candidate + sibling candidateDiscipline refs |
| Pending player option generation, including deferred levels | One-player `npcs/npc/abilities` envelope | dedicated `player-ability-options.schema.xml` (2026-11-01 follow-up); attachment schemas for each offered ability |
| Arrival hidden-world discovery if configured | no generation: prebuilt plausibility resolved locally | no schema or model call; visibility/reference validation retained |
| Intro standard / TinyBrain plan, draft, audits and revisions | `gameIntro/introProse` standard; TinyBrain prose + `revisionDecision` | `game-intro.schema.xml`, `revision-decision.schema.xml`, explicit plain staged planning/drafts; `edited-text.schema.xml` for optional cleanup |
| Autoqueued character/location/item/ability/faction/technique asset text | single image prompt text / `imagePrompts` batch | explicit plain for single text; `image-prompts.schema.xml` for batch; GPU work unchanged |
| Missing short-description helpers | typed batch XML summaries | six `short-description-*.schema.xml` layouts |
| Native tool calls | provider-native tool envelopes | existing native-tool validation; no XML schema attached to tool arguments |

Each listed model-generating family is attached explicitly at its production request seam. Conditional branches remain covered even when Luminex does not execute them. Region/location profiles use response envelopes, while nested ability/attribute/allocation/alias followups have their own layouts. Hostile profiles are schema refs within the shared NPC response, not a separate model request.

Actual production expected-root constraints already select the root for world helpers; no speculative alternative-root compiler grammar was needed. Region field-name aliases remain optional and are resolved by domain validators. Arrival-location selection for entry into an already-existing region is not reached by ordinary new-game creation and is excluded. Standalone region-secrets generation is invoked from later chat/movement, not new-game; its named file is used as a region fragment. Likewise unrelated Stories setup and later gameplay generation remain outside this inventory.

## Material boundaries

- Ability amounts accept scalar numbers or nested formula/binding objects. Both must remain legal.
- Optional candidate/technique references, new-discipline siblings and healing-vs-custom mechanics have domain-conditional rules. Do not force all alternatives as required.
- Registered player/item fields must come from inspectable mod schema fragments, never a JavaScript-generated field layout or unrestricted wildcard.
- Starting-technique candidates/disciplines now use shared typed nested XML through TechniqueXml, including both standard and staged responses. Save/domain DTO formats remain unchanged.
- Existing parsers may extract XML after commentary or accept alternate envelopes; schemas must preserve those supported forms. Plain output is not converted into a fabricated XML envelope.
- No live restart or test game is performed by the coding agent. Root/lifecycle owner coordinates those explicitly authorized steps after source/test readiness.

## Verification and deployment boundary

Production JavaScript syntax checks pass for the eight changed modules. Focused mechanics, parser-backed schema, rich-text, transport, shared audit/new-game ownership and staged integration checks passed; the combined run retained 107 passing cases, and the stale extracted-route fixture was corrected and its three affected cases passed. All current named files compile with the real compiler, including registered fragment inputs. Tests used mocks/fixtures under 16 GiB with no swap, without real model/service controls.

The coding agent performed no configuration changes, model calls or restarts. Root/lifecycle owner handles the authorized server+LLM restart and real new-game acceptance. Compact XML audit output from that run is the evidence for which conditional dispatches actually executed; source/fixture coverage includes branches the live run may skip. Final domain/value validators, count/reference checks, cancellation and correction caps remain in force.

## Live-run inventory correction

The first real run exposed `equip_best`, reached after NPC inventories, as an omitted schema attachment. It now selects a dedicated equipment-assignment layout, not the item-generation layout. The post-inventory tails were traced through equipment, local quantity cloning, attachment/technique authoring, starting-health restoration and shared asset generation. A smaller configured memory recall limit can also dispatch the shared context memory chooser, now named explicitly. The initial live failure is retained as acceptance evidence and is not counted as a successful end-to-end run.

Guard correction detail logs now pass their serialized diagnostic through the supported `writeLogFile.payload` field; the unsupported `sections` argument had created empty detailed files. Compact audit selection records were already independent of that detail-log bug.

Post-inventory audit also checked the standalone `StatusEffect.generateFromDescriptions` route. Ordinary generated inventory/item commits use `Thing.fromJSON`, which sets `enrichStatusEffects:false`; equip applies existing item mechanics and does not call this generator. Altered-item enrichment and later status mutations are separate gameplay paths, not an omitted setup dispatch. Generated NPC/player abilities use the covered attachment generator. The shared base-context builder's only deferred model helper is the conditional memory chooser covered above.

## Live acceptance result

On 2026-10-31, request `new-game-schema-test-3` returned HTTP 200 after 18 minutes 38 seconds using the captured latest saved form `2026-10-24T21-14-01-832Z_Exis-lvl-3-2026-10-24` and its active Luminex world snapshot. It created Exis, level 3 Human Android Engineer, in Gate Plaza Exterior within Spire-Root Market District. Starting ability choices remain pending; the intro is correctly deferred until those choices are made. No ability choices were invented by the test.

This was a successful game-creation request with two optional generation failures, not a clean generation run:

- Location item/scenery planning overgenerated and exhausted the seven EOS-continuation limit. The planning schema matched its actual checkpoint. Observed continuation input-token increases equaled previous output tokens, with no duplicated-prefix evidence. That family committed no location Things.
- Exis received five inventory items, but automatic equipment selection failed after attempting extraneous XML once its allowed document was complete. The character's gear slots remain empty.

The finalized audit records 118 named-schema transport dispatches, 30 selected structural corrections and two guard rejections/failures, with zero generic guard dispatch rows. Other recovered domain-validation retries remain separately visible. Evidence: [compact audit](../../../logs/2026-10-31T21-57-04-484Z_turn_prompt_errors_543a014b-0b4d-4b90-a88c-23bc0a91b18c.log), [HTTP receipt](../../../tmp/new-game-schema-live-2026-10-31T21-57-04-419Z/receipt.json), and [full HTTP response](../../../tmp/new-game-schema-live-2026-10-31T21-57-04-419Z/response.json). Conditional branches not exercised by this setting retain the parser-backed/mock coverage described above. Services remained running for the user; no save was automatically loaded.
