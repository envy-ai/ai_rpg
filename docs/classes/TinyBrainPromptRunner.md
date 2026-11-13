# TinyBrainPromptRunner

Location item/scenery generation uses the `location_things_generation` family: one strict roster checkpoint followed by a final full-Thing stage whose parser checks the complete root, approved roster, counts/rarities and whole-Thing validity before batch creation. Each stage owns its configured correction budget; completions skip inner XML validation. See [LocationThingGenerationPlan](LocationThingGenerationPlan.md).

With `chat_tools.mutating_prompts_only: true`, run-start native execution eligibility is captured from the original execution definitions before checkpoint narrowing. Lookup-only player/NPC/scheduled-event programs execute no native calls, including lookup calls; their parsed checks, attacks, plans and local mutation hooks continue normally. Mutation-capable creative programs retain their original permissions at each checkpoint. Each request exposes only executable definitions; disabled checkpoints expose none and send `tool_choice: "none"`. See [ChatToolPolicy](ChatToolPolicy.md).

Each entire program owns one terminal failure notification through
[PromptFailureReporter](PromptFailureReporter.md). Recoverable checkpoint retries
do not open windows; exhausted parser retries preserve their original cause and
report the accumulated model/tool counts. Intentional cancellation is excluded.

Checkpoint and final parser corrections use [XmlRetryFeedback](XmlRetryFeedback.md): an actual unclosed XML response gets one instruction to close all tags and put `DONE` after the root. Other parser and tool errors keep their existing feedback. Each stage still has its own retry budget and accepted transcript.

When a retry returns exactly the same text as that stage's preceding failed response, shared feedback appends `"Insanity is doing the same thing over and over again and expecting different results."` with literal double quotes. Whitespace changes count as a different response. The comparison starts fresh at every checkpoint and final stage, and successful-stage cleanup removes this feedback with the other correction messages.

## Purpose

The `ability_attachments` family runs a complete owned ability batch or independent pending-option list in one conversation. One fixed context/catalogue outline precedes per-ability catalogue selection and authoring checkpoints; each uses declared XML roots and existing domain parsers. A local terminal builder performs no extra completion. Accepted earlier abilities survive current-checkpoint retries, and the family shares native queue/progress/log ownership. See [AbilityAttachmentAuthoring](AbilityAttachmentAuthoring.md).

`TinyBrainPromptRunner.js` executes staged prompts used when `ai.tinybrain: true`. It drives player actions, event checks, need-bar checks, quest rewards, game intros, random/creative/NPC narration, crafting, location modification, checked containers, scene summaries, while-away updates, scheduled-event resolution, and scheduled-event interruption rewrites. It lets a small model answer one reasoning instruction at a time while preserving the conversation, tool calls, and tool results for later checkpoints and the final response.

The normal one-shot player-action path remains active when the option is omitted or false. In `prompts/_includes/player-action.tinybrain.njk`, non-attack prompts first pause after selecting the NPCs that may respond, then proceed to drafts where any character whose uncertain action actually survives can receive the appropriate check. The prompt does not freeze a checked-actor roster before later drafts. Repetition-buster prompts then run the additional analysis, editing, and branching checkpoints. Its nine built-in editing/pruning audit questions are nine separate `llm_dummy_action` checkpoints, so the model answers only one audit question per completion and each nonblank answer remains in the conversation for the second draft. For exit-button travel to a location whose name ends in `Exterior`, or whose own exit connects to a region named `<location name> Interior`, the exterior/interior deferral checkpoint includes the resolved destination's name and description. It obtains them at render time through the prompt-only `getLocationInfo(name, id?)` Nunjucks global using the exact travel destination id, including stub-description metadata when necessary. Attack branches contain no checkpoint tags and make one completion through the runner; the attack checker may return multiple valid attack blocks.

Eleven narrative prompt templates share `_includes/tinybrain-prose-audit.njk`. The audit asks for a decided yes/no verdict in exactly one `revisionDecision` root with one `revise` child, plus at most three brief corrections as plain text in `issues` when revision is needed. It forbids reasoning, competing verdicts and nested issue XML, and requires every element to close. Mere synonyms or descriptive item names do not warrant revision when identity remains unambiguous; actual quantity, outcome, continuity and domain-specific contradictions still do. These are prompt instructions, without a new parser limit, checkpoint or retry path. Existing optional-prose revisions may still return exact `N/A` when no useful narration remains.

