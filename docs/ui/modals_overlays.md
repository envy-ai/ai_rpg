# Modals and Overlays (Chat UI)

Most modals live in `views/index.njk` and are wired up by the inline script or `public/js/chat.js`.

## Global overlays and status

- `#chatSpinnerStatusBar`: non-modal inline status strip rendered in the chat column between `#promptProgressDock` and `.input-area`. It is hidden when idle, shows the same text that the old play-page spinner overlay would have shown, and uses a small spinner to the left of italicized status text. `window.showLocationOverlay(message)` and `window.hideLocationOverlay()` now update this strip instead of showing a blocking backdrop, so normal interface interaction remains available. Request-scoped `chat_status` progress text also uses this strip, replacing the former temporary `AI Game Master` loading bubbles; prompt-excluded result/debug entries such as `check-results`, `tool-call-debug`, and pending `npc-action` still render as chat entries.
- `#playerInputRequestPanel`: non-modal floating panel used by the `requestUserInput` chat tool. The server emits `player_input_request` to the prompt request's `clientId`, so every open tab with that client id shows the same question; posting an answer or cancellation to `/api/chat/user-input-response` closes it across those tabs. The panel has no backdrop, keeps `aria-modal="false"`, does not add `body.modal-open`, sits above the rest of the interface, and can be dragged by its header so the player can inspect other UI before answering.
- Prompt-progress dock (`#promptProgressDock`, rendered in `views/index.njk` between `#chatLog` and `.input-area`, controlled by `public/js/chat.js`):
  - Auto-closes `#loadGameModal` before showing prompt activity.
  - Persists its state in `localStorage` under `airpg:promptProgressDockState`, defaulting to `one-line`.
  - Supports `collapsed` (4px glowing aggregate progress bar), `one-line` (longest-running prompt row), and `table` (full prompt table with sticky header and three visible body rows before vertical scrolling).
  - The dock remains visible when idle; the one-line empty state shows only an italic translucent `no prompts running` label plus mode controls.
  - The one-line state uses the prompt progress fill as the whole row background and shows tightly spaced transparent borderless SVG prompt actions before the prompt name, then received characters, floored approximate percent text such as `~42%`, and right-aligned mode controls. Prompt action icons stay fully bright on hover/active and gain a slight white drop-shadow glow. At non-mobile widths the prompt name uses 60% of the row, renders at font weight 600, and appends `(and N more)` when additional prompts are running.
  - The mode controls use white `assets/material-icons/misc/compress.svg` and `assets/material-icons/misc/expand.svg`: clicking the collapsed bar opens one-line, one-line compress returns to the bar, one-line expand opens the table, and table compress returns to one-line.
  - Completed prompts hold at 100% for 250 ms with a slightly brighter single pulse glow before clearing.
  - Each expanded table row includes progress fraction, received characters, elapsed/timeout/latency, retries, and eye/cancel/retry actions. Target-character, average-output, run-count, and average-rate values remain in the progress payload/stats, but the table does not display `Target`, `Avg Out`, `Runs`, or `Avg/s` columns.
  - Each prompt row includes an eye action that opens a separate floating viewer window with one combined text pane: the full prompt appears first in a differently styled inline span, followed by the live streamed response text, and the viewer header includes a `Copy Prompt` button plus a `Follow` checkbox.
  - The viewer supports header dragging, native resize, and an internal vertical scrollbar when the combined text pane overflows. When `Follow` is checked, the combined prompt/response pane stays scrolled to the bottom as throttled stream updates render.
  - Received-count cells are character based and displayed without a unit label.
- `#npcModalBackdrop`, `#questEditBackdrop`, `#craftingModalBackdrop`, `#salvageIntentBackdrop`:
  shared backdrops used to dim the page for certain modals.

## Quest confirmation (runtime-only)

