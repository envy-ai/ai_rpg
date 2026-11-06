# Portable visual foundations

Implemented after `9b7a386`; verification status is recorded below. Source authority: [assets/styles](../../ui/assets_styles.md), original
[audit](../../ui/widget_audit.md), package `styles/index.scss` and its current widget
partials. Preserve every existing selector, cascade position and default appearance.

## Bounded extraction

Add a side-effect-free `styles/_foundations.scss` with small declaration mixins and
one opt-in `styles` emitter. Package CSS emits only `.uiw-*` selectors. Sass consumers
can include the same declaration mixins at their current selectors, passing existing
values explicitly. No `@extend` selector merging, global element reset or .btn rename.
Portable color/spacing/radius/focus custom properties stay scoped to these classes;
app fonts, glass/brand gradients and game severity/type/rarity colors stay adapters.

| Common seam / proposed mixins | Actual bounded consumers / retained differences |
| --- | --- |
| Native `field-stack`, `field-label`, `control`, `help` declarations | main `.form-group` (~9402); Worlds `.library-control` (~72), `.form-group` (~323), `.help-text` (~363); Stories `.stories` fields (~28–49) and Runner `.story-authoring .form-group textarea`. Keep main glass treatment, dark Worlds/Stories overrides, label sizes/margins, readonly/invalid rules, textarea sizes and checkbox/range presentation. Grid/mobile column policy stays local. |
| `button-base`, `icon-button`, `disabled`, `focus-ring` | main `.button` (~3244), `.btn` (~11003), `.thing-list-panel__icon-toggle` (~3031); Worlds `.btn` (~769); Stories `.btn`/focus rules (~26); PageFeedback button focus (~45). Parameters preserve padding/gap/radius/font/opacity (.55 versus .6) and outline offsets. Main `.btn` does not acquire `.button`'s centering; icon transform focus and native disabled/eligibility remain unchanged. Header `%app-header-*` placeholders already share their own themed contract; retain them. |
| `surface` declarations | main `.favorites-panel` (~2723) and `.faction-detail` (~10084) are exact shared surface chrome; Worlds `.settings-library-panel,.settings-editor-panel` (~15) and Stories `.stories__panel` (~70) use the same dark panel pattern with distinct padding/shadow. PageFeedback dialog surface can compose with its existing tokens. Keep backdrop/filter, sticky/fixed sizing, flex/grid/scroll and modal role in hosts. |
| `badge` declarations | Worlds `.setting-badge` (~202), Stories `.stories__badge` (~84), main `.techniques-badge` (~17035). Share padding/radius/font sizing only; optional display/border must not introduce new baseline/flow. Uppercase/tracking, selected/applied/approval semantics and color maps stay adapters. Image badges and count overlays have separate measured geometry and remain domain styles. |
| `table-scroll`, `table` declarations | main `.data-table-scroll/.data-table` (~17150), consumed by Catalogue and technique/formula dialogs; package opt-in `.uiw-table-scroll/.uiw-table`. Preserve caption/row/column headers, keyboard region focus, cell spacing/borders and long-code wrapping. Existing `.collection-table` grid/entity tables retain their separate action/drag chrome; reuse only compatible declarations in its package partial, not the read-only table policy. |
| Busy/feedback structure, reuse rather than duplicate | Existing `_feedback.scss` already owns ProgressMeter/ProgressMirror and ActionGroup; `_notice-host.scss` owns notices. BusyButton already supplies aria-busy/current eligibility. Reuse button disabled/focus declarations and the existing spinner geometry if moved; do not add pseudo-spinners to every busy control, change labels or create another progress theme. Main/Settings status-message margin/alignment and success/error palettes remain host state presentation. |

## Existing styles and explicit boundaries

`_globals.scss` remains the app palette/font/brand owner. Its `glass-effect`,
`transition`, `themed-scrollbar` and header tokens are not portable defaults.
Config's `--config-*`, tab geometry and YAML monospace/resize remain app-specific;
its native forms/buttons inherit main foundations, so no duplicate Config renderer
or stylesheet is needed. Module slot grids/tooltip icon sizing remain domain layout;
common native fields inherit host styles and can consume foundations without
flattening fixed indices. Existing SearchableSelect, FloatingTooltip, modeless,
Lightbox, collection, structured-reader, progress and notice partials remain the
only owners of their behavior-specific rules; do not copy them into foundations.

## Ordered changes and gates after release

1. Add mixins plus an independent opt-in specimen for fields/help/invalid and
   disabled controls, normal/icon/busy buttons, two themed surfaces/badges and a
   long-content read-only table. Importing package CSS must leave unclassed native
   controls untouched; demonstrate local CSS-variable theme overrides without app
   globals, fonts or theme imports.
2. Replace only mapped declaration blocks at original positions. Preserve existing
   nested selectors/pseudos and pass current values; keep declaration order where
   later shorthands override earlier values. Main/settings/Config/PageFeedback/mod
   CSS load ordering stays fixed. Avoid a final blanket include which would undo
   prior cascade fixes. Core owns shared imports/build/specimen integration.
3. Terra verifies independent specimen and real Play/Catalogue, Config, Worlds,
   New Game, Stories/Runner and module field consumers at desktop and phone:
   labels above fields, field/control nonoverlap, long text wrapping/table scroll,
   visible keyboard focus, native disabled/invalid/read-only states and busy
   eligibility. Compare default computed spacing/colors/borders/display before and
   after targeted substitutions; scoped alternate theme must not leak. Compile all
   affected SCSS outputs and repeat deterministic asset comparison. No runtime JS
   behavior or transport tests are implied by this planning document.

## Implementation status

The six seams above now compose small declaration-only mixins in `_foundations.scss`.
The opt-in `.uiw-*` emitter and independent default/local-dark specimen use the same
building blocks. Main/settings/PageFeedback/Stories/Runner substitutions preserve
selectors, rule positions and explicit values; optional null arguments retain the
absence of declarations. Existing collection-table styles reuse only `table-base`.
No application font/brand/domain palette, layout or runtime state moved.

Terra captured baseline compiled CSS, desktop/phone representative-selector metrics
and screenshots in `tmp/foundations-baseline` before app edits. Static output diffs
for all five app/mod stylesheets contain only reordered independent declarations
within the same rules. All five affected outputs compiled successfully. Computed default/focus metrics match exactly across representative selectors at
1280px and 390px. The independent opt-in/theme specimen and six actual-page cases
pass (Play, Config, Catalogue, New Game, Worlds and Stories, including module
fields and phone geometry). Actual Runner behavior remains L03; its stylesheet
has semantic output parity and representative-selector measurements. Evidence and
artifacts are in [Playwright](../../playwright.md).
