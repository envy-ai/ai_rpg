# BusyButton

`packages/ui-widgets/src/busy-button.js` adopts a native button through
`new BusyButton(button,{busyClass='is-loading'})` or `BusyButton.attach`. Registration
is weak; `get(button)` retrieves the current owner.

`setBusy(boolean,{disabled,content,busyContent})` requires the current idle
`disabled` boolean on every call. It never restores captured eligibility. Content
is text, same-document nodes, a fragment or node array; no HTML parsing occurs.
Optional busy content replaces owned chrome. On exit it restores retained native
idle nodes only while that busy chrome is still owned. Explicit current `content`
wins; independently replaced visible content is preserved. `setIdleState` updates
current eligibility/content without releasing an active busy lock.

The caller owns requests, concurrency and the busy boolean; there is no promise
wrapper, global lock or request counter. `destroy` releases references/registration
without replaying stale DOM state. Callers retaining a live control should first
supply its current idle state. `destroyWithin(root)` releases registered controls.

Chat send composes with ability-selection eligibility, guidance/slash upload use
current controller flags, Config save/test use current validation policy, and
ActionGroup composes each action's existing pending flags with latest descriptors.
No job/request/queue ownership moves into this widget.
