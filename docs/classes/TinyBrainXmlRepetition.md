# TinyBrainXmlRepetition

## Purpose

`TinyBrainXmlRepetition.js` detects exact completed-XML repetition in cumulative TinyBrain model output. It is a transport-time safeguard for small models that enter XML copying loops; it does not repair malformed XML or rewrite near-duplicate content.

## Detection contract

`findTinyBrainXmlRepetition(responseText, options?)` scans XML-like markup while respecting quoted attribute delimiters and balanced nested elements. A candidate is an explicit opening tag plus content plus matching closing tag whose raw span is at least 51 characters.

The scanner ignores comments, CDATA sections, processing instructions, declarations, incomplete tags/elements, and self-closing tags as candidates. It recognizes:

- `AA`: the newly completed block exactly equals the preceding suffix after trimming whitespace immediately before the new block.
- `ABAB`: the last four completed direct siblings are exact pairwise copies, separated only by whitespace. The returned truncation boundary starts at the second `A`.

Comparisons are exact JavaScript string comparisons. Internal whitespace, attributes, tag case, and content must match exactly. A detection returns the pattern, truncation/end offsets, duplicate length, and source spans for the involved blocks.

`TinyBrainXmlRepetitionDetector` provides incremental `inspect(responseText)` calls. It avoids rescanning when newly appended text contains no closing delimiter and automatically handles a response rewind; `reset()` clears its remembered response.

## Runtime integration

`TinyBrainPromptRunner` activates the detector only when `ai.xml_repetition_fix === true`. `LLMClient` limits that async scope to completions whose normalized metadata label matches the runner, forces interruptible OpenAI-compatible streaming, and inspects cumulative text after each content delta.

On detection, `LLMClient` destroys the stream, truncates the copied suffix, and creates a continuation conversation ending with:

```json
[
  { "role": "assistant", "content": "<accepted response prefix>" },
  { "role": "user", "content": "continue" }
]
```

The next response is concatenated with the accepted prefix before ordinary output processing. Any incomplete tool call accumulated in the aborted stream is lost by design; earlier completed tool messages and results already in the TinyBrain conversation are preserved. The runner's configured `ai.retryAttempts` is also the maximum number of XML continuation recoveries for one completion. Reaching the limit throws a dedicated error.

The feature is separate from live slop correction. If both are active, token offsets remain relative to the stitched logical response, and live corrections cannot rewind into an already accepted XML continuation prefix.
