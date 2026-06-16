# Needs Modal Simplification Implementation Plan

**Status:** Implemented and archived.

This plan records the implementation path for simplifying `#npcNeedsModal`. It is kept as an archive of the completed work, not as current implementation instructions. For current user-facing modal behavior, see `docs/ui/modals_overlays.md`; for the original design rationale, see `docs/superpowers/specs/2026-06-15-needs-modal-simplification-design.md`.

## Goal

Replace the needs edit modal's large per-need card controls with compact value-editing rows:

- Need icon and display name.
- Colored range slider.
- Numeric input for exact value entry.

The implementation preserved the existing modal shell, API endpoints, dirty-state tracking, save flow, and panel refresh behavior.

## Current Implementation

- `views/index.njk`: `renderNpcNeedsEntries(data)` now renders each active need as a compact `.npc-needs-entry` row. Each row contains a `.npc-needs-label` with optional `.npc-needs-icon` and `.npc-needs-name`, a `.npc-needs-slider`, and a `.npc-needs-value-input` number field.
- `views/index.njk`: slider and number input changes are synchronized through the existing value-application flow. The row still uses the active need's min/max bounds and keeps the existing dirty-state behavior.
- `public/css/main.scss`: needs rows use a three-column grid on desktop, stack at `max-width: 640px`, and color sliders through `--npc-needs-color` / `accent-color`.
- `public/css/main.css`: generated output is compiled from the SCSS.
- `tests/npc_needs_modal_ui.test.js`: source-level regression coverage checks the compact renderer, direct `.npc-needs-value-input` styling, colored slider styling, mobile layout rule, and absence of the removed card-only controls.
- `docs/ui/modals_overlays.md`: the `#npcNeedsModal` entry describes the compact need-bar value editor.
- `docs/README.md`: the plan and its design spec are indexed in the project documentation map.

## Completed Tasks

### Task 1: Add Source-Level UI Coverage

**Files:**

- Created: `tests/npc_needs_modal_ui.test.js`

- [x] Added a Node test that extracts `renderNpcNeedsEntries(data)` from `views/index.njk`.
- [x] Asserted that the renderer creates compact rows with label, slider, and number input controls.
- [x] Asserted that removed card-only elements are absent from the renderer, including progress bars, metadata, delta buttons, threshold text, value readout, and current-effect text.
- [x] Added SCSS assertions for the compact grid row, colored slider, direct number input styling, and mobile stacked layout.

### Task 2: Implement Compact Needs Rows

**Files:**

- Modified: `views/index.njk`
- Modified: `public/css/main.scss`
- Generated: `public/css/main.css`

- [x] Replaced the old card-style need entry renderer with compact rows.
- [x] Preserved icon/name display for each active need.
- [x] Kept a range slider and numeric input synchronized for each row.
- [x] Applied the configured need color to the slider when available.
- [x] Removed redundant need-entry UI from this modal: progress bar, value readout, range/rate/audience metadata, description, current-effect text, and min/max/delta buttons.
- [x] Added responsive SCSS so compact rows do not overlap on narrow screens.
- [x] Compiled the SCSS output after implementation.

### Task 3: Align Documentation

**Files:**

- Updated: `docs/ui/modals_overlays.md`
- Confirmed: `docs/README.md`

- [x] Updated the `#npcNeedsModal` modal reference to describe the compact row editor.
- [x] Confirmed the docs index includes the needs modal simplification plan and design spec.

## Verification Record

Useful verification commands for this archived work:

- `node --test tests/npc_needs_modal_ui.test.js`
- `npm run scss:build:main`
- `npm run test:e2e:headless`

The focused Node test is the main regression check for the renderer and styles. SCSS compilation verifies that `public/css/main.css` is generated from `public/css/main.scss`. The default e2e suite is broader project coverage and may be run when the environment is available.

## Notes For Future Changes

- Keep needs-modal styling scoped to needs-specific classes where possible. Some `.npc-adjustment-*` classes are shared with the disposition modal.
- Do not reintroduce detailed need-bar inspection controls into `#npcNeedsModal`; the full NPC edit modal remains the place for need-bar applicability, while this modal is a fast value editor.
- If the needs row structure changes, update `tests/npc_needs_modal_ui.test.js` with the new intended structure instead of weakening the absence checks for removed card controls.
