# PopupDismissal

`public/js/widgets/popup-dismissal.js` exposes
`window.AIRPG_WIDGETS.PopupDismissal.bind(details, {trigger = summary})`.
It composes a native `details`/`summary` disclosure with ordinary buttons or links,
retaining native Tab, Enter and Space behavior without adding menu roles or a
second keyboard-navigation model. ActionImages is its initial consumer.

Only one bound popup stays open. Opening another closes the previous popup.
Captured outside pointer-down and click events close it even when downstream
handlers stop propagation. Captured action clicks on a `button`, `a[href]` or
`[data-popup-dismiss]` descendant close it synchronously before its handler runs;
buttons/links inside the summary remain native trigger content. Keyboard focus
returns to the summary before the callback when focus was inside the popup.
No delayed focus restoration can steal focus from a dialog opened by that action.
Asynchronous actions retain their own pending/disabled/error lifecycle independently
of the already-hidden popup.

Escape is captured and consumed only while a bound popup is open, closes that
popup and restores trigger focus. It leaves enclosing modeless choosers and native
dialogs open. Outside dismissal leaves the clicked control's focus behavior alone.

`bind` returns `{close({restoreFocus = false}), destroy()}` and repeated binding
returns the same controller. `destroy()` closes and removes its local listeners and
registration. Bindings use a WeakMap; document dismissal listeners are installed
once rather than once per popup. Only the active popup has a strong global
reference. A mutation observer watches while it is active and clears that
reference when its root is detached, then disconnects. Native asynchronous toggle
events and same-task programmatic opening are recognized without polling.

Load this helper before `action-images.js`. The transparent upper-right image
trigger and themed panel styling remain owned by existing `main.scss` rules.
Entity/map/header popup implementations keep their current behavior until explicitly
migrated to the helper.
