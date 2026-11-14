[Base-context system prefixes](config.md#base-context-system-prefix) connect the optional top-level `systemPromptPrefix` to every standard/TinyBrain base-context SYSTEM prompt. Global text precedes the existing explicit/per-prompt prefix, exact duplicates appear once, and generation includes retain local-prefix behavior.

[Player-action travel intent](api/chat.md) uses shared standard/TinyBrain guidance to preserve requested travel to unnamed areas. [TinyBrain movement](classes/TinyBrainPromptRunner.md) judges the original action and authoritative outcomes rather than an incomplete draft; genuine blockages must be explained in final prose, while unrelated failed checks and recoverable companion mishaps alone do not cancel travel. Existing movement, naming and vehicle guards remain in place.

[Sequential prose benchmark](run_prosebench.md) preserves exact raw scenario/system inputs, accepts ordered custom prefix sets through `--variants JSON` while retaining its baseline/critic/author defaults, freezes and verifies runner provenance before inference, and collects one native LLM request at a time, and targets ten correctly formatted finalProse responses per variant within thirty attempts. It keeps rejected raw replies and extraction errors, isolates logs/configuration artifacts, and supports explicit resume without hidden retries or semantic grading.

[Local context progress](classes/LLMClient.md#prompt-progress-and-cancellation) uses llama.cpp and Strata's streamed prompt-processing updates to fill the existing prompt bars in green, then returns to normal response progress when generated output begins. [Chat progress](ui/chat_interface.md) retains a running prompt's response fill through later unknown/zero context transitions until positive measured context progress arrives. Individual bars, aggregate/modal mirrors, favicon and page-feedback labels share this display policy through existing [ProgressMeter](classes/ProgressMeter.md) hosts, while response counts and latency measurements stay separate.

[TinyBrain technique regression coverage](classes/TinyBrainPromptRunner.md#reservation-regression-coverage) checks retained queue ownership during destination expansion and forwarding of the originating stream's client ID.

[Character-card drain warnings](ui/chat_interface.md) show one decimal place and hide amounts that round to zero, preserving the full precision of actual drain effects.

[NeedBarStatusEffects](classes/NeedBarStatusEffects.md) implements optional keyed YAML effects on need levels, with the [approved starter values and implementation plan](superpowers/plans/2026-11-10-need-bar-level-status-effects.md). [Player](classes/Player.md) derives active conditional statuses, preserves exact Health/need percentages when maxima change, keeps spending/recovery in authored units, and settles net ongoing changes consistently across time skips. Base/effective capacities remain separate for level cutoffs, technique profiles, saves and UI; reload/load failures preserve valid prior state. [StatusEffect](classes/StatusEffect.md) and its XML/editor contracts carry percentage rates and need-capacity modifiers. [SkillCheckValue](classes/SkillCheckValue.md) applies existing and new skill modifiers once in ordinary, opposed and attack checks. Native effect cards show conditional lifetime and unavailable target components. Deployment requires a server restart with user approval.

[Managed technique save compatibility](classes/TechniqueBalancePolicy.md#saved-status-schema-compatibility) compares stored and recipe-generated statuses through the same domain normalization, allowing older omitted empty fields to load while preserving saved mechanics, costs and policy snapshots. Genuine recipe mismatches report the specific differing field.

[Complete NPC alteration effects](classes/StatusEffectXml.md) preserve names, mechanics, identities, clocks and pinned grants while keeping derived ability/equipment/mod effects out of intrinsic status snapshots. [`/repair_status_effects`](slashcommands/RepairStatusEffectsCommand.md) uses [base-context repair](classes/StatusEffectRepair.md) in standard batches of ten or one TinyBrain conversation with one effect per checkpoint; it removes proven empty intrinsic duplicates, stages all results, and stores a durable count summary. The [implementation plan](superpowers/plans/2026-11-10-status-effect-repair.md) records the approved scope.

[ItemChargeService](classes/ItemChargeService.md) adds individual persisted discrete ammunition and continuous decimal charge pools, exact selected-source reload/payment, transactional rollback and durable replay. [ItemChargeApi](classes/ItemChargeApi.md) documents reload options and checked inventory drag reload endpoints; [ItemChargePool](classes/ItemChargePool.md) defines shared validation/XML and decimal arithmetic. [ItemChargeEvents](classes/ItemChargeEvents.md) handles reloads, explicit adjustments and authoritative payment receipts in standard and TinyBrain event checks. [Item charge UI](ui/item_charges.md) covers resource details, editing and the accessible reload dialog. Catalogue definitions omit current charge and fresh standard copies use only declared initial amounts.

[ItemReuseService](classes/ItemReuseService.md) resolves canonical standard-item rarity variants before full generation. [ItemBatchGenerationPlan](classes/ItemBatchGenerationPlan.md) chooses compact rosters and expands only unresolved entries for inventory, containers and locations. TinyBrain roster parsing passes retained queue ownership into nested family authoring, including at single-request concurrency; cached reuse retains the same uninterrupted owner. Existing level scaling and placement stay authoritative.

Focused item-family prompts now omit absent optional lore/context fields, validate populated text types, and serialize numeric owner levels explicitly; [strict XML text escaping](classes/nunjucks_filters.md) remains unchanged. Marked host template failures preserve their cause and leave [TinyBrain](classes/TinyBrainPromptRunner.md) or [standard parse retries](classes/PromptRetryPolicy.md) immediately, without asking the model to fix a deterministic render error. See [ItemReuseService](classes/ItemReuseService.md) and [PromptFailureReporter](classes/PromptFailureReporter.md).

[Shared item generation](classes/Thing.md) now reports independent charge, effect, parsed mod-invariant and sibling item errors in one correction round when their prerequisites are valid. [ItemChargePool](classes/ItemChargePool.md) collects independent pool errors; [ModExtensionRegistry](classes/ModExtensionRegistry.md) exposes pure parsed-field validators while retaining complete Thing validation. Shared item prompts and [named schemas](classes/ThingGenerationSchema.md) state numeric charge, duration and module-slot conditions, and fixed-name [item-family authoring](classes/ItemReuseService.md) omits world-wide module-count guidance. Standard and TinyBrain paths share these rules.

[Location Things generation](classes/LocationThingGenerationPlan.md) retains one logical queue owner through standard/TinyBrain roster, nested families, expansion, corrections and naming. When location creation inherits a parent owner, its lazy Things/NPC branches run as complete sequential programs so sibling NPC work cannot slip between item checkpoints; independent unowned creation retains configured parallelism.

[Location NPC generation](classes/LocationNpcGenerationProgram.md) now uses a compact XML roster and one schema-checked TinyBrain checkpoint per NPC when its family switch is enabled. The roster fixes name, kind, quantity and brief durable description; [detached validation](classes/LocationNpcGenerationPlan.md) injects those known fields, validates remaining fields and memories before native creation, and locally assembles the accepted XML. [Shared NPC technique guidance](classes/GeneratedNpcTechniques.md) distinguishes canonical technique IDs from disciplines and skills, shows a nested XML public catalogue or explicitly requires an empty selection, and gives field-specific repair errors. Standard full-batch generation remains available.

[World Profiles](classes/SettingInfo.md) provides optional **Location Item Generation Notes** under Prompt Guidance. [Location Things generation](classes/LocationThingGenerationPlan.md) appends nonblank notes as `Additional instructions:` at the end of standard/TinyBrain roster and expansion prompts; [settings autofill](api/settings.md) preserves existing notes and can fill a blank field. [Playwright](playwright.md) documents deterministic playthrough and vehicle fixture session overrides.

[Managed local LLM status](classes/ManagedLocalLlmController.md) waives Strata's short header-inspection deadline while [native prompt activity](classes/LLMClient.md) is present, including silent completions and staged checkpoints. Idle inspections retain their five-second limit and report contextual timeout errors with the original cause.

[ItemCatalogue](classes/ItemCatalogue.md) remembers item definitions independently of live stacks, including after consumption. Its per-game `itemCatalogue.json` save state initializes from surviving items in older saves, accepting legacy comma-grouped values without changing their original item metadata; saved standard families now support [item reuse](classes/ItemReuseService.md), with recipes remaining a separate later stage.

[ItemCataloguePanel](classes/ItemCataloguePanel.md) adds the read-only Play → Story Tools → Item Catalogue browser, with remembered snapshots, standard rarity variants, recorded/base mechanics and responsive keyboard navigation. [ItemCatalogueApi](classes/ItemCatalogueApi.md) documents its per-game detached read endpoint and no-game boundary.

[Automatic plot analysis](api/chat.md) now schedules after completed normal player-action outcome/history processing and turn finalization, using the final location. Its [configured cadence](config.md#plot-analysis), background execution and stale-result guards remain in place.

[`/quest_check`](slashcommands/QuestCheckCommand.md) stores manual objective/award summaries and generated reward prose in Adventure history, including zero-change results. It reuses native standalone cards and typed reward formatting, with an empty success reply to avoid duplication; [slash-command context](slash_commands.md) documents the returned storage receipts.

[Player arrival WYWA prose](api/chat.md) is stored visibly whenever its accepted result is nonempty, including after TinyBrain destination prose. Existing non-repetition guidance and optional empty/`N/A` omission remain; summary parent links use the actual visible or hidden WYWA entry.

[Level-up ability progress](classes/Player.md) includes the full character name, such as `levelup_abilities_Fizz`, through a [display-only prompt label](classes/LLMClient.md). Existing family routing, logs and statistics keys remain shared.

[Skill-check resolution](api/common.md#actionresolution-resolveactionoutcome) adds
the character's level once when its attribute is omitted, blank or `N/A`,
independently for each opposed participant. Named attributes keep their existing
math; [expanded check details](ui/chat_interface.md) identify the level bonus.

[What changed names](classes/ItemSummaryPresentation.md) are bold across body
text, grouped details, entity chips and exit pills. Items retain their exact
recorded rarity colors; [drawer presentation](classes/TurnStateDiffDrawer.md)
also emphasizes other explicitly named entities without inventory-name guesses
or colored HTML in stored summaries.

[Event-driven hostile party joins](classes/Events.md) reuse the existing hostile-to-friendly transition after membership succeeds. Living hostile [NPC context menus](ui/chat_interface.md) offer **Make not hostile** through a [canonical-ID API action](api/npcs.md), sharing the same disposition/flag update and native refresh/error UI.

[Implant installation](classes/ActorAttachmentSystem.md#automatic-installation-transfer)
automatically moves a current-player carried item into a visible local or party
recipient's inventory when needed. Recipient-owned items take precedence; exact
item identities, installed-state persistence and rollback remain authoritative,
without a separate transfer event or world-wide item lookup.

[Character-view implants](ui/modals_overlays.md) reuse the native equipment
list's icons, rarity styling and full item hover/lightbox behavior. Attachment
status sections explicitly select that presentation and resolve installed item
IDs from the viewed character's inventory; other mod status lists stay unchanged.

[Play header Save](ui/chat_interface.md) stays disabled until a game is loaded,
including in the mobile menu. Loaded-state changes preserve an active save's
busy hold, and delayed completion cannot enable Save after the game is unloaded.

[Shared input contrast](ui/assets_styles.md) gives app text/data inputs,
textareas and selects dark backgrounds and white text, including the quantity
prompt's native number control. The temporary app SCSS override preserves
component geometry, focus/error styling and nontext input roles.

[Inventory modal outside drops](ui/modals_overlays.md) use the visible dialog panel boundary, so releasing an item on its full-screen backdrop invokes the existing current-location drop flow. [Chat inventory behavior](ui/chat_interface.md) preserves native target priority, cancellation and owner/equipment checks.

[Quest party-member rewards](classes/QuestRewardBenefitRegistry.md) also reconcile hostility before any quest disposition bonus and before recording benefit success. [Reward retries](api/quests.md) repeat an unfinished reconciliation even after membership succeeds, while recorded benefits preserve later positive or negative disposition awards.

[Comment chat bubbles](ui/chat_interface.md) render ordinary Markdown while hiding their control `#` and first separator space only in display. [Native message styles](ui/assets_styles.md) give them a subtly different blue-grey background; stored/editable content and comment filtering remain intact.

[TinyBrain event checks](classes/Events.md) append need-bar planning and validated characters stages to the same conversation when both families are enabled. They reuse one base context, log, progress group and queue lease while preserving need-bar model overrides, suppression, section boundaries and application order; standard/mixed paths retain their existing behavior. [Family routing](classes/TinyBrainPromptFamilies.md) and the [failure-owner alias](classes/PromptFailureReporter.md) document the shared lifecycle.

[Shared response validation](classes/ResponseValidation.md) collects up to ten distinct independent problems per rejected response, flattening nested errors and retaining paths, repair guidance and causes. Coverage includes technique XML/mechanics and actor-aware attachment recipes, starting-technique actors/candidates, action-resolution fields/records, initial faction standings, faction worksheets, and selected TinyBrain need-bar/reward/WYWA boundaries. The completion gate collects configured missing tags after valid XML; domain validation follows once those structural prerequisites pass. [Retry feedback](classes/XmlRetryFeedback.md) presents the numbered problems together with strict rejection and existing budgets; dependency-blocked checks and unconverted parsers can still report one issue.

[Discipline-first authoring](superpowers/plans/2026-11-01-discipline-outer-authoring.md) groups technique references/candidates under shared XML parents across attachment, initial, first-use and narrative-learning prompts. Repeated parent IDs or normalized titles append children in encounter order with canonical metadata retained. [TechniqueXml](classes/TechniqueXml.md) translates into unchanged internal DTOs and treats conditional empty parent metadata as omission; [TinyBrain starting techniques](classes/StartingTechniques.md) approve parent metadata once, [native first-use](classes/PlayerTechniqueIntent.md) uses disciplineXml, and [event learning](classes/TechniqueEvents.md) keeps deterministic rename-safe replay. The [live acceptance result](superpowers/plans/2026-11-01-discipline-outer-authoring.md#live-acceptance) records successful startup and the final post-run validation follow-up.

The [TinyBrain validation audit](superpowers/plans/2026-11-01-tinybrain-validation-guidance.md) records all 18 routed families, shared optional-scalar empty/omission fixes, exact field correction guidance, reviewed final boundaries, and verification scope.

[Compact prompt progress](ui/chat_interface.md) now uses the equal-weight mean
of all currently reported logical prompt fractions for one-line/collapsed bars,
modal footer mirrors and the favicon. Unknown fractions contribute zero;
individual running-prompt table rows retain their own progress and controls.

# Docs Table of Contents

[TinyBrain ability attachment batches](classes/AbilityAttachmentAuthoring.md) share one catalogue outline and native runner conversation across owned abilities, independent pending choices and single manual drafts. Per-ability selection/authoring checkpoints preserve exact selected revision pins and retry locally; owned application remains atomic. The [family switch](config.md) retains standard generation when disabled.

[Player technique correction](classes/PlayerTechniqueIntent.md) preserves pending attempt identities when ordinary checks or attacks move or disappear, including known-ability attack shims and distinct repeated attempts. [Resolution-plan feedback](classes/PlayerActionResolutionPlan.md) requests a full corrected plan when nothing executed, and only the unexecuted suffix after completed receipts.

The shared [TinyBrain prose audit](classes/TinyBrainPromptRunner.md) requests one concise XML revision verdict across eleven narrative templates, retaining factual/domain checks while accepting unambiguous descriptive item wording. [Harvest and salvage narration](api/crafting.md#consumption-and-output) uses one finalized recovered-output list with native stack quantities after item-name validation.

[Barter currency](api/npcs.md) applies the configurable `formulas.barter.currency_multiplier` (default `1 + (level / 3)`) once to fresh merchant baseline estimates at initial/daily stock refresh. The NPC's own level is authoritative; existing balances, haggling and transfers are unaffected. [Shared formula validation](utils/barter-currency-formula.md) runs on startup/reload and at the merchant's current level.

[Harvest source preservation](api/crafting.md#consumption-and-output) ignores direct and event-driven selected-source consumption above major failure, with exact-ID protection shared by standard and TinyBrain [event checks](classes/Events.md) and retained for [event replay](classes/EventReprocessor.md). Both craft narration prompts also include harvest-only source-preservation guidance for main and additional-effect prose.

[Craft/process quantity selection](api/crafting.md) reuses the [native quantity dialog](ui/modals_overlays.md#crafting--processing), selects exact stack units without inventory mutation, validates source-ID/quantity XML, and reports preserved selected units. [What changed summaries](ui/chat_interface.md) show `**3x** Item` counts and bullet lists for multi-item results. Updated UI/prompt capabilities preserve the running older backend's contracts until restart.

[Craft success-degree generation](api/crafting.md) uses mode-specific named XML
schemas and bounded fresh-response correction for marked guard failures. Shallow
[partial schema references](classes/XmlGenerationSchema.md) preserve inherited
item fields and active mod layouts; [retry logging](classes/PromptRetryPolicy.md)
retains full rejected output without repeating it in correction prompts.

[Quest item reward summaries](classes/Events.md) also retain generated stack quantities in typed presentation labels while preserving canonical reward names and records.

[Selective technique context](classes/TechniqueSelectionContext.md) lists each
character's techniques as `* Name - shortDescription` within that character's
`<techniques>` block, adding `[technique_id]` only where a canonical name is
ambiguous against that actor's technique names/aliases. Standard read-only lookup
and TinyBrain selection guidance distinguishes ability names from technique
references and uses shown IDs for ambiguous names. Selection phases
provide full authoritative XML only for selected techniques/actors before
mechanics or event authoring. Global technique/authoring JSON dumps are removed;
source pins, blockers, qualification and existing execution receipts remain
authoritative. See the [implementation plan](superpowers/plans/2026-11-06-selective-technique-prompt-context.md).

[Techniques](classes/Technique.md) persist optional concise presentation metadata
and participate in the existing reviewed [load-time short-description backfill](api/game.md#get-apishort-descriptionspending)
and [missing-summary command](slashcommands/ShortDescriptionCheckCommand.md).
Shared authoring/backfill uses the existing 5–10-word guidance. Presentation
updates preserve mechanical fingerprints, revisions and receipt identities;
same-named technique definitions are generated independently.

[LLM transport progress](classes/LLMClient.md#prompt-progress-and-cancellation)
includes nonsilent JSON and token-chunked requests, reporting actual returned
characters without SSE deadlines. Empty or interrupted streams retain streaming
on bounded retries and later requests; only explicit streaming incompatibility
latches adaptive non-stream transport.

Party [memory and numeric disposition reviews](classes/Player.md) advance on
completed gameplay turns and event-driven travel at the configured interval;
direct travel retains its movement-owned scene-change cadence. Applied background
disposition changes [refresh party cards](ui/chat_interface.md) through the existing
party renderer, with original refresh failures shown in the persistent error
dialog. See [configuration](config.md#memory-summaries-and-autosaves)
and [server/LLM notes](server_llm_notes.md).

[Play travel](ui/chat_interface.md) stops direct exit and Map/Favorites movement
after failed or blocked Chat submissions. Ordinary Chat error dialogs preserve
the original server/client diagnostics alongside the shared prompt-failure viewer.

[Chat preflight](api/chat.md) rejects gameplay and travel-comment submissions
with `LOCAL_LLM_OFF` before turn work or game-state changes when the configured
[managed local LLM](classes/ManagedLocalLlmController.md) is manually switched off.
Ordinary non-travel comments remain usable; the guard makes no readiness probe.

[Technique XML](classes/TechniqueXml.md) treats audited optional and conditional empty leaves as omission across [attachment authoring](classes/AbilityAttachmentAuthoring.md), [starting techniques](classes/StartingTechniques.md) and [first-use intent](classes/TechniquePrompt.md). Required mechanics, populated-value validation, duplicate errors, and object/list semantics remain enforced. The [ability attachment validation audit](superpowers/plans/2026-10-31-ability-attachment-validation-guidance.md) covers source-level problem-and-fix feedback for branch choices, mechanics, formulas, recipes and actor-aware catalogue/resource checks without changing accepted mechanics.

[Semantic technique recipes](superpowers/plans/2026-10-31-semantic-technique-recipes.md) let the engine fill known identities and unambiguous selectors. [Healing and optional standard damage](classes/TechniqueBalancePolicy.md) use independent configurable coefficients and saved snapshots; deliberate custom damage remains available. First-use text authoring shares [nested XML](classes/TechniqueXml.md), while native JSON tool protocols remain unchanged.

Named-schema generation now [finishes at its first valid root boundary](superpowers/plans/2026-10-31-schema-document-completion.md). Observed premature EOS closes satisfied frames or opens the next required field for model-authored values; unchanged final validators still decide acceptance. Tool turns, cancellation, budgets and observed provider metadata remain preserved. The [live retest](superpowers/plans/2026-10-31-schema-document-completion.md#live-new-game-retest) records 29 local document completions and zero guard failures before an unrelated healing-policy validation stopped setup.

New-game structured generation now selects [named schemas across its setup tree](superpowers/plans/2026-10-31-new-game-generation-schemas.md), including conditional preparation, nested NPC/player setup and deferred choices/intro. [TechniqueXml](classes/TechniqueXml.md) shares nested XML mechanics between ability attachments and starting techniques; prose-only stages remain explicit plain output. Existing final validators and compact turn audits remain authoritative. Equipment selection and conditional context-memory selection use dedicated layouts, including post-inventory NPC setup. [Technique validation](classes/Technique.md) identifies the effective harmful-effect check and its inheritance/field path in correction feedback. The [live acceptance result](superpowers/plans/2026-10-31-new-game-generation-schemas.md#live-acceptance-result) records successful game creation and its two optional generation failures.

`--no-llm-autostart` starts configured game-owned llama.cpp/Strata managers off while retaining header startup controls and validation; managed preload/background inventory cannot start them indirectly. See [CLI configuration](config.md#start-with-managed-local-llms-off) and [controller behavior](classes/ManagedLocalLlmController.md).

Named [XML generation schemas](classes/XmlGenerationSchema.md) add unordered cardinality checks and bounded, tag-only synthetic continuation after sampled alternatives are exhausted. [Shared item generation](classes/ThingGenerationSchema.md) uses editable core/mod files; the [plan](superpowers/plans/2026-10-31-file-xml-generation-schemas.md) records rollout and CDATA balancing.

The existing [XML guard](classes/XmlClosingTagGuard.md#actual-eos-with-incomplete-xml) now handles observed premature EOS using explicit terminal samples and append-only token alternatives, with output/round budgets. The hash-pinned Strata API metadata patch was installed and verified in the prior approved restart; see the [EOS plan](superpowers/plans/2026-10-31-xml-eos-guard.md).

The independent [live XML closing-tag guard](classes/XmlClosingTagGuard.md) uses the existing sampled-token branch/rewind path for standard and TinyBrain XML, including opaque markup. It is enabled explicitly per effective AI profile, preserves provider-free deterministic output, and leaves strict final parsers authoritative. See the [implementation plan](superpowers/plans/2026-10-31-live-xml-closing-tag-guard.md).

XML guards and no-native-tool policy checks honor the first declared response root (including named schemas), ignoring unrelated markup before it opens and after it closes. Actual EOS before that opening requests the correct wrapper within the existing validation retry budget. Inside the root, actual `<tool_call>` elements are rejected in sampled output, branch/EOS alternatives and completed responses before callbacks or extraction. Untargeted XML scopes retain existing behavior. The policy follows each attempt's filtered tool exposure for standard and TinyBrain prompts, including forced output and disabled live guarding; literal CDATA/comments and escaped text are exempt. See [XmlClosingTagGuard](classes/XmlClosingTagGuard.md), [XmlGenerationSchema](classes/XmlGenerationSchema.md) and [LLMClient](classes/LLMClient.md).

All built-in TinyBrain XML parser functions now share expected-root metadata with
their envelope extraction; native custom checkpoint and final-model closures
declare explicit output contracts. Prose/scalar stages remain plain, and unknown
external contracts do not receive guessed roots. See the shared
[parser contracts](classes/TinyBrainPromptParsers.md) and
[runner options](classes/TinyBrainPromptRunner.md). The
[response-root coverage inventory](superpowers/plans/2026-10-31-live-xml-closing-tag-guard.md#response-root-coverage-audit-2026-11-04)
lists native wrapper/custom/final contracts and the remaining generic CLI and
external auto-detection boundaries. Custom XML programs can declare explicit roots
through the runner or LLMClient API. Provider live-guard capability flags remain
unchanged.

The shared header has a configured-only [local LLM toggle](classes/ManagedLocalLlmController.md): readiness LED, serialized on/off, retained manual-off intent and stack-bearing errors across desktop and phone. The [implementation plan](superpowers/plans/2026-10-31-local-llm-toggle.md) records the runtime boundaries.

Local LLM status polls recheck inspection failures and clear them after successful
current inspection; concurrent reads share one probe per lifecycle revision.
Obsolete probe results cannot replace newer state, while explicit start/stop
failures retain their original diagnostics until successful explicit recovery.

`faction_housekeeping.interval` independently controls faction reviews (default 11) using the existing eligible-turn clock, with no offset or new save counter. See [configuration](config.md#housekeeping-and-quest-check-intervals) and [FactionHousekeepingService](classes/FactionHousekeepingService.md).

Standard and TinyBrain [WYWA prompts](api/chat.md) explicitly name the player and party in a short comma-separated arriving-together line.

Numeric text accepts an optional leading unary `+` wherever the corresponding positive scalar is accepted, while retaining field-specific ranges, finite/safe-integer checks, and exact reference/ID syntax. This includes [resolution-plan amounts](classes/PlayerActionResolutionPlan.md), [TinyBrain checks and percentages](classes/TinyBrainPromptParsers.md), [initial faction standings](classes/InitialFactionStandings.md), [trackers](classes/Tracker.md), [positive durations](classes/Utils.md), [forced-roll answers](api/chat.md), and [crafting roll tokens](api/crafting.md). The shared [FormulaEvaluator](classes/FormulaEvaluator.md) also supports unary `+` on numbers, variables, and parenthesized expressions.

Crafts with output now record each preserved selected ingredient unit as a named bonus in the persisted `What changed` drawer, including `noProse` actions. See [crafting](api/crafting.md#chat-events-and-time) and [chat summaries](ui/chat_interface.md).

The [LLM stream reader](classes/LLMClient.md) preserves UTF-8 characters split across transport chunks and drains a final SSE data line without a newline before settling. Validation failures also record the observed finish reason, transport mode and numeric token usage; the reader never repairs genuinely missing XML.

Audited structured prompts validate model-correctable XML, fields, counts, references and prepared mechanics within their correction budgets before applying changes. The [validation audit](superpowers/plans/2026-10-27-prompt-domain-validation-retries.md) records covered families, mutation boundaries and focused verification.

The [optional XML field audit](superpowers/plans/2026-10-30-optional-xml-field-audit.md) permits omission wherever the audited field already has a no-value meaning, including NPC behavioral disposition and empty generation/worksheet collections. Required roots, actor/reference coverage, meaningful mechanics, and duplicate/invalid-field errors remain enforced. Core coverage and the failure-cost semantic exception are documented in [server/LLM notes](server_llm_notes.md); staged contracts are in [TinyBrainPromptParsers](classes/TinyBrainPromptParsers.md).

When XML is actually unclosed, [shared retry feedback](classes/XmlRetryFeedback.md) preserves the parser error and asks the model to close every tag, then write `DONE` after the root. The same correction helper reminds XML responses to escape literal tag mentions while keeping actual answer tags unescaped. `&lt;quests&gt;` and `&lt;item&gt;` are examples only: each literal tag keeps its own name and content when escaped. Direct completion/custom validators, outer parse retries, manual ability retries and TinyBrain checkpoint/final paths share this guidance; strict parsing, retry eligibility and existing budgets remain in force.

Character inventory generation now corrects XML, barter counts, whole-item/mod invariants and final scaled candidates inside one bounded feedback loop before creating anything. Every attempt is logged, with quiet recovery and one terminal failure report. See [Player inventory](classes/Player.md), [ThingMutationService](classes/ThingMutationService.md) and [PromptRetryPolicy](classes/PromptRetryPolicy.md).

[Barter start/haggle pricing](api/npcs.md) selects a [named XML schema](classes/XmlGenerationSchema.md) for sibling offer/stock wrappers. Marked model-output guard failures receive a fresh complete response within the existing [pricing correction budget](classes/PromptRetryPolicy.md), with full stitched rejection logs and effective feedback; cancellation, provider/configuration failures and mutation boundaries remain unchanged.

The response-validation audit also moves container/location final candidate preparation, detached location/faction/exit checks, pure selectors and whole-response name choices ahead of commit. See [Location](classes/Location.md), [ThingMutationService](classes/ThingMutationService.md) and [server/LLM notes](server_llm_notes.md).

TinyBrain starting-technique authoring validates a compact XML roster, then expands one technique per checkpoint with local correction retries and one final atomic batch commit. Starting techniques bypass discipline and acquisition prerequisites and establish saved discipline access atomically with learning; ability-granted techniques expose access for their active status source. Use-time requirements, mechanics validation, and ordinary learning gates remain in force. Standard mode retains full-batch generation; see [StartingTechniques](classes/StartingTechniques.md), [TechniqueService](classes/TechniqueService.md), [family routing](classes/TinyBrainPromptFamilies.md) and [configuration](config.md#tiny-brain-staged-prompts).

Completed [event learning](classes/TechniqueEvents.md) and narrative first-use
discovery now establish saved actor discipline access atomically with a new
learned technique. [TechniqueService](classes/TechniqueService.md) retains
acquisition/use prerequisites and source validation; previews, failures and
replays create no access grants, and private disciplines remain private. The
shared [operation parser](classes/TechniquePrompt.md) covers standard/TinyBrain
player actions and standalone NPC intent.

Technique [component selector feedback](classes/TechniqueBalancePolicy.md)
identifies each named component and XML field, distinguishes casting/scaling
skills from affected buff/debuff stats, and lists actual eligible attributes.
Independent selector errors are [collected together](classes/ResponseValidation.md)
without changing recipe validation or single-choice inference.
Active ability-backed discipline access now uses one shared
[service projection](classes/TechniqueService.md) for prompt context and actual
learning/prerequisite checks, including indirect discipline prerequisites.
Removing/expiring the source revokes derived access without changing privacy or
silently adding permanent actor access.

Technique icon menus in the character panel and Play sidebar open the
[existing technique editor](classes/TechniquesPanel.md) after a fresh catalogue
lookup: personal learned revision when present, otherwise the explicitly shared
catalogue revision. [ActionImages](classes/ActionImages.md) retains native popup,
cancellation and ownership behavior. Discipline icon menus open the same native
metadata/access editor with the exact discipline selected; ability menus remain
image-only.

Pending ability notifications refresh the authoritative player and choices together before rendering icons, including when startup WebSocket messages precede player-cache hydration. Stale or unloaded responses cannot replace the current selection; see [chat startup](ui/chat_interface.md) and [the ability modal](ui/modals_overlays.md#player-level-up-ability-draft).

XML correction conversations retain rejected responses until their checkpoint or completion succeeds; accepted TinyBrain checkpoints compact away failed attempts while preserving owned tool results. Repeated verbatim failures receive the requested quoted reminder through [shared retry feedback](classes/XmlRetryFeedback.md). [TinyBrain events](classes/Events.md) accept valid events across stages within the same prose section, deduplicate accepted effects and preserve authoritative final-state flags.

Sectioned [TinyBrain events](classes/Events.md) retain one event schema and queue owner per conversation, releasing before automatic maintenance. Internal nested prompts share that owner through [LLMClient](classes/LLMClient.md), with safe model handoffs and atomic model/global acquisition; human-input waits deliberately yield. The existing [continuation refresh](classes/TinyBrainPromptRunner.md#execution) replaces it alongside the world snapshot, keeping destination-specific and mod guidance current while preserving accepted section answers and receipts.

Unknown technique reference IDs fail before establishing intent locks, allowing corrected ordinary actions or empty pending suffixes while known/novel technique locks and completed receipts remain authoritative; see [PlayerTechniqueIntent](classes/PlayerTechniqueIntent.md) and [PlayerActionResolutionPlan](classes/PlayerActionResolutionPlan.md).

[`/reprocess_events`](slashcommands/ReprocessEventsCommand.md) defaults to the latest gameplay turn with no arguments. It reuses stored prose and runs event checks plus necessary event-effect generation, without new story, clock advancement, need-bar/quest-check prompts or unrelated automation. [Saved replay records](classes/EventReprocessor.md) preserve completed passes; older untracked turns and partial applications remain replayable with duplication warnings.

The shared [ability attachment authoring guide](classes/AbilityAttachmentAuthoring.md) uses a complete discipline-grouped short-summary catalogue lookup before selected-only canonical mechanics. Existing grants use direct technique IDs with server-resolved parents and captured revision pins; new candidates still choose a discipline. Actor-owned source mechanics and old attachment payloads stay outside that context. Both standard/TinyBrain paths retain one queue owner, and lookup never implicitly grants a technique. The guide also explains permanent owner traits, activated techniques and their target status effects, including temporary self-buffs. Separate examples illustrate passive traits and grant-only containers. [Prompt rendering notes](server_llm_notes.md#prompt-rendering) describe the general preference for capability guidance over warnings about individual mistakes.

[Ability attachment freshness](classes/TechniqueService.md#status-sources-and-ability-attachment-authoring) checks the game, character, and target abilities; routine resource changes and unrelated catalogue updates no longer invalidate a draft. Mechanics and references are validated against current state before application. The [manual attachment editor](classes/AbilityAttachmentsEditor.md) preserves optional maximum-capacity field omission on unchanged effects.

All new shared [domain identities](classes/IdGenerator.md) use `prefix_first_three_words` from their name or descriptive field, with `_2`, `_3`, and later collision suffixes. Named high-water counters persist deleted/discarded reservations, and hydration reserves all incoming known identities before missing IDs are allocated. [Discipline reuse](classes/TechniqueService.md#discipline-identities) still compares full normalized names; existing saved/pending IDs and references remain intact. See [save serialization](api/serialization.md#id-allocation) and the [implementation plan](superpowers/plans/2026-11-04-name-derived-domain-ids.md).

The explicit [`/migrate_ids` command](slashcommands/MigrateIdsCommand.md) uses detached [ID migration preparation](classes/DomainIdMigration.md) and a [runtime transaction](classes/DomainIdMigrationRuntime.md) to update the loaded world. It preserves prose and operational IDs, rewrites derived technique sources/receipts, keeps a recoverable original backup and validates native hydration. Bound Stories reject before installation; the command is never run automatically.

Faction relations are sparse directed edges: generation establishes meaningful ties across the complete starting roster, while unconnected pairs remain absent. Creation, autofill and new-game merging no longer require or synthesize an all-pairs matrix. Existing saved and configured relationships, including explicit neutral ties, are preserved. See [Faction](classes/Faction.md), [faction APIs](api/factions.md), [settings](api/settings.md), and [new-game setup](api/game.md).

Ability and status displays resolve granted technique names from the shared catalogue, including existing UUID references. Player and NPC modals refresh the catalogue before rendering; hover uses the loaded names. See [modal and tooltip behavior](ui/modals_overlays.md).

Status tooltips share inset effect cards with accent borders, duration badges, descriptions and Stat/Change tables. Character and location effects, item effects and ability attachment previews use the same renderer; zero modifier components and empty tables are omitted. Longer tooltips scroll within the viewport, support moving the pointer into their content, and dismiss with Escape. See [shared styles](ui/assets_styles.md) and [tooltip behavior](ui/modals_overlays.md).

Nonmodal prompt-progress and request-status updates preserve active hover/focus tooltips; the inline status strip does not dismiss them. Normal tooltip leave, scroll, Escape and modal cleanup behavior remains in place. See [chat status](ui/chat_interface.md) and [overlays](ui/modals_overlays.md).

Each gameplay turn now keeps an in-memory prompt audit and writes one compact `logs/*_turn_prompt_errors_*.log` after its actual handler and owned background text work settle. It groups transient/terminal failures by prompt and checkpoint/parser, keeps recovered section outcomes, and leaves chat/model/save data unchanged. See [PromptAuditLog](classes/PromptAuditLog.md) and the [implementation plan](superpowers/plans/2026-10-27-per-turn-prompt-audit.md).

That same turn file includes a separate [XML enforcement section](classes/PromptAuditLog.md#xml-enforcement): named-schema/generic-guard dispatches, selected corrections, failures and compact timing/location/path/offset context. Guard activity with zero corrections remains visible; successful selections never increase error totals.

The same audit separately records initial generated-output waits of five seconds or longer, including queue/preparation; the inclusive threshold is configurable through [`prompt_audit.high_latency_seconds`](config.md#prompt-audit-latency). Streaming and non-stream response/chunk measurements are distinguished, and slow waits never count as failures.

Every dispatched completion attempt also writes threshold-free timing to `logs/completion-timing-YYYY-MM-DD.jsonl` and the server console. A shared completion observer owns event reporting for streaming, non-streaming and CLI paths, feeding both the logical startup-latency audit and per-attempt records. Its request/completion IDs distinguish concurrent prompts and retries; `ttftMs` measures dispatch to first streamed generated content, while non-stream responses have separate timing fields. Preparation, retry backoff, transport remainder, and overall elapsed time are recorded separately. Each row includes the raw provider finish reason, numeric token usage, model, effective output-limit/stop settings and whether those settings were forwarded, even when a later parser rejects the response. Missing provider metadata remains null. See [PromptAuditLog timing](classes/PromptAuditLog.md#initial-output-latency).

Opt-in local [Strata termination tracing](strata_termination_tracing.md) distinguishes observed EOS tokens, stop matches, caps and guards without recording prompt or response text. Backend `responseId` joins the completion recorder's raw HTTP/SSE `providerResponseId`; parser states and output digests help investigate missing XML tails. The local investigation records reproduced closing-tag omissions and a single successful replay requesting `DONE` after the closing root.

New-game intro live correction accepts valid opening prefixes with no eligible n-gram tokens, and queued ownerless image requests restore their original absent audit context. Slop rewrite audit acceptance also occurs after its retry state is initialized. See [slop/repetition analysis](slop_and_repetition.md) and [PromptAuditLog ownership](classes/PromptAuditLog.md).

New attribute-only check titles and forced-roll questions show the selected stat, such as Dexterity, while real skill names retain precedence. See [chat check-result display](ui/chat_interface.md) and [common API payloads](api/common.md).

Historical tool/check/debug dumps are excluded before prompt-history projection or recent windows across NPC/party memories, disposition/offscreen/prose/summary helpers, housekeeping, location generation, scene illustration, Story Authoring source/receipt context, and entity-state tool lookups. UI/save/log records remain intact; current tool receipts remain authoritative. See [base_context_history](classes/base_context_history.md), [Player memory buffers](classes/Player.md), [housekeeping_history](classes/housekeeping_history.md), and [server/LLM notes](server_llm_notes.md).

After a TinyBrain section recovers, later sections retain its accepted answer and successful native/server receipts while failed drafts, error results and retry feedback leave the conversation. Full attempt logs remain intact; see [TinyBrainRetryContext](classes/TinyBrainRetryContext.md) and [TinyBrainPromptRunner](classes/TinyBrainPromptRunner.md).

New ordinary locations cannot share a live or pending region name; existing saved locations and region-entry placeholders retain their identities. TinyBrain validates an XML destination decision before later travel stages and corrects only that checkpoint by choosing a region, another location, or staying put, preserving accepted receipts. See [LocationCreationNameGuard](classes/LocationCreationNameGuard.md), [PlayerActionDestinationContext](classes/PlayerActionDestinationContext.md), and [TinyBrainPromptParsers](classes/TinyBrainPromptParsers.md).
Model-selected player travel also rejects the captured origin's canonical ID,
including normalized names and known region entries, before TinyBrain final
prose and within the standard response retry boundary. Distinct zero-minute
routes, authoritative committed travel and vehicle destinations retain their
existing semantics; see the same destination reference and
[result builder](classes/PlayerActionTinyBrainResult.md).

Region/location generation and their structured item/NPC population and faction generation/enrichment prompts use the configurable `world_generation.max_tokens: 20000` output budget per completion or TinyBrain stage. Coverage, precedence and transport limits are documented in [WorldGenerationTokenBudget](classes/WorldGenerationTokenBudget.md), [LLMClient](classes/LLMClient.md) and [configuration](config.md#core-ai-request-settings).

Location item/scenery generation supports a validated compact roster followed by exact full-Thing expansion through the `location_things_generation` TinyBrain family. Final XML/count/rarity/mod-field validation retries inside the active stage before atomic batch creation; standard mode owns one correction conversation and reports only terminal failure. See [LocationThingGenerationPlan](classes/LocationThingGenerationPlan.md), [TinyBrainPromptFamilies](classes/TinyBrainPromptFamilies.md), and [configuration](config.md).

The default-off [`chat_tools.mutating_prompts_only`](config.md#chat-tools) option suppresses native calls for lookup-only prompt scopes and in-context questions while preserving existing mutation-capable prompts, code-owned plans/events, and exact native-tool exposure. Disabled completions add no generated tool-permission message. See [ChatToolPolicy](classes/ChatToolPolicy.md), [LLMClient](classes/LLMClient.md), [TinyBrainPromptRunner](classes/TinyBrainPromptRunner.md), and [mod tool capabilities](classes/ModExtensionRegistry.md).

Terminal prompt failures on every app page open independent shared modeless prompt-viewer windows with
failure details and authoritative tool/retry counts; recoverable attempts remain
quiet. Logical ownership, cancellation, ephemeral realtime delivery and foreground
error deduplication are documented in [PromptFailureReporter](classes/PromptFailureReporter.md),
[LLMClient](classes/LLMClient.md), [TinyBrainPromptRunner](classes/TinyBrainPromptRunner.md)
and [the Play interface](ui/chat_interface.md).

Level-up ability options share the player Abilities chooser's full hover/focus tooltips and lazy icons. Persisted detached attachment drafts show effects and proposed technique names before selection; only selected drafts install mechanics. Next-level [player option generation](classes/Player.md) uses XML-only output and a dedicated single-player schema, with exact-target validation, bounded remaining-card retries and the final validation cause preserved. See [the Play interface](ui/chat_interface.md), [ability authoring](classes/AbilityAttachmentAuthoring.md), and [ability selection modal](ui/modals_overlays.md#player-level-up-ability-draft).

Ability-selection errors retain their server diagnostics and use shared error UI; unloaded submissions stop before any generation. Explicit deferred-intro metadata now round-trips through ordinary saves/autosaves. The TinyBrain intro validates its locally assembled XML before storing prose or autosaving. See [player ability selection](api/players.md#post-apiplayerability-selectionsubmit) and [game lifecycle](api/game.md).

Startup parser exhaustion and optional terminal prompt failures use that same viewer. Labelled [parse retry loops](classes/PromptRetryPolicy.md), faction stages and image-text validation own their full conversations; [New Game](api/game.md) forwards the original failure UUID in its error status/HTTP response while preserving immediate navigation to Play.

Quest generation accepts empty item-reward placeholders and sends XML/domain or forbidden-tool failures back through bounded correction replies before any quest mutation; see [Quest](classes/Quest.md), [Events](classes/Events.md), and [LLMClient](classes/LLMClient.md).

Quest offers record their origin location level and relative difficulty, persist the derived quest level, and scale authored base XP by quest/player levels before normal player XP scaling. Older saved quests/offers load at level 1 and preserve positive base XP, otherwise initializing 25 base XP per required objective (minimum one); pending chat previews stay synchronized. Required XML level/XP correction, immutable origins, relative-level editing, and actual awarded-XP reporting are documented in [Quest](classes/Quest.md), [Events](classes/Events.md), [QuestConfirmationManager](classes/QuestConfirmationManager.md), [Player](classes/Player.md), and the [quest API](api/quests.md).

Accepted chat submissions jump fully to the newest entry. Live/history updates and late content/layout growth follow only while the reader remains at the bottom; scrolling up cancels pending follow. Initial game-load and Adventure/mobile Chat navigation retain their history/visibility-aware bottom positioning. See [the Play interface](ui/chat_interface.md#layout-and-tabs).

Phone Chat keeps the existing Suggest actions and Send controls visible above the prompt dock by sizing the log/composer pane to the remaining viewport; see [the Play interface](ui/chat_interface.md#layout-and-tabs).

Explicit endpoint-bound Strata shared-prefix pinning and the later scene-reference boundary are documented in [LLMClient](classes/LLMClient.md#internal-prompt-message-boundaries), [TinyBrainPromptRunner](classes/TinyBrainPromptRunner.md), and [configuration](config.md#shared-context-prefix-caching). Reusable shared/scene mod-contributor placement is described in [ModExtensionRegistry](classes/ModExtensionRegistry.md), [modding hooks](modding_hooks.md) and [NSFW Boost](mods/nsfw-boost.md).

Optional [native Strata ownership](classes/StrataRuntime.md) adds game-owned startup and identity-guarded shutdown; its default is null and activation remains on hold. The [implementation plan](superpowers/plans/2026-10-31-managed-strata-runtime.md) records ownership and activation boundaries.

Optional Strata elastic VRAM or full RAM standby handoff, explicit provider/minimum-total-free memory
configuration, live-model admission checks, compensation and reload boundaries
are documented in [StrataVramClient](classes/StrataVramClient.md),
[ImageGenerationModelLifecycle](classes/ImageGenerationModelLifecycle.md),
[config.md](config.md#strata-elastic-vram-handoff), and the
[implementation plan](strata_vram_handoff_plan.md). The optional, secret-free
[all-DavidAU profile](../config.yaml.strata-davidau) selects this mode when passed
to the documented `--config-override` startup option and limits AI concurrency to
one request, matching the local Strata serving slot.
The custom Strata token-probability integration and its cross-process verification
are documented in [LiveDeslop](classes/LiveDeslop.md#local-strata-backend).

The [Story workspace backend](../mods/story-authoring/docs/StoryProject.md) supports an independent versioned library, strict generation proposals, scoped durable YOLO, safe world/protagonist sources, reviewed canonical materialization, portable bindings and actual-outcome reviews. Generic shared contracts are documented in [ModExtensionRegistry](classes/ModExtensionRegistry.md), [ModLoader](classes/ModLoader.md), [RuntimeReviewedSetup](classes/RuntimeReviewedSetup.md), [RuntimeProtagonistSetup](classes/RuntimeProtagonistSetup.md), [PageFeedbackController](classes/PageFeedbackController.md), and the [Story mod index](../mods/story-authoring/docs/README.md).

Reusable mod gameplay guards, runtime-reset and completed-turn callbacks, canonical choice-request settlement, continuity-work settlement, strict automated chat submission, and browser input-request and ability-selection handlers are documented in [modding_hooks.md](modding_hooks.md), [modding.md](modding.md), and [classes/ModExtensionRegistry.md](classes/ModExtensionRegistry.md).

The bundled [Story Authoring mod](../mods/story-authoring/docs/StoryAuthoringController.md) uses these hooks for protagonist decisions, scene goals, author notes, pause/resume, and saved progress. Its documentation includes focused-test and isolated standard/TinyBrain browser-verification commands. The [Play Runner UI](../mods/story-authoring/docs/StoryAuthoringRunner.md) documents shared native controls, cached/final ownership and focused controller/hook verification.

Interactive vehicle-route failures and the themed rerun/time-skip/skip-events modal are documented in [classes/TurnEventRecovery.md](classes/TurnEventRecovery.md), [api/chat.md](api/chat.md), and [ui/modals_overlays.md](ui/modals_overlays.md), including exact-turn autosaves, character-only time-skips, and standard/TinyBrain recovery.

Hidden Thing/exit persistence, strict generated/replayed XML fields, formula-derived first-entry discovery with successful-arrival refresh propagation, authoritative standard/TinyBrain reveal events, interaction/travel/map gates, and matching UI eye toggles are documented in [classes/Thing.md](classes/Thing.md), [classes/LocationExit.md](classes/LocationExit.md), [classes/Events.md](classes/Events.md), [api/chat.md](api/chat.md), [api/things.md](api/things.md), [api/locations.md](api/locations.md), [server_llm_notes.md](server_llm_notes.md), and [ui/chat_interface.md](ui/chat_interface.md).

Player-action `until` clock-time durations, including TinyBrain parsing and turn-start clock snapshots, are documented in [api/chat.md](api/chat.md), [classes/Utils.md](classes/Utils.md), [classes/TinyBrainPromptParsers.md](classes/TinyBrainPromptParsers.md), and [classes/PlayerActionTinyBrainResult.md](classes/PlayerActionTinyBrainResult.md).

Authoritative quest-completion notifications retain rounded XP/currency change rows and omit their duplicate gift rows using typed reward lines. Other gifts and split-travel objective summaries remain visible; award arithmetic and existing stored history are unchanged. See [api/chat.md](api/chat.md), [api/quests.md](api/quests.md), and [classes/Events.md](classes/Events.md).

Item appearance summaries report only successful creation or stack increments.
Failed generation retains successful sibling changes and reaches the existing
error modal with its original backtrace; TinyBrain continuations receive the
actual application result. See [Events](classes/Events.md).

Structured-only event notification rendering—including turn-diff severity/time semantics and need/disposition grouping without reverse-parsing display prose—is documented in [api/common.md](api/common.md) and [ui/chat_interface.md](ui/chat_interface.md).

Player Prompt Guidance persistence, its upper-right chat modal, shared XML-escaped base-context block, API, and prompt-hidden update notices are documented in [classes/Player.md](classes/Player.md), [api/players.md](api/players.md), [ui/chat_interface.md](ui/chat_interface.md), [classes/base_context_history.md](classes/base_context_history.md), and [server_llm_notes.md](server_llm_notes.md).

The custom Material sword-over-shield SVG is documented in [ui/assets_styles.md](ui/assets_styles.md#images).

Vision-generated seasonal/weather/lighting location edits, attached base-image context, and cached `N/A` decisions are documented in [config.md](config.md#location-weatherlighting-image-variants), [api/images.md](api/images.md#post-apiimageslocation-variantrequest), and [classes/Location.md](classes/Location.md).

The Tools menu's read-only current/previous-session Log Viewer, `logs/` and `logs/logs_prev/` directory mapping, filename filtering, creation-date ordering, API safety checks, and UI tests are documented in [classes/LogViewer.md](classes/LogViewer.md).

Shared prompt banned-trope loading and base-context location item/scenery generation are documented in [server_llm_notes.md](server_llm_notes.md).

The default-off `regions.secrets_enabled` switch, generation/parser behavior, context filtering, and saved-secret preservation are documented in [config.md](config.md#region-secrets) and [classes/Region.md](classes/Region.md).

The allocation preview's attribute-count handling and base-stat calculation example are documented in [ui/modals_overlays.md](ui/modals_overlays.md).

Compact item/scenery grid sizing and shared tooltip equip-slot badges are documented in [ui/chat_interface.md](ui/chat_interface.md).
Narrow-mobile item-lightbox action buttons for character-inventory dropping/giving, location pickup/giving, barter staging, crafting assignment, and module installation are documented in [ui/chat_interface.md](ui/chat_interface.md) and [ui/modals_overlays.md](ui/modals_overlays.md).
Prompt-free direct module-install prose, including Adventure/Story Tools refresh and base-context history inclusion, is documented in [api/things.md](api/things.md), [mods/modules.md](mods/modules.md), [classes/ItemModuleSystem.md](classes/ItemModuleSystem.md), [ui/chat_interface.md](ui/chat_interface.md), and [ui/modals_overlays.md](ui/modals_overlays.md).
Equippable-item sword/shield thumbnail badges, nonintrusive control stacking, and fixed corner inset are documented in [ui/chat_interface.md](ui/chat_interface.md).
The location NPC show-hidden control's spoiler-neutral behavior, including the absence of NPC-count-based disabling, is documented in [ui/chat_interface.md](ui/chat_interface.md).
Mobile tap-anywhere tooltip dismissal, explicit faction-emblem tooltip opening, and the chat action-suggestion modal are documented in [ui/chat_interface.md](ui/chat_interface.md).
Rich NPC portrait and current-location details in the shared desktop/mobile image lightbox are documented in [ui/chat_interface.md](ui/chat_interface.md).
Mobile Play-tab icon-bar shrinking, including single-row fit without horizontal scrolling, is documented in [ui/chat_interface.md](ui/chat_interface.md).
The fixed-width desktop app-header brand, right-aligned wrapping controls, fixed mobile app header, phone Adventure navigation/subnavigation, globally fixed live prompt dock, compact phone Adventure/Chat/Player & Party outer padding, phone-width main-content spacing, overlay navigation, accessible dismissal/focus behavior, Tools disclosure closure across viewport changes, and loaded-state-aware Play action are documented in [ui/pages.md](ui/pages.md), [ui/assets_styles.md](ui/assets_styles.md), and [ui/chat_interface.md](ui/chat_interface.md).

The `createExit` tool's required travel duration and two-way timing are documented in [api/chat.md](api/chat.md) and [classes/LocationExit.md](classes/LocationExit.md). Unbounded location danger bases, signed region modifiers, 1–5 faction violence, capped half-life arrival replenishment, saved-source recovery on a later real arrival, precommit invalidation, direct tools, cumulative danger-change events, the default-off `show_location_danger` four-skull indicator, other UI surfaces, and deliberate omission from ordinary LLM context are documented in [config.md](config.md#location-danger-indicator), [classes/LocationDanger.md](classes/LocationDanger.md), [classes/LocationHostileArrivalService.md](classes/LocationHostileArrivalService.md), [classes/Location.md](classes/Location.md), [classes/Region.md](classes/Region.md), [classes/Faction.md](classes/Faction.md), [classes/Events.md](classes/Events.md), [api/locations.md](api/locations.md), [api/regions.md](api/regions.md), [api/factions.md](api/factions.md), and [ui/chat_interface.md](ui/chat_interface.md).

Atomic new-game player standings generated from public faction identity and the player concept, including configurable bounds and strict retry validation, are documented in [classes/InitialFactionStandings.md](classes/InitialFactionStandings.md), [classes/Player.md](classes/Player.md), [classes/Faction.md](classes/Faction.md), [api/game.md](api/game.md), and [config.md](config.md#initial-faction-reputation).

Lockpicking/open-container button theming is covered in [ui/modals_overlays.md](ui/modals_overlays.md).

Portrait warning activation and formula-aware unspent-point allocation are covered in [ui/chat_interface.md](ui/chat_interface.md) and [ui/modals_overlays.md](ui/modals_overlays.md).

New Game’s native themed snapshot Save and searchable explicit-selection Load dialogs, keyboard/focus behavior, stale-list cancellation, atomic form application, reviewed-draft locks, and original settings API error stacks are documented in [ui/pages.md](ui/pages.md), [ui/modals_overlays.md](ui/modals_overlays.md), and [api/game.md](api/game.md).

Current map of Markdown documentation under `docs/`. This README and the generated aggregate `docs/all.md` are intentionally omitted from the index.
WYWA arrival narration is documented in [api/chat.md](api/chat.md), [api/players.md](api/players.md), [api/npcs.md](api/npcs.md), and [ui/chat_interface.md](ui/chat_interface.md): callers explicitly distinguish already-narrated arrivals from comment-only travel so qualifying bare arrivals require visible prose without duplicating player-action narration. Standard and TinyBrain return prose must also avoid paraphrasing the immediately preceding player-action response in the same turn; optional TinyBrain audit revisions can discard redundant prose through the [result builder](classes/TinyBrainResultBuilders.md) without inventing filler or dropping hidden updates. [Required prose parsing](classes/TinyBrainPromptParsers.md) rejects whole-response `N/A` sentinels in both drafts and revisions. Manual message deletion detaches and preserves independent WYWA rows and their own attachments when an ancestor is deleted; see [chat deletion](api/chat.md#delete-apichatmessage).


## Start Here

Shared [XML document parsing](classes/Utils.md#xml-helpers) strips all content outside the selected root before parsing or normalization. The [shared envelope scanner](classes/XmlResponse.md) preserves malformed final/outer envelopes for explicit rejection and serves ordinary completions and [TinyBrain](classes/TinyBrainXmlResponse.md).

Shared item generation renders one XML wrapper per collection field, including
unseeded module slots; see [Thing](classes/Thing.md#prompts-apis-and-events).
Single-Thing generation explicitly requires the `<items>` wrapper even for one
item, logs every response, and sends precise root/XML/whole-Thing validation
failures back to the model in one bounded correction conversation; see
[Thing](classes/Thing.md#prompts-apis-and-events).

TinyBrain runs snapshot original tool definitions and one native-call budget at the beginning. Each checkpoint exposes only its currently executable subset; no-call checkpoints, corrections and exhausted requests expose none. Parsed server-owned checks, attacks and scheduled-event plans retain separate execution contracts. Native lookup receipts remain cached until the relevant searchable index changes.

Base-context prompts preserve their own execution scope instead of advertising a shared player-action baseline. Definitions may change between checkpoints, which can reduce prefix-cache reuse. See [ChatToolPolicy](classes/ChatToolPolicy.md), [PlayerActionResolutionPlan](classes/PlayerActionResolutionPlan.md), [TinyBrainPromptRunner](classes/TinyBrainPromptRunner.md#prompt-caching) and [LLMClient](classes/LLMClient.md#internal-prompt-message-boundaries).

Generated Thing/exit XML now defaults omitted hidden flags to visible and only
requires a difficulty for hidden entries; see
[HiddenDiscovery](classes/HiddenDiscovery.md) and
[LocationExitSuggestions](classes/LocationExitSuggestions.md). Starting-region
generation uses bounded parser-guided correction before publishing world
records; see [Region](classes/Region.md#xml-parsing).

New region creation without a supplied offset requests a strict `+1..+4` offset
through [RegionLevelOffset](classes/RegionLevelOffset.md), retaining a captured
source-average anchor and adding it once. Existing regions/pending offsets and
explicit zero exceptions are preserved. The regional/world map difficulty-color
and current-player refresh contract is documented in [maps](ui/maps.md). Scope
and verification are tracked in the [region offsets and map level colors plan](superpowers/plans/2026-11-08-region-offsets-map-level-colors.md).

The all-local Artemis v1.2 NVFP4 TinyBrain profile is
[`config.yaml.artemis-v1.2-nvfp4`](../config.yaml.artemis-v1.2-nvfp4), based on
the latest Artemis/Kimi profile with remote text routing disabled. Its launcher
and startup command are documented in [config.md](config.md).

[`config.yaml.gemma4-a4b-artemis-v1.2-prose`](../config.yaml.gemma4-a4b-artemis-v1.2-prose)
keeps that profile's current settings, routes prose to Artemis v1.2 NVFP4,
and now uses local Merousis 26B A4B Q5_K_M for other prompts, retaining the
profile's existing filename. Its managed
model-switching launchers and startup command are documented in
[config.md](config.md).

| Doc                                                    | Use for                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [developer_overview.md](developer_overview.md)         | Session warm-up: project shape, core runtime flow, and first files to inspect.                               |
| [prompt_cache_audit_2026-11-13.md](prompt_cache_audit_2026-11-13.md) | Current-session prompt/cache latency baseline and implemented reductions: inventory ownership, focused family context, canonical projections, tool-free plot analysis and native retention settings. |
| [API_README.md](API_README.md)                         | High-level Express route index with pointers into `docs/api/`.                                               |
| [server_llm_notes.md](server_llm_notes.md)             | Detailed server, execution-scoped native tool exposure, plain-prose-safe expected-root validation, singular item-alter XML validation, tool-free structured generation prompts, strictly retried NPC behavioral-disposition generation and base-context guidance, hidden-state-safe action-suggestion instructions, strict generic-prompt XML bulk NPC field updates, restricted direct short-description mutation with NPC/faction regeneration support, actor death/need handling, scene-local NPC desire and initiative planning, pre-brainstorm standard/TinyBrain action checks with shared intent-focused outcome-tier guidance in both prompts and label-first check tool results, standard/TinyBrain movement-companion selection, hard mystery-capacity prose guidance, request-schema-enforced tools, multi-attack resolution, TinyBrain NPC attack pre-resolution, inline die overrides, normalized/local-terminal destination lookup, current-location exterior inference, destination context, staged result builders, scheduled-event planning lookups/execution, effective per-prompt TinyBrain routing, prose-owned travel with movement tags omitted from event prompts, prompt helpers, LLM/chat/event/save/generation flow, minimum-count location item/scenery validation with required identity prose, ComfyUI cleanup, VRAM-wait-safe prompt timeouts, and the 96000-token Qwen combo local/router model lifecycle with nonfatal router-unload warnings. |
| [config.md](config.md)                                 | Runtime/gameplay configuration, CLI overrides, effective per-label main-model vision routing, player-visible prose and rare scheduled-event routing—including the standard Kimi-prose/local-Artemis setup and retained inactive NanoGPT image configuration, the Kimi-prose/local-Qwen-TinyBrain hybrid, all-Kimi Artemis-image-workflow, and no-reasoning Codex Luna/Kimi-prose profile with Terra event extraction—plus atomic `/dev/shm` Artemis staging, 96k text-only context, three-minute idle sleep, managed ComfyUI handoff, test-only strict completion recording/replay, effective character portrait sizing, same-resolution ComfyUI prompt-list rendering, scope-specific exterior/interior seasonal location edits, path-driven local llama.cpp startup, router startup preloading/unloading, opt-in local slot-cache persistence, maintenance-prompt and tonal-scale controls, base-context quest-capacity guidance, staged TinyBrain prompts, XML repetition recovery, prompt concurrency/caching, and mod enablement. |
| [rebalance-technique-save.md](rebalance-technique-save.md) | Reviewed offline healing repair with exact actor/revision/hash guards, canonical policy compilation, preserved original save, and an atomic separate save copy. |
| [standard_image_workflows.md](standard_image_workflows.md) | Canonical per-model ComfyUI generation and source-resolution-preserving Krea Identity Edit v1.2, Flux Klein, Qwen, and Qwen 2.1 editing graphs, Qwen 2.1 generation and source-model presets, advanced-sampler seed application, the directly loadable filled Krea v1.2 ComfyUI test export, their supported families, shared config-independent named preset persistence, authoritative selected-family/custom-template routing and parameters—including unchanged effective edit-profile settings for seasonal variants—neutral Krea generation graphs using the canonical non-Heretic Qwen3-VL 4B encoder plus Krea's required dual-conditioned identity-edit topology, default-on Flux edit KV-cache bypass control, and structural tests. |
| [slash_commands.md](slash_commands.md)                 | Slash command lifecycle, interaction helpers, reply actions, durable housekeeping quest offers, and implementation conventions.                 |
| [slop_and_repetition.md](slop_and_repetition.md)       | Slop-word, ngram, regex, forbidden-trope, live sampled-token rewind, shared hidden-note-free history analysis, turnResult parsing, repetition-removal systems, and the cache-stable base-context slop-remover path.                |
| [modding.md](modding.md)                               | Mod discovery (including directory symlinks), defs overlays, enablement, runtime/client hooks, bundled mods, and save compatibility.        |
| [modding_hooks.md](modding_hooks.md)                   | Detailed hook contracts for chat tools, XML events, prompts including stage 3 mod steps starting at `3l`, UI, settings, and entity extensions. |
| [playwright.md](playwright.md)                         | Playwright setup and coverage, isolated rendered-page settings tests, live-test save loading, stateful-test isolation, regression run notes, and item-to-currency verification. |
| [ten_turn_api_playtest_gaps.md](ten_turn_api_playtest_gaps.md) | Follow-up checklist of notable supported gameplay actions not exercised during the 2026-08-08 ten-turn backend API playtest. |
| [ten_turn_api_playtest_followup_plan.md](ten_turn_api_playtest_followup_plan.md) | Comprehensive isolated follow-up plans for every ten-turn coverage gap, governed by natural-flow, prose/bookkeeping synchronization, genuine bug-finding, code-owned facts, minimal reusable prompt rules, protected narrative agency, and user-approved-only model-routing changes rather than benchmaxxing or test-passing as an end; includes the prohibition on mechanically policing prose, the shared temporary prose-issues review log, timeout-free API execution, `@@` fixtures, state/persistence/negative assertions, the preserved original 71-case completion boundary, and final backend progress of 146 verified plus 2 retained audited model failures out of 148 exercised cases. |
| [followup_api_playtest_acceleration_plan.md](followup_api_playtest_acceleration_plan.md) | Implementation plan for optional strict prompt-fingerprinted completion replay, declarative scenarios, focused triage, canonical fixtures, minimal profiles, and live verification used to accelerate remaining cases and defect loops without redoing completed pre-harness cases. |
| [followup_api_playtest.md](followup_api_playtest.md) | Implemented follow-up API acceleration workflow with explicit goal alignment for natural prose, synchronized bookkeeping, code-owned facts, general bug fixes, and discussion-before-change model routing; human-review issues go to the shared temporary prose log instead of automatically becoming prompt rules. Covers strict logical-completion cassettes, declarative and asynchronous cancellation scenarios, authoritative outcome/realtime polling, structured triage, immutable fixtures, flexible changed-text entity assertions including synchronized long/concise descriptions, config profiles, server-owned TinyBrain hidden-contest resolution, and complete 148-case backend audit evidence; not a retroactive gate for the original 71 API cases. |
| [model_benchmark_plan.md](model_benchmark_plan.md)   | Implementation plan for a one-command selected-model benchmark over every runnable declarative follow-up scenario, with isolated live-model routing, mechanical grading, executable-coverage accounting, interruption-safe artifacts, and a self-contained human prose-review report. |
| [model_benchmark.md](model_benchmark.md) | Operational guide for the complete 148-case/152-variant one-command model benchmark, including selected-model isolation, pre-harness conversions, immutable fixtures, mechanical grading, interruption-safe and resumable selected-case runs stored under ignored `benchmarks/model/`, runtime-config isolation, audited assertion corrections, diagnostic-only error-log retention, and browser-local human review. |
| [prose_benchmark.md](prose_benchmark.md) | One-command local-router or remote aggregate prose comparison over repeated independent copies of a retained configurable save, with configurable checkpoint, TinyBrain/normal mode, optional immediate post-prose halt, player input, attempt count, complete final saves, separately extracted dialogue, an HTML dashboard, a resumable criteria-driven Codex semantic-judging stage (including the lamia-shoes physical-grounding, humorous-subtext, and social-caution rubric), and a sequential six-model Gemma comparison helper stored under ignored `benchmarks/prose/runs/`. |
| [model_benchmark_current_status.md](model_benchmark_current_status.md) | Historical 2026-08-13 handoff captured at 122/152 variants after REG-3's diagnostic-log-policy rerun, with the then-retained 30 failure diagnoses, recovered error-log audit, goal-alignment constraints, authoritative artifacts, and focused resume workflow; see the remaining-failure audit plan below for the later 134/152 baseline. |
| [remaining_benchmark_failure_audit_plan.md](remaining_benchmark_failure_audit_plan.md) | Failure-directed audit plan for the 18 variants still red after EVENT-4 attempt 5 plus a complete walkthrough of every TinyBrain prompt, prioritizing removal of unnecessary frontier-model self-guidance, control-flow ownership, parser/domain invariants, explicit preservation of genuine LLM agency and functionality, a required follow-up remediation plan and implementation, honest residual model failures, and focused dashboard-updating reruns rather than benchmaxxing. |
| [run_prompts.md](run_prompts.md)                       | `scripts/run_prompts.js` prompt-runner usage and template helpers.                                           |
| [run_all_combinations.md](run_all_combinations.md)     | Prompt comparison helper under `tmp/glm-5.1_vs_glm-5/`.                                                      |
| [potential_redundancies.md](potential_redundancies.md) | Known doc/code redundancy candidates and cleanup notes.                                                      |
| [compact/classes/README.md](compact/classes/README.md)   | Losslessly compact, model-oriented mirror of all class reference documents.                                  |

## UI Docs

The [New Game form](ui/pages.md#new-game) requires an active world profile or
a world supplied by a reviewed Stories setup. Without one, native disabled
controls and top/bottom notices direct the player to Worlds; isolated browser
coverage is described in [playwright.md](playwright.md).

The shared workflow editor removes unavailable optional LoRAs on settings and
preset saves after successful live discovery; see
[standard_image_workflows.md](standard_image_workflows.md#settings-application).
World Profiles send its generation/edit workflow values as objects and preserve
explicit false Use global choices; see [UI](ui/pages.md) and [settings API](api/settings.md).
Its [SearchableSelect](classes/SearchableSelect.md) controls use native
single-choice dropdowns, multi-term search, and live ComfyUI encoder-type,
sampler, and scheduler choices.
Large option lists cache search text/membership and replace fragment-built
choices once per query, preserving every match and the native controls.
Optional LoRAs now use an add/remove table with a numeric strength per row,
persisted in profiles and presets and applied to standard rendering in row order.
The shared selector powers the Add LoRA search; existing string-only selections
retain strength `1`. See the same [workflow settings reference](standard_image_workflows.md#settings-application).
The generation workflow list includes **MOSS Image** and the separate **MOSS
Full Turbo** family/preset, both with core VAE nodes and single/batch generation.
Full Turbo enables positive/negative linear skimmed CFG at `1.5` and defaults
to sampler CFG `35`, with selected styles before its required turbo adapter;
load its preset to apply the full sampling settings. See the
[supported families](standard_image_workflows.md#supported-families).
Editing also includes **Qwen Image 2.1 Edit Skimmed CFG**, a separate family
and preset with regular skim scale `4`, sampler CFG `35`, and unchanged
source dimensions; the original Qwen Image 2.1 edit workflow remains available.

| Doc                                            | Use for                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ui/README.md](ui/README.md)                   | UI documentation scope and entry-point map.                                                                                                                                                 |
| [Portable DOM widgets](../packages/ui-widgets/README.md) | Independent ESM/SCSS selectors, popups, native/modeless overlays, tabs, repeaters and paired fields, with app adapters, build commands, lifecycle APIs and standalone specimens. |
| [classes/DebugUi.md](classes/DebugUi.md) | Shared Debug image/save collections, busy/status/progress ownership and preserved job/reload policy. |
| [classes/ModManagerUi.md](classes/ModManagerUi.md) | Native configured-mod form over shared collections/status with explicit configuration save and cached/final ownership. |
| [classes/FoundationStyles.md](classes/FoundationStyles.md) | Opt-in native field/button/surface/badge/table styles, side-effect-free Sass mixins and retained application cascade. |
| [classes/SubmitShortcut.md](classes/SubmitShortcut.md) | Portable native form/explicit-action Ctrl/Cmd+Enter ownership and thin application adapter. |
| [ui/widget_audit.md](ui/widget_audit.md)       | Current core and bundled mod widget inventory, reuse categories, individual dialog register, coupling constraints and proposed merge order for a decoupled UI library. |
| [ui/pages.md](ui/pages.md)                     | Server-rendered pages, templates, injected data, app header, New Game calendar-aware starting date controls, shared favicon behavior, the seven-tab configuration UI with global image-prompt instructions, shared AI section containers, consistently spaced canonical image workflows and safely serialized searchable selectors, explicit per-game saving, config backups, settings pages, and route notes.                |
| [ui/chat_interface.md](ui/chat_interface.md)   | Main Play interface behavior, tabs, panels, faction-list emblems, image-forward faction tooltips, rich item-style location/NPC hover details, durable expandable and self-repairing quest-offer cards with the themed next-turn reminder, setting-aware quest currency rewards, typed party and route-knowledge reward editing/display with completed-reward route inspection, chat flow/error alerts including committed-travel arrival errors and post-event maintenance failures that preserve successful payloads, prompt-selected companion forwarding, model-bound chat request filtering, keyed chat/prompt-progress DOM updates that preserve disclosures and action clicks, typed player-input surfaces with saved prefixes, selection-stable upper-right AI RPG/managed-llama terminal and prompt-following viewers, icon-only Stop & Undo with terminal staged-prompt/model-lifecycle cancellation and chat-bubble visibility controls, prompt tracker dock including current-row-only table sizing, final-token-safe completion snapshots, 10-character model-name display truncation, universal one-row TinyBrain progress, whole-run averages, the ordinary asymptotic curve, and blue inter-stage waiting, active-prompt favicon progress, chronological prompt-viewer messages, chat-log action controls including in-flight input edit ids, cookie-persisted chat bubble type filtering, and parent-linked turn-diff pruning, inventory lists including AI-backed item search, mobile-safe shared item filters with inventory-modal refresh behavior and narrow-viewport-only scroll-first modal item gestures, mobile two-column modal slot grids, mechanics-aware stack combining, and warning-confirmed item-to-currency conversion with explicit correction errors, tracker sidebar cards/progress fills/hover details/top-layer overlay controls, Story Tools, entity image upload/prompt editing/saved-prompt regeneration, item/scenery-safe active-render spinner/progress overlays, canonical sheltered-weather editing with legacy-value display migration, server-validated configured portrait ratios plus container-sized empty/populated NPC parity and separate player handling, concurrent distinct dragged-item operations on desktop, mobile tap actions, and client data flow. |
| [ui/modals_overlays.md](ui/modals_overlays.md) | Chat-page modal, standard-themed unresolved-quest reminder, shared Ctrl/Cmd+Enter submission, named-tool inline status bar, overlay, tooltip, background summary-failure alerts, browser-suppressible Cache Monitor fallback warning, prompt tracker including blue grouped waiting bars and final-token-safe default-follow persistent viewers, entity image upload/prompt editing fields, alphabetized ability displays with distinct short/full descriptions and level-up draft, quest-card manual completion with reward processing and Adventure return, keeper-wins item stack combiner, natural-height mobile container/barter layouts, crafting touch-drag and non-error implausibility notifications, blank stub descriptions, independently editable stub short descriptions, location-region fixer, and the accessible responsive Route and Travel inspector.                                      |
| [ui/maps.md](ui/maps.md)                       | Region/world map rendering, controlled-region faction-emblem overlays and tooltips, map actions, explored-location context-menu Favorites toggling, shared accessible route inspection with explicit no-route/eligibility state and server-revalidated travel, Story Tools context-menu teleport, cross-region exit deletion with orphaned indicator/vehicle-overlay cleanup, image prompt editing, stubs, and vehicle map state.                                 |
| [ui/relationships.md](ui/relationships.md)     | Play Relationships tab rendering, Cytoscape relationship graph data flow, curve-side endpoint offsets, hidden-character filtering, and missing-id placeholders.                             |
| [ui/assets_styles.md](ui/assets_styles.md)     | SCSS/CSS, assets, portable widget styles, shared effect-form geometry, modal button conventions, vendor libraries, icon colors and responsive styling. |

## Mod Docs

| Doc                                            | Use for                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [mods/modules.md](mods/modules.md)             | Bundled item-module mod: fields, active-setting-aware validation, explicit slot-clearing field conflict feedback, singleton stacked installation, module-link-safe splitting, UI, generation guidance, mechanics, tools, and XML events. |
| [mods/need-bar-lust.md](mods/need-bar-lust.md) | Bundled defs-only lust need bar and its shared runtime behavior.                            |
| [mods/nsfw-boost.md](mods/nsfw-boost.md)       | Bundled NSFW prompt boost mod: scene-filtered sexual-trait definitions with generation-only complete references, flat category defs, per-prompt d6-selected rare generation guidance, Player field, prompts, and tools. |

## API Reference

| Doc                                              | Use for                                                                                                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [api/common.md](api/common.md)                   | Shared payload shapes, chat entries, summary metadata, actor/location/thing/vehicle conventions.                                                                      |
| [api/serialization.md](api/serialization.md)     | Save-directory files, hydration/migrations, including durable `pendingQuestConfirmations.json` offer state.                                                                                                     |
| [api/attributes.md](api/attributes.md)           | Attribute endpoints and the duplicate `/api/attributes` route note.                                                                                                   |
| [api/chat.md](api/chat.md)                       | `/api/chat`, history, prompt modes, arrival-only hostile replenishment after while-away events, deterministic caller-supplied NPC turn queues, model-bound chat filtering, prompt/background-summary failures, scoped tool schemas including full item-XML-aligned `createThing` seeds and generic-admin-only direct concise-description edits with automatic regeneration after long-description patches, exit-button-only code-owned `isExterior` including connected `<location> Interior` regions, matching unparsed BigBrain exterior self-classification for other travel, authoritative scoped attack outcomes, dead/incapacitated attacker rejection, same-turn NPC attack deduplication, pre-prose TinyBrain hidden contests with forced-roll and duplicate-tool reuse, and explicitly legacy-bypassing pre-resolved TinyBrain NPC attacks, context lookup and direct `hasWeather` updates, parser-based housekeeping with persisted multi-turn context, preserved event results plus explicit post-processing errors when automatic housekeeping fails, optional tool-call debug entries, merged split-travel housekeeping, exact-name-or-alias travel companions, sequential TinyBrain movement-event conversations, quest-reward handoff/storage boundary diagnostics, tolerant prose-nested `timePassed` extraction without travel-time double counting, events, cross-region travel-time backfill, while-away candidates, time, and streaming payloads. |
| [api/crafting.md](api/crafting.md)               | Crafting, processing, salvage, authoritative harvestability checks, unlocked player/location-container inputs, strict parser-retried initial/result XML and success-degree consumption validation with rejected-response feedback, normal non-mutating implausibility responses, input consumption, timing, and generated result contracts.                           |
| [api/factions.md](api/factions.md)               | Faction CRUD, standings, relation generation, fill-missing, and prompt-scoped faction field mutation with concise-description regeneration.                          |
| [api/game.md](api/game.md)                       | New/load/save lifecycle, bounded AI RPG/managed-llama terminal-output reads, shared load/new-game cancellation and draining of active turns/choices/prompts/image queues/continuity work, emergency latest-autosave rollback, calendar-aware starting dates validated before reset, CLI startup save loading, new-game runtime reset across world maps/static indexes/async work including maintenance-prompt counters and housekeeping history boundary, mod mismatch handling, active calendar, config overrides, and game state endpoints. |
| [api/images.md](api/images.md)                   | Image generation, persisted entity prompts, distinct item/scenery prefixes and scenery-in-environment guidance, faction emblem alpha masking, saved-prompt regeneration, editable prompt generation, image jobs with ComfyUI sampler progress, shared-context-safe LLM prompt batching, uploads, descriptive browser-save filenames, serving, same-resolution ComfyUI render batching, llama.cpp/ComfyUI unload-or-terminate coordination, and canonical weather/lighting variants whose exterior guidance is labeled `Seasonal appearance`, with dedicated interior seasonal-edit guidance. |
| [api/locations.md](api/locations.md)             | Locations, exits, stubs, relocation, region-membership conflict repair, favorites, modification including normal non-mutating implausibility responses and canonical sheltered weather hints with legacy `outside` compatibility, strict `<things>`-root generated things, generated NPCs, and deletion.                                  |
| [api/lorebooks.md](api/lorebooks.md)             | Lorebook listing and metadata endpoints.                                                                                                                              |
| [api/map.md](api/map.md)                         | Region/world graph payloads, hidden/vehicle-safe exit projection, and route-inspector consumers.                                                                                                                                               |
| [api/misc.md](api/misc.md)                       | Feature flags, health/config tests, strict completion-cassette status/completion/consumption/incomplete-reset controls, text-prompt cancel/retry controls and their distinction from full turn rollback, and slash-command routes.                                                                           |
| [api/mystery-boxes.md](api/mystery-boxes.md)     | Story Tools MysteryBox list/get/update routes and persistence.                                                                                                        |
| [api/mystery-threads.md](api/mystery-threads.md) | Story Tools MysteryThread routes, box assignment, active-thread/per-thread unresolved-box cap validation, and persistence.                                             |
| [api/npcs.md](api/npcs.md)                       | NPC CRUD, aliases, state edits, equipment, committed teleport and arrival-error behavior, party cleanup, and barter sessions including parser-retried structured pricing and generated-stock validation.                                                                              |
| [api/players.md](api/players.md)                 | Player/party endpoints, explicit player-known route/fast-travel preview contracts, strict semantic equipment-result handling, direct moves, cross-region exit travel-time backfill, ability selection with declined-option persistence, stats, inventory serialization, and view preferences.                 |
| [api/techniques.md](api/techniques.md) | Actor technique availability, catalogue/discipline authoring, explicit discipline access, learning, personal revisions, read-only mechanics preview, and ordinary-chat technique uses. |
| [api/quests.md](api/quests.md)                   | Durable cross-client quest offers, while-you-were-away offer linkage, self-repairing pending-offer turn gating and save persistence, quest edits and authoritative benefit options, manual all-objective completion through authoritative reward processing, configurable and event-accelerated completion checks, item rewards, reputation, NPC dispositions, party/route-knowledge benefits, and explicit pending-reward errors.          |
| [api/regions.md](api/regions.md)                 | Region CRUD, generation, vehicle info, weather definitions, and weather state.                                                                                        |
| [api/scene-summaries.md](api/scene-summaries.md) | Story Tools scene-summary list/update routes and chat-tool rerun path.                                                                                                |
| [api/scheduled-events.md](api/scheduled-events.md) | Read-only Story Tools/admin scheduled-event inspection used by persistence and backend playtest snapshots.                                                            |
| [api/settings.md](api/settings.md)               | World profile CRUD, AI fill-missing, optional NPC naming guidance with safe shared name placeholders, defaults, factions, calendar drafts with separate exterior-vegetation and interior image-edit text, tone scale, slop words, and per-target image-prompt-writer instructions.                                                                 |
| [api/things.md](api/things.md)                   | Items/scenery, AI item search and mechanics-validated stack-combine suggestions, equipped-safe inventory/location transfers, stack operations, preview-confirmed whole-stack currency conversion, server-resolved TinyBrain checked-container plans, authoritative lock/event handling, container transfers, module actions, and deletion.                                                       |
| [api/trackers.md](api/trackers.md)               | Browser-facing plot tracker create/load/edit/delete routes for the chat sidebar modal.                                                                                |

## Class Reference

| Doc                                                                        | Use for                                                                                                                                                  |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [classes/NativeDialog.md](classes/NativeDialog.md) | Shared native dialog lifecycle for feedback, New Game, Stories, techniques, attachments, charge reload and log errors: focus restoration, pending dismissal, queued-close safety and disposal. |
| [classes/ModalStack.md](classes/ModalStack.md) | Shared custom-overlay visibility, keyboard, dismissal guards, focus, backdrops and scroll locks; owner callbacks retain feature transactions and policy differences. |
| [classes/AnchoredPopup.md](classes/AnchoredPopup.md) | Portable entity, toolbar, chat-filter and map-menu lifetimes, with injected dismissal policy, portal restoration and detachment cleanup. |
| [classes/CalendarEditor.md](classes/CalendarEditor.md) | Shared Worlds/Play calendar rows, season tabs, nested light descriptions and draft traversal with host-owned validation. |
| [classes/StatusEffectEditor.md](classes/StatusEffectEditor.md) | Shared player/NPC/Location/item effect and modifier forms preserving hidden metadata, optional fields, explicit zero and unavailable saved identities. |
| [classes/FloatingTooltip.md](classes/FloatingTooltip.md) | Shared general/Party tooltip lifecycle, right-left-below viewport positioning, hover transfer, scroll/Escape dismissal and independent package use. |
| [classes/FloatingWindow.md](classes/FloatingWindow.md) | Portable modeless window chrome, focused dismissal and stacking adopted by prompt and terminal viewers. |
| [classes/PointerDrag.md](classes/PointerDrag.md) | Owned pointer dragging with temporary listener cleanup, detach handling and existing viewport bounds. |
| [classes/Tabs.md](classes/Tabs.md) | Shared native tab activation, keyboard navigation, retained panels and extension registration for Play, Story Tools, System, Worlds and workflow editors. |
| [classes/TabList.md](classes/TabList.md) | Button selection and roving keyboard focus, composed by retained-panel tabs and mobile Adventure groups. |
| [classes/Repeater.md](classes/Repeater.md) | Shared delegated row removal, ordering, nested-list ownership and portable row-action controls. |
| [classes/ReaderRows.md](classes/ReaderRows.md) | Owned native row readers and nested disposal for technique and ability-attachment forms, preserving caller markup and validation. |
| [classes/CollectionView.md](classes/CollectionView.md) | Portable collection modes, counts, empty/table presentation and disposal across item holders, choices, readers and action/display cards. |
| [classes/LibraryCollections.md](classes/LibraryCollections.md) | Faction, Favorites, Catalogue, Worlds, Lorebooks, Stories and Story Tools collection adapters with retained selection/domain policies. |
| [classes/ModuleCraftingSlots.md](classes/ModuleCraftingSlots.md) | Fixed-index crafting/workbench slot ownership, shared module choices and originating-session async UI guards. |
| [classes/SceneIllustrationGallery.md](classes/SceneIllustrationGallery.md) | Keyed Gallery cards, lightbox/action disposal, neighbor focus and delete/refresh freshness. |
| [classes/ImageFrame.md](classes/ImageFrame.md) | Native image/placeholder replacement and binding cleanup with stale-event and reentrant-callback protection. |
| [classes/Lightbox.md](classes/Lightbox.md) | Portable rich media viewer, async actions, trigger bindings and special keyboard policy with host-owned error and overlay arbitration. |
| [classes/ExtensionFieldEditor.md](classes/ExtensionFieldEditor.md) | Shared Thing/NPC scalar mod fields, typed values, metadata/default policies and explicit invalid-value errors. |
| [classes/FactionEditor.md](classes/FactionEditor.md) | Shared faction asset/tier row ownership and existing directed relation editing across live, create and Worlds forms. |
| [classes/AttributeSkillAllocator.md](classes/AttributeSkillAllocator.md) | Existing shared allocation controller, native field construction and retained pool/rank rules. |
| [classes/GraphHost.md](classes/GraphHost.md) | Injected graph-engine generations, resource/listener/timer cleanup and status presentation for Region, World and Relationships. |
| [classes/NativeSuggestions.md](classes/NativeSuggestions.md) | Existing-input suggestion ownership, stale query guards and native selection behavior used by vehicle editors. |
| [classes/ActionGroup.md](classes/ActionGroup.md) | Keyed native action buttons with retained focus, caller-owned pending state and explicit teardown. |
| [classes/BusyButton.md](classes/BusyButton.md) | Native busy-button presentation with explicit current eligibility, owned content and teardown. |
| [classes/StatusSurface.md](classes/StatusSurface.md) | Text, visibility and status presentation with replaceable expiry timers and retained child chrome. |
| [classes/NoticeHost.md](classes/NoticeHost.md) | Portable transient notices, owned animation timers and explicit PageFeedback integration for persistent errors. |
| [classes/ChoiceSurfaces.md](classes/ChoiceSurfaces.md) | Entity, saved-game, saved-form, ability and stack-keeper choices composing shared content and listener lifetimes while retaining host selection rules. |
| [classes/SnapshotList.md](classes/SnapshotList.md) | Keyed snapshot reconciliation, stable row identity and error-preserving row disposal. |
| [classes/ProgressMeter.md](classes/ProgressMeter.md) | Finite caller-supplied progress presentation across prompt docks and image-generation overlays. |
| [classes/ProgressMirrors.md](classes/ProgressMirrors.md) | Owned progress surfaces mirrored into explicit application-selected targets. |
| [classes/FollowScroll.md](classes/FollowScroll.md) | Owned follow-scroll intent, selection/readiness policy, observers and queued frame cleanup. |
| [classes/SelectableText.md](classes/SelectableText.md) | Incremental literal text updates preserving native selections in terminal and prompt viewers. |
| [classes/TextGutter.md](classes/TextGutter.md) | Native textarea line numbers, vertical scroll synchronization and explicit owner disposal. |
| [classes/StructuredDetails.md](classes/StructuredDetails.md) | Native disclosure chrome, ordered read-only comparisons and recursive literal projections with host formatting. |
| [classes/TurnStateDiffDrawer.md](classes/TurnStateDiffDrawer.md) | Event-summary drawer, grouped native disclosures, retained severity/category normalization and exact entity routing. |
| [classes/ItemSummaryPresentation.md](classes/ItemSummaryPresentation.md) | Exact persisted item-name ranges and mutation-time rarity snapshots, safe shared Markdown rendering, canonical chips, neutral historical unknowns and first-list notification spacing. |
| [classes/Field.md](classes/Field.md) | Native labeled fields, faithful live-state HTML serialization, explicit field state and password-reveal bindings. |
| [classes/OtherEntry.md](classes/OtherEntry.md) | Native select/custom-text ownership with explicit form eligibility, retained values and released subscriptions. |
| [classes/RegionWeatherEditor.md](classes/RegionWeatherEditor.md) | Shared weather field/row construction with retained validation, nesting and save policies. |
| [classes/QuestEditor.md](classes/QuestEditor.md) | Quest row ownership, saved identity, pending lookup preservation and existing domain collectors. |
| [classes/RegionSecretsEditor.md](classes/RegionSecretsEditor.md) | Region secret rows, persistent owner reuse, validation and save behavior. |
| [classes/OrderedTextList.md](classes/OrderedTextList.md) | Shared memories/goals text rows, native drag and keyboard reordering, values and disposal. |
| [classes/NumberRange.md](classes/NumberRange.md) | Native slider/number pairing for needs and dispositions with caller-owned numeric policy. |
| [classes/ActorAttachmentSystem.md](classes/ActorAttachmentSystem.md)       | Helper for inventory-backed actor attachments such as implants.                                                                                          |
| [classes/base_context_relationships.md](classes/base_context_relationships.md) | Prompt-facing character relationship summaries for base-context character records.                                                                        |
| [classes/CodexBridgeClient.md](classes/CodexBridgeClient.md)               | Codex CLI bridge backend, prompt wrapping, streaming, structured output, and usage reporting.                                                            |
| [classes/ClineBridgeClient.md](classes/ClineBridgeClient.md)               | Cline CLI bridge backend, stdin prompt transport, NDJSON streaming, structured/plain output, and subprocess handling.                                     |
| [classes/ComfyUIClient.md](classes/ComfyUIClient.md)                       | ComfyUI image-generation queueing, list-workflow batching with monotonic overall batch progress, queue deletion/active interruption, abortable WebSocket polling/download/upload, sampler progress, abortable Cache Monitor-first VRAM release that does not misroute cancellation into `/free`, and a private full-cleanup fallback with explicit metadata, plus workflow-template payload notes, bundled workflow dependencies, and Qwen edit-prompt console output.      |
| [classes/Events.md](classes/Events.md)                                     | Standard parse-and-correct event XML with mandatory final quest/combat signals, plus section/category-aware TinyBrain event checks with one sequential movement-turn transcript/log, forgiving camelCase/snake_case/flatcase core XML tag parsing, in-place base-context refresh, player-action-owned movement, authoritative hidden-NPC/Thing/exit reveal lists and the shared exact-exit reveal helper, explicit arrival visibility restoration, invalid-target retry guidance, hidden-NPC name/alias reuse from first-appearance events, safe no-op suppression for exact/companion/status/thing-arrival duplicates, ignored stray movement XML, warning-and-omission handling for genuinely unknown event tags, strict pre-return need-bar response validation, checkpoint-local and aggregate schema-aware required tags, structured inventory-budget and dead-target validation, unambiguous consumed-item effect recovery, model-chosen death or incapacitation, narrow lone-root normalization, strict empty sentinels, checkpoint retry, local XML assembly, post-event maintenance error preservation, and typed quest-reward lifecycle boundary diagnostics; plus ordinary event/housekeeping application. |
| [classes/DispositionHostility.md](classes/DispositionHostility.md)         | Shared disposition-threshold hostility classifier used by client NPC serialization, barter eligibility, combat NPC slot selection, and friendly-transition reconciliation instead of stale raw flags. |
| [classes/EventReprocessor.md](classes/EventReprocessor.md)                 | Latest-turn event-only recovery, saved pass tracking, committed receipt reuse, untracked replay warnings and mutation guards. |
| [classes/EventsEventTypes.md](classes/EventsEventTypes.md)                 | Event type table with payload shapes, application behavior, and TinyBrain zero-health defeat outcome requirements.                                      |
| [classes/EventsXmlEventSchema.md](classes/EventsXmlEventSchema.md)         | XML event-check schema, LLM-facing event tag guidance, and camelCase/snake_case/flatcase parser compatibility.                                            |
| [classes/Faction.md](classes/Faction.md)                                   | Faction model, indexes, reputation, relations, generated oval-masked emblems, card/location/Region Map overlays, and direct field upsert behavior.                                                                         |
| [classes/FactionHousekeepingPrompt.md](classes/FactionHousekeepingPrompt.md) | Standard/TinyBrain faction-development reasoning and compact proposal contracts, tested wrapper/program handoff, earlier saved-game preview, and canonical flow-chart links. |
| [classes/FactionHousekeepingService.md](classes/FactionHousekeepingService.md) | Independent faction cadence, bounded whole-turn history with exact older evidence references and backlog cursors, full faction authoring, sparse relations, atomic saved plans, and the shared Markdown plan digest. |
| [classes/MainQuest.md](classes/MainQuest.md) | Main quest record (spine, roles, stages, endings, pressure ids), single-active rule, offer state, player view, `mainQuests.json` persistence. |
| [classes/MainQuestService.md](classes/MainQuestService.md) | Main quest config, base-context prompts and parsers, TinyBrain sections, prompt block and prominence, plot-analysis pin, lifecycle runtime (start, stages, checks, endings, abandon, pressure). |
| [api/main_quest.md](api/main_quest.md) | Main quest endpoints, background start, automatic checks, realtime events. |
| [classes/FactionFavor.md](classes/FactionFavor.md) | Faction favor record validation against reputation tiers, and favor XML parsing. |
| [classes/FactionFavorEffectRegistry.md](classes/FactionFavorEffectRegistry.md) | Typed favor effects, including fixed or target-filled hydrated grant-item containers, with prepare/apply split and scoped rollback. |
| [classes/FactionFavorService.md](classes/FactionFavorService.md) | Favor status (locked, cooldown, needs presence, available), activation order, rival-witness penalties and prompt rows. |
| [classes/FactionHousekeepingState.md](classes/FactionHousekeepingState.md) | Validated isolated faction-plan snapshots and successful-review boundaries with empty older-save defaults. |
| [classes/InitialFactionStandings.md](classes/InitialFactionStandings.md)   | Strict, configurable, atomic generation of the new player's initial standing with every active faction.                                                                                                                    |
| [classes/Globals.md](classes/Globals.md)                                   | Runtime state, current player/location/region helpers, prompt wiring, realtime emits, world time, calendar-date indexing, and per-season exterior/interior image guidance.                            |
| [classes/IdGenerator.md](classes/IdGenerator.md)                           | First-three-word persisted domain IDs, historical reservations and migration counters.                                                                                                  |
| [classes/OperationalIdAllocator.md](classes/OperationalIdAllocator.md) | Installation-wide category-integer IDs, durable exclusive range leases and cross-process allocation. |
| [classes/OperationalIdRegistration.md](classes/OperationalIdRegistration.md) | Explicit native-load operational identity reservations without interpreting named IDs or prose. |
| [classes/SequentialIdClient.md](classes/SequentialIdClient.md) | Server-owned browser pools, asynchronous low-water refill, multi-tab separation and temporary old-runtime capability gates. |
| [classes/OperationalIdMigration.md](classes/OperationalIdMigration.md) | Current-game UUID migration, chat/request aliasing, exact receipt references, preserved image assets and original charge replay scopes. |
| [classes/DomainIdMigration.md](classes/DomainIdMigration.md) | Detached name-ID migration, exact/derived references, validation, idempotence and unsupported Story boundaries. |
| [classes/DomainIdMigrationRuntime.md](classes/DomainIdMigrationRuntime.md) | Running-world migration transaction, recoverable backup, canonical JSON preservation checks and phase-specific rollback diagnostics. |
| [classes/ItemModuleSystem.md](classes/ItemModuleSystem.md)                 | Singleton-to-singleton module installation including stacked inputs, runtime split registration, persistence-boundary validation, ownership sync, and installed-module bonuses/effects.                                                                   |
| [classes/ImageGenerationModelLifecycle.md](classes/ImageGenerationModelLifecycle.md) | Transactional model/image handoff, optional owned Strata disk snapshot across the render batch, ComfyUI cleanup, cancellation-safe recovery and preserved failure ordering. |
| [classes/ImageWorkflowPresetStore.md](classes/ImageWorkflowPresetStore.md) | Shared config-independent generation/edit preset YAML validation, backup, overwrite protection, and persistence. |
| [classes/SearchableSelect.md](classes/SearchableSelect.md) | Shared native single-choice dropdowns and checkbox multi-selection, space-separated substring search, selection preservation, and host-owned serialization. |
| [classes/KimiBridgeClient.md](classes/KimiBridgeClient.md)                 | Authenticated Kimi Code ACP stdin bridge, native multimodal image blocks, live content streaming, model selection, per-process thinking effort, protocol isolation, structured output, and subprocess handling.  |
| [classes/LLMClient.md](classes/LLMClient.md)                               | LLM completions, backend selection, complete expected-root XML validation with alternative roots and surrounding-text tolerance, opt-in rejected-response validation correction for standard player actions, globally serialized strict prompt-fingerprinted logical-completion recording/replay with whole-TinyBrain reservation ownership, incomplete-recording reset, and latched replay failures, volatile tool-metadata normalization, exclusive model-lifecycle gating, abortable router-queued local model swaps with default-off slot-cache preservation, exact owned-cache termination cleanup, early visible progress with a 5,000-character cold-start target for unconfigured labels, abortable pre-prompt ComfyUI cleanup, managed local startup scripts, execution-scoped tool visibility with fresh task-only guidance only for nonempty callable subsets and no permission messages for disabled tools, adaptive streamed-token handling, cumulative TinyBrain and ordinary tool-loop progress/retries, terminal all-attempt cancellation, warning-based log-write failures, and prompt stats.   |
| [classes/ConfigFileBackup.md](classes/ConfigFileBackup.md)                 | Exact, timestamped, Git-ignored pre-save backups of the selected system-config target, including retained comments and failure behavior. |
| [classes/ConfigSaveTarget.md](classes/ConfigSaveTarget.md)                 | System-config save-target precedence across session override, startup override, and root config, plus readable UI path formatting. |
| [classes/XmlGenerationSchema.md](classes/XmlGenerationSchema.md) | Named XML schema files, optional/multiple cardinalities, safe references/fragments and bounded tag-only continuation. |
| [classes/ThingGenerationSchema.md](classes/ThingGenerationSchema.md) | Canonical item schema pilot, named active-mod fragments and standard/TinyBrain stage-specific wrapper selection. |
| [classes/XmlClosingTagGuard.md](classes/XmlClosingTagGuard.md) | Incremental lexical XML closing-tag rejection, shared QName grammar, independent live-token activation, standard/TinyBrain scope and explicit branch exhaustion. |
| [classes/LiveDeslop.md](classes/LiveDeslop.md)                             | Family-profiled live draft/final slop detection, shared XML/hidden-free history sanitation, player-facing prose mapping and n-gram boundaries, 500-token logprob batches, sampled alternatives, and word-by-word backward rewind. |
| [classes/LlamaCppRouterClient.md](classes/LlamaCppRouterClient.md)         | llama.cpp router model discovery, bounded transient status retries, idempotent startup preload, abortable exact-model unload/load actions, local slot 0 save/restore with model-safe filenames, consumed-cache deletion, program-termination cleanup boundaries, abortable status polling, and endpoint normalization. |
| [classes/ManagedLocalLlmController.md](classes/ManagedLocalLlmController.md) | Configured-only shared header toggle, real readiness/status API, serialized lifecycle control, manual-off prompt/image guards and recoverable stack diagnostics. |
| [classes/StrataRuntimeService.md](classes/StrataRuntimeService.md) | Unique native Strata systemd service, explicit memory/memlock/private-shm containment, private launch receipts, invocation/cgroup verification and bounded exact-unit cleanup. |
| [classes/StrataRuntime.md](classes/StrataRuntime.md) | Native Strata profile ownership, Linux parent-death attestation, exact endpoint/model readiness, guarded owner/instance shutdown, startup cleanup and mockable lifecycle contracts. |
| [classes/StrataImageContextCache.md](classes/StrataImageContextCache.md) | Configurable disk snapshot directory (default `/tmp`) around an exclusive image-render batch, managed-runtime identity, sticky temp-directory support, strict file checks and recovery after cancellation or failure. |
| [classes/LocalLlamaServerProcess.md](classes/LocalLlamaServerProcess.md)   | Path-driven local llama.cpp startup and ownership, separately captured and mirrored bounded terminal output, termination-mode script switching, same-script reuse, configurable strict ComfyUI pre-start cleanup, readiness polling, saved PID/process-group termination, and shutdown ownership. |
| [classes/LocalLlamaModelOptions.md](classes/LocalLlamaModelOptions.md)     | Loopback llama.cpp detection and unique advertised-model discovery for the System Configuration selectors. |
| `scripts/start-qwen-combo-router.sh` / `config/llama-qwen-combo-text-only.ini` | qwen-combo-router launcher and model-specific preset that disable automatic and explicit mmproj loading for local Qwen/Gemma text workers, preserve slot-cache support, and partially CPU-offload the oversized Garnet Q6 model. |
| `scripts/start-all-models-router.sh` | Managed text-only llama.cpp router exposing every top-level non-mmproj GGUF in `/d/llms` through a symlink catalog, with a 105K context and one resident model. |
| [classes/Location.md](classes/Location.md)                                 | Location model, persisted image prompts, universal unstubbing-time support for zero-or-more new location/region exit stubs with explicit invention guidance only when no existing exit is unexplored, bounded malformed-response retries and duplicate/known filtering, visits, favorites, exits, things/NPCs, optional generated metadata, canonical sheltered weather hints and old-save normalization, region membership, and policy-filtered player-safe travel routes. |
| [classes/LocationCreationNameGuard.md](classes/LocationCreationNameGuard.md) | Shared live/pending-region name reservations for new ordinary locations, detached generation validation, existing-location preservation, and region-entry placeholder exemptions. |
| [classes/LocationDanger.md](classes/LocationDanger.md)                     | Canonical location/region wild-danger resolution, faction standing/violence matrix, merged definition validation, and capped half-life arrival probability/source weighting. |
| [classes/LocationHostileArrivalService.md](classes/LocationHostileArrivalService.md) | Arrival-only hostile-deficit planning, saved decisions, destination locking, focused standard/TinyBrain generation, strict validation, precommit revalidation, atomic registration, and diagnostics. |
| [classes/DuplicateNameUtils.md](classes/DuplicateNameUtils.md)             | Shared person/place duplicate-name normalization that ignores case, normalized whitespace, and one leading `the` without altering stored display names. |
| [classes/LocationExit.md](classes/LocationExit.md)                         | Exit model, persisted image prompts, vehicle semantics, travel times, reverse-link helpers, and debug backtraces.                                                                 |
| [classes/LorebookManager.md](classes/LorebookManager.md)                   | Lorebook loading, matching, enablement, and prompt injection.                                                                                            |
| [classes/ModExtensionRegistry.md](classes/ModExtensionRegistry.md)         | Registry for mod hooks, tools, XML events, base and scene-summary prompt contributions, settings fields, UI hooks, entity fields, value/startup validators, and prompt-numbered player-action extensions.                                                     |
| [classes/ModLoader.md](classes/ModLoader.md)                               | Enabled mod loading, symlinked mod discovery, scoped helpers, defs overlays, prompt templates, and public/asset serving.                                                          |
| [classes/ModManager.md](classes/ModManager.md)                             | Filesystem-backed mod manager, enablement diffs, config writes, and pending load intents.                                                                |
| [classes/MysteryBox.md](classes/MysteryBox.md)                             | Persisted private mystery/offscreen continuity boxes, lookup tools, mention history, and editing.                                                        |
| [classes/MysteryThread.md](classes/MysteryThread.md)                       | Persisted mystery threads, active/concluded status, three-unresolved-box capacity, box grouping, and active-context filtering.                            |
| [classes/NanoGPTImageClient.md](classes/NanoGPTImageClient.md)             | Abortable NanoGPT image client and base64 image saving.                                                                                                            |
| [classes/OpenAIImageClient.md](classes/OpenAIImageClient.md)               | Abortable OpenAI image client and base64 image saving.                                                                                                             |
| [classes/NeedBarStatusEffects.md](classes/NeedBarStatusEffects.md) | Keyed need-level YAML templates, conditional source ownership, exact capacity ratios and fixed-unit timing contracts. |
| [classes/SkillCheckValue.md](classes/SkillCheckValue.md) | Shared fixed/percentage skill totals for ordinary, opposed and attack checks without changing stored ranks. |
| [classes/Player.md](classes/Player.md)                                     | Player/NPC model, shared NPC generation fields/guidance and variant/seed contract, persisted image prompts and combat state, inventory, need bars with distinct current/initial values and optional full-refill history suppression, numeric social dispositions, NPC behavioral disposition guidance, derived off-location current-party membership, progression, barter, death, location state, and computed location-vs-region vehicle context including canonical fixed-route destinations. |
| [classes/PlayerActionCompanions.md](classes/PlayerActionCompanions.md)     | Exact canonical-name/alias living-companion validation, dead-actor exclusion from actionable player-action rosters, selection-time shared-alias rejection, canonicalization, party-safe relocation, and the inferred-movement follow-up watch item. |
| [classes/PromptRetryPolicy.md](classes/PromptRetryPolicy.md)               | Shared conversion from configured retries-after-initial into strict total prompt-attempt limits plus state-neutral completion-and-parse retry orchestration, including location item/scenery and barter-pricing XML validation. |
| [classes/ResponseValidation.md](classes/ResponseValidation.md) | Collection of up to ten independent validation errors, nested error flattening, preserved causes and strict partial-result rejection. |
| [classes/PlayerActionDestinationContext.md](classes/PlayerActionDestinationContext.md) | Read-only live TinyBrain destination resolution, pre-draft short/full description, NPC and exit context, selected-destination-aware final movement guidance, expected-arrival absence, and authoritative or graph-derived player travel duration. |
| [classes/PlayerActionResolutionPlan.md](classes/PlayerActionResolutionPlan.md) | Attribute-free combined XML check/attack plans, multiple actions, server-owned resolution, descriptive authoritative receipts without unavailable resolver names, per-action retry identities, and pending-only correction. |
| [classes/PlayerActionTinyBrainResult.md](classes/PlayerActionTinyBrainResult.md) | Parsed TinyBrain player-action state validation, retry-anchored fixed-route vehicle-destination semantics, authoritative committed-travel movement input, and local canonical normal/travel XML assembly. |
| [classes/Quest.md](classes/Quest.md)                                       | Quest model, objectives, giver info, structured physical reward names/descriptions with legacy-save compatibility, typed party and exact-route knowledge benefits, narrative reward notes, independent completion and pending-reward state, direct idempotent rewards, presentation-only reward prose, base-context quest-capacity data and above-soft-limit player-action guidance, indexes, confirmation flow, and terminal declined-tool outcomes. |
| [classes/QuestConfirmationManager.md](classes/QuestConfirmationManager.md) | Durable cross-client pending quest records, safe previews, first-decision resolution, save/load hydration, inline chat linkage, and idempotent orphan-row reconciliation.                                                                                |
| [classes/QuestRewardBenefitRegistry.md](classes/QuestRewardBenefitRegistry.md) | Typed quest-benefit registry, strict handler contract, party-member recruitment, exact directed `knowledge/route` discovery, idempotent applied-id persistence, and explicit recovery behavior. |
| [classes/RealtimeHub.md](classes/RealtimeHub.md)                           | WebSocket hub for targeted and broadcast realtime events, including post-render Cache Monitor fallback warnings.                                         |
| [classes/Region.md](classes/Region.md)                                     | Region model, locations, exits, entry doorways and contextual arrival selection, weather, optional generated metadata, vehicle info, and generation parsing. |
| [classes/SanitizedStringMap.md](classes/SanitizedStringMap.md)             | Case/punctuation-insensitive string-keyed map.                                                                                                           |
| [classes/SanitizedStringSet.md](classes/SanitizedStringSet.md)             | Case/punctuation-insensitive string set.                                                                                                                 |
| [classes/SceneSummaries.md](classes/SceneSummaries.md)                     | Scene summary storage and staged TinyBrain generation, bijective committed-range mappings, contiguous coverage indexing, prefix-preserving manual-deletion recovery, legacy mapping reconciliation, Story Tools edits, and scene lookup/rerun tools.                               |
| [classes/ScheduledEvent.md](classes/ScheduledEvent.md)                     | Persisted scheduled events, due ordering, offscreen applicability, TinyBrain planning lookups, nonredundant validated call plans, immediate post-parse server execution/result assembly, singular permissive interruption contracts, resolution state, and save/load helpers.                 |
| [classes/SettingInfo.md](classes/SettingInfo.md)                           | World profile settings, migration-only saved audit-time restoration, persisted NPC naming guidance in Prompt Guidance, default starting date/time, calendar, per-target image prefixes and global-fallback prompt-writer instructions including faction emblems, slop words, tone scale, and persistence.                                                                     |
| [classes/Skill.md](classes/Skill.md)                                       | Skill model metadata and optional attribute association.                                                                                                 |
| [classes/StatusEffect.md](classes/StatusEffect.md)                         | Fixed and percentage status modifiers, maximum-health percentages, status-owned technique grants, durations, need deltas, and expiry semantics. |
| [classes/TechniqueRuntimeState.md](classes/TechniqueRuntimeState.md) | Technique catalogue, personal mechanics and equipment-access digest used to invalidate stale live story candidates; receipt exclusion and scoped prompt context. |
| [classes/TechniqueFormulaVariables.md](classes/TechniqueFormulaVariables.md) | Automatic level, skill-rank and attribute-modifier variables shared by server/browser, authoritative values, legacy alias preservation, and the reusable reference-table popup. |
| [classes/GeneratedNpcTechniques.md](classes/GeneratedNpcTechniques.md) | NPC catalogue selections and automatic initial authoring after progression/gear, strict references, preserved failure causes, and hostile spawn integration. |
| [classes/StartingTechniques.md](classes/StartingTechniques.md) | Automatic LLM-authored starting repertoires for new players/NPCs, catalogue reuse, validated batch learning, empty/completed initialization receipts, and retry-safe creation hooks. |
| [classes/Technique.md](classes/Technique.md) | Saved disciplines, immutable technique definitions, personal revisions, resource costs, scaling formulas, effects, prerequisites, and item grants. |
| [classes/TechniqueBalancePolicy.md](classes/TechniqueBalancePolicy.md) | Standard healing/damage and area/mixed/status component recipes, target-count pricing, configurable status coefficients, immutable policy snapshots and typed personal improvements. |
| [classes/TechniqueService.md](classes/TechniqueService.md) | Shared catalogue and pinned sources, authoritative weapon/utility execution, resource transactions, reviewed personal reset/rebase, formula snapshots and durable receipts. |
| [classes/TechniqueUtilityEffects.md](classes/TechniqueUtilityEffects.md) | Teleportation with native party/location behavior, existing/template summons with persisted lifetimes and expiry, resurrection, transaction undo and receipt-linked event handling. |
| [classes/TechniquePromptContext.md](classes/TechniquePromptContext.md) | Compact prompt-only actor/source projections, shared balance and formula-variable schemas, actor-specific value maps, explicit resource payment facts and duplicate-free main-action authoring context. |
| [classes/nunjucks_filters.md](classes/nunjucks_filters.md) | Shared template helpers and strict XML-text escaping for compact JSON without redundant quote entities. |
| [classes/TechniquesPanel.md](classes/TechniquesPanel.md) | Shared player/NPC technique editor, standard component recipes, weapon and utility effect authoring/use previews, saved summon templates, guarded catalogue revisions and personal reset/rebase, discipline controls, and ordinary chat turn submission. |
| [classes/AbilityAttachmentsEditor.md](classes/AbilityAttachmentsEditor.md) | Reviewed ability attachment generation/editing with permanent statuses, fixed/percentage modifiers, nested technique grants using shared utility and legacy/current recipe editors, stale-state protection and keyboard-accessible dialogs. |
| [classes/AbilityAttachmentAuthoring.md](classes/AbilityAttachmentAuthoring.md) | Standard two-phase and TinyBrain shared-conversation batch attachment authoring, per-ability selected canonical revision pins, atomic owned application, and independent persisted pending-choice previews. |
| [classes/ModelessChooser.md](classes/ModelessChooser.md) | Shared ability, skill and technique chooser lifecycle, keyboard behavior and chat-cursor insertion; player ability hover/focus details use the shared floating tooltip. |
| [classes/ActionImages.md](classes/ActionImages.md) | Lazy ability/technique/discipline icons using shared image jobs, transparent upper-right horizontal-dot menus, retained terminal outcomes, and explicit prompt editing/regeneration. |
| [classes/PopupDismissal.md](classes/PopupDismissal.md) | Shared native-disclosure popup dismissal, immediate action/outside closing, exclusive opening, Escape focus restoration and detached cleanup. |
| [classes/ActionIconTarget.md](classes/ActionIconTarget.md) | Persisted actor-scoped ability and catalogue-scoped technique/discipline art, strict target identity and stale-runtime protection. |
| [classes/PlayerTechniqueIntent.md](classes/PlayerTechniqueIntent.md) | Main player-action technique discovery, static native/combined-plan normalization, server IDs, rejection locks and authoritative pre-prose execution. |
| [classes/TechniquePrompt.md](classes/TechniquePrompt.md) | Pre-narration technique selection/discovery, reusable discipline naming, shared unresolved-example correction validation, strict JSON/self-target XML examples, bounded character facts, correction logging, explicit ignored-incapacity feedback and replay-safe authoritative results. |
| [classes/TechniqueEvents.md](classes/TechniqueEvents.md) | Typed learning/improvement/evidence commands and exact committed-effect notification references preventing duplicate application. |
| [classes/Thing.md](classes/Thing.md)                                       | Item/scenery model, persisted image prompts, stacks, standard-value currency conversion, concurrency-safe pending containers with logged/retried seed-minimum validation and valid extra contents, atomic placement, tool-free sensible numeric generation, mod fields, effects, values, mechanics checksums, and placement. |
| [classes/ThingMutationService.md](classes/ThingMutationService.md)        | Side-effect-free Thing candidates, canonical field aliases, whole-entity validation, atomic create/update/recreation commits, receipts, batch materialization, and read-only legacy-state audits. |
| [classes/TinyBrainPromptRunner.md](classes/TinyBrainPromptRunner.md)       | Shared staged prompt checkpoints including scene-summary stages, trimmed assignable dummy responses, optional prose-or-N/A parsing, post-parse hooks, continuation/base-context refresh, one-question audits, one player-agency rule plus audit reference, normalized/local-terminal destination lookup, scheduled planning lookups and immediate server-owned plan execution, local result builders, checkpoint-only parser validation with terminal XML-root contracts retained, queue/progress ownership, parser/tool retries, and nonfatal transcript-append warnings.       |
| [classes/TinyBrainPromptFamilies.md](classes/TinyBrainPromptFamilies.md)   | Allowlisted TinyBrain family routing, effective per-prompt model-override resolution, dedicated need-bar and scene-summary programs, local result-builder registration, player-action vehicle/companion control flow, judgment-based random-event handling, scheduled planning lookups, per-family configuration, render-state setup, and shared runner construction. |
| [classes/TinyBrainPromptParsers.md](classes/TinyBrainPromptParsers.md)     | JSON-safe checkpoint parsers with harmless presentation normalization, strict scene-boundary/entry contracts, READY/N/A prefix truncation, required and optional prose-only draft validation, semantic checks, concise scheduled call plans with tool-specific argument preconditions plus server-execution validation, safe duplicate collapse, non-blocking prose-length guidance, optional while-away player prose, selected additional-reunion names and per-NPC HERE updates, canonical while-away XML, player-action fields, and cross-stage invariants. |
| [classes/TinyBrainResultBuilders.md](classes/TinyBrainResultBuilders.md)   | No-LLM assembly of terminal TinyBrain XML, explicit pre-application while-away XML/destination validation, including scene-summary ranges and their following-scene marker, from parser-approved prose, authoritative mechanics, parsed structured blocks, and completed tool outcomes. |
| [classes/TinyBrainXmlResponse.md](classes/TinyBrainXmlResponse.md) | Expected-root-aware extraction for TinyBrain XML with commentary/fence tolerance, ignored inline-code tag mentions, self-closing roots, and strict rejection of malformed final envelopes. |
| [classes/TinyBrainXmlRepetition.md](classes/TinyBrainXmlRepetition.md)     | TinyBrain-only exact completed-XML `AA`/`ABAB` loop detection, stream backtracking, and bounded `continue` recovery. |
| [classes/Tracker.md](classes/Tracker.md)                                   | Persisted plot trackers, typed/canonical values, private value notes, countdown deadlines, event updates, hidden/progress sidebar display, prompt context, mutator tools, browser CRUD edits, and save/load helpers. |
| [classes/UnifiedTonalScale.md](classes/UnifiedTonalScale.md)               | Tone-scale loading, half-step options, dialogue uniqueness axis data, and prompt markdown rendering.                                                     |
| [classes/Utils.md](classes/Utils.md)                                       | Shared parsing, serialization, duration/time helpers, mixed XML/CDATA-preserving and depth-aware XML extraction helpers, migrations, and diagnostics.    |
| [classes/TurnEventRecovery.md](classes/TurnEventRecovery.md) | Interactive route recovery, exact-turn autosave reruns, character time-skips, and explicit event skipping. |
| [classes/VehicleInfo.md](classes/VehicleInfo.md)                           | Vehicle travel metadata, pending destinations, destinationless stops, return-to-departure redirects, pending-region arrival finalization, fixed routes, ETA/departure, null countdown fields without an ETA, and trip state. |
| [classes/base_context_history.md](classes/base_context_history.md)         | Shared caching-mode history selection, late meta extras, recent-only status/level notices, deletion-safe scene coverage and unchanged batched history rollover. |
| [classes/housekeeping_history.md](classes/housekeeping_history.md) | Diagnostic-free turn grouping and prose/event history, with opt-in source rows and bounded batches that preserve deferred review cursors. |
| [classes/housekeeping_update_log.md](classes/housekeeping_update_log.md)   | Player-facing housekeeping tracker and relationship update chat-log summaries with heading-free Markdown bodies.                                         |

## Design Ideas

| Doc                                                                                                | Use for                                                                            |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [strata_terminal_logprobs_patch.md](strata_terminal_logprobs_patch.md) | Durable hash-pinned custom Strata terminal-logprob patch, staged reproduction/deployment boundary, wire contract and model-free verification. |
| [ideas/live_xml_closing_tag_guard.md](ideas/live_xml_closing_tag_guard.md) | Implemented regex-based rejection of mismatched closing tags using open-element state and live rewind, independently of prose de-slopping. |
| [tinybrain_event_checks_overhaul_plan.md](tinybrain_event_checks_overhaul_plan.md)                 | Implemented plan for section/category event extraction, transit handling, strict checkpoint retry, local XML assembly, and tracker-last processing. |
| [tinybrain_parser_hardening.md](tinybrain_parser_hardening.md)                                     | Remaining TinyBrain semantic-hardening backlog, parser-boundary rules, explicit skip for heuristic prose-to-fact enforcement, and retry-feedback follow-up. |
| [ideas/area_attack_tool_plan.md](ideas/area_attack_tool_plan.md)                                   | Implemented plan for `resolveAreaAttack` prose-tool handling.                      |
| [ideas/delta_undo_implementation_plan.md](ideas/delta_undo_implementation_plan.md)                 | Serialized state-delta undo/redo transactions, background settlement, restoration, API/UI rollout, and verification plan. |
| [ideas/dramatis_personae.md](ideas/dramatis_personae.md)                                           | Brainstorm for recurring setting-agnostic NPC casts.                               |
| [ideas/faction_favors_brainstorm.md](ideas/faction_favors_brainstorm.md)                           | Activatable faction favors at positive reputation tiers: definitions, in-game-time cooldowns, presence rules, typed effect catalogue, activation flow, generation and UI. |
| [ideas/faction_favors_implementation_plan.md](ideas/faction_favors_implementation_plan.md)         | Implemented plan (with deviations) for faction favors: model, cooldown state, effect registry, `/api/chat` activation, rival penalties, generation/backfill, prompt block, UI, icons, tests and phases. |
| [ideas/gameplay_improvement_brainstorm.md](ideas/gameplay_improvement_brainstorm.md)               | Gameplay improvement ideas from small UX changes to larger systems.                |
| [ideas/improvement_prompt_existing_features.md](ideas/improvement_prompt_existing_features.md)     | Current implemented systems to tell the improvement prompt about so it avoids duplicate suggestions. |
| [ideas/location_danger_hostile_replenishment_plan.md](ideas/location_danger_hostile_replenishment_plan.md) | Arrival-only wild/faction replenishment with half-life curves, region danger modifiers, faction behavior matrix, tool/event mutations, and verification. |
| [ideas/main_quest_brainstorm.md](ideas/main_quest_brainstorm.md)                                   | Optional main quest line: start popup, outcome-based stages, role bindings, stage quests, pressure clock, silent replanning, main-quest endings, abandoning, and sequel/new follow-up main quests. |
| [ideas/main_quest_implementation_plan.md](ideas/main_quest_implementation_plan.md)                 | Implemented plan (with deviations) for the main quest line: `MainQuest` model, save file, prompts, plot-analysis pin, API, popups, quest panel, tests and phases. |
| [ideas/pending_region_specific_locations_plan.md](ideas/pending_region_specific_locations_plan.md) | Plan for preserving specific location stubs inside pending region-entry stubs.     |
| [ideas/quest_nonmaterial_rewards_plan.md](ideas/quest_nonmaterial_rewards_plan.md)                 | Plan and per-type handler contracts for typed, persistent, idempotent quest benefits such as party recruitment, services, favors, access, knowledge, property, titles, and world changes. |
| [ideas/setting_creation_studio_brainstorm.md](ideas/setting_creation_studio_brainstorm.md)         | Guided setting creation studio brainstorm.                                         |
| [ideas/tactical_battles_brainstorm.md](ideas/tactical_battles_brainstorm.md)                       | Optional tactical conflict scenes, zones, objectives, and rollout ideas.           |
| [ideas/tactical_map_generation_brainstorm.md](ideas/tactical_map_generation_brainstorm.md)         | LLM-assisted tactical map generation and validation ideas.                         |
| [ideas/trade_barter_system_plan.md](ideas/trade_barter_system_plan.md)                             | NPC trade/barter system plan.                                                      |
| [ideas/travel_planner_journey_risk_brainstorm.md](ideas/travel_planner_journey_risk_brainstorm.md) | Travel planning, lodging, foraging, encounters, and journey-risk ideas.            |
| [ideas/user_experience_improvement_brainstorm.md](ideas/user_experience_improvement_brainstorm.md) | UX improvements for player journeys, navigation, diagnostics, and shared patterns. |
| [ideas/world_inspector_editor_brainstorm.md](ideas/world_inspector_editor_brainstorm.md)           | Developer/admin world inspector and editor brainstorm.                             |

## Finished Or Archived Ideas

| Doc                                                                                                                  | Use for                                                        |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [ideas/finished/DayNightCycle.md](ideas/finished/DayNightCycle.md)                                                   | Day/night cycle design draft.                                  |
| [ideas/finished/Factions.md](ideas/finished/Factions.md)                                                             | Faction system design draft.                                   |
| [ideas/finished/header_revamp_brainstorm.md](ideas/finished/header_revamp_brainstorm.md)                             | App header and navigation revamp brainstorm.                   |
| [ideas/finished/minute_time_migration.md](ideas/finished/minute_time_migration.md)                                   | Minute-based time migration plan.                              |
| [ideas/finished/turn_state_diff_drawer_brainstorm_plan.md](ideas/finished/turn_state_diff_drawer_brainstorm_plan.md) | Turn state-diff drawer brainstorm and implementation plan.     |
| [ideas/finished/vehicles.outdated.md](ideas/finished/vehicles.outdated.md)                                           | Older vehicle concept brainstorm.                              |
| [ideas/finished/vehicles2.outdated.md](ideas/finished/vehicles2.outdated.md)                                         | Older setting-agnostic vehicle brainstorm.                     |
| [ideas/finished/visible_weather_image_variants_plan.md](ideas/finished/visible_weather_image_variants_plan.md)       | Implemented plan for location weather/lighting image variants. |

## Implementation Plans

| Doc                                                                                                                          | Use for                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [superpowers/plans/2026-11-05-ui-widget-merge-master.md](superpowers/plans/2026-11-05-ui-widget-merge-master.md) | Full remaining UI merge scope, per-category consumer checklist, ownership, completion gates and accumulated verification evidence. |
| [superpowers/plans/2026-11-05-domain-form-consolidation.md](superpowers/plans/2026-11-05-domain-form-consolidation.md) | Implemented shared calendar/status-effect editors, preserved host policies, canonical model constraints and focused verification evidence. |
| [superpowers/plans/2026-11-05-standalone-dialog-consolidation.md](superpowers/plans/2026-11-05-standalone-dialog-consolidation.md) | Standalone/Stories dialog lifecycle migration, retained draft and transaction policies, acceptance gates and remaining form-family seams. |
| [superpowers/plans/2026-11-05-reader-row-consolidation.md](superpowers/plans/2026-11-05-reader-row-consolidation.md) | Technique/attachment row-reader migration, nested ownership, reentrant cleanup and focused browser evidence. |
| [superpowers/plans/2026-11-05-form-field-consolidation.md](superpowers/plans/2026-11-05-form-field-consolidation.md) | Metadata, scalar mod, faction, module and allocator form migrations, owner lifetimes, responsive verification and required vehicle-choice follow-up. |
| [superpowers/plans/2026-11-05-vehicle-choice-consolidation.md](superpowers/plans/2026-11-05-vehicle-choice-consolidation.md) | Vehicle suggestion/token migration, preserved target snapshots and ETA validation, async/error ownership and focused evidence. |
| [superpowers/plans/2026-11-05-weather-typed-field-consolidation.md](superpowers/plans/2026-11-05-weather-typed-field-consolidation.md) | Weather row lifetimes and Stories scalar markup migration, typed-value reflection and focused verification. |
| [superpowers/plans/2026-11-05-quest-region-row-consolidation.md](superpowers/plans/2026-11-05-quest-region-row-consolidation.md) | Quest/region row migrations, preserved identities and async current selections, error coalescing and test evidence. |
| [superpowers/plans/2026-11-05-choice-surface-consolidation.md](superpowers/plans/2026-11-05-choice-surface-consolidation.md) | Five choice-surface migrations, detached-control cleanup, native selection policies and focused verification. |
| [superpowers/plans/2026-11-05-conditional-native-controls.md](superpowers/plans/2026-11-05-conditional-native-controls.md) | Other-entry, conditional field, secret reveal and dependent calendar migrations, explicit eligibility and consumer verification. |
| [superpowers/plans/2026-11-05-navigation-layout-consolidation.md](superpowers/plans/2026-11-05-navigation-layout-consolidation.md) | Play, Story Tools, mobile and Gallery tab integration, splitter movement and responsive lifetime ownership with retained app navigation rules. |
| [superpowers/plans/2026-11-05-remaining-reader-collection-foundations.md](superpowers/plans/2026-11-05-remaining-reader-collection-foundations.md) | Remaining structured readers, non-item collections, module slots, visual foundations and mod-parity routing with source anchors and consumer gates. |
| [superpowers/plans/2026-11-05-selectable-text-log-reader.md](superpowers/plans/2026-11-05-selectable-text-log-reader.md) | Shared selectable-text updates and Log file/gutter ownership with preserved native reader and request policies. |
| [superpowers/plans/2026-11-05-structured-reader-consolidation.md](superpowers/plans/2026-11-05-structured-reader-consolidation.md) | Chat/Turn/Stories native reader migrations, canonical plausibility template and preserved formatting, open-state and action authority. |
| [superpowers/plans/2026-11-05-action-collection-consolidation.md](superpowers/plans/2026-11-05-action-collection-consolidation.md) | Ability/skill/technique collection ownership, native action-image disposal and preserved chooser/domain behavior. |
| [superpowers/plans/2026-11-05-quest-tracker-display-collections.md](superpowers/plans/2026-11-05-quest-tracker-display-collections.md) | Quest/tracker card ownership, exact action contracts, tooltip identity and cache-safe async UI boundaries. |
| [superpowers/plans/2026-11-05-list-detail-activity-consolidation.md](superpowers/plans/2026-11-05-list-detail-activity-consolidation.md) | Remaining library/list/detail/activity migrations, native document adoption and lifecycle/selection gates. |
| [superpowers/plans/2026-11-05-module-crafting-slot-consolidation.md](superpowers/plans/2026-11-05-module-crafting-slot-consolidation.md) | Module candidate choice, indexed slot/session ownership and Scene Gallery card/freshness consolidation. |
| [superpowers/plans/2026-11-05-portable-visual-foundations.md](superpowers/plans/2026-11-05-portable-visual-foundations.md) | Implemented independent structural style mixins, real consumer mappings and verified theme/cascade parity. |
| [superpowers/plans/2026-11-05-reload-submit-shortcut-consolidation.md](superpowers/plans/2026-11-05-reload-submit-shortcut-consolidation.md) | Reload-source ownership, committed callbacks and portable native submission shortcuts with focused verification. |
| [superpowers/plans/2026-11-05-resource-meter-consolidation.md](superpowers/plans/2026-11-05-resource-meter-consolidation.md) | Shared health/need/vehicle fills with retained host formatting, native resource distinctions and verified rebuild/disposal. |
| [superpowers/plans/2026-11-05-debug-mod-controls-consolidation.md](superpowers/plans/2026-11-05-debug-mod-controls-consolidation.md) | Debug, Mod Manager and local LLM presentation migration, host policies and focused verification gates. |
| [superpowers/plans/2026-11-05-chat-native-reader-consolidation.md](superpowers/plans/2026-11-05-chat-native-reader-consolidation.md) | Shared Chat actions/quest offers, pending ownership and precise native/domain reader dispositions. |
| [superpowers/plans/2026-11-05-registered-mod-ui-parity.md](superpowers/plans/2026-11-05-registered-mod-ui-parity.md) | Actual registered metadata pipelines, bundled mod/native schema dispositions and remaining parity checks. |
| [superpowers/plans/2026-11-05-final-audit-source-reconciliation.md](superpowers/plans/2026-11-05-final-audit-source-reconciliation.md) | Original-family mapping, every static/runtime overlay root and source-grounded portable/native/domain boundaries. |
| [superpowers/plans/2026-11-05-full-widget-disposition.md](superpowers/plans/2026-11-05-full-widget-disposition.md) | Final original-inventory dispositions, accepted evidence and resolved migration/parity/completion gates. |
| [superpowers/plans/2026-11-05-widget-library-overlays.md](superpowers/plans/2026-11-05-widget-library-overlays.md) | Portable native-dialog and floating-tooltip lifecycles, PageFeedback/New Game and general/Party tooltip migrations, standalone specimens and isolated verification. |
| [superpowers/plans/2026-11-05-widget-library-extraction.md](superpowers/plans/2026-11-05-widget-library-extraction.md) | Implemented first portable widget package slice with SearchableSelect/PopupDismissal, application adapters, independent specimens, verification and remaining merge roadmap. |
| [superpowers/plans/2026-10-27-ability-attachments.md](superpowers/plans/2026-10-27-ability-attachments.md) | Ability-owned permanent statuses, fixed/percentage modifiers, status-granted techniques, automatic new-ability authoring, and reviewed existing-ability attachment editing. |
| [superpowers/plans/2026-10-27-prompt-domain-validation-retries.md](superpowers/plans/2026-10-27-prompt-domain-validation-retries.md) | Structured prompt validation audit, correction-loop boundaries, detached preparation, mutation exclusions and regression evidence. |
| [superpowers/plans/2026-10-26-integrated-player-technique-intent.md](superpowers/plans/2026-10-26-integrated-player-technique-intent.md) | User-confirmed integration of techniques, checks and attacks into player_action in both modes while retaining NPC legacy behavior. |
| [superpowers/plans/2026-10-25-techniques.md](superpowers/plans/2026-10-25-techniques.md) | Implemented initial discipline-based technique system, item charge costs and explicit ammunition loading, with verification evidence. |
| [superpowers/plans/2026-11-05-technique-extensions.md](superpowers/plans/2026-11-05-technique-extensions.md) | Approved weapon-based damage, teleport/summon/resurrection effects, standard area/mixed/status recipes, and reviewed personal reset/rebase implementation. |
| [superpowers/plans/2026-10-30-faction-housekeeping-runtime.md](superpowers/plans/2026-10-30-faction-housekeeping-runtime.md) | Faction housekeeping runtime scope, original offset design superseded by an independent faction interval, atomic sparse faction creation, persistence/base-context plans, and mocked verification plan. |
| [superpowers/plans/2026-10-25-technique-balance.md](superpowers/plans/2026-10-25-technique-balance.md) | Implemented standard healing and decreasing Mana costs, configurable recipes, saved policy snapshots, authoring parity, personal upgrades, verified UI/save behavior, and the copied-save Restorative Focus repair. |
| [superpowers/plans/2026-10-26-technique-player-ui.md](superpowers/plans/2026-10-26-technique-player-ui.md) | Discipline sidebar and clickable technique lists, recorded formula breakdowns and learning notices, and independent ability/technique icon prompts and presentation metadata. |
| [superpowers/plans/2026-09-12-hidden-things-exits-first-entry-discovery.md](superpowers/plans/2026-09-12-hidden-things-exits-first-entry-discovery.md) | Implemented creation-time hidden items, scenery, and directed exits; first-entry automatic perception; later reveal events; interaction gating; and UI treatment. |
| [superpowers/plans/2026-09-12-map-route-inspection.md](superpowers/plans/2026-09-12-map-route-inspection.md) | Implemented player-safe route inspection for Region Map, World Map, Favorites, and route rewards, with explicit reachability, steps, eligibility, and hidden-exit protection. |
| [superpowers/plans/2026-09-12-quest-hidden-route-knowledge-rewards.md](superpowers/plans/2026-09-12-quest-hidden-route-knowledge-rewards.md) | Implemented `knowledge/route` quest reward that reveals one canonical directed hidden exit without granting visits or fast travel. |
| [superpowers/plans/2026-05-22-hidden-items-scenery-exits.md](superpowers/plans/2026-05-22-hidden-items-scenery-exits.md)     | Archived earlier hidden items/scenery/exits draft; superseded for automatic discovery, events, and current mutation architecture. |
| [superpowers/plans/2026-05-23-implants-and-mod-hooks.md](superpowers/plans/2026-05-23-implants-and-mod-hooks.md)             | Implant/spell system hooks and mod-owned extension behavior.                                                           |
| [superpowers/plans/2026-05-23-mod-ui-hooks.md](superpowers/plans/2026-05-23-mod-ui-hooks.md)                                 | Mod UI extension layer, manifest, runtime, slots, panels, and bundled examples.                                        |
| [superpowers/plans/2026-05-24-scheduled-events.md](superpowers/plans/2026-05-24-scheduled-events.md)                         | Scheduled event tool, persistence, resolution prompt, and visible/hidden logging.                                      |
| [superpowers/plans/2026-05-26-modular-items.md](superpowers/plans/2026-05-26-modular-items.md)                               | Modular item system, configurable slots, item UI, mechanics hooks, tests, and docs.                                    |
| [superpowers/plans/2026-06-05-regen-party-images.md](superpowers/plans/2026-06-05-regen-party-images.md)                     | `/regen_party_images` command and shared NPC portrait regeneration flow.                                               |
| [superpowers/plans/2026-06-09-map-fast-travel-confirmation.md](superpowers/plans/2026-06-09-map-fast-travel-confirmation.md) | Region Map, World Map, and Favorites fast-travel confirmation.                                                         |
| [superpowers/plans/2026-06-13-improvement-prompt.md](superpowers/plans/2026-06-13-improvement-prompt.md)                     | Periodic visible, prompt-excluded game-improvement suggestions.                                                        |
| [superpowers/plans/2026-06-15-needs-modal-simplification.md](superpowers/plans/2026-06-15-needs-modal-simplification.md)     | Compact needs edit modal implementation tasks, focused UI test, SCSS compilation, and docs updates.                    |
| [superpowers/plans/2026-06-16-player-relationships.md](superpowers/plans/2026-06-16-player-relationships.md)                 | Player/NPC sparse relationship labels, persistence, chat-tool mutation, and docs updates.                              |
| [superpowers/plans/2026-06-16-trackers.md](superpowers/plans/2026-06-16-trackers.md)                                         | First-class plot tracker implementation: model, save/load, prompt context, mutator tools, sidebar UI, tests, and docs. |
| [superpowers/plans/2026-07-01-mystery-box-cleanup.md](superpowers/plans/2026-07-01-mystery-box-cleanup.md)                   | Periodic and manual mystery-box cleanup prompt, parser, slash command, tests, and docs.                               |
| [superpowers/plans/2026-07-02-mod-only-defs-overlays.md](superpowers/plans/2026-07-02-mod-only-defs-overlays.md)             | Mod-owned defs files without root placeholder requirements.                                                           |
| [superpowers/plans/2026-08-06-player-action-tinybrain-non-xml-finalization.md](superpowers/plans/2026-08-06-player-action-tinybrain-non-xml-finalization.md) | Parsed non-XML TinyBrain player-action finalization with vehicle-aware control flow and server-side canonical result assembly. |
| [superpowers/plans/2026-08-07-tinybrain-player-action-destination-revisits.md](superpowers/plans/2026-08-07-tinybrain-player-action-destination-revisits.md) | Implemented live TinyBrain destination resolution, revisit-change guidance, programmatic travel time, and WYWA bookkeeping; current player-facing return-prose storage is documented in api/chat.md. |
| [superpowers/plans/2026-08-29-atomic-thing-mutation-and-recreation.md](superpowers/plans/2026-08-29-atomic-thing-mutation-and-recreation.md) | Atomic, schema-driven Thing creation, updating, alteration, and recreation with structured XML fields, whole-entity validation, nested prompt-progress stages, and idempotent mutation receipts. |

## Design Specs

| Doc                                                                                                                                    | Use for                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [superpowers/specs/2026-05-23-mod-ui-hooks-design.md](superpowers/specs/2026-05-23-mod-ui-hooks-design.md)                             | Registry-backed mod UI pages, navigation, panels, actions, overrides, and lifecycle events.                |
| [superpowers/specs/2026-05-26-modular-items-design.md](superpowers/specs/2026-05-26-modular-items-design.md)                           | Modular item design: base slots, modules, configured slot types, stats/effects, and UI.                    |
| [superpowers/specs/2026-06-05-regen-party-images-design.md](superpowers/specs/2026-06-05-regen-party-images-design.md)                 | `/regen_party_images` design and shared portrait batching reuse.                                           |
| [superpowers/specs/2026-06-15-needs-modal-simplification-design.md](superpowers/specs/2026-06-15-needs-modal-simplification-design.md) | Compact needs edit modal with one icon/name, colored slider, and numeric input row per active need.        |
| [superpowers/specs/2026-06-16-player-relationships-design.md](superpowers/specs/2026-06-16-player-relationships-design.md)             | Sparse semantic character relationship labels persisted on `Player` for a future relationship graph.       |
| [superpowers/specs/2026-06-16-trackers-design.md](superpowers/specs/2026-06-16-trackers-design.md)                                     | First-class plot trackers: persistence, prompt context, sidebar display, hidden toggle, and mutator tools. |
| [superpowers/specs/2026-07-01-mystery-box-cleanup-design.md](superpowers/specs/2026-07-01-mystery-box-cleanup-design.md)               | Mystery cleanup design for periodic checks and `/resolve_mystery_threads`.                                |
| [superpowers/specs/2026-07-02-mod-only-defs-overlays-design.md](superpowers/specs/2026-07-02-mod-only-defs-overlays-design.md)         | Design for mod-owned defs files without root placeholder files.                                            |

## Slash Command Reference

| Doc                                                                                            | Command                                                                          |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [slashcommands/Command.md](slashcommands/Command.md)                                           | `/awardxp` grants exact raw experience points.                                   |
| [slashcommands/MigrateIdsCommand.md](slashcommands/MigrateIdsCommand.md) | `/migrate_ids` (`/migrate_domain_ids`) explicitly converts the loaded world to name-derived shared IDs. |
| [slashcommands/CalendarInfoCommand.md](slashcommands/CalendarInfoCommand.md)                   | `/calendar_info`, `/calendar` displays in-game calendar details.                 |
| [slashcommands/ClearPlotNotesCommand.md](slashcommands/ClearPlotNotesCommand.md)               | `/clear_plot_notes` removes hidden plot summary/expander entries.                |
| [slashcommands/ClearRelationshipsCommand.md](slashcommands/ClearRelationshipsCommand.md)       | `/clear_relationships` removes every stored character relationship edge.         |
| [slashcommands/ReprocessEventsCommand.md](slashcommands/ReprocessEventsCommand.md)               | `/reprocess_events` reruns pending event checks for the latest gameplay turn using its saved prose. |
| [slashcommands/ClearSecretsCommand.md](slashcommands/ClearSecretsCommand.md)                   | `/clear_secrets` removes hidden supplemental/offscreen story info.               |
| [slashcommands/ClearToolCallDebugCommand.md](slashcommands/ClearToolCallDebugCommand.md)       | `/clear_tool_call_debug` removes tool-call debug entries and reloads the page.   |
| [slashcommands/ExitBacktracesCommand.md](slashcommands/ExitBacktracesCommand.md)               | `/exit_backtraces` lists current-location exits with creation backtraces.        |
| [slashcommands/ExportHistoryCommand.md](slashcommands/ExportHistoryCommand.md)                 | `/export_history` exports chat history to text or HTML.                          |
| [slashcommands/FillExitTravelTimesCommand.md](slashcommands/FillExitTravelTimesCommand.md)     | `/fill_exit_travel_times` fills or regenerates region exit travel times and reports nonfatal prompt failures. |
| [slashcommands/FixExitsCommand.md](slashcommands/FixExitsCommand.md)                           | `/fix_exits` repairs one-way location exits.                                     |
| [slashcommands/GameIntroCommand.md](slashcommands/GameIntroCommand.md)                         | `/game_intro`, `/intro` generates intro narration and autosaves.                 |
| [slashcommands/GenerateMissingSkillsCommand.md](slashcommands/GenerateMissingSkillsCommand.md) | `/generate_missing_skills` fills missing skill metadata.                         |
| [slashcommands/GetConfigCommand.md](slashcommands/GetConfigCommand.md)                         | `/get` reads nested config values.                                               |
| [slashcommands/HealCommand.md](slashcommands/HealCommand.md)                                   | `/heal`, `/resurrect` restores health and clears death.                          |
| [slashcommands/HelpCommand.md](slashcommands/HelpCommand.md)                                   | `/help` lists slash commands and usage.                                          |
| [slashcommands/HousekeepingCommand.md](slashcommands/HousekeepingCommand.md)                   | `/housekeeping`, `/runhousekeeping` runs housekeeping with optional instructions. |
| [slashcommands/ImportItemCommand.md](slashcommands/ImportItemCommand.md)                       | `/import_item` imports XML item/scenery entries.                                 |
| [slashcommands/IncapacitateCommand.md](slashcommands/IncapacitateCommand.md)                   | `/incapacitate` applies the Incapacitated status without lowering health.        |
| [slashcommands/KillCommand.md](slashcommands/KillCommand.md)                                   | `/kill` immediately kills a named NPC.                                           |
| [slashcommands/ListNpcsCommand.md](slashcommands/ListNpcsCommand.md)                           | `/list_npcs` lists NPC locations and short descriptions.                         |
| [slashcommands/LocateCommand.md](slashcommands/LocateCommand.md)                               | `/locate` finds NPCs by exact name or alias.                                     |
| [slashcommands/ModelCommand.md](slashcommands/ModelCommand.md)                                 | `/model [model]` shows or updates the main runtime AI model.                     |
| [slashcommands/ModelOverrideCommand.md](slashcommands/ModelOverrideCommand.md)                 | `/model_override` lists or updates runtime override models.                      |
| [slashcommands/NeedBarsCommand.md](slashcommands/NeedBarsCommand.md)                           | `/needbars` lists or directly edits need bars.                                   |
| [slashcommands/OrphanedLocationsCommand.md](slashcommands/OrphanedLocationsCommand.md)         | `/orphaned_locations` lists locations with missing region links or usable exits. |
| [slashcommands/PlotAnalysisCommand.md](slashcommands/PlotAnalysisCommand.md)                   | `/plot_analysis` displays the latest background plot analysis.                   |
| [slashcommands/MainQuestCommand.md](slashcommands/MainQuestCommand.md) | `/mainquest` starts, inspects, checks or abandons the main quest. |
| [slashcommands/FactionFavorsCommand.md](slashcommands/FactionFavorsCommand.md) | `/faction_favors generate` generates favors for factions that have none. |
| [slashcommands/PromptStatsCommand.md](slashcommands/PromptStatsCommand.md)                     | `/promptstats` inspects or clears prompt output-character averages.              |
| [slashcommands/QuestCheckCommand.md](slashcommands/QuestCheckCommand.md)                       | `/quest_check` immediately runs and applies the dedicated quest checker.         |
| [slashcommands/RandomCommand.md](slashcommands/RandomCommand.md)                               | `/random` triggers a configured random event.                                    |
| [slashcommands/RefillNeedsCommand.md](slashcommands/RefillNeedsCommand.md)                     | `/refill_needs` refills stored need bars for one NPC or every NPC.               |
| [slashcommands/RegenPartyImagesCommand.md](slashcommands/RegenPartyImagesCommand.md)           | `/regen_party_images` regenerates current party NPC portraits.                   |
| [slashcommands/RegenFactionEmblemsCommand.md](slashcommands/RegenFactionEmblemsCommand.md) | `/regen_faction_emblems` queues forced emblem regeneration for all active-game factions, reporting queued, joined and native skipped results. |
| [slashcommands/RegexReplaceCommand.md](slashcommands/RegexReplaceCommand.md)                   | `/regex_replace` and generic `regexReplace` apply scoped bulk replacement across story, memory, NPC, location, and item text. |
| [slashcommands/ReloadConfigCommand.md](slashcommands/ReloadConfigCommand.md)                   | `/reload_config [override_file]` reloads config/defs and can select a highest-priority process-local override. |
| [slashcommands/ReloadLorebooksCommand.md](slashcommands/ReloadLorebooksCommand.md)             | `/reload_lorebooks` reloads lorebooks from disk.                                 |
| [slashcommands/ResolveMysteryThreadsCommand.md](slashcommands/ResolveMysteryThreadsCommand.md) | `/resolve_mystery_threads` runs mystery cleanup and reports resolved/revealed candidate decisions. |
| [slashcommands/RespecAbilitiesCommand.md](slashcommands/RespecAbilitiesCommand.md)             | `/respec_abilities` rebuilds ability selections across a level range.            |
| [slashcommands/RespecSkillsCommand.md](slashcommands/RespecSkillsCommand.md)                   | `/respec_skills` rebuilds NPC skill allocation for current level.                |
| [slashcommands/RpCommand.md](slashcommands/RpCommand.md)                                       | `/rp` toggles roleplay mode and related checks, including plot analysis.         |
| [slashcommands/RunPlotExpanderCommand.md](slashcommands/RunPlotExpanderCommand.md)             | `/runplotexpander` runs the plot-expander prompt immediately.                    |
| [slashcommands/RunPlotSummaryCommand.md](slashcommands/RunPlotSummaryCommand.md)               | `/runplotsummary` runs the plot-summary prompt immediately.                      |
| [slashcommands/SceneSummariesCommand.md](slashcommands/SceneSummariesCommand.md)               | `/scene_summaries`, `/summary_ranges` lists stored scene summaries and gaps.     |
| [slashcommands/SceneSummaryCommand.md](slashcommands/SceneSummaryCommand.md)                   | `/summarize`, `/scene_summary` exports ranges with contiguous coverage and performs transactional range/all rebuilds. |
| [slashcommands/ScheduledCommand.md](slashcommands/ScheduledCommand.md)                         | `/scheduled` lists pending scheduled events.                                     |
| [slashcommands/ScrubLegacyDebugCommand.md](slashcommands/ScrubLegacyDebugCommand.md)           | `/scrub_legacy_debug` removes old debug pollution from history/summaries.        |
| [slashcommands/SetConfigCommand.md](slashcommands/SetConfigCommand.md)                         | `/set` updates nested config values at runtime.                                  |
| [slashcommands/SetLastSeenCommand.md](slashcommands/SetLastSeenCommand.md)                     | `/set_last_seen` updates NPC last-seen time/location data.                       |
| [slashcommands/SetLevelCommand.md](slashcommands/SetLevelCommand.md)                           | `/setlevel` sets a player or character level while leaving XP unchanged.         |
| [slashcommands/ShortDescriptionCheckCommand.md](slashcommands/ShortDescriptionCheckCommand.md) | `/short_description_check` lists missing short descriptions.                     |
| [slashcommands/SlashCommandBase.md](slashcommands/SlashCommandBase.md)                         | Base class for slash command metadata, validation, overlays, and listing.        |
| [slashcommands/SlopwordsCommand.md](slashcommands/SlopwordsCommand.md)                         | `/slopwords` reports slop words above configured thresholds.                     |
| [slashcommands/TeleportCommand.md](slashcommands/TeleportCommand.md)                           | `/teleport` moves the player to a location by id or name.                        |
| [slashcommands/TimeCommand.md](slashcommands/TimeCommand.md)                                   | `/time` advances or rewinds world time by a signed duration.                     |
| [slashcommands/TonalScaleEvaluationCommand.md](slashcommands/TonalScaleEvaluationCommand.md)     | `/tonal_scale_evaluation` runs the tonal-scale evaluation prompt immediately.    |
| [slashcommands/VehicleStatusCommand.md](slashcommands/VehicleStatusCommand.md)                 | `/vehicle_status` displays current vehicle route/trip status, preserving unset trip timing as unset. |
| [slashcommands/WeatherCommand.md](slashcommands/WeatherCommand.md)                             | `/weather` displays current-region seasonal weather details.                     |
| [slashcommands/WorldOutlineCommand.md](slashcommands/WorldOutlineCommand.md)                   | `/world_outline` lists regions, locations, and pending stubs.                    |

Story authoring continuation policies, canonical prerequisite preparation, copied pending-outcome recovery and optional setup field descriptors are documented in the linked [StoryBindingService](../mods/story-authoring/docs/StoryBindingService.md), [StoryExecutionBridge](../mods/story-authoring/docs/StoryExecutionBridge.md) and [StoryGenerationService](../mods/story-authoring/docs/StoryGenerationService.md). Shared explicit form submission and owned terminal-progress behavior are described in [modals_overlays](ui/modals_overlays.md) and [PageFeedbackController](classes/PageFeedbackController.md).

The focused missing-field editor fixture renders the real Stories page with mocked API transport; see [StoryAuthoringController verification](../mods/story-authoring/docs/StoryAuthoringController.md#verification).

Shared feedback dialogs restore focus across same-ID control rerenders; see [PageFeedbackController](classes/PageFeedbackController.md).

Shared standalone progress now accepts named owner snapshots through `setJobs(scope, jobs)` and scoped immediate `trackJob` updates. Stories replaces its current jobs and YOLO runs together, removing previous-story/terminal/paused ownership while preserving unrelated consumers; see [PageFeedbackController](classes/PageFeedbackController.md) and [StoryEditor](../mods/story-authoring/docs/StoryEditor.md).

[StorySetupSchema](../mods/story-authoring/docs/StorySetupSchema.md) documents shared strict reviewed setup validation and canonical nested form descriptors. Scoped canonical preparation uses the helper described in [RuntimeProtagonistSetup](classes/RuntimeProtagonistSetup.md).

Fresh story attachment/setup guards, reviewed switches after settled work, concept-only preview semantics and the distinct verified current-saved-timeline restore path are documented in [StoryBindingService](../mods/story-authoring/docs/StoryBindingService.md). [StoryProjectStore](../mods/story-authoring/docs/StoryProjectStore.md) documents ordinary outline copies preserving intentions while removing old-game execution/canonical claims.

The [Stories editor](../mods/story-authoring/docs/StoryEditor.md) distinguishes YOLO generation steps from traversal-only completion receipts when reporting a complete scope. Its content buffers synchronize generation-only revision updates against an unchanged saved baseline/authored context; actual content/context conflicts still require explicit review.

Every Stories outline form supports **Generate missing fields** (Alt+G), preserving existing values and concurrent edits in an unsaved draft. [StoryGenerationService](../mods/story-authoring/docs/StoryGenerationService.md) documents its strict missing-key response patch, source-aware shared base-context prompts, isolated read-only projections, cancellable jobs and freshness checks. Save and approval remain separate.

The [New story form](../mods/story-authoring/docs/StoryEditor.md#generate-missing-fields) also generates blank fields before explicit Create, with retained session drafts and scoped transient jobs. Stories uses a [native top-layer dialog shell](../mods/story-authoring/docs/StoryEditor.md#shared-dialog-shell) so its title and close controls stay above the production header and glass container.

[StoryContextBuilder](../mods/story-authoring/docs/StoryContextBuilder.md#read-only-base-prompts) explicitly completes the shared wrapper's attribute/skill collection contract for read-only narrative projections, including no-game creation, without consuming unrelated live mechanics.

Story-bound Play receipt capture shares the actor’s public-passage filter and validates coherent saved candidates before installation. Blank/auxiliary canonical history is excluded from evidence without modifying game history or weakening imports; valid failed-sync receipts remain readable and block advancement. See [StoryExecutionBridge](../mods/story-authoring/docs/StoryExecutionBridge.md) and [StoryBindingService](../mods/story-authoring/docs/StoryBindingService.md).

Shared prompt-owner snapshot regression coverage and isolated Stories dock cancellation are documented in [PageFeedbackController](classes/PageFeedbackController.md); the combined affected test command is in [StoryAuthoringController](../mods/story-authoring/docs/StoryAuthoringController.md#verification).

Live-source authoring candidates capture a separate runtime generation/checkpoint fingerprint, preserving semantic source portability and owned partial setup retries; reviewed apply and initial setup commit reject stale live candidates. See [StoryGenerationService](../mods/story-authoring/docs/StoryGenerationService.md) and [StoryBindingService](../mods/story-authoring/docs/StoryBindingService.md).

[RuntimeProtagonistSetup](classes/RuntimeProtagonistSetup.md) initializes abilities through canonical player offers; reviewed setup retains those pending choices and does not use NPC post-generation ability assignment.

The [YOLO coordinator](../mods/story-authoring/docs/StoryOutlineRun.md) checks live-runtime identity separately from semantic source identity when reusing or accepting completed generation jobs. Its persisted step key and exact older-job pointer prevent repeat generation after an interrupted candidate receipt.

Detached image load events during character/location refresh are handled in the existing entity renderer; see [assets_styles.md](ui/assets_styles.md).

Character hover/lightbox rendering hydrates newly generated status-granted technique names before location and party updates. The shared catalogue request ordering and stack-bearing unknown-reference errors are described in [modals_overlays.md](ui/modals_overlays.md), [chat_interface.md](ui/chat_interface.md), and [TechniquesPanel](classes/TechniquesPanel.md).

The [Stories Main plot](../mods/story-authoring/docs/StoryEditor.md#main-plot) edits the existing canonical root outline, separately from its brief premise, and appears in New story before creation. [Shared generation guidance](../mods/story-authoring/docs/StoryGenerationService.md#complete-story-planning) directs ordered outline sections toward a complete finite arc and intended resolution while preserving actual game agency and outcomes.

[Manual Stories generation](../mods/story-authoring/docs/StoryEditor.md#instructions-before-manual-generation) asks for optional transient instructions before launching. The shared native dialog preserves the original New story form while asking, and [generation prompts](../mods/story-authoring/docs/StoryGenerationService.md#request-instructions) place captured guidance before bulk context with XML-safe wrapper rendering.

Manual [outcome preparation](../mods/story-authoring/docs/StoryExecutionBridge.md) reuses active/pending work only for matching instructions; changed guidance requires explicit cancellation or current-suggestion review.

[Story save-source discovery](../mods/story-authoring/docs/StoryBindingService.md) lists only immediate save directories with readable metadata manifests, excluding archive containers without hiding corrupt saves or other read errors. Direct saved-world selection remains strict.

[Scoped Stories Play approval recovery](../mods/story-authoring/docs/StoryExecutionBridge.md#scoped-play-approval-recovery) lists required leaf/ancestor approval records and explicitly approves/synchronizes only that reviewed scope before continuing. Content or actual timeline differences remain subject to existing reconciliation; [the editor](../mods/story-authoring/docs/StoryEditor.md#approve-required-sections-and-continue) preserves stale candidate errors inline without reviving their output.

[Play approval recovery verification](../mods/story-authoring/docs/StoryAuthoringController.md#verification) includes the focused `StoryPlayApprovalRecovery.test.js` service checks and full-shell `story-approval-recovery.spec.js` browser fixture.

[Current-target technique damage](classes/TechniqueDamageEffectiveness.md) shares ordinary attack assessment guidance and [multiplier math](classes/DamageEffectiveness.md) across weapon and other damage before rolls. [TechniqueService](classes/TechniqueService.md#current-target-damage-effectiveness) preserves per-effect/target ratings and stale-fact checks. The [technique editor](classes/TechniquesPanel.md) retains existing legacy ratings without offering a new authored rating control. Disabled PC/NPC attempts return explicit ignored feedback and continue; [TechniqueReport](classes/TechniqueReport.md) rounds damage/healing presentation while saving exact receipts and health.

The [sequential IDs, stacked crafting and ability-batch plan](superpowers/plans/2026-11-08-sequential-ids-stacked-crafting.md) records the implemented UUID compatibility/migration boundaries, native quantity selection and consumption contracts, item-summary formatting, sequential TinyBrain attachment authoring and passing verification. Restart and migration execution require separate user authorization.

The shared [quantity dialog](ui/modals_overlays.md#crafting--processing) stays above crafting and barter modals, displays the available maximum at the end of its question, and has browser coverage for pointer access and Escape/Enter routing while the parent remains open.

Stack-combiner image inspection reuses the [full item lightbox and tooltip](ui/modals_overlays.md#image-lightbox), including light-grey item level text, while card selection retains the keeper choice.
