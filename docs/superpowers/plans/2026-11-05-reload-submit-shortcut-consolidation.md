# Reload sources and native submission shortcuts

L01/L04 of the [full disposition](2026-11-05-full-widget-disposition.md), following
checkpoint `9b7a386`. Scope approved from current native source before editing;
implemented and verified by the focused checkpoint below. Foundation styles are a parallel
Group 7 slice with separate owned SCSS and prior computed-style baseline.

Reload keeps its existing host state, GET/POST payloads, operation replay IDs,
amount validation/preview, compatibility, native pending guard, queued rapid reopen
and success callbacks. Source buttons now compose CollectionView with entry-owned
click/drag listeners; StatusSurface retains literal status/data-kind/hidden state.
Source replacement/close releases stale controls. Owner identity and generations
guard read/submission continuations; committed results still run page-live callbacks
and global refresh across ordinary close/reopen without altering a newer dialog.
Final unload retires views/native state and ignores late UI/callbacks; cached hide
keeps the document alive. Original parse/Error/server details are logged and shown
through persistent PageFeedback alongside retained inline text.

SubmitShortcut extracts the existing document bubble algorithm, preserving native
`requestSubmit`, form validation and explicit action resolution. Its package default
recognizes native/role dialogs; the thin application adapter supplies existing
class selectors, top custom/media policy and PageFeedback. Native top-layer dialog
priority stays generic. Composition/defaultPrevented/disabled/readonly and explicit
non-form action guards remain. Ordinary forms need an explicit target. One native
listener owner/document has explicit disposal; no Node fake-DOM branch, duplicate
engine or promise/transaction wrapper is introduced.

The existing `/js/modal-submit-shortcuts.js` URL is generated deterministically from
the adapter. Its shared-head position follows stack/feedback dependencies before
interaction; no runtime loader/fallback is added. The package entry exports the
class; the independent specimen demonstrates validation, native modal input,
readonly and an explicit ordinary-page action. No new reload markup/style is needed.

Terra gates: stale source click/drag after filter/select/close/reopen; compatible and
unavailable sources, search-empty/preview/amount; replay retry versus changed source/
amount; held options/reload/callback across cached/final hides and an explicit
native close/new dialog; committed callback/global refresh and newest pending state.
Shortcut gates cover Ctrl/Cmd/defaultPrevented/composition/readonly/disabled fields,
all-disabled submitters, native invalid form, exact submitter, explicit action scope,
filter non-submission, native/custom/media priority, error causes and disposal.
Reuse current actual NewGame/Stories/reload and named non-form consumers rather
than a second fake engine. No test execution/git/server action by coding agents.

L02/L03/L05–L09 and full original audit reconciliation remain open; neither a native
shortcut specimen nor this source migration constitutes final completion.

## Frozen build/source evidence

Widget and main/settings/PageFeedback/StoryEditor/StoryAuthoring SCSS builds pass.
All twenty-one generated JS/CSS/map/template outputs reproduce byte-identically
after a second build, including the new shortcut asset and ignored mod styles.
The browser plausibility template remains exact canonical bytes. Seventy-two
relevant JS modules pass syntax; production Play/Worlds/Config render and all
three inline scripts parse. Shared constructor/shortcut assets occur once and the
shortcut follows its feedback/stack dependency boundary. Behavioral evidence is
recorded by the coordinator from Terra's focused runs; no tests ran in this worker.

## Accepted focused verification

Fifteen distinct Chromium cases pass across this slice and parallel foundations:
six actual-page foundation cases, one independent style/theme specimen, two native
shortcut/direct-adapter cases and six reload cases. Reload includes retired source
controls, replay retry, cached/final pending reads, committed callback after external
native close/new dialog, and final pending POST suppression. Three Node shortcut
source checks pass; obsolete fake-DOM behavior tests were replaced by actual browser
coverage rather than a production compatibility branch. Changed test scripts pass
syntax checks. Exact artifact groups are recorded in [Playwright](../../playwright.md).

Focused review found no production defect. Its obsolete Node require finding was
resolved by the test migration and verified by the three passing source checks.
No live server restart, save load or local service call occurred.