- Built dynamically in `AIRPGChat.setupQuestConfirmationModal()` (in `public/js/chat.js`).
- Used when the server sends `quest_confirmation_request` via websocket.
- Accept/Decline triggers `/api/quests/confirm`.

## Slash command uploads

- `#slashUploadModal`: reusable file-upload modal opened by slash-command reply actions of type `request_file_upload`.
- Implemented in `public/js/chat.js`; the modal reads selected file text client-side and posts it to `/api/slash-command/upload`.
- Intended for slash commands that need user-supplied files without hardcoding per-command upload UI.

## Empty action confirmation

- `#emptyActionConfirmModal`: opened when the user submits the chat input with no text.
- Confirming resubmits through the normal chat send path with an explicit empty-action flag; cancel/close returns focus to `#messageInput`.
- The matching `/api/chat` request is a normal player-action continuation, but skips plausibility before prompt rendering. The legacy attack precheck/check prompts are disabled globally.

## Quest editing

- `#questEditModal` + `#questEditBackdrop`
- Edits quest name, description, rewards, objectives. Item, faction reputation, and NPC disposition rewards use repeatable row editors; faction rows use faction selectors, and NPC disposition rows use NPC selectors plus disposition-type dropdowns from configured disposition definitions, with existing values preserved when option loading fails or a custom saved type is not in the definitions. NPC disposition reward reasons occupy a full-width second row.
- Save uses `/api/quest/edit`.

## Faction creation

- `#factionCreateModal`: full new-faction form (name/home region/descriptions/tags/goals/assets/relations/reputation tiers).
- Submit path:
  - If fields are missing, calls `/api/factions/fill-missing` to complete blanks.
  - Then posts to `/api/factions` to create the faction.

## NPC views and management

- `#npcInventoryModal`: character inventory listing with filters.
- `#thingContainerModal`: two-column thing-container inventory modal using the shared thing-list renderer for current player inventory and selected container contents; on mobile it becomes a two-row vertical split where player inventory takes the top half and container contents the bottom half. Drag/drop, movement-threshold touch dragging, shift-click, `Add all`, or `Remove all` moves whole stacks, and nested containers reuse the same modal with a breadcrumb/back stack. For single-item drag/drop or shift-click transfers, distinct dragged item moves can process concurrently; the same item and bulk moves remain guarded, and late responses are ignored unless they still target the active container modal session. `Add all`/`Remove all` operate only on the currently visible filtered items in their column, send one bulk API request, and use preflight validation for equipped items and self-containment.
- Location container cards are also direct drop targets: dragging a loose location item, or a current-player inventory item from an inventory-style modal, onto a container card moves that item into the container and highlights the card during hover.
- `#barterModal`: two-column barter interface opened from the trade icon on eligible current-location or party-member NPC cards, after a lightweight `Barter with <name>?` confirmation so expensive stock/pricing prompts do not start accidentally. While the session prompt and stock generation are running, both inventory columns show loading spinners instead of empty-inventory text. The modal reuses the shared thing-list renderer for player sell offers and merchant buyable stock, shows both actors' currency, stages trades by click or drag/drop without moving items until commit, renders item prices as persistent coin badges on item images in every view mode, hides unavailable offers by default behind per-column checkboxes, and commits through `/api/npcs/:id/trade/commit`. Pending source items are darkened in their owner column while pending copies appear highlighted in the receiving column. Shift-click/shift-drag, and all mobile stack transfers, open a quantity modal for stacks. If the merchant cannot cover their owed currency, a confirmation modal can accept the trade for only the merchant's available currency. The haggle row posts free-text offers to `/api/npcs/:id/trade/haggle`, displays the opposed-check result and merchant response, renders haggle history as chat-like boxes with the speaker label above the response text, and reprices the session unless the NPC refuses further trading. Committing a trade closes the modal after the transaction response, refreshes chat history to show the standalone `⚖️ Trade` event-summary block listing items/currency exchanged, and does not wait for the merchant's queued NPC action prompts; being refused after haggling or closing a haggled-but-uncommitted session also concludes the trade and lets the merchant take a normal NPC action.
- `#npcViewModal`: character overview (attributes, skills, faction info, gear, read-only ability cards with active/passive/triggered color coding, status, plus read-only resistances/vulnerabilities text boxes).
  - Attributes/skills now use the shared allocation partials from the New Game UI.
  - Section order now renders Skills, the `Apply Point Changes` action row, and a Faction section above Equipment in the modal body.
  - In NPC view mode, the Faction section shows that NPC's faction name.
  - In player view mode, the Faction section lists all factions with resolved reputation tier labels and tier perks as benefits.
  - Attribute and skill allocation areas no longer use nested internal scrollbars; they inherit the modal body's single scroll container.
  - NPCs render those controls in read-only mode, and the unspent attribute/skill point totals are hidden.
  - Player view mode enables spending unspent attribute/skill points directly in the modal, with live skill-pool previews that include formula deltas from provisional edits (for example, Intelligence bonus effects in the skill pool formula).
  - Player save flow blocks submit on negative pools and prompts confirmation if pools remain positive.
