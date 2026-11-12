# ResponseValidation

`ResponseValidation.js` collects up to ten distinct actual validation errors in encounter order. The cap applies across nested collectors and ordinary error wrappers whose causes contain an aggregate; identical messages are deduplicated. It collects independent invalid values, unsupported fields, incompatible combinations, missing fields and invalid records, rather than only missing selectors.

Technique component resolution collects independent payment-profile, scaling
skill, scaling-attribute and affected-stat choices within each component, so a
missing skill no longer hides a missing buff attribute until a later retry.
Errors retain exact field/component identity, purpose, actual eligible values
and XML placement. Affected stat-name validation waits for a resolved stat kind;
no dependent cascade or partial normalized recipe is returned.

`ValidationIssueCollector.capture(validate)` records a thrown rule error and allows independent sibling checks to run. `add(error)` flattens nested collected errors into the same ten-problem budget. `full` and `size` expose that budget. `throwIfAny()` must run before returning a parsed or normalized value: one unwrapped issue rethrows its original error; multiple issues throw `ResponseValidationError`, with a numbered `message`, frozen `issues` and first-error `cause`. The aggregate constructor also flattens, deduplicates and caps its input. `withValidationContext(error, context)` prefixes each issue separately. Contextual leaf errors retain their original cause, and explicit prompt cancellation propagates immediately, including through contextual causes and nested aggregates.

Covered boundaries include:

- [TechniqueXml](TechniqueXml.md) typed fields/lists and discipline entries/groups; [Technique](Technique.md) identities, provenance, requirements, costs, checks, targets, nested statuses/modifiers/grants and independent revision/evaluated-amount checks.
- [TechniquePrompt](TechniquePrompt.md) automatic candidate rules and placeholders; [TechniqueBalancePolicy](TechniqueBalancePolicy.md) recipe shape, kind/ID consistency and actor skill/attribute/resource selections. An invalid optional selector value and independent missing/unknown selectors can appear together.
- [AbilityAttachmentAuthoring](AbilityAttachmentAuthoring.md) pure status/candidate validation and [TechniqueService](TechniqueService.md) detached attachment statuses/entries, actor attributes/skills, evaluated amounts, costs and prerequisite references. Invalid entries never become available to sibling checks; a rejected status discards its detached catalogue additions.
- [StartingTechniques](StartingTechniques.md) final-response actor records, candidate siblings and missing actor coverage, shared by standard generation and TinyBrain expansion checkpoints.
- [PlayerActionResolutionPlan](PlayerActionResolutionPlan.md) recursive fields/lists and independent action records; [InitialFactionStandings](InitialFactionStandings.md) standing fields/records/coverage; [FactionHousekeepingPrompt](FactionHousekeepingPrompt.md) worksheet/proposal fields and references; [TinyBrainPromptParsers](TinyBrainPromptParsers.md) need-bar records, reward rows, WYWA character updates/item names and final sections.
- [LLMClient](LLMClient.md) independent configured required-tag checks after successful XML parsing. Domain response validation follows only after those structural prerequisites pass.

Collected problems reach existing standard and TinyBrain correction conversations through [XmlRetryFeedback](XmlRetryFeedback.md), without changing retry budgets. Checks requiring an invalid discriminator or unavailable normalized value wait until that prerequisite is corrected. No facts, successful values or mechanics are fabricated to reach later checks; invalid partial objects remain local and reject before acceptance or commit.

This is an expansion of the named shared boundaries, not a conversion of every parser. Malformed XML, unresolved parent branches, permanent outer-status constructor internals, TinyBrain starting rosters and other checkpoint families, stateful first-use identity callbacks, managed-policy internals and some downstream service-reference rules can still report one issue. Collection does not change transport handling, application, save state or the live per-token XML guard. Existing ID reservation/allocation during detached authoring remains unchanged; rejecting a draft installs no catalogue or actor state but can reserve IDs.
