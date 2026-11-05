# Tabs

`packages/ui-widgets/src/tabs.js` exports portable `Tabs`; the classic `controls.js` adapter registers `AIRPG_WIDGETS.Tabs`. ConfigManager, Worlds editor/calendar sections, and image-workflow Generate/Edit modes adopt the same controller. Feature content, drafts, validation and routes remain local.

Construct `new Tabs({tabs: [{id, button, panel}], initialId, activeClass = 'active', onChange})` with a nonempty collection of unique IDs and native HTML buttons/panels in one document. `initialId` is optional: the selected enabled button's existing active class is used, otherwise the first enabled button. Unknown/disabled selections throw. Worlds constructs both controllers before loading an applied world profile, since loading can select calendar/editor panels.

The controller sets tab/panel roles, links IDs through `aria-controls`/`aria-labelledby`, hides inactive panels, manages the configured active class and `aria-selected`, and uses roving tab index. Click, Left/Right, Home and End activate tabs; keyboard navigation wraps and skips disabled buttons. Panel DOM is retained when switching. Arrow keys with Alt/Ctrl/Meta are untouched.

`activate(id, {focus = false, notify = true})` selects a known enabled tab. Changed selections call `onChange(id)`; initial construction does not. `activeId` reads the current selection. Callers own disabling and application effects. `destroy()` removes listeners/references and is idempotent, retaining markup and its current presentation; further operations throw. A fresh instance can adopt the same markup.

The independent specimen includes retained draft fields, a disabled middle tab, keyboard selection and destroy/remount controls.
