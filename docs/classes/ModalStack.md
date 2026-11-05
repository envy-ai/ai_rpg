# ModalStack

`packages/ui-widgets/src/modal-stack.js` owns explicit custom-overlay visibility,
shared backdrops, scroll locks and injected dismissal/focus policies. Native roots
use NativeDialog; modeless windows and choosers retain their separate lifetimes.
No document observer infers transactions or missing registrations.

Construct with `{document, lockTarget = document.body, lockClass = 'modal-open',
resolveTop = roots => roots.at(-1)}`. `register(root, {backdrop, lockScroll=true})`
establishes ownership; `setVisible(root, boolean)` updates hidden/ARIA and lock
state. Closing a sibling retains a shared backdrop needed by another owner.
`setLock(owner, boolean)` represents explicit nonvisual gates, including mandatory
ability choices. `sync()` reconciles an explicit host transition. `top` invokes
the top resolver over visible registered roots. AIRPG injects its actual computed
z-index and DOM tie order at transitions/key boundaries; no polling imposes a new
visual stack.

`configure(root, {onDismiss, canDismiss, escape, trapFocus, focusables,
dismissOnBackdrop})` supplies host policy. Both dismissal callbacks receive
`{root, reason}`; `canDismiss` may reject with `false`, and `onDismiss` owns feature
cleanup and closing. Supplying a callback defaults Escape to `dismiss`; removing
it resets Escape to `ignore`. Explicit Escape values are `ignore`, `dismiss` and
`block`. Trap/backdrop defaults are false, preserving owners without those
behaviors. Root backdrop dismissal requires `event.target === root`; an external
shared backdrop calls `requestDismiss(root, {reason:'backdrop'})` after identifying
its registered top owner.

`requestDismiss` only routes the visible top root, defers actual native `:modal`
top-layer dialogs, and observes mandatory, pending and host guards. `setPending`
sets the shared guard and `aria-busy`; async epochs, button locks and transport
stay in owners. Document keyboard routing bubbles after popup/floating handlers,
respects prevented events, and only handles Escape/Tab owned by the top root.
Default trap candidates are visible, enabled tab stops, including hidden-ancestor
and disabled-fieldset checks. An injected `focusables` callback preserves an
owner's original candidate selection.

`rememberFocus(root, target=document.activeElement)` and `restoreFocus(root,
{target, onlyIfInside=false})` are explicit host transitions, with connected-node
or same-ID replacement focus. Visibility does not invent initial/return focus.
`restoreFocus` releases its remembered reference and reports whether a target was
available. Exported `trapFocus(event,{document,controls,preventEmpty=true})` shares
boundary mechanics with the responsive header without changing its navigation
visibility policy.

`unregister(root)` closes/releases runtime roots and entry listeners. Idempotent
`destroy()` closes all roots, aborts document/entry listeners and releases locks
and references. Calls after service destruction fail clearly. Transient owners
reset their configured callbacks after settlement to release request closures.

`client/widget-adapters/modal-stack.js` registers actual page groups and visual
priority. Play loads this adapter after markup before immediate inline consumers;
standalone pages defer it before their controllers. Play/Chat repeated Escape/Tab
routes now use configured owners. Guidance/suggestions and route/recovery retain
their original traps; other editors explicitly retain no trap. Required ability
and recovery cannot gain generic Cancel. Quest, container, workbench, image forms
and other shells without original Escape retain `ignore`. Domain close buttons,
validation, submission and staged transactions remain app callbacks. Standalone
Config/workflow/Worlds/Lorebooks use the same policy seam, retaining their existing
lock/backdrop differences. The master ledger records consumer-level verification
and later media/dialog compositions separately.

The constructor also accepts `canHandleKeys(root,event)` for explicit higher-owner
composition. It runs at the existing keyboard boundary after native modal checks.
AIRPG compares the visible lightbox and current custom root through its actual
visual resolver; only the lower owner yields. The media controller reciprocates
through its injected predicate. This preserves higher custom owners and the
lightbox's distinct ignored-Tab/interactive-key policy without registering it as a
locking/trapping custom modal or adding an overlay observation fallback.
