# Portable widget library extraction

Date: 2026-11-05. Status: phase one implemented and verified. The independent package,
application adapters, compiled styles and specimen are complete. Subsequent phases
remain an ordered roadmap.

## Outcome and scope

Establish an independently usable vanilla JavaScript and SCSS package, initially containing the existing SearchableSelect and PopupDismissal implementations. Current application consumers must use these same implementations through thin adapters. A standalone specimen must work without the game server, API, application scripts, AIRPG globals, or application stylesheet.

The reference is the existing interface and contracts documented in [widget_audit.md](../../ui/widget_audit.md), [SearchableSelect](../../classes/SearchableSelect.md), and [PopupDismissal](../../classes/PopupDismissal.md). This slice preserves appearance, selection/filtering behavior, form serialization ownership, keyboard behavior, and immediate popup dismissal. It does not introduce a framework, redesign controls, or migrate other widget families.

Effort and uncertainty are bounded: these are two small existing controls, but browser load order, disabled-state rerendering, popup event ordering, and CSS cascade need direct verification. No game server restart or save loading is needed.

## Package and host boundary

- Create `packages/ui-widgets/package.json` with ESM exports from `src/index.js` and a documented SCSS entry, `styles/index.scss`. The package has no runtime dependencies or application imports. DOM APIs are its only environment dependency. Package names and selectors must describe widget behavior rather than the game.
- Extract `SearchableSelect` into `packages/ui-widgets/src/searchable-select.js` and export it from the package entry.
- Extract the disclosure manager into `packages/ui-widgets/src/popup-dismissal.js`, exporting `createPopupDismissal({ document })`. Its returned service provides `bind(details, options)` and `destroy()`. A returned binding retains `close({ restoreFocus })` and `destroy()`. Document defaults may use the browser document; an explicitly supplied owner document supports isolated specimens.
- Add application entry sources under `client/widget-adapters/`. SearchableSelect's adapter preserves `window.AIRPG_WIDGETS.SearchableSelect` and the existing workflow-default label. PopupDismissal's adapter creates the application-owned service and preserves `window.AIRPG_WIDGETS.PopupDismissal.bind(...)`. All application-global registration stays in these adapters.
- Use the installed root `esbuild` to bundle those adapters into the existing `public/js/widgets/searchable-select.js` and `public/js/widgets/popup-dismissal.js` paths. These become generated distribution assets, with one authoritative source per implementation. Preserve current classic-script URLs and execution order; do not convert the whole client to ESM.
- Add a deterministic root build script and npm command that regenerate both adapters. Do not introduce dynamic script loading, runtime fallback implementations, new server routes, or a second copy of the control logic.
- Keep the package directly importable through its ESM source entry; the standalone specimen imports it directly. Root build tooling is development infrastructure, not a runtime requirement of the exported modules.

The current host serves `public/` through `express.static` and uses classic scripts, sometimes deferred. Keeping generated assets at their existing paths avoids changes to server startup, Nunjucks script placement, and the many existing browser fixtures which load these URLs/files.

## SearchableSelect contract

Retain construction with a root element and `multiple`, `options`, `value`, `onChange`, and `emptyLabel`; retain `getValue`, `setValue`, `setOptions`, the bubbling `searchable-select-change` event, current CSS selectors, and root `data-label`/`data-placeholder` support. The portable default empty label is generic; the app adapter retains “Use workflow default.” Explicit caller labels such as “Choose…” continue to win.

Preserve these behaviors:

- Single choice uses a native select and multiple choice uses labelled checkboxes.
- Search is case-insensitive, with all whitespace-separated substrings required.
- Filtering preserves selections, including a single selected option excluded by the current query and a stored unavailable single value.
- Programmatic value/options changes do not emit user-change events.
- Values are copied where necessary; internal controls do not acquire form names.
- Disabled controls remain disabled when options/value/filtering rerender them. Existing app code also disables containing controls during requests, so extraction must preserve that behavior rather than assume only the widget API can change disabled state.

