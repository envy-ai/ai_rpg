# Portable DOM widgets

Dependency-free browser ESM and SCSS for native searchable choices, disclosure popup dismissal, native modal lifecycle and floating tooltips. The package imports no application scripts, styles, API clients, assets, or globals, and registers no globals of its own. Importing the entry creates no listeners; creating a widget/service establishes its owned lifetime.

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

Open `http://0.0.0.0:8000/examples/index.html`. It imports only package files and demonstrates filtering, single/multiple values, disabled refresh, destroy/remount, exclusive popups, modal focus/pending state, and plain/rich/scrolling tooltips.

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

## NativeDialog

`new NativeDialog(dialog, { returnFocus = null, onClose = null, removeOnClose = false } = {})` adopts an existing native `<dialog>`. The host supplies its markup, accessible name, buttons, form state and theme. No custom focus trap, body lock or modal registry is added; the browser owns the top layer and native keyboard navigation.

`open({ initialFocus = null, returnFocus } = {})` calls native `showModal()`, captures the configured/invoking focus target, and optionally focuses a supplied control. `close(returnValue = '')` returns `false` while pending, otherwise calls native close and returns `true`. Direct `dialog.close()` is supported and intentionally bypasses the controller's pending guard. `setPending(boolean)` controls the dismissal guard and `aria-busy`; Escape cancellation is prevented while pending. The host owns disabling controls and settling async work.

Native close events are queued. Reopening before the preceding close event completes throws a clear error; wait for that event before starting a new lifetime. An already-open dialog is also rejected. This keeps each close callback and focus target associated with one open lifetime.

`whenClosed()` resolves after the active lifetime's queued close processing, or
immediately when no lifetime is active. Waiters are class-owned, so callers may
request it from an earlier native close listener during the same event dispatch;
destruction also settles pending waiters. Reusable-root adapters can reserve their
request generation, await this method, then discard superseded requests before
opening again.

When closed, `onClose()` runs before focus restoration, allowing the host to reenable controls or update page state. Focus returns to the captured target, or its same-ID replacement if that target was detached. `removeOnClose` removes the transient root and disposes the controller after its callback; ordinary roots can reopen. `destroy()` is idempotent, removes owned listeners/references, and closes an open root without invoking the controller's callback or scheduling additional focus work. Other operations reject use after disposal.

## FloatingTooltip

`new FloatingTooltip(root, { hideDelay = 180, padding = 16, scrollTargets = [] } = {})` adopts an HTML root, adds `.floating-tooltip`, and owns its timer/listeners. Package CSS supplies only fixed positioning, hidden state and interactive pointer behavior; the host supplies theme/content sizing.

`show(content, {clientX, clientY}, {allowHTML = false} = {})` writes safe text by default; `allowHTML: true` explicitly accepts caller-owned markup. It cancels pending hiding, resets scroll, removes `hidden`, adds `visible`, and positions using the existing pointer offset/viewport-edge adjustment. `move(point)` updates visible positioning. Focus-trigger handlers may supply the trigger rectangle as a point; the tooltip never takes focus itself.

`hide({defer = false} = {})` closes immediately or starts the hover-transfer delay. Overflowing content gains `.is-interactive` while deferred so the pointer can enter and scroll it. Root mouseenter cancels the delay; root mouseleave, window/extra-target scrolling, or document Escape dismisses it. Escape is not consumed, allowing surrounding interactions to handle the same key. Content eligibility, mobile/touch policy and explicit-opening exceptions belong to callers.

`destroy()` cancels the timer, hides the root and removes all owned event subscriptions and references. It retains the supplied root/content/theme and removes only the structural class it added. Remount with a fresh instance; show/move/hide reject use after disposal. DOM/event ownership follows the root document, including iframe roots.

## Application adapters and generated files

The containing application keeps classic script URLs through `client/widget-adapters/`. These alone register application globals; the selector adapter retains the application label `Use workflow default`, and the chooser adapter supplies chat insertion/focus policy. Run root `npm run widgets:build` after changing package runtime/style source or adapters. It deterministically produces:

- `public/js/widgets/searchable-select.js`
- `public/js/widgets/popup-dismissal.js`
- `public/js/widgets/overlays.js`
- `public/js/widgets/modeless-chooser.js`
- `public/js/widgets/prompt-windows.js`
- `public/js/widgets/controls.js`
- `public/js/widgets/modal-stack.js`
- `packages/ui-widgets/dist/widgets.css`
- `packages/ui-widgets/examples/specimen.css`

Do not edit generated files directly. Changes to the application's `main.scss` also require `npm run scss:build:main`; it includes the same generic selector styles at their existing cascade position and retains workflow/technique theme overrides.

## ModelessChooser, PointerDrag and FloatingWindow

