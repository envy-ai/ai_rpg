# SelectableText

`packages/ui-widgets/src/selectable-text.js` exports the pure
`updateSelectableText(output,nextText,update=null)` function through the package
entry and classic overlays adapter. It adopts a same-document HTML output element
containing at most one text node and requires literal string text. It returns
false when unchanged, otherwise true. It creates no listeners or persistent owner.

This is the existing Chat incremental updater extracted intact, using the output's
own document/Node constants. The optional delta contains `{previousText,
appendedText,nextText,reset}`. A matching non-reset delta appends then removes any
trimmed prefix. Other updates replace only the changed span between common prefix
and suffix. It retains the native text node and DOM Range selection behavior;
invalid mixed markup and an inconsistent final delta throw clear errors. No HTML
parsing, transport offsets, buffers, truncation or retry policy are introduced.

Chat's terminal, prompt, live response and failed-response readers delegate through
`updateSelectableTextElement`. Their existing FloatingWindow and FollowScroll
owners keep focus/drag/follow/selection policies. Log Viewer uses its native
textarea selection model and [TextGutter](TextGutter.md), rather than a fabricated
terminal gutter or common document editor.
