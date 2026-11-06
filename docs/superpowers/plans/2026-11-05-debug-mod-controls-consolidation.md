# Debug, Mod Manager and local LLM presentation

L02/L06 of the [full disposition](2026-11-05-full-widget-disposition.md), following
checkpoint `c4d7dac`. Implementation is source-frozen; delegated verification is in progress. Scope uses existing CollectionView/SnapshotList/ImageFrame, BusyButton,
StatusSurface and ProgressMeter. No new package primitive is planned.

## Bounded consumers and preserved contracts

- Debug's generated-image result history appends entries, while recent images and
  the saves browser replace snapshots. Compose the corresponding existing view
  ownership, explicit entry listeners and image frames; remove inline save-row
  callbacks without changing save names/IDs or endpoints. Recent image activation
  fills prompt/width/height/seed/negative prompt, rather than opening a Lightbox.
  Keep the six-recent-image limit, full-size result links and current card chrome.
- Compose Debug image-job status with StatusSurface text slots/native line breaks
  and ProgressMeter. Existing palettes and progress formatting stay host-owned.
  BusyButton replaces only existing image-generation/portrait disable/chrome work;
  do not add a global save/load or Mod Manager lock. Preserve image polling's 1s
  start, 2s cadence, 60-attempt bound and explicit load/portrait/status reload delays.
- Move Debug's dynamic page controller to `public/js/debug-ui.js` for explicit
  ownership and direct syntax checks; keep its injected JSON console block/static
  statistics/native disclosures/vendor pretty-json in the template. These are
  read-only/native/vendor compositions, not a new inspector to rewrite.
- Mod Manager retains native configured-enable checkboxes, runtime active flags,
  metadata and restart-required warnings. Use CollectionView/StatusSurface for
  repeated presentation. Explicit Refresh/Save remain domain commands with their
  existing configuration persistence and no automatic service restart.
- Local LLM LED/label/aria state remains its current app renderer. BusyButton adopts
  only pending/transition eligibility, retaining the exact LED content and header
  geometry; StatusSurface can target the existing state label. Existing revision,
  deduplicated errors, serialized explicit POST and one 2s refresh loop remain host
  policy. No actual LLM/server operation is performed during development checks.

## Ownership and error boundaries

Entry replacement releases old local actions/image bindings. Started page-owned
operations still finish across ordinary list refresh; only final disposal suppresses
obsolete UI. Own timers/listeners/viewers and late continuation guards explicitly.
Cached pagehide retains them: local-LLM's current unconditional closed flag would
otherwise leave a restored page permanently inactive. Do not create a second poll
loop or alter backend desired-on/off/restart semantics to address that UI boundary.

Original request/parser/server errors retain inline status and persistent
PageFeedback details. Preserve native confirmations and deliberate page reloads;
this is not an alert/confirm replacement sweep. Native readonly tables/statistics
and vendor JSON retain their semantics and inherited foundation theme.

## Delegated verification

Terra verifies actual Debug recent-image form fill, appended result history, save
load/delete IDs/confirmation, stale retired controls, busy/status/progress including
zero, original errors and bounded timer/cached/final behavior. Mod Manager covers
configured-versus-active checkboxes, explicit save/refresh, restart warning, latest
snapshot/error and final guards. Local toggle covers native keyboard/pending LED,
revision race/error dedup, cached/final owner and one scheduler. Fixtures intercept
all endpoints; no live server restart, save load or LLM transition is permitted.

Root owns master/index/commit; this worker owns the named views/local controller,
new Debug UI module and focused documentation. L03/L05/L07–L09 remain separately
open after this finite slice.

## Accepted evidence

Nine distinct Chromium cases pass on actual Debug/Mod Manager/header templates
with mocked services. They cover recent-image keyboard/form fill, retired controls,
original error stacks, completed image jobs including zero progress and retained
previous results/links, explicit mod IDs/configuration/restart warnings, committed
PUT versus stale GET, and cached/final pending work/loop retirement. Strengthened
reruns count once. The four affected Node suites shared with Chat passed 24 cases;
no production fake-DOM compatibility branch was added. Changed scripts pass syntax,
Debug/Mods render with parsed inline scripts and local assets. Focused source review
found no introduced defect. Exact result groups are in [Playwright](../../playwright.md).
No server, save or local service operation occurred.
