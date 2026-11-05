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

Native details use PopupDismissal. Toolbar/header/chat-filter/map-edge popovers
remain tracked separately in the [master ledger](../superpowers/plans/2026-11-05-ui-widget-merge-master.md).