Standalone need-bar checks use two completions. When both TinyBrain event families are enabled, those same phases append inside the event program, retaining its accepted transcript, single base context, log, progress group and queue owner. The first asks for the existing plain-text per-character planning analysis and forbids XML. The second retains that analysis and asks only for the `<characters>` block. A strict domain parser retries the second phase in place when its XML or need-bar fields are malformed.

## Nunjucks Tags

`TinyBrainPromptExtension` registers four synchronous Nunjucks tags. They render private checkpoint/result markers that the runner consumes; the markers are never sent to the model.

```njk
{% llm_dummy_action %}
{% llmparse('player_is_traveling') as travel %}
{% llmparse('parser_name', extraArgument, anotherArgument) as result %}
{% llmresult('registered_result_builder') %}
```

- `llm_dummy_action` normally requires a non-whitespace assistant response and stores its trimmed text as the checkpoint value. It accepts optional `{% llm_dummy_action as variableName %}` syntax so later conditional prompt control flow can inspect that text after the runner rerenders the program. A blank terminal response is accepted when that same checkpoint completed at least one successful tool invocation, because the retained tool result already supplies the checkpoint's useful context; its assigned value is then the empty string.
- `llmparse(name, ...args)` selects a named parser and passes the response followed by all extra arguments and a parse context to it. Checkpoint/model-final parse contexts and `afterParse` expose `withNestedPrompt(callback)`: use it only around awaited work that can start another LLM request. It runs that child work under the staged program's retained queue owner through native `LLMClient.withPromptQueueReservationNested`; nested completions and runners inherit ownership without competing with their parent. Pure parsing and cached results retain the reservation uninterrupted. Cancellation propagates terminally instead of retrying the checkpoint.
- `as variable` is optional. When present, the parsed value is restored into the Nunjucks context on the next program render, so later conditionals can branch on it.
- `llmresult(name)` must be the only content after the final checkpoint. It invokes a registered local result builder with parsed assignments, ordered checkpoint values, template context, and accumulated successful tool invocations, and performs no additional LLM request. Unknown builders, duplicate result markers, duplicate assignment targets, and trailing prompt text fail explicitly. Programs without this marker retain the ordinary final LLM completion. Intermediate completion adapters, including the dedicated player-action adapter, remove inherited `expectedXmlRootTag` and `expectedXmlRootTags`; each checkpoint is validated by its own parser. Final model completions retain the caller's root validation. Locally assembled results do not issue a final model request.
- A local result builder also bypasses `finalParser`, which belongs to the final-model completion path. API callers validate assembled results explicitly before application; while-away parses canonical XML, populates its complete update plan, and resolves destinations before changing world state.
- `accept_or_reject` accepts exactly one `<accepted></accepted>` or `<rejected>...</rejected>` result. Rejection ends the program immediately.
- `player_is_traveling` accepts `<travel>yes</travel>` or `<travel>no</travel>` and returns a boolean.
- `player_action_optional_prose` accepts prose-only text or exact `N/A`; `N/A` becomes `null` so a family result builder can omit an optional player-facing prose element. XML and result wrappers remain invalid.
- `response_or_na` returns `false` for normalized short no-result answers such as `N/A`, `not applicable`, `none`, `no`, `no issues`, or `nothing`. It also returns `false` when the trimmed response begins or ends with a standalone `N/A` token, including `NA` and `N.A.` variants; token boundaries prevent words such as `narrative` or `banana` from matching. Every other non-whitespace response returns `true`. The player-action template uses this value to decide whether to request a revised draft after each editing check.
- `yes_no` accepts a response beginning with `yes` or `no` (optionally prefixed by `Answer:`), normalizes it to a boolean, and rejects ambiguous or differently formatted answers.
- `revision_decision`, `allowed_character_selection`, `narrative_scope`, `exact_xml_root`, `outcome_acknowledgement`, `while_away_character_update`, `while_away_arrival_update`, `scheduled_event_applicability`, `scheduled_event_tool_plan`, `scheduled_event_tool_execution`, `scheduled_event_summary`, `scene_summary_boundaries`, and `scene_summary_entry` are provided by `TinyBrainPromptParsers.js`. They return JSON-safe structured values and fail on malformed, duplicate, unknown, or cross-stage-inconsistent content. Scene boundaries must be in range and strictly ascending; each scene entry must match its server-assigned start index and use the exact summary/details/quote shape. Scheduled-event applicability requires one explicit decision/reason XML pair. Its plan validates supported targets, fields, JSON, and available calls without forcing copies of the raw event, derived change status, alternative target references, or unused purposes. The execution-result parser remains available as a standalone contract helper, but the current scheduled-event program executes an accepted plan in a post-parse hook instead of creating a second LLM checkpoint. Scheduled summaries require nonempty text-only XML and reject exact null sentinels. The singular while-away arrival parser reuses the candidate-update validator with an exact selected name and required literal `HERE`.
- Parser names beginning with `mod_step_` currently require non-whitespace and retain the response without additional transformation.
- Unknown parser names fail before another LLM request is sent.

