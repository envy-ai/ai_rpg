# PointerDrag

`packages/ui-widgets/src/pointer-drag.js` exports owned pointer dragging for an
existing root/header. Construct `new PointerDrag(root, handle, options)` with an
optional shared `dragState` and `shouldIgnorePointerDown`, `extraMoveGuard`,
`onDragStart`, `onDragMove`, `onDragEnd` callbacks. It preserves the existing drag
viewport bounds and pointer-ID/primary-button checks; it does not add a new bound
or polling policy.

Pointer move/up/cancel subscriptions and the active-root detach observer exist
only during a drag. Ending, cancelling, removing the active root or destroying the
controller releases that lifetime. Idempotent `destroy()` also removes the header
listener and references; teardown still completes if the owner's end hook throws,
and that original error propagates.

PromptWindows' `bindPanelDragInteractions` delegates to this class through a
WeakMap rather than copying its mechanics. Prompt live/failure windows, terminal,
player-input requests and the progress dock retain their app-specific ignore
targets, state and positioning callbacks. FloatingWindow composes the same class.
