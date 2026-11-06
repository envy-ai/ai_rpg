# Selectable text and Log reader consolidation

Group 2 of the [remaining-reader routing](2026-11-05-remaining-reader-collection-foundations.md),
implemented and verified after navigation checkpoint `c8d23be`.

The existing `chat.js:updateSelectableTextElement` implementation is now the pure
portable `updateSelectableText` export. Terminal output, prompt/live response and
failed-response viewers keep the same caller methods, buffers, incremental delta,
FloatingWindow and FollowScroll policies. The output's owning Node realm replaces
the former global Node reference. No transport, retry, offset or truncation policy
moves into the package.

Log Viewer adopts TextGutter for its native read-only textarea/line numbers and
CollectionView for its actual filename buttons. Entry AbortSignals release old
click actions. App filtering, ordering, selected filename, list/file abort logic
and inline/native error presentation remain local. Empty/LF/trailing-line counts,
literal text and unwrapped horizontal scrolling remain exact; terminal receives
no invented gutter. Final unload aborts requests and releases all three owned
views/dialogs; cached hide retains them. Late read and whenClosed continuations
check owner disposal before accessing destroyed controllers.

Core owns modules, exports/classic build, Chat text helper, Log source, app-free
specimen/styles and class/package docs. Group 1 independently owns structured
readers/check/diff/projection helpers and their bounded Chat sections. Shared entry
and build integration are coordinated explicitly. No tests, git or server actions
were run by the coding agents.

Terra gates: direct unchanged/append/trim/middle-change/invalid text and Range
identity; actual terminal/prompt/failed readers retain selection/follow/offsets;
Log literal markup, empty/trailing newline, long-line/vertical scroll, stale file
and session responses, retained-selection filters, stale removed controls, native
error details and cached/final unload. Desktop/phone Log and independent specimen
geometry remain required. Reader/card/foundation/mod groups 3–8 remain open.

## Frozen source/build evidence

After both reader groups froze, widget/main/settings builds passed twice and all
fourteen generated JS/CSS/map/template assets were byte-identical. The browser
plausibility template exactly matches its canonical source. Sixty-two relevant
modules passed syntax checks; rendered Play/Log templates and the Play inline
script parse, each shared constructor asset occurs once, and both canonical/browser
plausibility templates compile. Browser/source behavioral evidence is aggregated
by the coordinator from Terra's focused runs; no tests were run by this worker.