## Execution

The first full `base-context.xml.njk` render normally places a private program-start marker immediately before the allowlisted tiny-brain include selected by `TinyBrainPromptFamilies.js`. The scene-summary caller places the same marker inside its dedicated `scene-summarize.xml.njk` wrapper because that prompt does not use base context. The runner keeps the already-rendered fixed prefix and system prompt, then rerenders only the selected family program after parsed assignments. This prevents random-word seeds or other fixed input values from changing between checkpoints.

Callers that need several separately rendered programs to act as one sequential model conversation can pass a state from `createTinyBrainContinuationState()`. After each successful program, the runner replaces that state with cloned `conversationMessages`, accumulated tool invocations, and the active prompt-log path. By default, the next program retains the original system message, appends its newly rendered base context and first instruction as the next user message, and continues writing to the same log file. Callers such as sectioned TinyBrain event checks can instead enable `refreshContinuationBaseContext`: the runner requires one base-context end marker, replaces that transcript message's prior base snapshot with the newly rendered snapshot, and omits the new program's duplicate fixed prefix. Earlier questions and accepted assistant answers remain in sequence while only one full base context survives. A changed system prompt, missing/duplicate base marker, or malformed continuation state fails explicitly. Continuation state itself shares model context and logging, without storing concurrency tokens. A caller can wrap sequential programs in an explicit owned reservation scope so their runners join one queue owner. Sectioned movement-event extraction does this across origin/between/destination/tracker sections and releases before automatic maintenance prompts. Each program retains its separate progress and tool-schema lifecycle. Eligible TinyBrain event sections include their need-bar phases before the program finishes. Mixed-family owned event sections finish their complete event program before starting the awaited separate need-bar program; outside owned scopes separate requests retain their parallel launch. Parallel standard-generation descendants serialize their individual completions through the shared owner's native request gate.

The TinyBrain event family places its complete schema inside that replaceable base-context prefix rather than its rerendered program. Section continuation therefore retains exactly one schema while refreshing scene-conditional and mod guidance alongside the current world snapshot. This uses the ordinary continuation refresh; accepted section messages and parser behavior are unchanged.

For each checkpoint, the runner:

1. Appends only the new instruction segment as a `user` message.
2. Runs the normal completion or chat-tool loop.
3. Keeps assistant tool-call messages and `tool` results in the conversation.
4. Rejects an attempt before parser acceptance when an invocation returned by that completion has `metadata.error: true`, except for an explicitly nonblocking budget-exhaustion denial of a declared built-in read-only lookup. Successful invocations from the same attempt remain retained, failed invocation records are omitted from the eventual accepted result, and the failed tool result stays in the model transcript as correction context.
5. Parses the terminal assistant response. Parsers receive read-only checkpoint metadata plus the current and accumulated successful tool-invocation records, allowing final semantic checks to run before acceptance.
6. If the caller supplies `afterParse`, runs that hook after syntactic/semantic parsing but before accepting the checkpoint. The hook may execute code-owned consequences and add their tool transcript to the conversation. A structured failure from this hook retries the same checkpoint rather than advancing to a separate acknowledgement or tool-call checkpoint.
7. On success after a parser/hook failure or failed native invocation, retains the original section input/instruction, successful tool receipts, explicit authoritative hook messages and the accepted answer, then advances. Failed attempts and correction feedback are removed before subsequent sections. Clean sections retain their original accepted transcript; see [TinyBrainRetryContext](TinyBrainRetryContext.md).
8. On parser or tool-invocation failure, reports the failed text to the prompt-progress viewer, retains the failed terminal assistant response, and appends a concise correction request containing the validation message but no stack trace. Every retry of the same checkpoint or final stage sees all earlier failed answers and their feedback in order. Ordinary tool-loop retries keep the original checkpoint instruction and tool results in context while telling the model not to repeat successful calls. A failed post-parse plan execution instead requests a complete corrected plan and explains that successful executions are cached, so required calls can remain in the complete plan without repeating their effects. Failed answers and feedback leave the conversation only after the stage parses and its post-parse hook succeeds, before the next stage receives its instruction.