Add an explicit `setDisabled(boolean)` API (and a readable disabled state) so app adapters can apply disabled ownership without depending on generated DOM. Add idempotent `destroy()` that releases listeners/callback references and generated control DOM while preserving the host root and unrelated attributes. Clearly reject mutation/use after destruction rather than silently mounting placeholder behavior. Construct events and DOM from the owning document where necessary.

In `public/js/image-workflow-editor.js`, use the widget disabled API when synchronizing “Use global defaults,” retaining current disabling of the rest of the workflow form. LoRA availability reconciliation and hidden JSON serialization remain in this application controller. Technique selector callers keep their current public contract and event listeners.

## PopupDismissal contract

Preserve native details/summary activation and ordinary buttons/links; do not add menu roles or a competing keyboard-navigation model. Bindings remain idempotent for a root, validate details/summary ownership, and keep one open popup per service.

Preserve event ordering and focus:

- Capture outside pointer/click dismissal even when feature handlers stop propagation.
- Close an action popup synchronously before its action handler runs.
- Restore summary focus synchronously when the action originated inside the popup, allowing a subsequently opened native dialog to retain focus.
- Escape closes only the active popup, restores its trigger, and consumes that Escape before an enclosing chooser/dialog handles it.
- Outside dismissal does not steal the outside control's focus.
- Recognize same-task programmatic opening and queued native toggle events without polling.
- Observe detached active roots only while needed; release the active reference and observer on close/detachment.

Give the service explicit ownership of its document listeners and observer. `destroy()` closes active state and removes document/local event subscriptions; binding destruction closes/unregisters only that binding. Future binds on a destroyed service fail clearly. Avoid a permanent library-global active-popup singleton and avoid strong registries retaining every historical inactive popup. The app owns one service for its document; specimen/tests can create and dispose independent services.

ActionImages remains the real consumer and retains image regeneration, prompt editing, pending/error behavior, markup and theme. Other entity/header/map popups remain outside phase one.

## Styles and specimen

- Move the generic `.searchable-select__choices`, search and select rules from `public/css/main.scss` into package SCSS without importing `_globals.scss` or application tokens.
- Import that SCSS into `main.scss` at the existing rules' cascade position. Keep workflow- and technique-specific color, border, padding, sizing and form rules in their current application scopes. Preserve existing selector names so consumer fixtures and rendering continue to match.
- PopupDismissal provides behavior for native disclosure markup and needs no application image-menu styling in the package.
- Add `packages/ui-widgets/examples/index.html` and an ESM specimen script. Include single and multiple selectors, visible selection/change state, disabled/rerender/dispose/remount controls, two disclosure popups, and a popup action opening a native dialog. Use generic sample filenames/options and text.
- Build the package SCSS to a standalone distributable CSS file; specimen styling may add only its own page layout and native disclosure presentation. It must not import application CSS, fonts, images, scripts, network services or API data.
- Document direct ESM/SCSS consumption, package CSS generation, root adapter regeneration, public APIs and ownership/teardown in the package README. No publishing or external package installation is part of this task.

## Ordered work and acceptance

1. Commit the audit and this plan before implementation (coordinator-owned). No source changes precede that checkpoint.
2. Create the ESM package, migrate both implementations, add lifecycle/disabled APIs, and add the independent specimen.
3. Add thin app adapters and deterministic build tooling, regenerate the existing browser assets, migrate workflow disabled synchronization, and extract/import generic SCSS.
4. Add focused interaction coverage through the designated testing agent. Coordinate public APIs/specimen selectors before test implementation.
5. Run syntax/build checks and focused standalone/consumer browser regressions. Review desktop and narrow screenshots against current app styling. Correct regressions before broadening scope.
6. Update class docs, UI/assets docs, Playwright coverage notes where affected, the audit's implementation status, and documentation indexes. Coordinator reviews integration and commits the concrete result.

Phase one is complete when both exported controls operate without application code, all migrated real consumers use the package implementations, the specimen has no unexpected app/network dependency, owned lifetimes can be destroyed/recreated, build output is reproducible, and focused browser regressions preserve the existing host UI/behavior.

## Verification delegated to the testing agent

