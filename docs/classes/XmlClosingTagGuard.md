# XmlClosingTagGuard

`XmlClosingTagGuard.js` tracks open XML elements in generated output and retained
assistant prefill. It rejects a real closing tag unless it matches the innermost
open name, with exact case. An empty stack permits no closing tag. The rejection
uses a dynamic regex built from the expected name and xmldom's shared QName and
XML-whitespace grammar; Unicode/namespaces follow the installed strict parser.

The incremental scanner ignores comments and processing instructions, balances
CDATA as described below,
respects attribute quotes and DOCTYPE internal subsets/comments, and buffers split
markup. A changed/rewound prefix resets and replays scanner state. Incomplete
closing-name prefixes wait for completion; alternative branches must remain viable
prefixes of the expected close. Self-closing elements do not enter the stack.

`new XmlClosingTagGuard({ mode: true | "auto", expectedRootTags: null | string[] })` exposes `inspect(responseText)`
(null or start/end/actualName/expectedName/pattern), `isViablePrefix(responseText)`,
`terminalState(responseText)` and `beginGeneration()`. True scans declared XML output
even after explanatory text. Auto activates only on leading legal XML markup, allowing fences, comments,
PI/declarations and real orphan closing tags; ordinary text and math such as
`<3` remain prose. Prompt examples and native tool-call arguments are never scanned.

