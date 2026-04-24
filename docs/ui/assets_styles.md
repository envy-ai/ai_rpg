# Styling and Assets

## SCSS/CSS layout
- `public/css/_globals.scss`
  - Color palette, gradient, font family, and mixins.
  - Primary UI palette is defined here (glass background, primary blue, etc).
  - Shared app-header theme tokens live here, including the header surface, border, hover/action/active/accent colors, focus ring, muted text, control height/radius, and compact spacing.
- `public/css/main.scss`
  - Base layout and the bulk of component styling for the chat UI.
  - The shared `.app-header` uses SCSS placeholder inheritance (`%app-header-control-base`, `%app-header-control-interactive`, `%app-header-link-surface`, `%app-header-action-surface`, `%app-header-accent-surface`) plus CSS custom properties on `.app-header` so future themes can override colors without rewriting component selectors. Header controls are namespaced and do not depend on generic `.btn` styles.
  - The app header renders a dark glass band with a crossed-swords brand crest, primary nav labels `Play`, `New Game`, `Worlds`, `Lorebooks`, `System`, a native `Tools` disclosure, and chat-only `Save` / `Load` actions. Tablet-width viewports move nav to a horizontally scrollable second row; phone-width viewports switch nav to a wrapping flex layout and render the open Tools menu as an embedded two-column panel so it stays inside the viewport.
  - The chat tab bar uses icon-only `.tab-button` controls with shared `.tab-button__icon` sizing, transparent button chrome, and a flush `.tab-bar` layout with no gap or bottom margin plus a subtle inset shadow.
  - The Adventure-tab location panel keeps the shared glass `.container` styling but overrides the nested `.location-block .container` shape so only the bottom-right corner remains rounded.
  - The main Adventure layout uses a flush `.chat-wrapper` with no inter-column gap.
  - The Adventure-tab `.chat-sidebar` outer panel also keeps only the bottom-right corner rounded.
  - Desktop Adventure layout exposes slim `.adventure-resize-handle` separators for the location and player/party columns. They use `col-resize`, highlight on hover/focus/drag, disable text selection while dragging, and are hidden in the stacked narrow layout.
  - On narrow/mobile layouts, the Adventure stack now clears the desktop fixed-height/inner-scroll chain (`.main-content` / `.tab-panels` / `#tab-adventure` / `.adventure-content` / `.chat-wrapper`) so `.location-block > .container` and `.chat-sidebar` grow with content instead of keeping redundant inner vertical scrollbars.
  - Compact thing-list popovers now promote their owning `.thing-list-panel` with a temporary `.thing-list-panel--popover-open` stacking class so location item/scenery text cannot paint above an open filter or sort popup.
  - Open item context menus use the `.entity-context-menu--floating` body-level positioning class while open, so Scenery menus can paint above the Things section and modal inventory/crafting menus are not clipped by scroll containers; the floating menu width shrinks to the widest visible option instead of keeping the legacy minimum width.
  - Thing-list icon surfaces opt out of native mobile long-press image/callout behavior (`-webkit-touch-callout`, image drag, and selection); modal drag-wired icons also use `touch-action: none` so custom pointer/touch long-press dragging is not canceled by native gestures.
  - The thing-container inventory modal uses `.thing-container-modal__*` classes for a wide two-column layout, compact visible-item bulk buttons, dashed drag/drop zones, breadcrumb buttons, touch-drag ghost styling, and a mobile vertical half-and-half split instead of a free-height one-column stack.
  - Character view ability cards use `.npc-view-ability-*` classes and visually mirror the player level-up ability selector cards without inheriting the selector's clickable/selected behavior. Shared `.ability-type-*` classes color-code active/passive/triggered ability names, uppercase type labels, and NPC editor ability type controls.
  - Compiled output: `public/css/main.css`.
- `public/css/settings.scss`
  - World Profiles page layout and field styling.
  - Compiled output: `public/css/settings.css`.
- `public/css/lorebooks.css`
  - Lorebooks page styling (no SCSS source in repo).
- `public/css/map.css`
  - Shared container styling for Region and World map tabs.

## Images
- `public/generated-images/` is the image output directory for entity images; persisted image IDs are displayed through `/api/images/:imageId/file` so PNG/JPEG/WebP/GIF files do not require extension-specific client URLs.
- `public/icons/` stores static UI icon assets (for example, `sword-shield.svg`).
- `assets/material-icons/app-nav-icons/` stores mask-friendly app-header icons for New Game, System, Tools, Save, Load, Debug, and Player Stats. App-header masks also reuse existing game-tab icons for Play, Worlds, and Lorebooks.
- `public/js/image-manager.js` coordinates image job requests and updates.
- `public/js/lightbox.js` provides the full-screen lightbox viewer.

