# TechniquePrompt

`TechniquePrompt.js` supplies shared strict automatic-authoring/operation parsers and prepares scheduled NPC techniques plus deterministic explicit player UI Use operations. Natural player actions now integrate into the existing standard/TinyBrain `player_action` conversation through [PlayerTechniqueIntent](PlayerTechniqueIntent.md), without a separate `technique_intent` request or explicit none response. UI Use retains ordinary `/api/chat` turn gates and source/revision pins.

Main character blocks contain concise Markdown repertoires. Before resolving a
technique, standard actions retrieve selected authoritative XML with read-only
`getTechniqueDetails`; TinyBrain has a strict selection checkpoint before each
existing mechanics plan. Explicit `discover` selects acquisition/authoring facts;
unknown `use` references fail with correction guidance. This changes context
delivery, while existing operation validation, source selection and execution
remain authoritative. Scheduled NPC/starting/attachment authoring retains its
self-contained targeted context. See
[TechniqueSelectionContext](TechniqueSelectionContext.md).

The scheduled-NPC standalone logged `technique_intent` structured prompt receives a bounded projection of the actor's health/dead/disabled state, actual skills, attribute modifiers, abilities, active needs, colocated actor identities, a grouped ID/name/stored-short-description lookup of relevant public catalogue techniques, available technique sources, bounded `balanceAuthoring` recipe/profile choices and per-technique `balanceImprovements` saved-policy steps, and the actor’s canonical `formulaVariables` catalogue. Its supplied facts use nested XML elements rather than JSON. The broad lookup omits full catalogue mechanics; exact IDs resolve authoritative definitions on the server while actor-owned usable source mechanics remain. It never serializes the whole server base context, configuration or Globals. New technique identities are reserved from the first readable, nonplaceholder candidate name before mechanics parsing, through the shared first-three-word name allocator; no identity is allocated before a name is available. Discipline identities are resolved lazily from the proposed title using the same allocator, while canonical title matching uses the complete NFC lowercase snake_case title. Existing normalized-title catalogue records retain their IDs and rules. The first readable proposed discipline title and assigned ID stay locked through corrections. `getTechniqueCreationInstructions()` shares the complete creation contract with other generation workflows. It includes complete nested XML candidate/discipline examples and explicit typed schemas for requirement arrays, checks, costs and effects; requirement strings such as `"Spellcasting >= 1"` are invalid. For nonhealing custom mechanics it requests `{formula}` amounts using known canonical variable keys without repeating binding maps or current values; resource names such as `mana` are not formula variables. The same instructions and parser validation apply to standard and TinyBrain preparation.

[StartingTechniques](StartingTechniques.md) reuses that creation contract for
automatic initial character repertoires, assigning IDs/provenance in the engine.
Discipline requirements can use actual class/race identity as `{ kind: 'class' |
'race', name }`, alongside established training/ability requirements.

Authoring instructions define disciplines as reusable traditions or fields, prefer
an appropriate existing discipline, and prefer an actual skill's name when it
already names the practice (for example Spellcasting). Examples use explicit
`DISCIPLINE_NAME` / `DISCIPLINE_DESCRIPTION` and technique identity placeholders,
not plausible copyable names. Empty example requirements are structural examples,
not unrestricted access; neither the example nor the requirement shape examples
establish a default minimum skill rank of 2.
`parseAutomaticTechniqueDiscipline()` and `parseAutomaticTechniqueCandidate()`
reject unresolved known example tokens with a field-specific correction error.
New candidate parsers also reject `candidate.unique` with removal guidance;
the retired flag is not a model authoring choice. Full normalized candidates
returned to service authoring omit this saved-only metadata.
First-use, starting repertoire and event learning share this validation. Existing
saved disciplines and manual editing still use the normal domain validator; they
are not renamed or retroactively rejected. The prompt retry test verifies that
the model receives the naming error before a corrected discipline is committed.

`parseTechniqueIntent()` accepts one `<techniqueIntent>` root. `kind` is `none`, `use` or `discover`. Operations have text-only `actor`, `intent`, `techniqueId`, optional `sourceId` and `weaponItemId`, optional nested `utilitySelections/selection` keyed by effect ID, and `targets` containing distinct `targetId` children. Discovery identifies an existing catalogue technique by ID without repeating known mechanics, or supplies one nested XML `discipline` group for a novel technique: existing parent ID OR new parent metadata, followed by exactly one child technique/candidate without repeated disciplineId or server-owned identities. Both use and discovery require explicit targets; a self technique names the acting actor's ID as its sole target. New standard healing, damage, buff/debuff and mixed/area candidates use `revision.recipe` semantic components with actor-aware selectors. They omit costs, failure costs, effects and balance metadata; the server materializes canonical mechanics and saved policy before domain validation. Deliberate custom damage, weapon-based damage and utility effects use the complete strict mechanics schema. `parseAutomaticTechniqueCandidate()` validates the recipe proposal envelope while retaining its raw DTO until the service has the authoritative actor; present metadata on ordinary definitions still receives full domain validation. Attributes, duplicate/unknown fields, malformed nested XML, invalid IDs, duplicate targets, unsupported mechanics and inconsistent candidate IDs fail explicitly.

Parser correction uses the configured retry budget and logs the full attempt conversation with field-level errors. A recognized technique cannot become `none` or a different technique after rejected preparation. Parsing performs only preview/preflight. Actual check preparation and commit run once after parsing/logging succeeds, outside the parser retry boundary; cancelled rolls, stale preparation and execution failures are propagated without rerolling.

