# FloatingTooltip

[`packages/ui-widgets/src/floating-tooltip.js`](../../packages/ui-widgets/src/floating-tooltip.js)
exports a portable tooltip controller registered for the app by generated
`public/js/widgets/overlays.js`. The shared head loads that adapter before Play's
DOMContentLoaded initialization. Regenerate it with `npm run widgets:build`.

Construct with a tooltip root and optional `{hideDelay = 180, padding = 16,
scrollTargets = []}`. `show(content, point, {allowHTML = false})` supplies safe text
or explicit caller-owned HTML, resets its scroll, cancels delayed hiding and uses
the existing viewport-position algorithm. `move(point)` follows pointer or supplied
focus-anchor coordinates. `hide({defer})` closes immediately or waits for the hover
bridge; overflowing deferred content becomes interactive so it can be scrolled.
Root mouseenter cancels hiding. Root mouseleave, window/additional-target scroll,
and document Escape dismiss; Escape remains available to enclosing interactions.
The controller never steals focus.

`destroy()` cancels timers, removes listeners, hides the retained root and releases
references; show/move/hide after destruction fail clearly. Generic structural CSS
lives in `packages/ui-widgets/styles/_floating-tooltip.scss`, included by the app
at its existing tooltip rules. Theme, content and sizing stay in `main.scss`.

Play's general `window.floatingTooltipController` wrapper preserves its public
show/move/hide methods, explicit-open exception, touch suppression and ready event.
Party creates a second instance with its panel as an additional scroll target and
retains `window.hidePartyTooltip`, card formatting and suppression checks. Both use
one implementation for position, timer, hover transfer and dismissal. Ability
hover/focus, effect cards, item comparisons and entity content remain callers.

See the [package README](../../packages/ui-widgets/README.md) for independent use
and the standalone plain/rich/scrollable tooltip specimen.

An optional `owner` identity supplied to `show(content,point,{allowHTML,owner})`
allows explicit caller cleanup. `move(point,{owner})` and `hide({defer,owner})`
ignore stale identities; omitting the option retains the original unconditional
behavior. Every show replaces the owner, including unowned legacy shows, and a
completed hide clears the reference. Deferred hiding/interactive hover retains the
current identity until dismissal. This lets retiring card owners dismiss their
own active tooltip without hiding another control's newer focus tooltip, including
when the pointer stays stationary or has entered the tooltip's hover bridge.
Tracker and ability/skill collection adapters use their card identity; neither
`:hover` nor rendered-content comparisons decide ownership.
