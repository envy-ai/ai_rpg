# AnchoredPopup

`packages/ui-widgets/src/anchored-popup.js` exports the portable anchored-popup
lifetime. The generated overlay adapter registers `AIRPG_WIDGETS.AnchoredPopup`.

Construct with a root and optional `{trigger, portalTarget, position, onOpen,
onClose, closeOnAction, repositionOnScroll, repositionOnResize, closeOnResize}`.
`open({point, initialFocus})` owns visibility/expanded state, document exclusivity,
optional portal movement and active subscriptions. The injected position callback
receives `{root, trigger, point}`. It does not invent geometry or new viewport
bounds. `reposition()` reapplies that callback while open.

Captured outside pointer/click and Escape dismiss. Action buttons/links dismiss
synchronously before their handlers when `closeOnAction` is enabled. Focus can
return before an action opens a dialog; no deferred focus work steals that dialog's
focus. `close({restoreFocus, reason})` releases active listeners/observer, restores
the original parent/sibling and inline position, then notifies `onClose`. Source or
trigger detachment closes active state and removes orphaned body portals. Hooks
may dispose their own lifetime; idempotent `destroy()` supports that reentrancy.
Closed/destroyed roots have no document/window handlers retaining them.

Play's Thing and NPC context menus use this lifecycle while retaining card state,
item/actor actions and the existing Thing viewport-position function. Thing menus
retain their body portal. Location-image and map-location menus use the same
controller with their original anchored/point geometry and resize behavior.
Their `closeOnAction` is explicitly false: feature handlers preserve the selected
location context before opening an editor/travel action. Generic capture must not
clear that domain target before the handler reads it.

Consumer coverage remains explicit in the [master ledger](../superpowers/plans/2026-11-05-ui-widget-merge-master.md).

Toolbar filter/sort/view, Chat visibility and map edge/stub menus also adopt this
lifetime. Their adapters pass `outsideEvents` from `pointerdown`, `mousedown`,
`click`, `contextmenu`; defaults remain pointerdown/click. A compact toolbar filter
passes `outsideBoundary: panel` to keep interactions elsewhere in its own panel
inside; sort/view use their own roots. Toolbar/Chat keep controls open on changes
and preserve click-only outside policy. Toolbar preserves no Escape focus return
through `restoreFocusOnEscape:false`; Chat retains trigger focus. Existing width
observers and exact layout calculations stay adapters.

Map edge/stub menus preserve mousedown/contextmenu outside dismissal, no original
Escape action (`dismissOnEscape:false`), no repositioning and async feature-owned
action settlement. Removal disposes the controller and its temporary listeners.
No added placement bounds or geometry apply. Actual native modal `:modal` dialogs
retain keyboard priority, including popups portaled outside their native parent
whose trigger remains inside. Header Tools is native details and uses
PopupDismissal. The mobile header is a responsive navigation panel: its desktop
content remains visible and it retains explicit scrim/media-query state, sharing
the `trapFocus` boundary utility rather than adopting popup hidden state.
