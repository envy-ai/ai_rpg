# TextGutter

`packages/ui-widgets/src/text-gutter.js` exports `TextGutter` through the package
entry and classic overlays adapter. `new TextGutter(textarea,gutter)` adopts native
same-document elements and owns one passive textarea scroll subscription. Duplicate
owners reject until the first is destroyed. It adds no markup, styles or observer;
the host supplies matching line-height/padding and a hidden-overflow gutter.

`setText(text,{resetScroll=false})` requires literal string text, sets the native
textarea value and renders line numbers as text. It returns zero for empty input;
otherwise LF-separated lines are counted exactly, including a trailing empty line.
Native textarea newline behavior remains browser-owned. `resetScroll:true` resets
both textarea axes before gutter synchronization. Identical values are not
reassigned, preserving native selection when possible. No HTML is rendered.

`sync()` copies vertical textarea scrollTop to the gutter; horizontal scrolling
remains solely in the unwrapped textarea. There is no automatic tail/follow or
polling. `destroy()` aborts the subscription/releases references, retains content
and DOM, and is idempotent. Updates after destruction reject; a new owner can
adopt the same elements.

Log Viewer uses the binding for file/empty/loading display, keeping filenames,
requests, errors, filter and selected-file policy in its app controller. Its file
list uses CollectionView with explicit entry subscription disposal. Cached
pagehide preserves this document; final unload aborts outstanding requests and
releases gutter/list/native-dialog owners before late callbacks can write UI.