## Client templates
- `public/templates/plausibility.njk` is rendered in the browser via Nunjucks
  (used for plausibility insight tooltips).
- `views/popups/plausibility.njk` is the server-side copy.

## Vendor libraries (public/vendor)
Loaded on the chat page:
- `cytoscape.min.js` + layout plugins (`cose-base`, `fcose`, `euler`) for maps.
- `markdown-it.min.js` for chat markdown rendering.
- `nunjucks.js` for client-side templating.
- `vaadin.js` (loaded for UI assets; check usage before removal).

## Notes
- The chat UI relies on SCSS variables and mixins in `_globals.scss`.
- Markdown/prose tables in chat messages (`.message .message-content table`) use
  alternating row backgrounds (top row shaded at `rgba(0,0,0,0.25)`), `border-spacing: 0`,
  top-left cell alignment for all `th`/`td`, and default cell padding `0 1em` with reduced
  outer-edge horizontal padding (`0.2em`) on each row's first/last cell. Markdown-rendered
  tables are wrapped in `.message-table-scroll` so they span the content width and provide
  horizontal scrolling when content is wider than the message area.
- Markdown code fences / preformatted blocks in chat messages (`.message .message-content pre`)
  use `white-space: pre-wrap`, `overflow-wrap: anywhere`, and `word-break: break-word` so
  long lines wrap inside the message column instead of forcing horizontal overflow.
- Item tooltip styling includes stacked tooltip cards (`.tooltip-thing-stack*`) so hovering an
  equippable item can show currently equipped compatible-slot items beneath the primary card.
- The shared image lightbox now has an optional two-pane thing-view mode driven by
  `.image-lightbox--details`, `.image-lightbox__media`, and `.image-lightbox__details`,
  reusing the existing tooltip-card markup inside the right-hand pane. Desktop keeps the image
  in a left column capped to `67vw` and vertically centers the tooltip pane without stretching it
  full-height, while mobile switches the panes vertical and makes the overall viewer scrollable.
  Clicking either pane dismisses the lightbox.
- Shared theming primitives for entity cards/menus live in `public/css/main.scss`:
  `.entity-card`, `.entity-icon`, `.entity-image`, `.entity-name`,
  `.entity-context-menu-button`, `.entity-context-menu`, `.entity-context-menu-item`.
  Legacy classes (for example `.location-entity-*`, `.inventory-*`, `.npc-card-menu*`)
  are still emitted in templates/scripts for compatibility, but unified styles bind to
  the shared `entity-*` classes.
- Shared portrait health bars now include a `.health-bar-readout` overlay positioned directly
  above the bar, using white text with a black outline plus a subtle drop shadow; size is tuned
  per bar variant through CSS custom properties on `.health-bar`, `.chat-health-bar`, and
  `.npc-health-bar`. Readout text displays current/max health as upward-rounded integers even
  though the underlying health values may be fractional. Floating `.health-change-float`
  change numbers drift and fade over five seconds before the client removes them on the
  CSS animation end event.
- Portrait cards also share `.character-level-badge` for the top-left bare `L.<level>` text on player
  and NPC portraits, using a `3px` black stroke for readability. The player portrait adds `.chat-player-level-badge`, while the unspent-points
  warning triangle is anchored from the shared chat-health-bar geometry instead of the portrait's
  top-left corner so it sits lower-left, just above the bar.
- Dead NPC/party cards position a `skull.svg` icon plus corpse countdown just below the level text and use the same
  `3px` black outline styling instead of a pill background, with the skull scaled to the line
  height via `1em` sizing so it tracks the countdown text.
- Thing thumbnails on item/scenery cards also use a shared `.thing-count-badge` overlay in the
  lower-right corner of the image area. Items always show their persisted `count`; scenery
  hides the badge when `count === 1`.
