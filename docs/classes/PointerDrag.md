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

`writePosition(root,event,dragState)` optionally replaces the default floating
window position writer. It adds no numeric limits or positioning policy: the host
writes its own width/position from its existing rules. `capturePointer=false` can
be explicitly enabled for native separator handles; the controller acquires and
releases capture, stops on lost capture, and includes acquisition failures in the
start cleanup boundary. Original start errors propagate; if cleanup also fails,
an AggregateError retains the start error as its cause. Default window behavior
and callbacks remain unchanged.

Both Adventure separators now use this injected writer/capture ownership. The
adapter keeps width bounds, directions, localStorage, arrow/Shift steps and
Home/Escape/double-click reset. Ending desktop mode stops active dragging and
clears its body/handle classes. Document controllers survive cached pagehide;
final unload disposes drag and keyboard/media/resize listeners.
