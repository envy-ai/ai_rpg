# ProgressMeter

`packages/ui-widgets/src/progress-meter.js` presents an already computed progress
fraction. `new ProgressMeter(root,{fill,completeClass,waitingClass})` adopts a root
and contained fill (first element child by default). `attach(root,options)` reuses
its explicit weak registration. `update({fraction=0,complete=false,waiting=false})`
updates width/state classes. Explicit zero remains visible at `0%`. A supplied
nonfinite or nonnumeric fraction, including null, throws a field-specific error;
no numeric clamping or estimation occurs. Hosts retain their previous unknown
fraction normalization and existing aggregate bounds.

`destroy()` releases metadata/references; `destroyWithin(root)` releases registered
nested meters. Package SCSS includes optional generic meter/mirror structure with
CSS custom-property colors/heights. App markup/classes/theme remain existing.

Play table, aggregate/collapsed and one-line fills, open-modal mirrors, and entity
image-generation overlay fills use the same primitive. Prompt curves, completion
holds, TinyBrain group-waiting state, throttling, imageManager jobs and progress
normalization remain app-owned. [ProgressMirrors](ProgressMirrors.md) supplies
explicit multi-surface mounting and teardown.
