# TinyBrainXmlResponse

`extractTinyBrainXmlResponse(response, expectedRootTags)` selects model-authored
TinyBrain XML before strict structural and domain validation. Callers supply one
known root name or an array of allowed root names. This module serves
`TinyBrainPromptParsers`, player-action resolution plans, and staged event XML;
the same lexical scanner in [XmlResponse](XmlResponse.md) also serves ordinary
completion extraction and document parsing through `Utils`.

Surrounding prose and Markdown fences are ignored when an expected envelope is
present. Both paired roots and self-closing roots are recognized. The final
expected envelope wins; an empty root remains subject to its parser's existing
empty-result policy. Comments, CDATA, processing instructions, and quoted
attribute values do not create spurious candidate roots.
Matched single- or double-backtick inline code spans outside an active XML
envelope are also ignored, so literal tag mentions before or after the response
cannot replace the real envelope. XML inside fenced code blocks remains
eligible; backticks inside an active envelope do not alter strict XML parsing.

Extraction never repairs XML or chooses an earlier valid result after rejecting
a later result. A final incomplete expected envelope remains selected and fails
strict parsing. A nested expected root does not replace an open outer expected
root, so valid inner XML cannot hide a malformed envelope. Malformed fields,
unexpected elements, attributes, mechanical values, and cross-stage invariants
remain the caller's strict validation responsibility.

Parsers return extracted XML through `normalizedResponse` where applicable.
The runner retains the original model response in its conversation and log.
Plain-prose, scalar, and sentinel contracts retain their existing behavior.