- `#npcDispositionModal`: adjust dispositions.
- `#npcNeedsModal`: adjust need bars.
- `#npcMemoriesModal`: edit important memories.
- `#npcGoalsModal`: edit goals.
- `#npcEditModal`: full NPC edit form (attributes, skills, abilities, status effects, faction membership, resistances, vulnerabilities, and AI notes).
  - Abilities in the edit form include a required short description field, and their name/type fields are color-coded by active/passive/triggered type.
  - NPCs also expose per-character need-bar applicability checkboxes here; unchecked bars are removed for that NPC, and re-enabling them restores the bar at `100`. This section is omitted for the player.
  - NPCs expose a `Willing to trade` checkbox that writes `willingToTrade` through `PUT /api/npcs/:id`.
- `#addNpcModal`: generate and add a new NPC (optional reference image and AI-notes seed).

## Item / scenery editing

- `#thingEditModal`: edit items/scenery (metadata, bonuses, on-hit/equip effects, flags).
  - Includes a short description field directly under the main description.
- `#inventoryTooltip` and `#partyTooltip`: floating tooltips for entity cards.
  - Item tooltips include inflicted status effect durations when available, rendered from canonical minutes as `days/hours/minutes` with zero-value units omitted.
  - Equip status effects only show for equippable items (slots set).
  - Attribute bonuses are hidden for non-equippable items.
  - Hovering an equippable item also stacks additional tooltip cards below it for currently equipped items in compatible slots (player gear in world/location context; viewed actor gear in inventory modal context).
  - Status effect need bar selectors normalize Health and need bar display names to their ids.

## Location and region editing

- `#locationEditModal`: edit location name/description/level/status effects, controlling faction, vehicle fields, and the containing region. Stub descriptions may be left empty, which clears existing stub presentation text. Changing the Region selector saves normal location edits first, then calls `POST /api/locations/:id/relocate` to move the location server-side so `location.regionId` and old/new `Region.locationIds` stay in sync. Pending regions are shown as disabled `unstub first` options. When the selected region differs from the current one, the modal shows a relocation-cleanup section with inbound/outbound direct exits from `GET /api/locations/:id/relocation-options`; selected exits are removed during relocation and a checkbox can make the moved location the target region entrance.
- `#regionEditModal`: edit region name/description/parent/level, controlling faction, and vehicle fields.
  - Both include a short description field directly under the main description.
  - Status-effect duration fields accept shared minute-canonical duration input such as `4 hours, 15 minutes`, `1d11h30m`, or bare minute counts.
  - Both include a shared vehicle editor partial with an `Is Vehicle` checkbox that enables/disables fields, a single-select destination picker, a `Vehicle Exit` select rendered as `inside -> outside`, and a fixed-route destinations picker (add/remove list with live substring suggestions, capped at 10 matches). The destination picker edits the active trip target: `currentDestination` for resolved trips and `pendingDestination` while the vehicle is underway. Unresolved named pending targets still render in the picker even before they resolve to a concrete `locationId`, and region-only pending targets remain intact unless the user explicitly clears or replaces them. Both destination areas also include `New Region` buttons: the active destination button creates a region-only unresolved `pendingDestination`, while the fixed-route button adds a `pending-region:<region name>` route entry that continues to point at that not-yet-generated region name until a timed arrival resolves it. Region edit vehicle-exit options are limited to exits that leave the region.