When a parser returns `normalizedResponse`, the runner returns that cleaned accepted answer and uses it when compacting a recovered section. Clean sections retain the original model response in their conversation transcript. All original responses remain in the full attempt log. XML domain parsers use this to accept harmless fences or surrounding commentary without passing those wrappers into consumers that expect XML.

Checkpoint validation retries use `ai.retryAttempts` as the number of retries after the initial response. This covers parser failures and blocking structured tool errors; failed tool calls therefore cannot leak into a successfully accepted TinyBrain API result. Exhausted read-only lookup denials remain in the model transcript but are excluded from failure gating and accepted invocation records. They cannot by themselves reject an otherwise valid draft; unresolved mechanical/domain failures still block. Transport retries inside `LLMClient` remain separate. Exhausted validation retries throw a clear error. Final repetition-buster XML is parsed without invoking the separate XML-repair prompt, so malformed final output is retried in the same accumulated conversation instead.

The non-attack repetition-buster player-action program ends with `llmresult('player_action_result')`. Its final prose, movement, vehicle state, destination, revisit-change plan, hidden-note, and time answers are parsed checkpoints rather than one model-authored XML response. One authoritative player-agency boundary appears with the first draft and the railroading audit refers back to it once; later draft/final stages do not repeat a growing list of prose prohibitions. When the player's incomplete quest count strictly exceeds `config.soft_quest_limit`, the first-draft instruction also asks the model to avoid unsolicited new quest-like tasks; the guidance is omitted at or below the limit and is not repeated in later checkpoints. No hand-written prose/dialogue detector or conditional semantic parser is used. Before drafting, a no-tools checkpoint asks only for the exact name of a destination identified by the player action or `N/A`. A unique existing match causes server code to inject its canonical identity, short/full descriptions, visible present NPCs, and exits; missing or ambiguous locations inject nothing. An unresolved location stub whose backing region has not yet been generated is treated the same way, while a non-stub location with a missing region remains a hard world-data error. This is read-only drafting context and does not mechanically precommit the later movement decision. The shared standard/TinyBrain `player-action-travel-intent.njk` contract separates travel intent from destination naming. Preview `N/A` records an unavailable exact name and does not cancel movement toward an unnamed area. The later movement checkpoint repeats the original player action and judges it against established route facts and authoritative outcomes; draft prose is revisable rather than authority to erase requested travel. Valid requested journeys that stopped short in a draft must be completed in final prose. A genuine movement-blocking outcome or invalid route can prevent travel, with its concrete supported reason explained in final prose; unrelated hunting/tracking failures and recoverable companion mishaps alone do not cancel it. The destination checkpoint reuses known identities or supplies a grounded descriptive name and appropriate region for an unnamed destination. Naming collisions require a valid name/region correction rather than cancellation; the same-origin guard still permits staying when the action does not actually leave the canonical location. Descriptive references such as a shelter or landmark likewise do not erase selected travel. This changes prompt guidance only: there is no new checkpoint, state, parser heuristic, or model-correctness guarantee. For committed route travel, `/api/chat` passes an authoritative movement type alongside the destination, and the template skips the movement parser checkpoint. After either committed or parsed mechanical destination selection, the program's ordinary rerender calls the strict read-only `PlayerActionDestinationContext` prompt global. Existing destinations immediately add canonical context without requiring rigid prose reproduction; graph-resolved travel time suppresses the redundant duration checkpoint. A timestamped visited destination with selected destination prose adds one Markdown change-planning checkpoint with expected arrival absence and visible present NPCs, then supplies accepted bullets to the final destination-prose instruction. Non-party accompanying-character selection accepts canonical names or aliases and allows movement established explicitly or reasonably inferred; an empty non-party allowlist skips the checkpoint. Living party members are derived and carried automatically by the shared movement executor. Deterministic vehicle `UNCHANGED` branches also skip their checkpoint. `PlayerActionTinyBrainResult.js` validates movement/vehicle state and independently resolves the same destination/time during XML assembly. The assembled response is appended to the same prompt log, keeps the accumulated tool/progress state, and is not inserted as a fabricated assistant message.

