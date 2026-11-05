# Portable native-dialog and floating-tooltip extraction

Date: 2026-11-05. Status: implemented and verified. NativeDialog and FloatingTooltip,
their real-consumer migrations, compiled assets and independent specimens are complete.

## Bounded result

Extend the existing `packages/ui-widgets` ESM/SCSS package with `NativeDialog` and
`FloatingTooltip`. Migrate PageFeedback/New Game native dialog lifecycle and both
duplicated Play floating tooltip controllers onto those implementations. Keep all
current markup, appearance, event contracts, application policies and transports.
The existing interface is the visual reference; no mockup or redesign is needed.

Both fit this slice because they adopt existing DOM roots and own only small
interaction lifecycles. They do not absorb form transactions or entity formatting.
Custom Play modals, modeless choosers/windows, native-dialog content generation,
and other popup families remain outside this phase. Phase one remains documented
in [widget-library-extraction](2026-11-05-widget-library-extraction.md).

## NativeDialog contract and migrations

Add `packages/ui-widgets/src/native-dialog.js`, exported from the package entry.
Adopt an existing native `<dialog>` root. Own native modal open/close, initial
focus, return focus (including the same-ID replacement of a detached trigger),
pending Escape/close guarding, and explicit listener disposal. Support a narrow
close callback for application cleanup and an opt-in remove-on-close lifetime for
transient feedback dialogs. Direct native `dialog.close()` remains compatible.
`destroy()` is idempotent; other use after disposal fails clearly.

Pending state is a dismissal guard and `aria-busy` state, not an async framework.
The host still owns disabled controls, fetches, AbortControllers, stale-response
epochs, status text, errors, persistence and commit decisions. Do not introduce
global dialog registries, body locks or focus traps alongside the native browser
top layer.

- `public/js/page-feedback.js`: preserve safe text/Node content, its return value
  (the native element), `dialogs` bookkeeping, focus behavior, and error dispatch;
  delegate only lifecycle to NativeDialog. Prompt/modeless failure handling and
  WebSocket/jobs remain untouched.
- `public/js/new-game.js`: preserve save/load workflow objects and their existing
  pending controls, epoch increment, close-triggered abort and trigger-state
  updates. Delegate native visibility/cancel/focus to NativeDialog and route close
  controls through its pending guard.
- Add one classic overlay adapter in `client/widget-adapters/overlays.js`, build
  `public/js/widgets/overlays.js`, and load it through shared head before deferred
  PageFeedback/NewGame consumers. It registers constructors in `AIRPG_WIDGETS`;
  exported package modules remain free of application globals.

## FloatingTooltip contract and migrations

Add `packages/ui-widgets/src/floating-tooltip.js`, exported from the package entry.
Adopt a supplied tooltip root and its owner document. Provide the current
`show(content, point, {allowHTML})`, `move(point)`, `hide({defer})` behavior plus
idempotent `destroy()`. Text is safe by default; HTML is explicit caller-owned
content, preserving existing rich effect/entity formatters. Root classes/hidden
state, scroll reset, the existing viewport-position algorithm, and the 180ms
hover-transfer delay remain unchanged. Do not add numeric clamping or a new
positioning framework.

Own root mouseenter/leave, delayed-hide timer, document Escape and window scroll
dismissal, with proper cancellation/removal on disposal. Permit app-owned scroll
targets; app wrappers retain show policy without importing touch/game/global helpers.
Do not consume Escape: existing tooltip dismissal allows enclosing interactions
to receive it. Existing caller focus handlers keep supplying their anchor point;
the primitive must not steal focus.

- `views/index.njk` general controller: retain `window.floatingTooltipController`
  public shape and `floatingTooltip:ready` notification. The app wrapper owns
  `shouldSuppressContextTooltips()` and its explicit-open exception.
- `initPartyDisplay`: replace duplicate timer/position/show/leave mechanics with
  another FloatingTooltip instance. Keep `window.hidePartyTooltip`, Party panel
  scroll dismissal, member formatting, mobile suppression, rerender cleanup and
  card event bindings in the adapter.
- Use existing tooltip styles unchanged. If shared structural SCSS is needed for
  the independent specimen, add only package-owned structural rules and compile
  all affected outputs; do not move app rich-tooltip theme/content styles into
  the library.

## Files, specimens and verification

Runtime/build scope: the two package modules/exports, overlay adapter/build output,
build script, shared head, PageFeedback, NewGame and the two inline index
controllers. Extend the package's app-free specimen with a native modal (pending
toggle and focus return) and text/rich/scrolling tooltip triggers. Package docs,
class/UI docs and audit status follow the implementation; the coordinator owns
the root documentation index and commits.

Testing is delegated to terra. Extend standalone package browser interaction
coverage for native top-layer/focus/close/pending/teardown and tooltip positioning,
safe text, explicit HTML, hover bridge, overflow interaction, scroll/Escape and
teardown without app scripts/API. Exercise real migrations through the isolated
New Game save/load fixture, PageFeedback native error/content focus case, and
rendered index ability/entity/Party tooltip fixture. Direct-script fixtures must
load the new adapter; do not add runtime fallbacks to support old fixture setup.

Preserve phase-one popup ordering/select lifecycle tests and use focused existing
consumer regressions where changed shared-head behavior matters. Run browser
tests only in the required 16GB/no-swap user systemd scope, with automatic game
webServer disabled. Use isolated static/rendered fixtures bound to `0.0.0.0`,
keep artifacts under `tmp/`, and never restart/load the user's game server.
The coding agent may perform syntax/build checks and deterministic output checks;
the testing agent owns test execution. Complete when independent primitives and
actual migrated consumers pass, appearance remains unchanged, teardown is owned,
and no transport/domain behavior moved into the package.

## Verification results

- `npm run widgets:build` and `npm run scss:build:main` passed. Repeated widget
  builds produced identical generated adapter, package and specimen assets.
- Syntax checks passed for all nine changed runtime/build modules and assets,
  the extracted general/Party inline scripts, affected Nunjucks templates and
  changed test files. `git diff --check` passed.
- Twenty-nine distinct focused Chromium cases passed across isolated runs:
  15 portable-overlay/New Game/PageFeedback cases, 5 ability/Party tooltip cases,
  1 independent overlay specimen case, 7 attachment/technique/formula-variable
  adapter cases, and 1 extended specimen layout case. The last checks included
  1280px and 390px captures with readable controls and no clipping. Unchanged
  phase-one selector/popup behavior retained its existing evidence; the changed
  standalone page was rechecked.
- Six unit cases passed across `tests/pagefeedback.owned_jobs.test.js`,
  `tests/entity_tooltips_ui.test.js` and `tests/mobile_tooltip_dismissal.test.js`.
  The entity source assertion was updated to expect all three NPC presentations
  to call the shared controller instead of preserving the removed Party
  `innerHTML` implementation, then rerun; five unaffected passes were retained.
- Browser commands used `PLAYWRIGHT_SKIP_WEBSERVER=1` and the required
  `systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0`. Unit commands
  used the required transient service wrapper with the same memory/swap limits.
  Artifacts and reports are under `tmp/`; no game server was started/restarted,
  and no live save or game state was loaded or mutated.

The exported NativeDialog contract now rejects reopen while a previous native
close event is queued. This prevents a new lifetime from replacing the first
lifetime's cleanup and focus target. A focused browser regression verifies that
closing callbacks complete before a retained root can be opened again.

Custom Play modal stacks, modeless chooser/window lifecycles and additional popup
families remain the next overlay work in the broader widget merge roadmap.