- Inventory, location item/scenery sections, and the crafting inventory now share the same
  inventory-style thing-card DOM builder in `views/index.njk`, with shared control/popup
  classes in `public/css/main.scss` such as `.thing-list-panel`, `.thing-list-panel__header`,
  `.thing-list-panel__controls`, `.thing-list-filters-shell`, `.thing-list-sort-shell`,
  `.thing-list-view-shell`, `.thing-list-filters-row`, `.thing-list-panel__icon-toggle`,
  `.thing-list-sort-option`, and `.thing-list-view-option`. Narrow panels switch to a
  popover-style filter shell anchored to the shared icon-only filter toggle button, while
  sort and view each stay in their own popup. The shared control icons now come from
  `assets/material-icons/inventory-view-icons/filter.svg`,
  `assets/material-icons/inventory-view-icons/sort.svg`,
  `assets/material-icons/inventory-view-icons/view.svg`,
  plus the per-sort glyphs (including `sort_chronological.svg` and `sort_quantity.svg`)
  and the `cards.svg` / `table.svg` / `grid.svg` / `grid_small.svg` view icons in that same folder. The repeated toggle, sort-shell,
  and view-shell markup now comes from the
  shared `views/_includes/thing-list-filter-toggle.njk` macros so all four panels stay in sync.
  Size-related tuning for shared item/scenery imagery is centralized in the
  `// Shared thing-view sizing tokens` block near the top of `public/css/main.scss`,
  covering the classic-card container, base icon size, grid/tile sizing, table image cell,
  overlay badge bar, count badge, action-icon list, and the item `•••` context-menu button.
  Shared view-mode presentation is handled by `.thing-collection-view--table`,
  `.thing-table`, `.thing-table-row`, `.thing-table-row__icon-cell`,
  `.thing-table-row__content`, `.thing-table-row__utilities`,
  `.thing-collection-view--grid`, `.thing-collection-view--small-grid`,
  `.thing-table-row__icon`,
  `.thing-action-icon-list`, `.thing-grid-tile`, and `.thing-grid-tile__icon`; grid modes use a `1px` tile gap and a `2px`
  rarity-colored border on the image/icon itself. `Small Grid` now overrides those shared
  sizing tokens to `0.7x` with SCSS math so the tile, image, count badge, overlay badge bar,
  and context-menu button all shrink together without transform scaling. Table mode now uses a real
  HTML table (`<table>/<tbody>/<tr>/<td>`) with collapsed borders; its image cell and row height use
  a shared `0.5x` scale derived from the base icon size, the title cell is explicitly left-aligned and vertically centered, and its `•••` context-menu button/menu are absolutely anchored from `.thing-table-row__content` instead of the utilities cell.
  Inventory-style tables additionally opt into `.thing-table__head` / `.thing-table__head-cell`
  for a blank icon header plus `Title`, `Level`, `Value`, `Equip`, and `Actions`, along with
  `.thing-table__col--level`, `.thing-table__col--value`,
  `.thing-table__col--equipment`, plus the matching `.thing-table-row__level`,
  `.thing-table-row__value`, `.thing-table-row__equipment`, `.thing-table-row__equipment-inner`,
  and `.thing-table-row__equipment-label` cell styles so `Level`, `Value`, and `Equipment Slot`
  render as dedicated columns, with the equipment cell hosting the `Equip` / `Unequip` button.
  Location item/scenery tables intentionally keep the slimmer three-column variant. The shared default view is `Grid`;
  row and cell borders are styled as collapsed `2px` lines with zero spacing. The shared list container also gets semantic mode classes
  for downstream styling hooks: `.view-classic-mode`, `.view-table-mode`,
  `.view-grid-mode`, `.view-grid-mode-large`, and `.view-grid-mode-small`.
  Crafting cards also add a red equipped-state outline via `.crafting-inventory-card.is-equipped`
  so equipped items are visually blocked from slot assignment until unequipped.
  The crafting inventory grid also carries the same `8px` top separation below filters as the
  player inventory grid for consistent spacing after the radio filter row.
- NPC memories/goals editors share `npc-list-editor-*` base classes for modal layout,
  row controls, and actions; legacy `.npc-memories-*`/`.npc-goals-*` classes remain on
  markup for compatibility.
- Long names are handled client-side before render: when names exceed 40 characters,
  the UI wraps the name in a `<div class="entity-name-long">` so sizing/line-height is
  style-driven (`font-size: 0.75em`, `line-height: 0.85`, centered text); regular names
  use line-height `1.25`.
- Item/scenery card names also trigger the same compact-name wrapper when any word in the
  name is 12+ characters, even if the full name is under 40 characters.
- Skill allocation controls use `.skill-add-row` for inline add inputs and
  `.skill-remove-btn` for the compact remove button styling.
- Faction reputation tier thresholds in the faction editor use `.faction-tier-threshold`
  with a fixed input width of `6em` in `public/css/main.scss`.
- Settings editor tabs use `.editor-tabs` with a fixed height of `80px` in `public/css/settings.scss`.
- `.points-warning` reserves space for pool warning text so layout doesn't jump.
- Pool warning visibility is toggled with `visibility` (not `display`) so that reserved help-text height remains stable.
- Scrollbars are themed via the shared `@mixin themed-scrollbar` in `public/css/_globals.scss`; target width/height is `1ex`, with a rounded gradient thumb matching the primary blue/purple UI palette.
