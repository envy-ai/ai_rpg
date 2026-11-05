# ModelessChooser

The portable implementation is
[`packages/ui-widgets/src/modeless-chooser.js`](../../packages/ui-widgets/src/modeless-chooser.js).
[`client/widget-adapters/modeless-chooser.js`](../../client/widget-adapters/modeless-chooser.js)
keeps application insertion/focus/modal policy; `npm run widgets:build` generates
`public/js/widgets/modeless-chooser.js`, which registers
`window.AIRPG_WIDGETS.ModelessChooser`. Play's abilities, skills and discipline
technique pickers share this lifecycle and the existing `.modal__dialog` chrome.

Construct with `{root,title,closeButton,insert}`; `insert` receives bracketed
choice text. `open(title)` closes another chooser, exposes its named dialog and
focuses the first choice. `choice(button,name)` binds native Enter/Space/click
insertion without submitting a turn or closing the list. `close({refocusInput})`
hides the chooser, restores the chat input when requested, and emits
`chooser:closed`. `isOpen` exposes its visibility. Escape closes the open chooser
unless a real modal/native dialog above it owns dismissal. A/S keep their existing
ability/skill shortcuts; T opens or cycles technique disciplines outside text-entry
and modal contexts.

The `.modeless-chooser` full-screen shell has `pointer-events:none`; only its
surface accepts pointer events. It creates no backdrop, inert page, focus trap or
`body.modal-open` state, so players can continue writing in the composer. Surface
height leaves composer space and its body scrolls independently. Feature renderers
own their content and asynchronous data. All three current consumers exercise the
same lifecycle; ability/technique rows use native content buttons beside independent
image controls to avoid nested interactive buttons.

The exported package constructor uses `onChoose`, `formatChoice`, `choiceLabel`,
`returnFocus` and `canDismiss` rather than knowing about chat. Its generic native
dialog precedence can be extended by a caller; the app adapter also checks custom
blocking modals and translates `refocusInput` into the portable `focusReturn`
option. Choice controls must use the owning document and either belong to the
root or be detached controls being constructed before insertion. One delegated
root handler replaces per-choice handlers, so detached/rerendered old controls
cannot invoke choices after teardown.

Only the active chooser is retained per document. Its Escape listener/detach
observer exist only while open; direct root hiding leaves Escape unconsumed and
clears ownership on the next event. `destroy()` is idempotent, closes/releases
listeners, callbacks and root references, and permits remounting with a new
instance. Other operations reject use after disposal. The independent package
specimen exercises two choosers with a still-usable composer and separate windows.

The player ability chooser shows the shared floating item-style tooltip when an
ability's content button is hovered or receives keyboard focus. It displays the
ability's name, type, level when present, short description, and distinct full
description, with multiline text preserved. The tooltip uses the existing
`floatingTooltipController` and `.tooltip-thing` presentation; it hides when the
pointer and focus leave, on chooser close, or before ability cards refresh.
Hovering the separate ability image/menu also hides it. The content button keeps
its bracketed-name insertion action.

The blocking level-up ability modal also binds this tooltip controller and
attachment formatter to each option's selection button. Its detached preview
`attachmentDraft.statusEffects` shows candidate technique names and numeric
modifiers; pending image/menu controls are separate siblings of the selection
button.
