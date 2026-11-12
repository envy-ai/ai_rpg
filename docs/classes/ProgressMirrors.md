# ProgressMirrors

`ProgressMirrors` is exported from `packages/ui-widgets/src/progress-meter.js`.
Construct with `{document,classNames:{bar,fill,waiting}}`. `update(targets,
{active,fraction,waiting})` mounts one ProgressMeter per explicitly supplied target,
updates its snapshot and releases obsolete/inactive bars. If an owner replaces a
surface's children, the next update recreates its missing bar. Idempotent
`destroy()` removes bars/meters and releases document/target references.

The package neither scans modals nor observes the whole document. Chat's existing
modal visibility observer selects open custom dialog roots and supplies its
already-computed aggregate snapshot; standalone/native/modeless roots retain their
separate policy. This replaces duplicated strip creation/fill/removal while keeping
modal ownership, arithmetic and progress events inside the app.

Chat supplies the same current tracked-prompt mean used by its compact dock and
favicon. Modal visibility selects the surfaces, without changing which reported
prompt entries contribute. Waiting styling applies only when every tracked
entry is between grouped stages; table rows keep individual progress.
