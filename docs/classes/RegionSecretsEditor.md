# Region secrets editor

`views/index.njk` shares Region Secret row lifecycle through ReaderRows and native createField. Its persistent owner clears across render/reset/close/reopen; static Add remains live. Each row has a visible Secret label, the existing textarea class/rows/placeholder and an owned native Remove button.

Render retains only string entries and initially creates one blank row for an empty list. Manual removal may leave zero rows. Collection reads current DOM order, trims strings and filters blanks, preserving the existing Region payload. There is no new minimum rule, ID allocation or backend behavior. Cached page hide retains the owner; final non-persisted hide destroys it.

SCSS retains the desktop text/remove grid and phone stack, with the labeled wrapper using existing form-row sizing. The actual browser save/reopen and responsive geometry cases passed; verification is tracked in the [row consolidation plan](../superpowers/plans/2026-11-05-quest-region-row-consolidation.md).
