# LiveDeslop

## Purpose

`LiveDeslop.js` maps slop detected in player-facing prose back to sampled OpenAI-compatible backend tokens. It handles both plain TinyBrain drafts and family-specific final XML prose, chooses a higher-probability safe branch, tells `LLMClient` where to rewind, and retains correction diagnostics for the normal slop-removal attachment. Live requests prefer streamed prose-token logprobs while retaining tools.

## Local Strata backend

The local custom Strata build adds the generated-token `logprobs` and
`top_logprobs` fields this controller already requests, plus exact assistant-prefix
continuation with tools. The installed upstream release alone does not supply
this metadata. The custom path requires one serial serving slot; continuous
batching and pipelined decoding reject logprob requests explicitly.

Strata reports natural-log probabilities from the full-vocabulary raw model
scores before temperature, truncation filters, or penalties. Parser fragments and
tokens combined while decoding split UTF-8 sequences have no usable branch
alternatives: streaming preserves them as opaque text, while nonstream results
use aligned records with null probability and empty alternatives. This controller
retains its existing explicit failure if it cannot find a viable recorded branch.

The focused `tests/live_deslop.strata_integration.test.js` fixture exercises the
real Strata HTTP service and this project's `LLMClient`/controller together,
including a rewind and continuation with unchanged tool definitions. It uses a
scripted engine and does not load a model. Set `STRATA_TEST_CONTROL_ROOT` and
`STRATA_TEST_PYTHON` when the adjacent local checkout/runtime are not available;
the test reports a skip when those external prerequisites are absent.

## Prose extraction

`extractLiveProse(response, { proseTags })` recognizes only the supplied player-facing tags and builds a combined prose string plus source-offset mappings into the raw XML response. The default profile contains `<prose>`, `<originProse>`, `<betweenProse>`, and `<destinationProse>`. `resolveLiveDeslopProseTags(family)` supplies explicit profiles for quest reward `<prose>`, game-intro `<introProse>`, craft/location `<description>` and `<otherEffectDescription>`, container `<prose>`, and while-away/scheduled-event `<proseForPlayer>` fields. XML tag markup is removed, `<hidden>` content is excluded, and non-prose state/tool/timing fields stay outside recognized spans.

Every XML tag creates a hard n-gram boundary. The extraction therefore also returns individual `ngramSegments`; configured and repeated n-grams are matched inside each segment rather than over a flattened token stream. History indexing applies the same XML splitting and hidden-content exclusion. The completed-response deslop pass reuses `sanitizeLiveSlopText(...)` through its shared history-segment sanitizer, so live and post-generation frequency counts cannot disagree because a stored `<hidden>` note was included by only one path.

`extractStableLiveProse(response)` removes the final unfinished alphanumeric word from an open prose tag. This delays inspection until a word boundary, preventing a subword prefix such as `delve` from being rejected before a later token completes a different word. A closed prose tag is considered stable through its final character.

`extractLivePlainProse(response)` and `extractStableLivePlainProse(response)` provide the same source mapping, hidden-content exclusion, partial-word delay, and XML hard boundaries for unwrapped first- and second-draft checkpoints. In plain mode all visible text outside XML tags is prose. The transport marks the final token of a completed response so the checker also inspects a draft that ends directly on an alphanumeric word without trailing punctuation or whitespace.

## Detection and source mapping

`locateDetectedSlop(...)` receives the normal slopword, regex, and n-gram diagnostics. It locates the latest triggering occurrence in the current prose:

- words use the same alphabetic/apostrophe token boundaries as the slopword analyzer;
- regexes use server-provided match offsets, including raw-offset correction for markdown asterisks removed by regex analysis;
- n-grams use `Utils.normalizeKgramTokenSpans(...)`, which applies the same common-word and NPC-name filtering as `Utils.normalizeKgramTokens(...)` while preserving source spans.

When more than one diagnostic ends at the latest point, the earliest beginning wins so the complete triggering phrase can be replaced.

## Branch selection

