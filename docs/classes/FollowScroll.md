# FollowScroll

`packages/ui-widgets/src/follow-scroll.js` owns queued bottom scrolling and optional
scroll-intent/resize/mutation observation. Construct with an HTML scroll root and
`{canScroll,isFollowing,onFollowChange,trackIntent,observe,initialPending,
requireVisible}`. Predicates remain host-owned; no transport or content rendering
is included. The copied Chat bottom threshold is two pixels, with no data clamping.

`request({force=false,immediate=false})` preserves pending force intent and schedules
one owned animation frame. `flush()` retries pending work after host readiness
changes. `scrollNow()`, `captureIntent()` and `atBottom()` expose existing boundary
mechanics. Tracked upward scroll cancels pending following until the user reaches
bottom or an explicit force request. Optional observation follows root/child size
and content changes using native observers, with no polling. `hasSelection(root)`
checks intersecting native selection ranges. The host decides whether force may
bypass follow/selection and whether hidden/zero-height views should defer.

Idempotent `destroy()` aborts owned scroll listeners, observers and queued frames,
then releases DOM/predicate references. Cached pagehide preserves controllers;
real UI disposal releases them.

Chat history uses tracked intent, observed row/viewport changes and its existing
history-ready/load-count predicate. Prompt viewers and terminal output retain
checkbox/selection-pointer/range guards without introducing Chat's user-scroll
policy. Each window owns its own controller and disposes it on close; queued work
cannot move a removed viewer. Terminal's Follow checkbox now calls the terminal
controller rather than the old prompt-viewer selector helper. Job, request and
poll ownership remain unchanged.

Observed text/nested-content mutations request following without walking the
whole row list. Direct root child-list changes alone resynchronize the set of
ResizeObserver targets; direct rows remain observed for late image/disclosure
size changes. Owned observer callbacks ignore delivery after destruction.
