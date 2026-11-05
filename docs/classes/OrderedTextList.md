# OrderedTextList

`packages/ui-widgets/src/ordered-text-list.js` composes `Repeater` into an ordered editable text list. The controls adapter registers `AIRPG_WIDGETS.OrderedTextList`. Play's NPC memories and goals share this widget; loading/saving, trim/filter serialization, dirty buttons, error/status display and modal lifetime remain in the page adapter.

`new OrderedTextList(root, {values = [], rows = 2, itemLabel = 'entry', rowClass, inputClass, handleClass, removeClass, maintainEmptyRow = true, onChange})` owns the root's rows. Values must be strings; `setValues(values)` validates the complete array before replacing rows and emits no change. Empty input arrays display one blank row by default. Classes and textarea height preserve each caller's existing layout.

Every row supplies a labeled native draggable button, labeled textarea and Delete button. Native drag reorders only within this list; a focused handle also supports Alt+Up/Down. Editing, addition, deletion and actual movement notify `onChange()`. Deleting the last row retains one blank row by default. Focus moves from deleted controls to a surviving row.

`add(value = '', {focus = false, notify = true})` returns the new row. `createRow(value)` returns a detached row for existing append workflows; root delegation activates it when appended. `getValues({trim = false, omitEmpty = false})` returns current DOM order. The Play adapters explicitly request both trim and omission for their existing save payloads. `clear()` empties rows and cancels dragging without notifying; closing a dialog uses it. `destroy()` releases the delegated lifecycle and callbacks, retaining row markup. It is idempotent; other operations reject use after disposal.

The portable specimen covers editing, adding, removing, dragging, keyboard movement and destroy/remount using application-free data.
