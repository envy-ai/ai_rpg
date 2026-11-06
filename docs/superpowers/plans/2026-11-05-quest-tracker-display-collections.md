# Quest and tracker display collections

Group 4 of the [remaining reader/collection routing](2026-11-05-remaining-reader-collection-foundations.md),
implemented and verified after reader checkpoint `44a60f3`.

Actual `initQuestPanel:createQuestCard/renderQuestPanel` and
`renderChatTrackersPanel` now compose the existing CollectionView. Their original
rebuild policy is preserved, so no SnapshotList or new primitive is introduced.
Quest details use the existing native disclosure builder. Active/completed counts,
empty state and content replacement share collection ownership; app adapters retain
formatting, sorting and eligibility. First-active-open, completed-closed, paused
appearance and updated/created/index ordering remain exact.

Every quest action/route/edit listener and tracker tooltip/edit/delete listener
uses its entry's AbortSignal and is released before obsolete DOM is removed.
Tracker header/list ownership and both quest collections survive cached pagehide,
then release on final unload. Pending operations continue across card replacement;
only final document disposal suppresses obsolete UI continuations. The pending
Quest edit response also guards its existing destroyed ReaderRows cleanup.

Tracker whole-card progress remains the existing CSS pseudo-element/gradient and
`--tracker-progress-percent`, with current host parsing/normalization and zero/
invalid behavior. It is distinct from ProgressMeter's contained fill, so no bar
node, new numeric bound or redesign is introduced. This exact structural seam is
recorded for the later foundation stage.

Touched request failures now retain original parse/Error/server backtraces through
persistent PageFeedback; tracker inline save status remains. Confirmations, action
IDs, requests, client IDs, request-local pending state and completion/retry/abandon
refresh behavior remain app-owned. There is no global pending lock or new transport.

Terra gates: active/completed/paused ordering/default details and empty/count
state; exact completion/retry/abandon/pause/route/edit target IDs; old removed
buttons inert; pending actions can finish after rerender but cannot write after
final unload; cached owner remains live. Trackers cover hidden-only empty state,
hidden toggle, raw percentage/count fills, countdown text, tooltip content/disposal,
edit/delete response refresh and original error details. Desktop/phone markup and
existing CollectionView portable evidence are retained; no new API requires a
parallel specimen. Root owns the master ledger/index/commit; domain Group 3 owns
distinct ability/skill/technique/action-image blocks. Coding agents run no tests.

Tooltip disposal uses explicit FloatingTooltip owner identity, never `:hover` or
content inference. New shows replace identity, including other unowned controls;
retiring a tracker dismisses only its own tooltip even while the pointer is
stationary or transferred into the interactive hover bridge. The same narrow seam
is shared with the parallel ability/skill collection adapters.

## Frozen source/build gate

After both collection groups froze, widgets/main/settings builds passed twice;
all fourteen generated JS/CSS/map/template assets rebuilt byte-identically,
including final tooltip-owner and chooser-focus changes. The browser plausibility
template remains byte-identical to its canonical source. Sixty-four relevant
modules passed syntax checks; production Play renders and its inline script parses,
with each shared constructor asset present once. Exact behavioral counts/artifacts
are added by the coordinator from Terra's focused runs.
