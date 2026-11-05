# FloatingWindow

`packages/ui-widgets/src/floating-window.js` exports modeless window behavior.
Construct with a root and optional `{header, closeButton, onClose, nextLayer,
drag, dismissOnEscape}`. It adds modeless dialog semantics, focusability, raising
on pointer/focus, optional focused-window Escape and owned PointerDrag behavior.
It creates no backdrop, inert state or modal focus trap.

`FloatingWindow.create({document, ariaLabel, onClose, nextLayer, drag})` builds a
generic window with `elements` for root/header/meta/title/subtitle/actions/close
button/content. The accessible label is required. The host fills those slots,
applies its theme, chooses anchoring and supplies `nextLayer` when app windows
share a stacking policy. The default package layer sequence is document-local.
`destroy()` releases drag/window subscriptions and references; the host owns root
removal and transaction cleanup. A throwing drag-end hook does not prevent
remaining teardown and its error propagates.

The authoritative PromptWindows domain adapter is now
`client/widget-adapters/prompt-windows.js`, built to the existing
`public/js/widgets/prompt-windows.js` URL. Live/failure windows use the generic
factory and retain all existing prompt classes. Prompt failure validation, safe
rendering, UUID deduplication, header/tab-bar anchoring and stack offsets remain
there. `adoptFloatingWindow` applies the same behavior to Terminal while preserving
its existing chat-global Escape policy. `destroyViewer` disposes before removing
prompt/failure/terminal roots. Player-input/progress dragging uses PointerDrag
without adopting a window shell or changing the request/dock lifetime.
