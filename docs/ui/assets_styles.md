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
- `public/js/image-manager.js` coordinates image job requests and updates.
- `public/js/lightbox.js` provides the full-screen lightbox viewer.

## Client templates
- `public/templates/plausibility.njk` is rendered in the browser via Nunjucks
  (used for plausibility insight tooltips).
- `views/popups/plausibility.njk` is the server-side copy.

## Vendor libraries (public/vendor)
Loaded on the chat page:
- `cytoscape.min.js` + layout plugins (`cose-base`, `fcose`, `euler`) for maps.
- `fitty.min.js` for auto-scaling entity name text.
- `markdown-it.min.js` for chat markdown rendering.
- `nunjucks.js` for client-side templating.
- `vaadin.js` (loaded for UI assets; check usage before removal).

## Notes
- The chat UI relies on SCSS variables and mixins in `_globals.scss`.
- `public/js/fitty-init.js` listens for `inventory:updated` and `location:updated`
  to reflow text after dynamic DOM updates.
- Skill allocation controls use `.skill-add-row` for inline add inputs and
  `.skill-remove-btn` for the compact remove button styling.
- `.points-warning` reserves space for pool warning text so layout doesn't jump.
- Pool warning visibility is toggled with `visibility` (not `display`) so that reserved help-text height remains stable.