- `#regionWeatherEditModal`: edit the current location's containing region weather definition from the location context menu.
- `#calendarEditModal`: tabbed field editor for the active `calendarDefinition`, opened from the location/map context menus. It loads `/api/calendar`, edits year name plus ordered months, weekdays, seasons/time descriptions, and holidays, saves through `PUT /api/calendar`, and displays validation failures from the server without mutating the calendar.
- `#setLastSeenModal`: opened from the main-location and map location context menus. It prompts for the same exact-time (`H AM/PM` or `H:MM AM/PM`) or relative (`duration ago`) input supported by `/set_last_seen`, displays the selected location label, and submits by calling the existing slash-command execution path instead of duplicating client-side parsing.
- `#newExitModal`: create or edit exits (new region/location, existing location, or an existing pending region's entrance, with editable travel time and optional image for new stubs). User-entered names for new locations/regions are validated server-side before creation; duplicate existing/pending world names, banned name fragments, and slop words return an alert and do not create a stub or exit.
- Summon NPC/item now reuse the shared searchable chooser modal (`.npc-selection-modal`) instead of dedicated `<select>`-based forms.
  - `Summon NPC` filters existing NPCs by name/location and executes immediately on row click.
  - `Summon Item or Scenery` filters existing thing records by name/type/origin label (including inventory origins like `Bob's inventory`) and executes immediately on row click.
  - The same chooser implementation is also reused by teleport and `Put in Inventory` target selection, so all three flows share the same typeahead-without-`select` behavior through the shared `window.showSearchSelectionModal(...)` helper.

## Crafting / processing

- `#craftingModal`: drag-and-drop crafting UI for craft/process and `Modify Location`; craft and process show an available-items/scenery picker that combines active player inventory with current-location items and scenery plus item contents inside current-location containers, including contents of scenery containers while nested container contents remain item-only. `Modify Location` still uses optional selected player-inventory materials/tools. Craft, process, and location modification submits may run with no selected slot inputs when the player is relying on the station, location, abilities, or notes.
- `#salvageIntentModal`: optional prompt before salvage; salvage and harvest still require exactly one target item.

## Save/load

- `#loadGameModal`: choose manual or autosave and load.
  - Uses elevated z-order above all other overlays while open.
  - When the elevated load backdrop is active, any visible `.modal` is forced above it to prevent blur-layer occlusion of dialogs.
  - Confirm closes the modal immediately, then sends `/api/prompts/cancel-all` before `/api/load`.

## Player level-up ability draft

- `#playerAbilitySelectionModal`: player-only blocking modal used when one or more levels are missing required abilities.
  - Ability names and uppercase type labels use the shared active/passive/triggered color coding.
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
- `public/js/chat.js` owns the runtime-only quest confirmation modal and the shared slash upload modal flow.
- LLM prompt modals (`#addNpcModal`, `#thingEditModal` create mode, `#newExitModal`, `#craftingModal`, `#salvageIntentModal`) close immediately on submit; no visible waiting state is shown, and errors surface via `alert()` after closing. Add NPC and Create Item/Create Scenery allow additional submissions while earlier prompts are still running. In Create Item/Create Scenery mode, `#thingEditSlot` labels its empty slot value as `Not specified`; selecting it leaves the generated seed's slot unset.
