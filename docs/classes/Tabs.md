# Tabs

`packages/ui-widgets/src/tabs.js` exports portable `Tabs`; the classic `controls.js` adapter registers `AIRPG_WIDGETS.Tabs`. ConfigManager, Worlds editor/calendar sections, and image-workflow Generate/Edit modes adopt the same controller. Feature content, drafts, validation and routes remain local.

Construct `new Tabs({tabs: [{id, button, panel}], initialId, activeClass = 'active', onChange})` with a nonempty collection of unique IDs and native HTML buttons/panels in one document. `initialId` is optional: the selected enabled button's existing active class is used, otherwise the first enabled button. Unknown/disabled selections throw. Worlds constructs both controllers before loading an applied world profile, since loading can select calendar/editor panels.

The controller sets tab/panel roles, links IDs through `aria-controls`/`aria-labelledby`, hides inactive panels, manages the configured active class and `aria-selected`, and uses roving tab index. Click, Left/Right, Home and End activate tabs; keyboard navigation wraps and skips disabled buttons. Panel DOM is retained when switching. Arrow keys with Alt/Ctrl/Meta are untouched.

`activate(id, {focus = false, notify = true})` selects a known enabled tab. Changed selections call `onChange(id)`; initial construction does not. `activeId` reads the current selection. Callers own disabling and application effects. `destroy()` removes listeners/references and is idempotent, retaining markup and its current presentation; further operations throw. A fresh instance can adopt the same markup.

The independent specimen includes retained draft fields, a disabled middle tab, keyboard selection and destroy/remount controls.

## Shared selection and extension ownership

Tabs now composes [TabList](TabList.md) for the same button/keyboard behavior.
`onActivate(id,{changed,source})` is an optional every-activation hook, separate
from the unchanged changed-only `onChange`. Sources are `click`, `keyboard` and
the caller-supplied activation source (default `programmatic`). Silent activation
still reconciles panels. This supports actual Play reselect/hash hooks and Story
Tools lazy loading without moving those domain rules into the widget.

`add({id,button,panel})` adopts a late tab and returns an idempotent registration
disposer. Selection and IDs are validated like initial tabs; existing panels and
selection are retained. Disposing the selected registration hides its panel and
silently selects the first remaining enabled panel. No DOM nodes are removed by
the controller; the extension owns its markup. No independent general remove API
is exposed. Scene Illustration uses this registration lifetime through Play's
`window.registerPlayTab({id,button,panel,onActivate})` adapter and disposes it on
final unload. Registration immediately reconciles a matching existing URL hash.

Play global tabs and all four Story Tools panels now use Tabs. The Play adapter
keeps hashes, explicit programmatic hooks, per-tab reselect refresh differences and
queued map/favorites state. Scene Gallery no longer has a parallel hash/selection
controller or delayed activation repair. Mobile uses TabList directly; Worlds,
Config and image-workflow callers retain the original Tabs defaults.
