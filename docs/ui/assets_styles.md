# Styling and Assets

## SCSS/CSS layout
- `public/css/_globals.scss`
  - Color palette, gradient, font family, and mixins.
  - Primary UI palette is defined here (glass background, primary blue, etc).
- `public/css/main.scss`
  - Base layout and the bulk of component styling for the chat UI.
  - Compiled output: `public/css/main.css`.
- `public/css/settings.scss`
  - Settings page layout and field styling.
  - Compiled output: `public/css/settings.css`.
- `public/css/lorebooks.css`
  - Lorebooks page styling (no SCSS source in repo).
- `public/css/map.css`
  - Shared container styling for Region and World map tabs.

## Images
- `public/generated-images/` is the image output directory for entity images.
- `public/icons/` stores static UI icon assets (for example, `sword-shield.svg`).
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
- Shared theming primitives for entity cards/menus live in `public/css/main.scss`:
  `.entity-card`, `.entity-icon`, `.entity-image`, `.entity-name`,
  `.entity-context-menu-button`, `.entity-context-menu`, `.entity-context-menu-item`.
  Legacy classes (for example `.location-entity-*`, `.inventory-*`, `.npc-card-menu*`)
  are still emitted in templates/scripts for compatibility, but unified styles bind to
  the shared `entity-*` classes.
- NPC memories/goals editors share `npc-list-editor-*` base classes for modal layout,
  row controls, and actions; legacy `.npc-memories-*`/`.npc-goals-*` classes remain on
  markup for compatibility.
- Long names are handled client-side before render: when character/item/scenery
  names exceed 40 characters, the UI wraps the name in a `<span>` with
  `font-size: 0.75em` and `line-height: 0.85`; regular names use line-height `1.25`.
- Skill allocation controls use `.skill-add-row` for inline add inputs and
  `.skill-remove-btn` for the compact remove button styling.
- `.points-warning` reserves space for pool warning text so layout doesn't jump.
- Pool warning visibility is toggled with `visibility` (not `display`) so that reserved help-text height remains stable.