Declared `expectedRootTags` (or a compiled schema's `name`) bound the guard to the
first matching opening root, with exact case. Other elements before that opening
and all markup after its matching close are ignored. Unrelated elements never
enter the structural stack. Outside comments, CDATA, declarations and quoted
attributes are still skipped lexically, so their tag-shaped text cannot start it.
Nested same-name roots remain inside the outer root. Raw offsets, split markup
and rewind replay are preserved; in-root closing/schema checks remain strict.
Without a declared root, existing true/auto behavior remains unchanged. This
first-root guard boundary does not change downstream final-envelope selection;
only named schemas also stop the transport at that boundary.

`allowToolCalls:false` additionally rejects actual `<tool_call>` opening elements,
including self-closing tags and unfinished attributes, as soon as the name has an
XML delimiter. Split names remain buffered. Rejections identify the element path,
explain that no native tools are available and request the intended XML without
tool-call elements. Escaped text, comments, processing instructions, attribute
values, declarations and literal CDATA do not trigger this policy. CDATA's existing
pseudo-tag balance checks remain in force independently. The default is true for
standalone structural callers.

LLMClient derives this permission from each attempt's filtered native-tool payload,
including disabled choices, exhausted budgets, corrections and TinyBrain checkpoint
subsets. Both sampled-output corrections and EOS alternatives use that same policy;
a forbidden tool marker cannot become an assistant prefill. Completed responses also
receive a policy-only lexical scan (`checkStructure:false`) before callbacks or
expected-root extraction. It uses the same declared-root boundary, or the existing
generic XML scope when no root is declared. This scan does not stop at
unrelated nesting errors; existing final validators still own XML/domain correctness.
It applies with the live guard disabled and to forced/cassette outputs. Explicit
plain output scopes (`xmlOutput:false`) bypass this XML policy; auto scopes retain
the leading-XML detection described above. Enabled native-tool behavior is unchanged.

## Integration

Effective `ai.xml_closing_tag_guard` defaults to false and is independent of
`live_deslop`, slop/repetition settings and prose-family routing. Enabling it
asserts provider support for OpenAI-compatible sampled token logprobs/top-logprobs
and exact assistant-prefill continuation. It is enabled in the managed Strata
profile; other providers remain opt-out. Eligible CLI requests fail explicitly.

`chatCompletion({ xmlOutput })` accepts true, false or `"auto"`. Explicit options
win. Otherwise known roots/strict XML/required tags imply true, including inside
auto TinyBrain scope. A known plain scope remains false. Other requests use auto.
`LLMClient.withXmlOutputScope({ xmlOutput, expectedXmlRootTag, expectedXmlRootTags, appendLogSection }, callback)` provides
checkpoint scope without requiring every completion adapter to pass new options.
Built-in XML checkpoints declare true; built-in plain prose/choice stages declare
false; custom/unknown checkpoints use auto. False avoids guard/logprob overhead.
Every built-in XML TinyBrain parser passes its shared function output contract
through this scope. Custom native checkpoint/final-model closures declare local
runner output contracts. Dynamic exact/section roots come from parser arguments;
schemas supply their own root name. Root declarations flow through sampled
alternatives, EOS checks, forced-prefix replay and final policy inspection.
Plain nested scopes clear inherited roots and schemas unless explicitly redeclared.
Unknown external/custom contracts without an expected root retain generic XML
behavior; semantic roots are never inferred from the model's response.

LLMClient composes the structural check before an existing prose token hook and
uses the same stream/nonstream branch-rewind machinery. `LiveDeslopController`
shares its branch selector with `inspectXml`, allowing XML delimiters but excluding
NUL/control and recognized EOS/chat-control alternatives. Candidate prefixes are
rechecked, and tried branches remain finite. Native tool definitions remain intact.
Opaque text is still scanned at exact raw offsets without fabricated alternatives.
Without an applicable file-schema/CDATA forcing rule, an unresolved close fails
with tag, expected name, offset and regex diagnostics through existing
stack-bearing errors.

TinyBrain corrections append to its existing prompt transcript; ordinary
corrections use the shared LLM diagnostic log writer. Strict final parsing/domain
validation remains authoritative. This guard never repairs/deletes completed XML;
file-schema forcing inserts only generation-time structural prefixes. The actual-EOS extension below can continue
a sampled premature EOS; unknown/missing terminal metadata never proves EOS. Candidate checks cover closing-name nesting
and viable QName prefixes, not full attribute grammar: malformed attributes such
as `<item x=>` remain the strict final XML parser's responsibility. An explicit `forceOutput` has no sampled token stream, so automatic hook setup is
bypassed before provider-profile resolution while existing strict response validation remains. File fixtures may
miss and fall through to a real provider, so configured providers retain guard setup. A file fixture with no AI profile can run its strict lookup without guard setup; any real-provider fallthrough still requires normal configuration.
Version-2 cassette replay accepts the configured hook without invoking it and
retains fingerprint/consumption validation. A matching legacy file fixture remains
incompatible with token hooks and fails explicitly; use an explicit plain/guard
opt-out only for a deliberately nongenerated fixture call. Caller-owned hooks
retain their existing restrictions. Replay cannot demonstrate live token guard
behavior; tests use mocked token streams.

## Actual EOS with incomplete XML

A declared root that has never opened reports `missingRoot:true` and incomplete
output even for empty/prose responses. Verified actual EOS in that state raises
a response-validation error instructing the model to wrap its response in the
declared root (or one of the allowed roots). The existing correction-attempt budget
applies; feedback includes this reminder even when general validation feedback is
disabled. This does not synthesize an unopened root. Schema EOS completion below
applies once the root has opened.

The same flag rejects an actual sampled EOS when `terminalState` reports open elements or pending markup, including an initial partial root/comment/tag. With a named schema, verified actual EOS now prefers deterministic tag-only completion: rewind pending markup to its start, close frames whose required children are satisfied, and repeat upward. At the first missing required child, emit its opening tag and resume the model for its value. If upward closure completes the root, finish locally and run the unchanged final XML/domain validators. Empty text, wrong values/counts/references and unsupported mechanics still reject normally. One finite batch is one synthetic force/completion action; inserted-tag count is diagnostic, not a new continuation counter.

Without a named schema, `inspectXmlTerminal` retains the existing sampled non-EOS alternative selection at `responseText.length`, including bounded CDATA structural handling. Closed/plain output does not require terminal metadata. Native tool-call turns bypass terminal XML correction and retain strict tool JSON validation. Explicit stop strings, token limits, cancellation/disconnect/error never trigger synthetic terminal closure.

Named-schema generation also stops at the first structurally valid root-closing boundary, including an allowed self-closing root. Same-token/opaque-chunk trailing output is discarded; earlier invalid XML is not salvaged. `stopAtDocumentEnd`/`completedAt` expose that boundary for the shared controller. An effective streaming payload that can still emit native calls defers this cutoff until ordinary termination confirms no calls. Non-stream responses already expose their complete tool-call list. Actual tool turns remain intact. The original token/prose hook receives one final `responseComplete` inspection of the completed prefix before acceptance; its correction/error/cancellation still takes precedence.

The transport counts the actual sampled crossing token, drops its whole metadata record if it crosses the cutoff, and never shortens a sampled token while retaining its ID/probability. Synthetic closes/openings have no sampled token identity. Raw provider finish reason/usage are preserved; a deliberately stopped stream may have null final metadata. No provider EOS or stop value is invented.

The installed Strata extension reports `choice.logprobs.terminal` separately from
`logprobs.content`: reason `eos_token`, an actual `sample` with id/token/bytes/
logprob/top_logprobs, and all `stop_token_ids`. It retains all raw alternatives;
non-UTF-8 alternatives have null token text and raw bytes, and cannot be selected
as text prefills. Every stop identity and recognized chat/control token is excluded
from candidate branches. Other observed reasons have no invented EOS sample.
An older provider returning an ambiguous stop with incomplete XML fails with a
missing-terminal-metadata diagnostic rather than silently accepting or guessing.

Every EOS continuation uses the original finite positive logical output budget.
Sampled output/EOS and branch attempts consume that budget, reconciled against
provider completion usage for opaque/reasoning tokens. A separate EOS continuation
count uses the effective validated retry allowance plus one (one when unconfigured),
so EOS-to-whitespace loops cannot create thousands of requests. Normal validation,
network and user retries receive a fresh attempt budget and guard state; EOS/prose
branching, token-length continuation and stream fallback retain their budget.

The backend payload is reviewable under `tmp/xml-eos-guard-backend`, based on exact
installed source hashes with unchanged termination tracing. It was installed and
real EOS metadata verified during the prior approved restart; receipt:
`tmp/strata-eos-deploy-20261031T182642Z/deployment-receipt.json` (SUCCESS,
2026-10-31). The schema extension needs only a game-code restart, with no further
backend patch or runtime model-profile change. See the
[EOS implementation plan](../superpowers/plans/2026-10-31-xml-eos-guard.md).

The [durable backend patch notes](../strata_terminal_logprobs_patch.md) pin the
installed base/target hashes and describe isolated reproduction and coordinator
deployment.

## File schemas and CDATA pseudo-tags

[Named file schemas](XmlGenerationSchema.md) optionally add unordered child counts,
required fields and unknown-child checks. Ordinary malformed-tag correction first tries sampled alternatives; exhaustion can force a missing opening tag or current close. Verified schema EOS instead uses the deterministic completion path above; text values
and final domain validation remain model/parser-owned.

Generated CDATA has its own pseudo frame. Legal inner XML-like tags recurse and
must close before ]]>; they are unrestricted by schema names/counts and cannot
close outer XML frames. Literal comparisons such as x <3 stay text. A literal
nested CDATA opener is not another real CDATA region. The real ]]> delimiter is
never hidden by inner quotes/comments. If it interrupts an unfinished inner tag,
correction rewinds that tag start. Closure obligations are inner tag, CDATA end,
then outer element. Split delimiters are buffered. CDATA is text for the enclosing
schema, so nonempty CDATA cannot satisfy or bypass a child-only container.
Empty/whitespace CDATA remains allowed. Input prompt/schema CDATA is not scanned
as generated output. Bounded CDATA-inner/end forcing is also available without a
file schema; other ordinary schema-less exhaustion still fails explicitly.

## Per-turn enforcement audit

The shared LLMClient integration records guarded transport dispatches, selected branches/forced prefixes and guard failures in the existing [PromptAuditLog XML section](PromptAuditLog.md#xml-enforcement). Named schemas and the generic guard are identified separately. Counts and UTC/offset ranges aggregate repeated decisions; zero-correction runs remain visible. Selections are recorded before later transport/application checks and are not labelled applied. Compact rows omit token text and response values; existing detailed diagnostics are unchanged.

Document-completion detail records use the separate `xmlSchemaCompletion` prefix so a same-millisecond completion cannot overwrite a preceding `xmlClosingGuard` correction record. EOS closure plus local finish is one combined detailed decision. Compact audits separately identify closure, required-opening and document-completion selections without claiming final domain acceptance. See the [completion plan](../superpowers/plans/2026-10-31-schema-document-completion.md).
