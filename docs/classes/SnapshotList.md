# SnapshotList

`packages/ui-widgets/src/snapshot-list.js` reconciles keyed caller snapshots into
an adopted HTML root. `new SnapshotList(root,{key,create,update,dispose})` defaults
key selection to `record.id`; values must be unique nonempty strings. `create`
returns an HTMLElement or `{element,dispose}`. `update(element,record)` retains
host formatting/state. Optional list-level `dispose(element)` composes nested
widget cleanup with any entry-specific disposer.

`render(records)` preserves retained nodes and their order with minimal DOM moves,
updates current records, and disposes obsolete rows. Rendering during rendering or
disposal fails clearly. `clear()` disposes current entries before removing content;
idempotent `destroy()` also releases callbacks/root references. Disposal hooks are
captured before invocation, so an entry may destroy its owner while all current
row cleanup still runs once. An obsolete removal pass stops after owner disposal.
Failures retain the original error; multiple cleanup failures use AggregateError
with the first cause. No app IDs, schema, transport, sorting or polling are built in.

Chat's existing prompt table uses this lifecycle around its current row formatter.
Standalone PageFeedback uses `job:<id>` and `prompt:<id>` keys so valid identical
job/prompt identities never collide. Scope aggregation and prompt filtering stay
inside PageFeedback; library keys do not change server identities.
