# Portable DOM widgets

Dependency-free browser ESM and SCSS for native searchable choices and disclosure popup dismissal. The package imports no application scripts, styles, API clients, assets, or globals, and registers no globals of its own. Importing the entry creates no listeners; creating a widget/service establishes its owned lifetime.

## Use independently

```js
import { SearchableSelect, createPopupDismissal } from './src/index.js';

const select = new SearchableSelect(document.querySelector('#choices'), {
    options: ['Forest fp8', 'Forest fp16', 'Ocean fp8'],
    value: 'Forest fp8',
    onChange: value => console.log(value)
});

const popups = createPopupDismissal({ document });
const binding = popups.bind(document.querySelector('details'));

// When the owner removes its controls:
select.destroy();
binding.destroy();
popups.destroy();
```

After installing this directory as a local package, the same exports are available from `@ui-widgets/dom`. Package exports `@ui-widgets/dom/styles` (SCSS) and `@ui-widgets/dom/styles.css` (compiled CSS) have no app stylesheet prerequisites. Keep the package's source, styles and generated `dist/widgets.css` together when copying it elsewhere.

Use `styles/index.scss` with Sass, or link `dist/widgets.css`. Generic styles inherit the host font; the host supplies its surrounding field labels and theme. For exact cascade placement, `styles/_searchable-select.scss` exposes a `styles` mixin. PopupDismissal supplies behavior only; use native disclosure presentation or supply your own popup panel styles.

To build the CSS from a standalone checkout, run `npm install` in this package, then `npm run build:css`. Sass is a development dependency; runtime modules have no dependencies. When working in the containing application, use `npm run widgets:build` from its root instead. That command uses root development tools and also regenerates app adapters and specimen CSS.

Serve the package's standalone specimen without the game:

```bash
python -m http.server 8000 --bind 0.0.0.0 --directory packages/ui-widgets
```

Open `http://0.0.0.0:8000/examples/index.html`. It imports only package files and demonstrates filtering, single/multiple values, disabled refresh, destroy/remount, exclusive popups and opening a native dialog from an action.

## SearchableSelect

`new SearchableSelect(root, options)` accepts a browser HTMLElement and:

- `multiple = false`: native single select or labelled checkbox group.
- `options = []`: distinct trimmed nonblank strings.
- `value = null`: string for single selection, array for multiple selection.
- `onChange = null`: called for user selection changes only.
- `emptyLabel = 'Choose…'`: the blank single-choice label.
- `disabled = false`: initial disabled state.

The root's `data-label` names its choices and generated search; `data-placeholder` customizes the search placeholder. Labels may repeat across instances; controls are named by their local root rather than shared generated IDs. Controls deliberately have no form names: the host serializes values through the API.

`getValue()` returns a string or copied array. `setValue(value)` and `setOptions(options)` rerender without emitting changes and preserve the query. Search requires every case-insensitive whitespace-separated substring. Filtering retains values; a selected single value remains available when filtered out, and missing stored single values show `(unavailable)`. Multiple selections survive filtering. Selecting an option emits the bubbling `searchable-select-change` event with `{ value }` and invokes `onChange`.

`setDisabled(boolean)` updates every generated control; `disabled` reads the current disabled state. Existing hosts that disable generated inputs directly retain that state on rerender: the search input is the source of disabled state. Use the explicit API when owning a whole widget's disabled state.

`destroy()` is idempotent. It removes generated controls/listeners and releases host/callback references, preserving the host root and unrelated attributes. Old detached controls cannot emit through the destroyed widget. Create a new instance to remount; other methods/getters reject use after destruction.

## PopupDismissal

`createPopupDismissal({ document = globalThis.document } = {})` creates a service for one browser document. `service.bind(details, { trigger = details.querySelector(':scope > summary') } = {})` requires a native details root and its direct summary in that document. Rebinding returns the existing controller. Keep one service owner for each root.

Bound disclosures retain native Tab/Enter/Space behavior and ordinary buttons/links. No menu roles or synthetic keyboard selection model are added. Only one bound popup stays open per service. Queued native toggle events and same-task programmatic opens are reconciled before dismissal/action handling; no polling is used.

Outside pointerdown/click handlers run in capture, even when a descendant stops propagation. When switching to another registered summary, pointerdown preserves the old disclosure until that summary's click so closing flowing content cannot move the pointerup target. Capture click then closes the previous popup before native summary activation completes. Ordinary outside pointerdown still dismisses immediately.

Action buttons, links and `[data-popup-dismiss]` descendants close synchronously before their handlers run. If focus was inside, it returns to the summary before the callback, so a dialog opened by the action keeps its focus. Escape closes the active popup, restores trigger focus and consumes that Escape before enclosing dialogs/choosers handle it. Outside dismissal leaves outside focus alone. Callers own asynchronous pending/error/action state.

Bindings expose `close({ restoreFocus = false } = {})` and idempotent `destroy()`. Destroying a binding closes/unregisters it. Destroying the service closes active state, removes its document subscriptions and active detach observer, and invalidates bindings; future binds throw a clear error. A fresh service can bind roots again. Inactive bindings use a WeakMap, with no strong registry of historical roots. Only the active root is observed for detachment.

Both widgets construct DOM/events using their owning document, including iframe documents.

## Application adapters and generated files

The containing application keeps classic script URLs through `client/widget-adapters/searchable-select.js` and `popup-dismissal.js`. These alone register `AIRPG_WIDGETS`; the selector adapter retains the application label `Use workflow default`. Run root `npm run widgets:build` after changing package runtime/style source or adapters. It deterministically produces:

- `public/js/widgets/searchable-select.js`
- `public/js/widgets/popup-dismissal.js`
- `packages/ui-widgets/dist/widgets.css`
- `packages/ui-widgets/examples/specimen.css`

Do not edit generated files directly. Changes to the application's `main.scss` also require `npm run scss:build:main`; it includes the same generic selector styles at their existing cascade position and retains workflow/technique theme overrides.