`new ModelessChooser({root, title, closeButton, onChoose, returnFocus, formatChoice,
choiceLabel, canDismiss})` adopts a modeless surface. `open(title)` closes another
chooser in the same document, names/shows it and focuses its first choice.
`choice(control, value)` binds native button activation through root delegation;
controls may be detached while being built, but must use the root's document and
be inserted into it before interaction. Connected outside controls are rejected.
`onChoose(formatChoice(value))` does not submit, close or steal focus. The defaults
preserve raw values and use their string label; applications can format insertion.

`close({focusReturn=false})` hides and emits `chooser:closed`. A requested return
uses the supplied element/function; otherwise an inside focus returns to the
opener. Escape belongs only to the currently visible chooser and defers to native
dialogs by default; `canDismiss` can add host-specific overlay rules. No backdrop,
inert page, body lock or focus trap is added. `isOpen` exposes visibility and
idempotent `destroy()` releases listeners/active document ownership/references.
Create a new instance after destruction.

`new PointerDrag(root, handle, {dragState, shouldIgnorePointerDown, extraMoveGuard,
onDragStart, onDragMove, onDragEnd})` owns header activation and temporary pointer
move/up/cancel listeners. It retains the existing window viewport bounds. Active
root removal cancels dragging; `destroy()` releases all handlers, including when
an end hook throws (the original error still propagates).

`new FloatingWindow(root, {header, closeButton, onClose, nextLayer, drag,
dismissOnEscape=true})` adopts existing markup. It raises on pointer/focus and
closes only from its close control or focused Escape; `onClose` remains the host's
cleanup request. It adds modeless semantics without blocking the page.
`FloatingWindow.create({document, ariaLabel, onClose, nextLayer, drag})` creates
generic chrome and returns a controller with named `elements` slots. The host
supplies theme/content/anchoring; a supplied layer callback coordinates app window
stacks. `destroy()` releases window/drag subscriptions; the host removes its root.
The specimen demonstrates independent windows and composer-friendly choosers.

## Repeated controls

The entry also exports `Tabs`, `Repeater`, `createRowActions`, `OrderedTextList`,
`createField`, `NumberRange` and `ReaderRows`. Tabs adopt existing tab buttons/panels and provide
roving keyboard focus. Repeater owns add/remove/reorder row lifecycle around a
caller-built rows. OrderedTextList composes it for editable strings,
including native drag and keyboard reorder. `createField` creates above-control
labels and returns `{field, input, label}`; NumberRange synchronizes caller-owned number and
range inputs with an injected value policy rather than imposing domain bounds.
Their independent example is `examples/repeated-controls.js`; current app
consumers retain calendar/config/workflow/actor schemas and serialization.

## ModalStack and AnchoredPopup

`new ModalStack({document, lockTarget=document.body, lockClass='modal-open'})`
owns explicitly registered custom visibility/backdrop/scroll-lock state. Register
each root with `{backdrop=null, lockScroll=true}`, use `setVisible(root, boolean)`
for hidden/ARIA transitions, and `setLock(owner, boolean)` for named nonvisual
gates. `sync()` is an explicit reconciliation boundary; `top` uses the supplied resolver (open order by default).
Closing a sibling retains its shared backdrop while another owner needs it.
`unregister(root)` closes/releases a runtime root; `destroy()` closes all roots
and releases state. There is no blanket DOM observer or imposed visual/transaction policy. Owners configure dismissal/focus behaviors; native dialogs and
modeless surfaces retain their own lifetimes. The independent example demonstrates
shared ownership rather than claiming to implement every custom-modal interaction.

`new AnchoredPopup(root, {trigger, portalTarget, position, onOpen, onClose,
closeOnAction=true, repositionOnScroll=true, repositionOnResize=true,
closeOnResize=false})` owns an ordinary popup's active lifetime. Its injected
`position({root,trigger,point})` callback supplies geometry. `open({point,
initialFocus})`, `close({restoreFocus=false,reason='api'})`, `reposition()`, `isOpen`
and idempotent `destroy()` manage exclusivity, visibility/expanded state, optional
portal restoration and temporary subscriptions. Native details keep using
PopupDismissal. Outside pointer/click and Escape dismiss; action buttons/links
close before their handlers by default. Callers with action-dependent context may
disable action auto-close and close explicitly after capturing that context.
Source/trigger detachment releases active state and orphan portals. Closed or
destroyed roots have no active document/window listeners. The independent example
opens a native dialog after synchronous popup dismissal and focus return.


