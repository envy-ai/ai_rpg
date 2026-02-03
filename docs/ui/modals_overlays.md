# Modals and Overlays (Chat UI)

Most modals live in `views/index.njk` and are wired up by the inline script or `public/js/chat.js`.

## Global overlays

- `#locationOverlay` (class `overlay-backdrop`): travel/generation spinner while location updates.
- `#npcModalBackdrop`, `#questEditBackdrop`, `#craftingModalBackdrop`, `#salvageIntentBackdrop`:
  shared backdrops used to dim the page for certain modals.

## Quest confirmation (runtime-only)

- Built dynamically in `AIRPGChat.setupQuestConfirmationModal()` (in `public/js/chat.js`).
- Used when the server sends `quest_confirmation_request` via websocket.
- Accept/Decline triggers `/api/quests/confirm`.

## Quest editing

- `#questEditModal` + `#questEditBackdrop`
- Edits quest name, description, rewards, objectives.
- Save uses `/api/quest/edit`.

## NPC views and management

- `#npcInventoryModal`: character inventory listing with filters.
- `#npcViewModal`: character overview (attributes, gear, skills, abilities, status).
- `#npcDispositionModal`: adjust dispositions.
- `#npcNeedsModal`: adjust need bars.
- `#npcMemoriesModal`: edit important memories.
- `#npcGoalsModal`: edit goals.
- `#npcEditModal`: full NPC edit form (attributes, skills, abilities, status effects, faction membership).
  - Abilities in the edit form include a required short description field.
- `#addNpcModal`: generate and add a new NPC (optional reference image).

## Item / scenery editing

- `#thingEditModal`: edit items/scenery (metadata, bonuses, on-hit/equip effects, flags).
  - Includes a short description field directly under the main description.
- `#inventoryTooltip` and `#partyTooltip`: floating tooltips for entity cards.

## Location and region editing

- `#locationEditModal`: edit location name/description/level/status effects and controlling faction.
- `#regionEditModal`: edit region name/description/parent/level and controlling faction.
  - Both include a short description field directly under the main description.
- `#newExitModal`: create new exits (new region/location, optional image).
- `#summonNpcModal`: summon an existing NPC into current location.
- `#summonThingModal`: summon an existing item/scenery into current location.

## Crafting / processing

- `#craftingModal`: drag-and-drop crafting UI.
- `#salvageIntentModal`: optional prompt before salvage.

## Save/load

- `#loadGameModal`: choose manual or autosave and load.

## Image lightbox

- `#imageLightbox`: full-screen image viewer bound by `public/js/lightbox.js`.

## Notes

- Most modals are toggled via `hidden` + `aria-hidden`.
- The inline script in `views/index.njk` contains the open/close logic and field wiring.
- LLM prompt modals (`#addNpcModal`, `#newExitModal`, `#craftingModal`, `#salvageIntentModal`) close immediately on submit; no visible waiting state is shown, and errors surface via `alert()` after closing.