When `ai.xml_repetition_fix: true`, `run()` wraps the complete staged program in a metadata-scoped XML repetition context. Every matching checkpoint, final completion, and tool-loop completion gains the streaming detector; nested prompts with a different metadata label do not. A balanced explicit XML block longer than 50 characters that exactly repeats the immediately preceding trimmed suffix is removed, as is the second half of an exact direct-sibling `ABAB` sequence. The interrupted completion then resumes from the retained assistant prefix after the exact user prompt `continue`. Comments, CDATA, self-closing elements, incomplete elements, and near-matches are left alone. The recovery budget is the runner's `ai.retryAttempts` value, independent of parse/transport retry counters, and exhaustion fails explicitly. Earlier completed tool results remain in the staged transcript, but any partial tool call in the aborted stream is discarded.

The optional `onParseFailure` callback receives the failed response, checkpoint, attempt, final-step flag, and parser error. The player-action integration uses it only for UI progress reporting. Full errors and backtraces remain in server logs; the model receives only the parser's concise error message inside the correction request. Tool-call messages and tool results that preceded the malformed terminal response remain available during retry. After success, only actual successful protocol pairs and declared authoritative hook messages remain; failed pairs and retry feedback are removed. `afterParse.retainedMessages` and `error.tinyBrainRetainedMessages` declare keyed `{ key, message }` receipts. Hook throws with partial tool execution also provide `tinyBrainRetryToolInvocations` alongside their retry transcript, preserving committed results without guessing from text.

`runChatCompletionWithToolLoop()` returns `conversationMessages` for this purpose. Its terminal assistant response is included after any tool-call and tool-result messages.

Because most staged families render through `base-context.xml.njk`, their retained prefix starts from the same canonical base context used by the corresponding one-shot prompt. Original execution definitions are captured at run start; provider payloads expose only the current checkpoint’s permitted subset. Execution permissions remain specific to the family and checkpoint: the pre-draft player destination-name checkpoint permits no tool calls, checked containers use no native tools and resolve their parsed check plan on the server, NPC narration permits lookup-only tools at its information checkpoint, and scheduled-event planning permits only non-mutating tools before the plan is accepted. Scheduled-event Story Tools that exist only for generic prompts are excluded. The scheduled plan's `afterParse` hook then runs every validated direct update and other call in order, adds the exact tool calls/results to the retained conversation, and never asks the model to translate its plan back into native tool calls or acknowledge their completion. The base-context marker is removed from transport payloads; the retained raw transcript keeps its marker and initial user message fixed across checkpoints.