Custom overlay policies use `ModalStack.configure(root,{onDismiss,canDismiss,
escape,trapFocus,focusables,dismissOnBackdrop})`. Callbacks receive `{root,reason}`
and retain domain cleanup. `requestDismiss` routes only the top custom root;
`setPending`, `rememberFocus` and `restoreFocus` are explicit owner transitions.
Keyboard routing bubbles after popup handlers and defers native `:modal` dialogs.
Supply `resolveTop` to preserve a host's visual priority; default open order is
portable. Defaults do not add Escape/trap/backdrop behavior. `trapFocus` exports
just focus-boundary mechanics for distinct responsive/navigation shells.

AnchoredPopup additionally accepts `outsideBoundary`, `outsideEvents`
(default `['pointerdown','click']`), `dismissOnEscape=true` and
`restoreFocusOnEscape=true`. These preserve equivalent existing menu variations
without duplicating active subscriptions. All geometry remains injected.


`ReaderRows(root)` composes Repeater for caller-built native rows with ordered
readers and owned disposal. `add(row,read,{dispose,removeButton})`, `read()`,
`remove(row)`, `clear()` and idempotent `destroy()` preserve schema/validation in
the caller. `signal` owns row-group Add actions; `ReaderRows.destroyWithin(root)`
releases only explicitly registered nested owners before host replacement.
Unregistered/detached rows fail clearly before reading. `examples/reader-rows.js`
demonstrates edit/read DOM order, removal and disposal without app services.

## Collection and media presentation

`CollectionView(root,{empty,count,modeClasses,classNames,disposeContent})` renders
already selected records with count/empty/mode/table chrome and entry disposal.
`render({items,totalCount,countText,emptyText,mode,columns,showHeaders,renderItem,
keepVisibleWhenEmpty})` takes native element or `{element,dispose}` render results.
`clear()` and idempotent `destroy()` release mounted ownership. Column descriptors
supply labels/classes; schema/filter/sort/requests remain caller-owned.
`createCollectionEntry` shares native root classes, attributes and data.

`ImageFrame.attach(root).show({src,alt,placeholderHtml,errorHtml,loading,draggable,
onImage,onError})` owns image replacement/error/binding lifetime. `onImage` may
return a disposer; stale detached events and reentrant cleanup cannot replace a
newer image. `ImageFrame.destroyWithin(root)` releases registered frames before
host replacement; no URL/job/global dependency is required.

`Lightbox(root,{inner,media,image,caption,details,actions,closeButton,onError,
canHandleKeys})` adopts an image/details viewer. `show`, `hide`, `bind`, `isOpen`
and `destroy` retain explicit action and trigger-focus lifecycle. Its bubble key
policy yields to native modal/popup routing; hosts can inject custom visual-owner
arbitration. Async actions cannot close newer show generations. Binding returns
a disposer and keeps inactive thumbnails weakly referenced. Error presentation
is injected with the original error. The included SCSS preserves both-pane desktop
and scrollable mobile geometry. The independent collection/media example requires
only DOM/package modules and data-image content.

## Injected graph viewport

`GraphHost(root,{createEngine,destroyEngine,statusClasses})` owns an adopted
viewport and active engine generation. `mount(optionalEngine)` replaces the engine;
`own(dispose)`, `listen`, `guard` and `defer` attach only active-generation resources.
`status(textOrElement,{kind})`, `clear()` and idempotent `destroy()` release listeners,
timers/resources before engine destruction, retaining original errors/causes.
The factory receives `(root,{signal})`; getters expose `engine` and native `signal`.
Engine/topology/layout/plugins/transport stay injected. No graph dependency or app
global is needed. `examples/graph-host.js` demonstrates a supplied DOM engine.

## Snapshot feedback and follow scrolling

`ActionGroup(root,{onAction,renderIcon})` retains keyed native controls across
`update(descriptors)` and host-selected `setPending(ids,boolean)` calls. Callbacks
receive `(id,{event,button,buttons})`; async ownership remains outside the package.
`SnapshotList(root,{key,create,update,dispose})` reconciles keyed records while
retaining node/control identity. Both support explicit idempotent destruction and
nested resource cleanup; no job/prompt schema or connection is included.

`ProgressMeter(root,{fill,completeClass,waitingClass})` presents
`update({fraction=0,complete,waiting})`. Supplied fractions must be finite numbers;
zero remains zero, and no numeric clamping/estimation occurs. `ProgressMirrors`
mounts one such meter across supplied targets; the host selects surfaces and
computes snapshots. Generic meter/action styles have their own SCSS variables.

`FollowScroll(root,{canScroll,isFollowing,onFollowChange,trackIntent,observe,
initialPending,requireVisible})` owns queued frames and optional native observers.
`request({force,immediate})`, `flush`, `captureIntent`, `scrollNow`, `atBottom` and
`destroy` preserve injected readiness/follow/selection boundaries. Static
`hasSelection(root)` shares native range detection. `examples/feedback.js` shows
independent snapshots, actions, explicit zero, mirrored fills and scrolling.
