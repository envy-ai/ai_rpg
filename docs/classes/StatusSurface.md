# StatusSurface

`packages/ui-widgets/src/status-surface.js` adopts text, visibility and state through
`new StatusSurface(root,options)` or weak `StatusSurface.attach`. Options select
`textElement`, `stateAttribute`, `stateClasses`, `stateColors`, `visibleClass`,
`hideMode` (`hidden` or `display`), display value and `clearStateWhenHidden`.

`update({text,state='',visible=Boolean(text),busy,autoHideMs=null})` takes plain text,
updates only configured presentation and optionally sets `aria-busy`. Expiry is null
or a finite nonnegative duration, including zero. Every update cancels the old timer;
a stale success cannot hide a later persistent error. `destroy` cancels timers and
releases references/registration; `destroyWithin(root)` releases owned descendants.
It does not create errors, requests, HTML or modal policy.

Chat guidance/upload/player-input and index spinner wrappers retain their original
normalization/classes/attributes. The spinner supplies its text child, preserving
its existing spinner node and stationary tooltip behavior. Config, Lorebooks,
workflow preset and New Game wrappers retain their display/color/timing differences.
Unexpected original errors use PageFeedback separately; ordinary field-validation
messages remain inline.
