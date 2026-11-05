# Technique and attachment reader-row consolidation

Status: implemented and verified. This is an independent finite form slice after the calendar/effect and standalone-dialog work. The wider metadata/mod/vehicle/faction/allocator families remain open in the master ledger.

## Native seam and implementation

`techniques.js:rowsEditor` previously maintained a row-to-reader Map and manually coupled Remove buttons to Map deletion and DOM removal. That single helper already backs requirements, normal/failure costs, summon-template attributes/skills, effects/status magnitudes and recipe components. `ability-attachments.js` repeated the same ownership pattern for scalar modifiers, granted techniques and permanent effect rows.

The portable `ReaderRows` class composes existing Repeater with explicit reader/disposer ownership: `add(existingRow, read, {dispose, removeButton})`, `remove`, DOM-ordered `read`, `clear`, idempotent `destroy`, an owned Add-action `signal`, and explicit registered-subtree `destroyWithin`. It builds no fields, applies no domain schema and adds no reorder UI. Duplicate/already-owned/foreign rows and invalid callbacks fail at the add boundary. Removed/replaced/closed groups release only owned callbacks; serializers are never invoked as cleanup.

Both real source modules now use this owner at all four duplicate Map sites. Their original classes, labels, controls, validators, zero/optional/formula behavior, saved IDs/provenance, recipe contracts, optimistic revisions and HTTP operations remain unchanged. Existing nested forms are released before replacing dynamic bodies or generated attachment drafts, and on native close. Attachment mode listeners use explicit lifetime signals. Generic Repeater removal gains only an optional `restoreFocus` argument with its existing default unchanged; ReaderRows selects false to retain these consumers' old raw-delete behavior.

Core owns package exports, classic controls registration, build and independent specimen mounting. The specimen lives in `examples/reader-rows.js` and its own SCSS source. The implementation worker changes no Play index/common overlay source. Terra owns test changes/execution.

## Ownership and error contract

Root and row registries are weak. Each root retains its live rows/readers until removal/clear/destroy, with no global strong registry of historical controls. Destroy marks the owner disposed and aborts its root signal before invoking user disposers, so reentrant destroy is harmless. A disposer may destroy the owner during clear; remaining metadata releases remain idempotent and the captured root is still emptied. Original cleanup errors/causes survive after all cleanup attempts.

## Verification

Source syntax checks passed for the new package class, Repeater, the independent example, techniques and attachments. Core rebuilt the widgets/specimen assets, including the ReaderRows SCSS and final classic adapter. The testing worker reported 10 unique passing focused Chromium cases before the narrow reentrancy correction: one direct reader-order/removal/disposal case, eight existing technique/attachment author/edit/apply cases, and one real nested-removal/post-close retained-button case. After rebuilding the final signal ownership, direct/nested cases were rerun successfully with no fixture page errors. The focused reentrant destroy/clear callback case passed, including zero remaining children when a disposer destroys the owner during clear. Together the valid evidence covers **11 unique reader-row browser cases**; unaffected passes were retained for the callback-only correction.

Affected commands use the shared 16 GB/no-swap user systemd browser scope and XDG/DBUS/Playwright environment described in the [standalone plan](2026-11-05-standalone-dialog-consolidation.md#verification-evidence):

- `tests/e2e/ability-tooltip.spec.js tests/e2e/ui-widgets-controls.spec.js --grep 'location item sort and view|reader rows serialize' --output=tmp/toolbar-reader-results --workers=2` includes the direct ReaderRows case and the separately owned toolbar case.
- `tests/e2e/ability-attachments.spec.js tests/e2e/techniques-panel-editor.spec.js --grep 'attachments|technique buff editor|technique editor saves|shared editor authors|standard mixed recipe' --output=tmp/reader-consumers-results --workers=4`: 8 passed.
- `tests/e2e/ability-attachments.spec.js --grep 'removing nested attachment' --output=tmp/reader-removal-results`: 1 passed.
- Final built adapter: `tests/e2e/ability-tooltip.spec.js tests/e2e/ability-attachments.spec.js tests/e2e/ui-widgets-controls.spec.js --grep 'map edge popup|removing nested attachment|reader rows serialize' --output=tmp/map-reader-final-results --workers=3` retained the direct/nested passes, alongside the separately owned map-edge case.

Fixtures loading scripts directly now include the actual controls adapter. No live server restart, loaded-save operation, backend change, new framework or numeric clamping was introduced.

The final reentrant callback gate ran the same browser prefix with `tests/e2e/ui-widgets-controls.spec.js --grep 'reader disposal tolerates' --output=tmp/reader-clear-final-results` and passed. It covers repeated/reentrant destroy, clear whose disposer destroys the owner, remaining callbacks released once, empty DOM after clear and original cleanup errors. The coordinator also accepted the final direct/reentrant 2/2 affected run alongside the retained previous cases. Runtime source and generated controls are frozen for checkpoint review.