Shared candidate validation, including recipe proposals, collects up to ten independent field/rule problems through [ResponseValidation](ResponseValidation.md). This includes multiple invalid fields in one candidate/revision, rather than requiring separate candidates. Actor-aware recipe compilation and final service preparation retain their existing once-per-attempt validation boundary.

Optional outer XML scalars (`sourceId`, `operationId`, `newAttempt`, `discoveryIntent`, and discovery `techniqueId`) treat empty or whitespace-only text as omission. Required actor/intent/kind and known-use techniqueId remain nonempty; a grouped novel operation requires exactly one validated child candidate. Attributes, nested markup and duplicates remain errors. Shared candidate/discipline leaf omission rules are documented in [TechniqueXml](TechniqueXml.md); domain checks, receipt-reference exclusivity and explicit `newAttempt` values remain unchanged.

The shared parser marks narrative discovery and novel candidates with the
native-only `acquisition.establishDisciplineAccess` authority. Standard player
tools, TinyBrain plans and standalone NPC intent therefore establish an absent
explicit discipline-access record only when the new learning actually commits.
Preview and rejected/cancelled attempts remain read-only. This replaces only the
discipline-access gate; technique acquisition/use requirements, source
qualification and all mechanics validation remain enforced. No new XML field or
public-access change is involved; see [TechniqueService](TechniqueService.md).

`getStartBlocker(actor)` returns the authoritative dead/disabled/zero-health reason. Production standard/TinyBrain tools, plans, explicit UI Use and scheduled NPC preparation check it after committed replay and before source/target preview. A blocked attempt returns explicit model-facing ignored feedback, completes its attempt bookkeeping, and continues without checks, costs, learning or effects; it creates no receipt. `assertCanStart(actor)` and internal preflight/commit remain strict defenses. Already committed attempts still replay when the actor is now disabled.

This structured preparation request sends an empty tool schema with `none`,
uses its parser as the single XML/semantic correction boundary, and propagates
transport/cancellation failures. It does not introduce an inner XML retry loop.

Source selection uses `TechniqueService.resolveSource`: learned personal mechanics take precedence; differing equipment versions require explicit selection. UI metadata pins `sourceId`, definition revision and personal revision. The server revalidates pins and colocated targets; an invalidated source fails rather than substituting another version. A committed retry returns the saved receipt before requiring the source to remain equipped.

`receiptInvocation()` adapts saved receipts into structured `useTechnique` invocations, retaining the nested source identity and requested target IDs. The request ID scopes stable primary player/NPC operation IDs, and ordered TinyBrain plans use checkpoint/ordinal identities. These receipts feed narration, event duplicate prevention, structured API notifications and NPC action-opportunity exclusion. A miss or helpful non-damaging committed attempt consumes the actor's current opportunity; preflight rejection does not.

Before a teleport check or charge, the chat adapter expands a selected existing location stub through the native location preparation path and reruns technique preflight. Standard tool execution and TinyBrain resolution plans yield their prompt queue reservations while expansion may generate a location. A region-entry stub that resolves to a different location ID requires an explicit new destination selection or fixed-destination revision; the saved mechanic is never silently retargeted. A successful player teleport adds the current destination's authoritative ID, name, description and region to the standard tool result or TinyBrain retained resolution result before prose. The request-local location is refreshed for following scene work. Committed receipt replay supplies the saved transition without moving the player again; existing once-per-arrival while-you-were-away, hostile arrival and discovery processing remains the arrival hook.

## Attempt references

`resolveTechniqueAttemptIdentity` validates a model-selected reference against a committed `use` receipt from the current turn with identical actor, technique, source and target set. XML technique operations accept optional `operationId` (reference only) or `newAttempt: true` (deliberate additional attempt), never both. A matching prior receipt without either field produces correction feedback rather than charging again or silently merging distinct attempts. New execution IDs remain server-owned. `collectCommittedTechniqueReceipts` deduplicates receipt references by operation ID for client/event payloads.

Standard attack tools expose analogous `techniqueOperationId` and `newTechniqueAttempt` fields, with explicit intent required for a deliberate repeat. A known technique ability always routes to the technique service, including intentional repeat attempts, instead of adding ordinary weapon damage. Normal unrelated attacks retain their existing behavior.

Native attack result caching preserves this identity contract: explicit references include the receipt and arguments in the cache identity; deliberate new attempts use their server tool-call identity. An unflagged later call cannot silently reuse a cached technique result from a different tool-call identity. Ordinary weapon-attack caching is unchanged. The `useTechnique` definition is exposed only when `getChatToolDefinitions({allowTechniqueExecution: true})` opts into an available executor; standard action routes enable it, other prompt families omit it by default.

The standalone intent request selects `technique-intent.schema.xml`. Engine-reserved IDs/provenance and fresh revision 1 need not be repeated by the model; consistent explicitly supplied canonical values remain accepted. Native tools retain outer JSON arguments; novel authoring supplies the shared XML group in disciplineXml. Saved/editor DTOs retain their existing shapes.

Automatic candidate validation uses [ResponseValidation](ResponseValidation.md) for independent identity/mechanics rules and unresolved example placeholders across fields. Ordinary contextual wrappers preserve each aggregated problem for shared correction feedback. First-use identity reservations and operation callbacks retain their existing stateful ordering.

Damage preparation receives the same runtime assessment callback as native standard/TinyBrain tools and UI Use. Ignored invocation metadata contains `ignored: true`, actor/technique IDs and the authoritative reason, without `error` or a fabricated `techniqueReceipt`. NPC narration receives this feedback explicitly. Receipt narration uses [TechniqueReport](TechniqueReport.md); canonical metadata remains exact.