Testing artifacts belong in `tmp/`; browser helpers belong in `playwright_scripts/` if needed. Use isolated fixture/static HTTP servers bound to `0.0.0.0`, with `PLAYWRIGHT_SKIP_WEBSERVER=1` so Playwright cannot start or reuse the user's game process. Preserve existing fixture intercepts; do not exercise live game APIs.

Standalone interaction coverage should verify:

- Single choice, keyboard selection, all-term search, filtered selected value, unavailable value, clearing, callback/event counts and no programmatic emissions.
- Multiple checkbox selection surviving filtering, copied values, no accidental form serialization, accessible names and native keyboard operation.
- Explicit disabled state plus disabled rerendering, destroy/remount, and clear use-after-destroy errors.
- Exclusive popup opening; captured outside dismissal despite stopped propagation; keyboard activation; Escape ownership within an enclosing native dialog; same-task programmatic open; active-root detachment; binding/service destroy and clean recreation.
- Popup action dismissal/focus completes before an action opens a native dialog; pending/error state remains caller-owned.
- Package specimen imports no AIRPG/application globals or application assets; no unexpected API/network requests or page errors; usable desktop/narrow layouts.

Consumer regressions should start with `tests/e2e/image-workflow-loras.spec.js` and the affected SearchableSelect/ActionImages cases in `tests/e2e/techniques-panel-editor.spec.js`, then relevant `tests/e2e/ability-attachments.spec.js` cases. Keep existing fixture load paths; update tests only where the packaging/public contract intentionally changed. Select focused cases before rerunning unrelated technique mechanics.

All commands that execute browser tests run under the required user systemd scope with `MemoryMax=16G` and `MemorySwapMax=0`; non-browser tests use the required transient service wrapper from `~/AGENTS.md`. Build and standalone syntax checks do not need a test scope. Compile every modified SCSS output before completion. Stop after required checks pass unless a new change/failure justifies repetition.

## Phase one verification results

The audit and implementation plan were committed before source work as `0ed2ab8`
and `0ad402a`. Implementation review resolved stale checkbox listeners after full
rerenders and synchronous dismissal of a second programmatically opened popup.
Registered-summary switching also preserves the pointer target when native
disclosure content is in flow; ordinary outside pointerdown remains immediate.

- `npm run widgets:build` and `npm run scss:build:main` passed. Repeated widget
  builds produced identical adapter, package CSS and specimen CSS checksums. The
  app's compiled `main.css` remained byte-identical; its source map reflects the
  extracted SCSS source.
- Syntax checks passed for all new/changed JavaScript sources, adapters, generated
  runtime assets, build tooling and the new browser spec. `git diff --check` passed.
- Twenty distinct focused Chromium cases passed across isolated runs: three
  `ui-widgets-package.spec.js` cases, sixteen workflow/technique/attachment consumer
  cases, and one ActionImages popup case. The consumer selection used
  `--grep 'workflow|technique editor|attachment'` with `image-workflow-loras.spec.js`,
  `ability-attachments.spec.js` and `techniques-panel-editor.spec.js`. The final popup
  run used `--grep 'popup service|action icon popups'`; selector lifecycle was rerun
  after the checkbox cleanup fix. Unaffected specimen/selector passes were retained
  when the final popup-only changes were verified.
- Browser commands used `PLAYWRIGHT_SKIP_WEBSERVER=1`, the installed Chromium path,
  and `systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0`; all reports,
  results and screenshots are under `tmp/`. No game server was started/restarted and
  no live save was loaded or mutated. Desktop (1280px) and narrow (390px) specimen
  captures were inspected and showed readable controls without clipping.

## Deferred merge phases

After the first slice is proven, proceed in the audit's order: shared overlay/focus/dismissal lifecycle and floating windows; tooltip/anchored popup controllers; tabs/repeatable text lists/form controls; collection/media primitives around existing renderers; transfer and assignment workspaces; larger list-detail/chat/progress/graph compositions. Keep gameplay schemas, transport, persistence, async transaction ownership and extension hooks in application adapters throughout.