`LiveDeslopController.inspect(...)` runs after each stable token boundary returned in a live token chunk. On a match it:

1. Finds the sampled token that contains the first word of the detected span.
2. Tries that token's returned `top_logprobs` entries in descending probability order, excluding the already-used token and any branch already tried at the same prefix.
3. Rejects alternatives that immediately produce another normal slop match or that would inject XML delimiters.
4. If no alternative is viable, moves to the first token of the preceding word and repeats until it reaches the preceding XML boundary (or the start of a plain draft). It never rewinds through tag markup into another XML-delimited fragment.
5. Returns the raw rewind offset and selected token to `LLMClient`, which restarts the same logical completion with the corrected prefix as assistant prefill while retaining the original tool schema.

The controller does not send token bans or mutate provider logits. A partial-token alternative can be tried provisionally; if its completed word later triggers the detector, that branch is remembered and the controller chooses the next alternative or backs up another word.

`beginGeneration()` clears branch-local state before a new parser attempt while retaining accumulated correction diagnostics. `getDiagnostics()` returns the unique word/regex/n-gram lists and per-correction token/log-probability details.

## Failure behavior

Missing/misaligned token probability metadata, an unlocatable detector match, a match outside sampled prose tokens, and exhaustion of every recorded branch all throw explicit errors. The surrounding chat route surfaces these through its normal error response rather than accepting an unchecked response.

llama.cpp may append a zero-text, zero-byte control record to `logprobs.content` when a non-stream response ends normally. `LLMClient` recognizes that record only in the final position of a `finish_reason: "stop"` text response, omits it from live token history, and marks the preceding visible token as response-complete so the final prose boundary is still checked. Empty metadata entries in any other position fail explicitly.

Streaming capability failures are remembered under each prompt family's effective endpoint plus managed llama.cpp PID. Later live stages on that backend use the 500-token non-stream method without repeating the failed probe. A game-server restart clears the in-memory latch, while a managed llama.cpp restart changes the PID key; either event permits one fresh streaming attempt. Content deltas without logprobs remain in the response at their exact offsets but are not added to sampled token history; structured `delta.tool_calls` are accumulated independently. When the latch first activates, the active prompt integration appends the exact failure and available HTTP/server/backtrace details to that staged run's prompt log before retrying non-stream.

## Structural XML branch reuse

[XmlClosingTagGuard](XmlClosingTagGuard.md) adds raw-XML `inspectXml` detection to
the same branch selector. Markup alternatives are allowed on this path; recognized
EOS/chat-control tokens remain excluded. Structural activation is independent of
prose extraction/deslop and runs before an existing prose hook. No completed XML
is repaired, and strict final parsers remain unchanged.

The transport supplies `allowToolCalls` from its filtered per-attempt native-tool
exposure. When false, both ordinary XML alternatives and EOS append alternatives
must remain free of actual `<tool_call>` elements; sampled forbidden openings are
rejected before unfinished attributes are accepted. Literal CDATA/comments and
escaped text retain their existing treatment. Policy branch exhaustion preserves
the field/path and guidance to return the requested XML without tool-call elements.

`inspectXmlTerminal` reuses that selector for an actual sampled EOS at an append
cursor, never as a fake content token. It checks open/pending XML, validated stop
identity and finite probabilities, excludes all stop IDs, and preserves the full
raw prefix. Missing metadata, exhausted alternatives, token budget or EOS-round
limits fail explicitly; normal retries reset generation-local counts.

## Named-schema completion

`inspectXml` can return a `documentComplete` decision with exact `responseText`/`completionOffset` at the first valid schema root boundary. `canStopEarly:false` defers this for a streaming payload that may still emit native calls; actual `hasToolCalls` skips structural completion. The schema-aware terminal path prefers deterministic closes over sampled EOS alternatives, closes satisfied frames upward and opens the first missing required child for the model. A fully closed document finishes locally; schema-less terminal behavior is unchanged. Synthetic decisions carry no fake sampled token IDs/probabilities and preserve one-action force/continuation accounting, with separate diagnostic tag counts.
