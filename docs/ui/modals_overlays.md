# Modals and Overlays (Chat UI)

Most modals live in `views/index.njk` and are wired up by the inline script or `public/js/chat.js`.

## Global overlays

- `#locationOverlay` (class `overlay-backdrop`): travel/generation spinner while location updates.
- Prompt-progress overlay (`.prompt-progress-overlay`, created by `public/js/chat.js`):
  - Auto-closes `#loadGameModal` before showing prompt activity.
  - Auto-anchors below the top header/tab controls by default so top navigation remains clickable.
  - Supports drag/resize/contract; manual drag disables auto-anchoring for that session.
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

## Faction creation

- `#factionCreateModal`: full new-faction form (name/home region/descriptions/tags/goals/assets/relations/reputation tiers).
- Submit path:
  - If fields are missing, calls `/api/factions/fill-missing` to complete blanks.
  - Then posts to `/api/factions` to create the faction.

## NPC views and management

- `#npcInventoryModal`: character inventory listing with filters.
- `#npcViewModal`: character overview (attributes, gear, skills, abilities, status, plus read-only resistances/vulnerabilities text boxes).
  - Attributes/skills now use the shared allocation partials from the New Game UI.
  - Attribute and skill allocation areas no longer use nested internal scrollbars; they inherit the modal body's single scroll container.
  - NPCs render those controls in read-only mode, and the unspent attribute/skill point totals are hidden.
  - Player view mode enables spending unspent attribute/skill points directly in the modal.
  - Player save flow blocks submit on negative pools and prompts confirmation if pools remain positive.
- `#npcDispositionModal`: adjust dispositions.
- `#npcNeedsModal`: adjust need bars.
- `#npcMemoriesModal`: edit important memories.
- `#npcGoalsModal`: edit goals.
- `#npcEditModal`: full NPC edit form (attributes, skills, abilities, status effects, faction membership, resistances, vulnerabilities).
  - Abilities in the edit form include a required short description field.
- `#addNpcModal`: generate and add a new NPC (optional reference image).

## Item / scenery editing

- `#thingEditModal`: edit items/scenery (metadata, bonuses, on-hit/equip effects, flags).
  - Includes a short description field directly under the main description.
- `#inventoryTooltip` and `#partyTooltip`: floating tooltips for entity cards.
  - Item tooltips include inflicted status effect durations when available.
  - Equip status effects only show for equippable items (slots set).
  - Attribute bonuses are hidden for non-equippable items.
  - Status effect need bar selectors normalize Health and need bar display names to their ids.

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
  - Uses elevated z-order above all other overlays while open.
  - When the elevated load backdrop is active, any visible `.modal` is forced above it to prevent blur-layer occlusion of dialogs.
  - Confirm closes the modal immediately, then sends `/api/prompts/cancel-all` before `/api/load`.

## Player level-up ability draft

- `#playerAbilitySelectionModal`: player-only blocking modal used when one or more levels are missing required abilities.
- Shows `Ability options for level-up are being generated` while option generation is in progress.
- Applies a dynamic top offset below header/tab controls so top-row UI buttons stay clickable during generation.
- Renders card options for one level at a time and requires exactly `player_abilities_per_level` selections.
- Existing level abilities appear preselected and toggleable; newly generated options fill up to `player_ability_options_per_level`.
- Submit button is horizontally centered with `1.5em` bottom spacing.
- Submit advances to the next missing level (if any) and keeps gameplay blocked until all missing levels are filled.

## Image lightbox

- `#imageLightbox`: full-screen image viewer bound by `public/js/lightbox.js`.

## Notes

- Most modals are toggled via `hidden` + `aria-hidden`.
- The inline script in `views/index.njk` contains the open/close logic and field wiring.
- LLM prompt modals (`#addNpcModal`, `#newExitModal`, `#craftingModal`, `#salvageIntentModal`) close immediately on submit; no visible waiting state is shown, and errors surface via `alert()` after closing.