The wrapper places explicitly scene-dependent mod references after the older history/world index, at the same stable-context boundary as standard prompts. When the effective AI profile opts a matching Strata endpoint into `shared_prefix_cache`, `LLMClient` derives `strata_prefix.messages` from each actual normalized request, including retries, native tool rounds and refreshed continuations. The pin stops before scene references/current region; it does not pin the changing staged conversation or alter the fixed tool policy. See [LLMClient](LLMClient.md#internal-prompt-message-boundaries) for capability validation, generic/image exclusions and the distinction between message boundaries and actual backend checkpoints.

`TinyBrainResultBuilders.js` also removes terminal formatting completions for quest rewards, while-away results, game intros, NPC actions, non-travel random/creative actions, scheduled-event results, scheduled-event interruption merges, crafting, location modification, checked containers, and scene summaries. The scene-summary builder combines all validated completed-scene checkpoints and appends the fixed following-scene boundary record required by the established parser. Creative/mechanical questions remain checkpoints; only already accepted prose and fixed fields are assembled locally.

When `ai.live_deslop` is enabled, first-draft checkpoints, conditional second drafts, player-action final-prose checkpoints, and other families' final structured responses use live slop correction. Drafts and the parsed player-action prose sections use plain-prose extraction; planning, destination, hidden-note, timing, tool, outcome, and audit checkpoints are not inspected. Other final extraction uses the family's explicit player-facing XML tag profile, so hidden summaries, tool results, state blocks, timing fields, and other non-prose XML are excluded. These stages first request streamed prose-token logprobs while keeping the tool schema. Content deltas without logprobs are preserved at their exact response offsets but bypass prose-token inspection; structured tool calls are handled through `delta.tool_calls`. If the current llama.cpp process rejects streaming or supplies invalid/misaligned prose-token metadata, all later live stages for that process use non-stream logprob batches of at most 500 tokens.

`TinyBrainPromptRunner.run()` owns or joins one `LLMClient.withPromptQueueReservation()` lifecycle. Checkpoints, parse/transport retries, tool rounds and awaited internal child prompts retain the same logical queue slot. Parser/post-parse `withNestedPrompt` and native prompt-launching tools establish an explicit async scope; child completions inherit the owner, and a nested runner joins it without releasing the parent's resources. Different-model children hand off the owner's single current model lease while retaining its optional all-model permit; same-model children reuse the existing lease. Parent stages move back to their target as needed. Atomic native model/global acquisition prevents queued unrelated prompts from holding a child's model while waiting for its parent's global slot. Same-label nested runs retain independent tool schemas identified by render run id. `requestUserInput` deliberately yields while waiting so user or asynchronous mod responders do not block the queue. Reservation resources release in `finally`, including parser failure and cancellation. Other genuinely free configured concurrency slots remain available; no global serialization is introduced when no all-model cap is configured.

Parallel sibling programs inside the same inherited owner share its per-request gate and can interleave their completions. Native callers requiring whole-program continuity sequence those siblings before launch: sectioned event checks append eligible TinyBrain need bars to the same program or sequence a separate mixed-family program afterward, and owned location creation completes Things (including nested families and naming) before NPCs. Independent unowned location population still launches both branches in parallel. See [LocationThingGenerationPlan](LocationThingGenerationPlan.md).

The runner also owns one async-scoped prompt-progress group, using the render state's stable run id and a dedicated target label derived from its metadata label (`player_action_tinybrain`, `event_checks_tinybrain`, and the same `<metadataLabel>_tinybrain` rule for future runners). Every nested `LLMClient.chatCompletion()`, including tool-loop rounds, inherits that group automatically. `LLMClient` therefore reuses one prompt-progress entry and stable prompt id for the entire run without prompt-specific lifecycle code. The decoded-character received count accumulates across requests while the expected multiprompt target is selected once from the dedicated historical whole-run average or configured family target and never changes during the run. Progress uses the ordinary asymptotic curve: 75% at the expected total, then approaching 100% as additional output arrives. The current stage uses the ordinary yellow/orange fill. Parsing, tool execution, or rerendering gaps retain the same row in blue at its current character count and percentage. The next stage preserves both totals and returns the fill to its active color. Successful completed programs, including an event program ending normally with `<done/>`, write one aggregate whole-run sample when the group clears; parse/transport failures and rejected player actions do not change that history. Parse-failed text is retained in order for the group and displayed separately from the live retry response.

## Logging

Each run creates one family-specific TinyBrain prompt log through `LLMClient.logPrompt()`. Every later prompt segment, tool-call round, parser error, retry, response, locally assembled terminal result, and adaptive live-stream failure is appended to that same file. A caller-provided continuation state also carries that path into later sequential programs, so the entire logical conversation uses one prompt log. The completion callback receives a strict `appendLogSection(...)` helper tied to this file. Live-stream failure sections record the exact fallback message, classification, capability key, HTTP details, server response, and backtrace before the non-stream retry starts. LLM responses use explicit markers such as:

XML repetition recovery also appends its detected pattern, removed offsets, retained assistant prefix, and exact `continue` user prompt to this transcript before the continuation request. As with every later TinyBrain append, a filesystem failure emits a warning and does not terminate the running turn.

```text
=== TINY-BRAIN CHECKPOINT 1 ATTEMPT 1 LLM RESPONSE BEGIN ===
...
=== TINY-BRAIN CHECKPOINT 1 ATTEMPT 1 LLM RESPONSE END ===
```

`LLMClient.logPrompt({ filePath, append: true })` only accepts paths inside the runtime `logs/` directory and returns `null` if the target file is missing or another filesystem write fails. Tiny-brain execution still treats initial log creation as required. Once a run has started, however, failure to append a later prompt, response, diagnostic, or parse-error section emits a console warning naming the log and lets the running turn continue without that entry.

## Prompt Caching

Every checkpoint resends the accumulated conversation. Providers can reuse an unchanged prefix, but changing executable tool subsets can invalidate the early tool prefix. The runner snapshots original definitions and mutation eligibility at run start, preserving immutable definitions while exposing only each checkpoint’s executable subset. Programs without native executors expose no tool definitions. Empty permissions omit tools/functions/parallel flags and send `tool_choice: "none"`; corrections and exhausted budgets follow the same rule.

NPC narration permits its information lookups, creative actions permit enabled prose tools, and scheduled-event planning permits non-mutating native tools. Checked containers, events/need checks, summaries, quest rewards and other families without native loops expose none. Under `chat_tools.mutating_prompts_only`, lookup-only player/NPC/scheduled programs also expose none. Code-owned XML checks, attacks, plans, events and post-parse mutation hooks retain separate validated execution contracts.

Regular TinyBrain `player_action` has twelve original information tools: `moreInfo`, `getHistory`, `getFullScene`, `listMysteryBoxes`, `findMysteryBoxes`, `getMysteryBox`, `listMysteryThreads`, `getMysteryThread`, `listLocationEntities`, `getTravelTime`, `locateNpcs`, and `locateThings`. Destination selection disables them; other checkpoint subsets can narrow them. No scheduling, input requests, trackers, relationships, visibility, module/admin or mechanical native tools are added. Ordered unopposed/opposed checks and single/area attacks use attribute-free `<resolutionPlan>` XML and server-owned execution; see [PlayerActionResolutionPlan](PlayerActionResolutionPlan.md).

No-tool checkpoints receive no generated tool-permission message. Restricted checkpoints with callable tools may receive task-only guidance listing only exposed names; unrestricted checkpoints need none. Guidance preserves requested XML/plans and never enters retained conversation history. Direct no-tool or forbidden-subset calls are rejected before response callbacks and retried within the configured completion budget, then fail explicitly. Native loops independently validate their allowlists before execution. The matching label/reservation owns one `max_tool_calls` budget across checkpoints/retries, counting attempted individual native calls including cache hits and denials; XML actions do not consume it. At exhaustion the next payload exposes no native tools. Unexpected native responses are rejected rather than executed.

Negative `moreInfo`, `locateThings`, and `locateNpcs` results retain their actual
zero-match receipts across checkpoints and retries. Equivalent queries reuse
that receipt, ignoring `includeFullState` for a missing `moreInfo` target. A note
explains why repeating the query cannot help and asks the model to continue from
existing context. Lookup-index fingerprints cover ids, searchable names, NPC
eligibility and aliases, so creation, deletion, renaming, or alias/eligibility
changes allow a fresh lookup; unrelated entity descriptions and placement do not
invalidate a genuine global absence. Matching semantics remain specific to each
tool/type, including case-sensitive Thing ids. Nested unrelated prompts and
concurrent runs do not share schema, budget, or negative-cache ownership.

Changing tool definitions or `tool_choice` can change the chat-template prefix
before the world context, invalidating prefix reuse. Unchanged tools do not preserve KV state across
model-process termination or guarantee reuse when other prompt content changes.
If `ai.cachebuster: true` is enabled, `LLMClient` adds a fresh sequential cachebuster to
the final user message for every request, which intentionally prevents reliable
prefix-cache reuse.

Focused regression coverage is in `tests/tiny_brain_prompt_runner.test.js`,
`tests/llmclient.base_context_tools.test.js`, and `tests/chat_tool_calls.test.js`.
The continuous-run fixture uses the real runner, tool runtime, and completion
payload construction with mocked provider responses, including tool results,
parser correction, execution denial, and exhaustion. It verifies serialization
and permissions; live llama.cpp cache timing still requires a real model run.


Main player actions now set `playerActionCombinedMechanics` so their existing
resolution-plan checkpoints run even when the global NPC legacy-check option is
on. Natural player technique discovery uses those plans without a separate
technique_intent request. A no-tools `technique_selection` checkpoint precedes
each existing initial, draft and revision mechanics plan (up to three selections).
Its strict `techniqueSelections` XML parser resolves only actor/technique/kind;
the post-parse hook retains authoritative selected XML facts before the plan.
Empty selection needs no injected detail. Each later selection reads the current
local actor roster and current source/resource state. Standard player actions use
the equivalent read-only native `getTechniqueDetails` tool; the TinyBrain native
lookup allowlist remains unchanged.

Event checks use the same selection/parser/rendering contract only before a stage
whose allowed tags include `techniqueChange`; tracker/transit-only stages skip it.
Event actor identity is bound to the supplied section/location context, including
origin overrides. Selections and injected details stay in the native event log.
See [TechniqueSelectionContext](TechniqueSelectionContext.md). The caller's
[PlayerTechniqueIntent](PlayerTechniqueIntent.md) session supplies strict
normalization, stable candidate IDs, per-attempt rejection locks and pending-plan
omission guards. Actor incapacity retains its original fatal error across both
plan preflight and runner correction boundaries; cancelled/stale execution is
never retried as syntax correction.

The independent [XML closing-tag guard](XmlClosingTagGuard.md) scopes built-in XML
checkpoints as declared XML and built-in prose/choice stages as plain, even when
the completion adapter disables generic XML validation. Unknown custom stages use
leading-output auto detection. Its async scope passes through native tool loops;
structural corrections/errors append to the same prompt transcript. Explicit
completion xmlOutput and known final XML root/strict contracts retain precedence,
while known plain scope avoids structural logprob overhead.
Every built-in XML parser supplies its expected roots through shared function
metadata in [TinyBrainPromptParsers](TinyBrainPromptParsers.md), which also drives
its envelope extraction. This includes alternative accepted/rejected roots,
argument-selected exact roots, and final-model parsers. Plain/scalar/prose parsers
remain plain. The runner scopes the actual registered function, so a custom parser
overriding a built-in name does not inherit the old function's XML contract.

`parserOutputContracts` maps parser names to local output descriptors or resolvers
called with that checkpoint's `...parserArgs`. `finalOutputContract` declares the
final-model response, including a closure around a domain parser. Descriptors use
`xmlOutput` plus `expectedXmlRootTag` or `expectedXmlRootTags`; roots imply XML.
For example, a custom section parser can declare
`parserOutputContracts: { section: root => ({ expectedXmlRootTag: root }) }`.
Invalid descriptors and contracts for unregistered parser names fail before
generation. Explicit local contracts override function metadata. Native custom
contracts cover staged event XML, faction sections/proposals, starting technique
plans/entries, location-Thing plans and player-action resolution plans. Narrative
and generation final-model closures declare their output roots at their callers.

The guard ignores unrelated XML outside the first expected root and reports
actual EOS before it opens with a wrapping reminder. Unknown custom functions
without an explicit contract retain generic auto behavior; no expected root is
inferred from generated text. Plain draft-prefix handling remains available for
untyped checkpoints. Provider capability flags still control live enforcement;
these declarations do not enable unsupported providers.

The player-action `player_action_destination_decision` checkpoint is registered as XML. Its domain parser checks new-location region-name collisions inside the existing checkpoint retry loop. A corrected answer may choose a region, another location, or stay; earlier accepted mechanics and native/server receipts remain intact. No rewind of accepted checkpoints or special retry budget is introduced.

## Reservation regression coverage

`tests/llmclient.background_priority.test.js` checks that player-action technique
execution retains its queue reservation during nested destination expansion.
Its extracted callback fixture supplies the originating request's `stream` and
asserts that `stream.clientId` reaches the technique operation, while preserving
the destination-result and session-commit assertions.
