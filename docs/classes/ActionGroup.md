# ActionGroup

`packages/ui-widgets/src/action-group.js` owns keyed native action controls.
`new ActionGroup(root,{onAction,renderIcon})` adopts an HTML root; icon rendering
is optional, and supplied content/transport remains host-owned.

`update([{id,label,title,ariaLabel,className,disabled,active}])` validates unique
nonempty IDs, reuses native buttons, updates descriptors and removes obsolete
controls/listeners. Cursor reconciliation leaves already-correct buttons in place,
preserving focus/hover across ticks. A retained focused control moved by a real
reorder regains focus only if the browser dropped it to body; intentional new focus
and disabled/removed actions are not overridden. Existing leading label/content
may share the adopted root.

`onAction(id,{event,button,buttons})` receives the latest descriptor identity and a
Map of current controls. The package neither starts nor serializes async work.
`setPending(ids,boolean)` preserves host-selected locks across later updates;
other controls remain independently available. `buttons` exposes current controls.
`destroy()` aborts owned listeners and releases references without changing domain
state. `get(root)` retrieves an explicitly owned group; `destroyWithin(root)`
releases registered nested groups before host replacement. Registrations are weak.

Play view/retry/cancel groups retain original ordering, SVGs, titles, active-viewer
state and cancel/retry transaction guards. Standalone PageFeedback keeps its
existing label-plus-native-buttons markup and per-action pending behavior, with
namespaced job/prompt row identities supplied separately by SnapshotList.
