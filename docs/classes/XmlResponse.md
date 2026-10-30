# XmlResponse

`extractXmlRootBlock(input, options)` isolates one XML envelope without parsing
or repairing its contents. `Utils` uses it before every document parse and for
ordinary completion extraction; `TinyBrainXmlResponse` uses it for expected-root
selection.

Options:

- `expectedRootTags = null`: one allowed root name or an array, matched without
  case sensitivity during extraction. The downstream XML/domain parser still
  validates spelling and syntax. Without this option any root name is eligible.
- `selectFinal = false`: choose the first outer envelope, or the final eligible
  envelope when true. Nested same-name roots remain part of the open envelope.
- `ignoreInlineCode = false`: when true, skip matched single- or double-backtick
  spans outside an active envelope. Fenced XML remains eligible.
- `requireComplete = false`: when true, return an empty string if the selected
  envelope lacks its outer closing tag. This never selects an earlier draft.

The result is the selected source substring, or an empty string when no root
matches (or completeness is required and missing). Surrounding content is
discarded. A truncated selected envelope otherwise extends to the end of the
input so its parser can report the actual error. No valid descendant can hide
an incomplete selected outer root.

The lexical scanner recognizes self-closing roots and skips quoted attribute
values, comments, CDATA, processing instructions, and declarations including
DOCTYPE internal subsets. Tag-shaped text there cannot alter root boundaries.
Malformed content inside the selected root is retained for strict validation.
