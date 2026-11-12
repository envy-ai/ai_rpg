# FoundationStyles

`packages/ui-widgets/styles/_foundations.scss` contains declaration-only native
style mixins plus an opt-in `.uiw-*` stylesheet emitter. It imports no application
palette, font, layout or asset files. Existing widget behavior stays in its own
SearchableSelect, tooltip, window, collection, structured-reader and feedback
partials. Collection tables reuse only the compatible table base.

## SCSS contract

`@use` the foundations module for side-effect-free includes at existing selectors.
Arguments use the host's values; `null` omits a declaration and preserves inherited
or later styling. Mixins neither rename selectors nor merge them through @extend.

| Mixins | Emitted declarations |
| --- | --- |
| `field-stack` | flex and column direction |
| `field-label($display,$margin,$color,$size,$weight)` | supplied display, bottom margin, color, font size/weight |
| `control($padding,$border,$radius,$background,$color,$size)` | supplied native field chrome |
| `help($size,$color,$margin,$line-height)` | supplied help/error text size, color, top margin and leading |
| `button-layout($gap,$justify)` | inline-flex and centered cross-axis; optional gap/justification |
| `button-chrome($padding,$border,$radius,$weight,$size,$cursor)` | supplied native button chrome |
| `disabled($opacity,$cursor)` | host-provided disabled appearance |
| `focus-ring($color,$offset:2px,$width:2px)` | outline and offset at the host's existing focus selector |
| `surface($background,$border,$radius,$padding,$shadow)` | supplied surface chrome |
| `badge($padding,$radius,$size)` | compact badge geometry, without display/color/semantic policy |
| `table-scroll`, `table-base` | minimum width/horizontal overflow; full-width collapsed table |

Optional parameters default to null except the noted focus dimensions. Field and
button geometry do not imply a font, breakpoint, eligibility rule or state owner.
Main `.btn` therefore keeps its inherited justification while `.button` centers;
Worlds/main retain distinct disabled opacities and Stories labels retain their
inherited weight. Textarea `font` shorthand order is preserved so the explicit
16px Stories size is not lost. Host focus, invalid and readonly selectors remain.

## Opt-in CSS

Package `styles.css` emits only namespaced foundation rules:
`.uiw-field`, `.uiw-help`, `.uiw-field-error`, `.uiw-button`, `.uiw-icon-button`,
`.uiw-surface`, `.uiw-badge`, `.uiw-table-scroll` and `.uiw-table`. Unclassed native
controls are unaffected. `createField({className:'uiw-field', ...})` can adopt the
native field presentation; no JavaScript style initialization is required.

Local `--uiw-*` properties theme control/button/surface/badge/table colors,
spacing/radius, help/error color, focus and disabled opacity. The defaults are
independent light presentation. Scope overrides on a surface to theme only its
children; no root/global token declarations are installed. The foundations
specimen shows default and local dark surfaces, native invalid/disabled/busy
controls, long text and a focusable overflow table. BusyButton remains the owner
of busy state and current idle eligibility; styles add no spinner or state logic.

## App consumers and verification

Main fields/buttons, collection icon controls, Favorites/Faction surfaces,
technique badges and read-only tables include these declarations at their original
cascade positions. Worlds uses the same helpers at its existing library/form/
panel/badge selectors. Config inherits main native controls and retains its own
backend theme/tab/YAML layout. PageFeedback and Stories/Runner use their existing
native surfaces, fields, button/focus rules and palettes. Module fixed-slot grids,
header placeholders, app glass/brand/font globals, responsive layout and domain
colors remain local.

The application's temporary [input-contrast theme](../ui/assets_styles.md) is a
separate color-only override emitted last in `main.scss`. It gives app native
text/data fields dark backgrounds, white text and dark browser chrome across
pages without changing portable `.uiw-*` defaults or component geometry, focus,
error and disabled-opacity rules.

All affected SCSS outputs must be compiled. Baseline CSS and computed-style
artifacts were captured before app substitution; comparison and real consumer
evidence are recorded in [Playwright](../playwright.md). The
[foundation plan](../superpowers/plans/2026-11-05-portable-visual-foundations.md)
records the bounded mapping and verification gates.
