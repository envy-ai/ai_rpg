# LiveDeslop

## Purpose

`LiveDeslop.js` maps slop detected in player-action prose back to sampled llama.cpp tokens. It handles both plain TinyBrain drafts and final XML prose, chooses a higher-probability safe branch, tells `LLMClient` where to rewind, and retains correction diagnostics for the normal slop-removal attachment. Live requests prefer streamed prose-token logprobs while retaining tools. Streamed content without logprobs is preserved verbatim but excluded from prose-token inspection; this keeps XML tag pieces intact when llama.cpp omits their probability metadata. Invalid or misaligned supplied metadata still makes `LLMClient` fall back to bounded non-stream batches for the current llama.cpp process.

## Prose extraction

`extractLiveProse(response)` recognizes `<prose>`, `<originProse>`, `<betweenProse>`, and `<destinationProse>` content and builds a combined prose string plus source-offset mappings into the raw XML response. XML tag markup is removed from the analyzed text, `<hidden>` elements and their contents are excluded, and incomplete streamed tags beginning with `<` are ignored until they close. Non-prose XML fields are outside the recognized spans.

Every XML tag creates a hard n-gram boundary. The extraction therefore also returns individual `ngramSegments`; configured and repeated n-grams are matched inside each segment rather than over a flattened token stream. History indexing applies the same XML splitting and hidden-content exclusion.

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

Streaming capability failures are remembered under the effective endpoint plus managed llama.cpp PID. Later live stages use the 500-token non-stream method without repeating the failed probe. A game-server restart clears the in-memory latch, while a managed llama.cpp restart changes the PID key; either event permits one fresh streaming attempt. Content deltas without logprobs remain in the response at their exact offsets but are not added to sampled token history; structured `delta.tool_calls` are accumulated independently. When the latch first activates, the player-action integration appends the exact failure and available HTTP/server/backtrace details to the corresponding prompt log before retrying non-stream.
