# ProgressMeter

`packages/ui-widgets/src/progress-meter.js` presents an already computed progress
fraction. `new ProgressMeter(root,{fill,completeClass,waitingClass,contextClass})` adopts a root
and contained fill (first element child by default). `attach(root,options)` reuses
its explicit weak registration. `update({fraction=0,complete=false,waiting=false,context=false})`
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

Play computes one equal-weight mean across currently reported logical prompt
entries for compact/collapsed bars, modal mirrors and favicon progress. Unknown
fractions count as zero without leaving the denominator. Table meters remain
per-entry. The primitive performs no aggregation or future-work estimation;
see [chat progress](../ui/chat_interface.md).

`contextClass` is an optional presentation class for a supplied `context: true`
snapshot. Complete or waiting state suppresses that class; ordinary updates
remove it again. The primitive does not infer phases or substitute fractions.
Generic package styles expose `--progress-context-fill` for
`.progress-meter--context`; the feedback specimen's Context import and Update
snapshot buttons demonstrate switching the same native bar and mirrors between
context and response presentation.

Chat supplies measured context-import fractions during `progressPhase: context`,
then resumes its existing response curve after real generated output starts.
When a logical prompt already has a finite positive cumulative response count
(`receivedCount`, or legacy `bytes` when absent), a later context phase retains
the response curve, label and color until its context fraction is a finite
positive number. Unknown or zero context progress no longer empties a running
TinyBrain response bar between stages. A fresh prompt with no response retains
its initial unknown/zero context presentation. This display policy belongs to
Chat; backend phases and widget APIs are unchanged. Only an all-context display
aggregate uses green; mixed phases retain the ordinary aggregate color, and
all-group-waiting retains blue.
