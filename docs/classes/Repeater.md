# Repeater

`packages/ui-widgets/src/repeater.js` exports `Repeater` and `createRowActions`. The classic controls adapter exposes both under `AIRPG_WIDGETS`. The Worlds calendar uses one repeater per month, weekday, season, holiday and nested light-description list. Its domain reference refresh, draft/preview updates and field validation remain application code.

`new Repeater(root, {onChange, onInput, emptyRow})` adopts an HTML root's direct child rows. It delegates buttons marked `data-repeater-action="up"`, `"down"` or `"remove"`; native draggable elements marked `data-repeater-handle` support vertical pointer reordering and Alt+Up/Down keyboard reordering. Nested repeater events are scoped to their closest root. Row DOM and edits survive movement. The host supplies markup, labels and styles.

`add(row, {notify = true})` appends and returns a native same-document HTML row. `remove(row)` and `move(row, -1 | 1)` require a direct child. Boundary moves return false and emit no change. Structural changes call `onChange({action, row})`; row input events call optional `onInput(event)`. Removing the final row calls an optional `emptyRow()` factory, without an extra add notification; focus within a deleted row moves to a neighboring row control. Keyboard reordering retains handle focus.

`clear()` cancels dragging and removes rows without notification or automatic replacement. `destroy()` cancels dragging, removes owned listeners/root marker and releases references while retaining rows. Destruction is idempotent; later mutations throw. Lifecycle uses root-local delegated listeners, with no global registry, polling or document listener.

`createRowActions(document, {className, buttonClass, removeClass, removeLabel = 'Remove'})` creates a wrapper containing native Up, Down and Remove buttons, ready for a repeater. The calendar retains its existing classes and labels through these options.
