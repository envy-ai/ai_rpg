# TabList

`packages/ui-widgets/src/tab-list.js` exports native button selection and roving
focus without panel, route or request ownership. The package ESM entry and classic
controls adapter expose it. Tabs composes the same controller; all three mobile
Adventure navigation groups use it directly because their datasets control layout
while the same panes remain available together on desktop.

Construct `new TabList({items:[{id,button}],initialId,activeClass='active',onChange,
onActivate})` with unique nonempty IDs and same-document HTML buttons. The initial
enabled active-class button wins when no initial ID is supplied, otherwise the
first enabled choice. Unknown/disabled selections reject. Native `:disabled` and
`aria-disabled=true` choices are skipped. The controller sets tab/tablist roles,
selected class, `aria-selected` and roving tab indexes. It owns no content markup.

`activate(id,{focus=false,notify=true,source='programmatic'})` selects a choice.
`onChange(id)` runs only when selection changes; `onActivate(id,{changed,source})`
runs for every notified activation, including reselect. Construction is silent.
User sources are `click` and `keyboard`. Left/Right wrap through enabled choices;
Home/End choose the boundaries and focus the selected control. Alt/Ctrl/Meta
combinations remain untouched. The caller supplies visibility and activation effects.

`add({id,button})` returns an idempotent registration disposer, used by Tabs for
late extension ownership. Disposing the selected registration silently selects the
first remaining enabled choice, if any. `activeId` reads current selection.
`destroy()` removes subscriptions and references while retaining markup/current
presentation; it is idempotent, and other operations reject use after destruction.
