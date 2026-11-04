# Live XML closing-tag guard

Implement the approved design in docs/ideas/live_xml_closing_tag_guard.md without
runtime controls, game restarts or real-model tests.

Use effective ai.xml_closing_tag_guard (default false; enabled in the managed
Strata profile) independently of prose deslop. XML scope is explicit true/false or
auto leading-output recognition. Known XML validation/roots promote auto to true;
known plain TinyBrain stages explicitly bypass both guard and logprob overhead.
Unknown/custom XML outputs remain covered by leading actual-XML recognition,
including fences/comments/PI and orphan closing tags. CLI capability mismatch
fails explicitly for XML-eligible requests; unconfigured providers stay unchanged.

An incremental scanner shares xmldom QName grammar, ignores comments/CDATA/PI and
quoted delimiters, tracks the open stack, and tests real closing tokens with a
dynamic rejecting regex. Rewinding reconstructs retained-prefix state. Extend the
existing LiveDeslop branch selector for raw XML, allow ordinary markup tokens,
exclude special/control alternatives, and preserve native tools. Compose this
structural check before ordinary prose inspection. Inspect opaque text without
inventing sampled token records; exhausted/unavailable alternatives fail clearly.

Retain existing stream/nonstream continuation, retry boundaries, logging and strict
final XML/domain validators. Do not repair completed responses, invent required
fields, or prevent premature EOS. Tests use scanner fixtures and mocked standard/
TinyBrain token transports, with prose guard on/off and missing metadata cases.

## Verification and deployment boundary

Scanner and mocked standard/TinyBrain transport tests cover nested/duplicate/wrong
closes, Unicode/namespaces, split prefixes, comments/CDATA/PI/quoted attributes and
DOCTYPE subset comments, retained-prefix rewinds, opaque text, exhausted branches,
special-token rejection, plain bypass, tool preservation and both prose/structural
guards together. An affected 36-case batch also exercised the scripted Strata
MockEngine HTTP fixture without loading a model/GPU. Forced fixture checks retain
final-parser behavior; they cannot establish live token correction.

Changed JavaScript syntax and YAML flag checks pass. The default remains false;
the managed Strata profile opts in. No server restart, live model call or runtime
control was performed by this implementation work. Final XML/domain validation and
premature-EOS behavior remain unchanged.

Final focused fixture/QName boundary checks passed 3/3, including explicit forced
valid/invalid XML and non-strict file-fixture misses retaining real-call guarding.
Full attribute grammar remains the final parser's responsibility; no additional
attribute validator was added to this closing-tag guard.

## Response-root coverage audit (2026-11-04)

The audit followed `LLMClient.chatCompletion` callers, shared completion/tool-loop
adapters and their request options in top-level application JavaScript and the
checked-in mod sources (including ignored mod directories). It reviewed
`validateXML:false`, custom response validators, required-regex requests, named
schemas and staged parser/final callbacks. Roots come from declared parser/schema
contracts, never from scanning prompt examples or generated response text.

| Request group | Declared XML scope |
| --- | --- |
| Existing ordinary gameplay/event/housekeeping, selector, alteration and generation requests | Their existing `expectedXmlRootTag(s)` or named file-schema root; alternative normal/travel/rejected envelopes retain their existing ordinary acceptance contracts. |
| Shared NPC parse-retry generation | Its existing `responseRootTag`, including schema-less `npcInfo` requests. |
| Faction autofill | `faction`. |
| Ordinary faction housekeeping | `factionHousekeepingProposal`. |
| Standalone spells mod generation | `spell`. |
| Built-in TinyBrain checkpoints | Output metadata on the actual parser functions, including dynamic root arguments; plain parsers explicitly declare plain output. |
| Custom TinyBrain event, location-Things, resolution and initial-technique parsers | `events`, `thingsPlan`, `resolutionPlan`, `startingTechniquePlan` and `technique`, respectively. |
| Custom faction-housekeeping checkpoints | Each section's root argument, or `factionHousekeepingProposal` for the proposal. |
| Custom TinyBrain final closures | Explicit `characters`, `questRewardResult`, `things`, `scheduledEventResult`, turn/travel alternatives, NPC-only `turnResult`, crafting/modification `result`, or `containerOpenResult`, as accepted by each final parser. |

The narrative adapter forwards parser/final contracts and clears broader ordinary
request roots where a declared final contract owns the scope. These declarations
also reach nested completion adapters that disable ordinary XML validation.
Local result builders do not make model requests and need no generation scope.
Native tool JSON and existing Story Authoring JSON protocols remain outside the
XML-contract inventory; prose-only scene illustration remains prose.

This is coverage of the reviewed project contracts, not a promise about arbitrary
third-party/custom prompt programs. Unknown custom parsers and the generic
`scripts/run_prompts.js` utility retain automatic XML detection when no root is
declared. That CLI's optional extraction tag may be a repeated or nested child,
so it is deliberately not relabeled as the response root. An unspecified wrapper
cannot be inferred safely from that tag or an arbitrary required regex. New known
XML callers should declare their actual root(s), named schema or parser contract.

The effective backend guard flag and provider capability policy remain unchanged;
adding root contracts does not enable sampled-token guarding on an opted-out or
unsupported provider. Final parsers, semantic retry budgets, tool permissions and
ordinary plain/JSON protocols retain their existing ownership.
