# ModalStack

`packages/ui-widgets/src/modal-stack.js` exports explicit custom-overlay visibility,
shared backdrop and scroll-lock ownership. It does not observe the whole document
or infer feature transactions. Native roots use NativeDialog; modeless choosers,
windows and input/progress panels do not join a modal backdrop group.

Construct with `{document, lockTarget = document.body, lockClass = 'modal-open'}`.
`register(root, {backdrop = null, lockScroll = true})` establishes an owned custom
root. `setVisible(root, boolean)` changes hidden/ARIA state and synchronizes all
registered owners. Closing one sibling retains a shared backdrop while another
owner remains visible. `setLock(owner, boolean)` represents explicit nonvisual
gates such as unresolved ability selection. `sync()` is an explicit boundary for
owner state changes; `top` reports the current open order. It introduces no new
z-index, focus trap, dismissal or pending policy.

`unregister(root)` closes/releases a runtime root; `destroy()` closes all supplied
roots, removes owned backdrop/lock state and releases references. Both are
idempotent where appropriate; use after service destruction and visibility
changes without registration fail clearly. No polling or observation fallback
maintains unmigrated callers.

`client/widget-adapters/modal-stack.js` explicitly registers current page roots and
their backdrop groups. Its generated `public/js/widgets/modal-stack.js` loads from
the shared head. Play's static form/inventory/crafting/barter/calendar roots and
Chat's static overlays now change visibility through this owner. Runtime search
selection and Chat warning/edit/recovery shells register/unregister explicitly.
Warnings, message editor, tracker and set-last-seen retain their existing lock
policies; mandatory ability selection retains a named lock before cards appear.

The old sibling visibility lists and independent shared-backdrop/body-class writes
have been removed from these paths. Existing feature Escape/focus/pending/decision
callbacks remain adapters in this pass. Their remaining consolidation, other-page
custom forms and mandatory vs dismissible behavior are separately tracked in the
[master ledger](../superpowers/plans/2026-11-05-ui-widget-merge-master.md); this
ownership migration is not completion of every custom-modal interaction.
