# Needs Modal Simplification Design

**Status:** Implemented design/archive spec. The compact needs editor described here is current behavior for `#npcNeedsModal`; this document preserves the design intent and rationale rather than serving as implementation instructions. For the current user-facing modal map, see `../../ui/modals_overlays.md`; for the archived implementation task breakdown, see `../plans/2026-06-15-needs-modal-simplification.md`.

## Goal

Simplify the needs edit modal so it works as a fast value editor instead of a detailed need-bar inspector. The implemented UI shows one compact row per active need:

- Need icon
- Need display name
- Range slider, colored with the need definition's configured color
- Numeric input for direct value entry

## Context

Before this redesign, `#npcNeedsModal` rendered each need as a large card with a heading, range/rate/audience metadata, description, a separate progress bar, slider readout, numeric input, min/max/delta buttons, and current-effect text.

That was redundant for the edit workflow. The slider already communicates bar state, and the user usually only needs to set an exact value or drag the value roughly into place. Need applicability remains in the broader NPC edit modal, so the needs modal does not need to explain which bars are applicable.

Current code matches the simplified design: `views/index.njk` renders compact `.npc-needs-entry` rows, and `public/css/main.scss` styles them as a responsive grid with colored sliders.

## Considered Approaches

1. Compact one-line rows.
   - Pros: lowest visual noise, fastest scanning, matches the user's requested shape.
   - Cons: hides range and effect-threshold context.
   - Decision: chosen.

2. Simplified cards.
   - Pros: preserves the current layout structure while removing the most redundant controls.
   - Cons: still gives each need too much visual weight for a simple edit action.

3. Inline editing on existing displayed bars.
   - Pros: avoids a separate modal for some cases.
   - Cons: higher risk because player/NPC/party need bars appear in several panel contexts, and inline editing could make normal status display feel editable by accident.

## Implemented Design

The modal keeps its existing title, loading state, empty state, footer, save/cancel flow, and API behavior. Only the rendered need entries change.

Each need row uses a stable three-column layout on desktop:

- Left: icon and name.
- Middle: slider.
- Right: numeric input.

On narrow screens, the row can wrap or stack so the label remains readable and the slider/input do not overlap. The numeric input remains visible rather than hidden behind another interaction.

The slider uses the need's configured color through `accent-color` and/or a CSS custom property. If a need has no configured color, the existing default needs color is used.

The following old UI elements are intentionally absent from the needs modal entries:

- Separate progress bar and fill.
- Slider value readout.
- Range/rate/audience metadata.
- Need description.
- Current-effect threshold text.
- Min, max, decrement, and increment buttons.

## Behavior

The implemented data flow stays intact:

- Load needs from `/api/player/needs` or `/api/npcs/:id/needs`.
- Normalize displayed values as rounded integers.
- Track `originalValue` for dirty-state detection.
- Save only changed entries through the existing `PUT` endpoint.
- Refresh cached player/NPC data and visible panels after save.

The slider and numeric input remain synchronized. Editing either control updates the in-memory row value, recomputes dirty state, and enables Save when at least one value differs from its original value.

The controls retain the configured min/max constraints for each need even though the range text is no longer shown. The client clamps and rounds local control values for display/editing, and the model applies authoritative need-bar bounds through `Player.setNeedBarValue(...)`.

## Error Handling

Existing load and save errors continue to surface in the modal status area. The redesign does not add fallback behavior. If a needs payload is malformed or a save fails, the UI should fail visibly through the existing error path instead of silently accepting a placeholder value.

## Current Implementation References

Primary references:

- `views/index.njk`: `renderNpcNeedsEntries(...)` renders compact `.npc-needs-entry` rows with `.npc-needs-label`, optional `.npc-needs-icon`, `.npc-needs-name`, `.npc-needs-slider`, and `.npc-needs-value-input`.
- `public/css/main.scss`: needs rows use a three-column grid on desktop, stack at `max-width: 640px`, and color sliders through `--npc-needs-color` / `accent-color`.
- `public/css/main.css`: generated CSS output for the SCSS.
- `tests/npc_needs_modal_ui.test.js`: source-level regression coverage for the compact renderer, colored sliders, mobile row layout, and absence of removed card-only controls.
- `docs/ui/modals_overlays.md`: current user-facing modal reference for `#npcNeedsModal`.

Avoid changing the disposition editor, even though it shares some `.npc-adjustment-*` classes. Any shared CSS edits should be checked against `#npcDispositionModal`.

## Testing

When changing this area, manual/browser verification should cover:

- Opening needs for the player.
- Opening needs for an NPC.
- Slider updates numeric input and enables Save.
- Numeric input updates slider and enables Save.
- Save updates cached UI bars and closes the modal as before.
- Load and save failure paths still display modal status errors.
- Responsive layout does not overlap text, slider, or input on mobile widths.

Applicable static checks for implementation changes:

- `node --test tests/npc_needs_modal_ui.test.js`
- Lint or syntax-check edited JavaScript/template content if an existing command is available.
- Compile `public/css/main.scss` into `public/css/main.css` when styles change.
