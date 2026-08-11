# Modals and Overlays (Chat UI)

Most modals live in `views/index.njk` and are wired up by the inline script or `public/js/chat.js`.

## Keyboard submission

- `public/js/modal-submit-shortcuts.js`, loaded by the shared head include on every application page, provides one delegated modal submission shortcut.
- Pressing Ctrl+Enter or Cmd+Enter in an editable modal control submits its nearest form through `requestSubmit()`, preserving native validation and the form's submit handler.
- Non-form data-entry modals declare their intended action with `data-ctrl-enter-submit`; this covers workflows such as fast travel, region repair, file uploads, crafting/salvage intent, NPC memories/goals, load game, world-profile auto-fill guidance, model addition, and chat-message editing.
- Search and inventory-filter controls without a form or explicit action remain non-submitting. In the barter modal, only the haggle field maps the shortcut to `Haggle`; filter fields never trigger `Commit Trade`.
- A disabled submit/action button leaves the shortcut inactive.

## Global overlays and status

- `#chatSpinnerStatusBar`: non-modal inline status strip rendered in the chat column between `#promptProgressDock` and `.input-area`. It is hidden when idle, displays status text with a small spinner to the left of italicized text, and is controlled by `window.showLocationOverlay(message)` / `window.hideLocationOverlay()`. Normal interface interaction stays available while it is visible. Request-scoped `chat_status` progress text uses this strip; prompt-excluded result/debug entries such as `check-results`, `tool-call-debug`, and pending `npc-action` render as chat entries.
- Automatic post-turn summary failures arrive as targeted `summary_error` realtime messages. The chat client displays a blocking browser alert headed `Automatic summary failed` with the server stack trace. This event is separate from `chat_error`, so reporting a background failure does not alter the completed foreground chat request's lifecycle.
- `.comfy-cache-monitor-warning`: blocking warning modal shown when post-render Cache Monitor VRAM release fails and the server falls back to full ComfyUI `/free` cleanup. It recommends installing or enabling the `comfyui-cache-monitor` custom nodes and explains that the fallback discards the system-RAM model cache. Its `Don't show this warning again on this browser` checkbox stores `airpg:hideComfyCacheMonitorFallbackWarning=true` in localStorage when the popup is dismissed, so the preference is browser-local and independent of saves and server configuration.
- `#playerInputRequestPanel`: non-modal floating panel used by the `requestUserInput` chat tool, confirmation-mode destructive chat-tool prompts such as `deleteThing`, and integer-mode forced skill-check rolls requested by `<f>` in action text. The server emits `player_input_request` to the prompt request's `clientId`, so every open tab with that client id shows the same question, confirmation, or roll request; posting an answer, confirmation, or cancellation to `/api/chat/user-input-response` closes it across those tabs. Multi-line questions render as separate readable lines, with simple `Label: value` lines emphasized. In confirmation mode the answer textarea/label are hidden and the server-supplied confirm/cancel labels are used. In integer mode the label changes to `Roll`, the textarea is replaced by a single-line numeric input, client and server validation require an integer, and invalid input leaves the panel open with an error. The panel has no backdrop, keeps `aria-modal="false"`, does not add `body.modal-open`, sits above the rest of the interface, and can be dragged by its header so the player can inspect other UI before answering.
- Prompt-progress dock (`#promptProgressDock`, rendered in `views/index.njk` between `#chatLog` and `.input-area`, controlled by `public/js/chat.js`):
  - Does not close `#loadGameModal` while prompt progress updates render, so load/save workflows stay open during ticking prompt updates.
  - Persists its state in `localStorage` under `airpg:promptProgressDockState`, defaulting to `one-line`.
  - Supports `collapsed` (4px glowing aggregate progress bar), `one-line` (longest-running prompt row), and `table` (full prompt table with sticky header and three visible body rows before vertical scrolling).
  - The dock is visible when idle; the one-line empty state shows only an italic translucent `no prompts running` label plus mode controls.
  - The one-line state uses the prompt progress fill as the whole row background and shows tightly spaced transparent borderless SVG prompt actions before the prompt name, then received characters, floored approximate percent text such as `~42%`, and right-aligned mode controls. Prompt action icons stay fully bright on hover/active and gain a slight white drop-shadow glow. At non-mobile widths the prompt name uses 60% of the row, renders at font weight 600, and appends `(and N more)` when additional prompts are running.
  - The mode controls use white `assets/material-icons/misc/compress.svg` and `assets/material-icons/misc/expand.svg`: clicking the collapsed bar opens one-line, one-line compress returns to the bar, one-line expand opens the table, and table compress returns to one-line.
  - Completed ordinary prompts hold at 100% for 250 ms with a slightly brighter single pulse glow before clearing. Every `TinyBrainPromptRunner` program, including player actions and event checks, reuses one stable row and prompt id while accumulating decoded-character received counts against one fixed whole-run expected target. It uses the ordinary curve—75% at the expected total, then asymptotically approaching 100%—and remains unchanged when the next stage starts because neither accumulated output nor the target resets. Between model requests, that row stays blue at its current fraction and continues to show the accumulated character count and percentage; it returns to normal progress coloring when the next stage begins. Retry/cancel are disabled during the blue no-request gap, while view remains available. The final group clear uses the ordinary 100% completion pulse.
  - Each expanded table row includes progress fraction, received characters, elapsed/timeout/latency, retries, and eye/cancel/retry actions. Target-character, average-output, run-count, and average-rate values are present in the progress payload/stats, but the table does not display `Target`, `Avg Out`, `Runs`, or `Avg/s` columns.
  - Each prompt row includes an eye action that opens a new modeless floating viewer window with one combined text pane: the full prompt is amber, the live streamed response is cyan, and parse-failed response text is retained in order in red. Request messages are labeled and shown chronologically, so staged prompts keep each prior assistant response before the user checkpoint that follows it instead of grouping all assistant responses at the end. Model names longer than 10 characters use the first 10 characters plus `...` in both the tracker table and viewer subtitle, with the full identifier retained as hover text. The viewer header includes a `Copy Prompt` button plus a `Follow` checkbox, which is checked by default when a viewer opens.
  - Prompt viewers use `role="dialog"` with `aria-modal="false"`, have no backdrop, and do not add `body.modal-open`, so the rest of the interface stays interactive. Multiple viewers can be open at once; each keeps its last prompt/response snapshot after the prompt leaves the live tracker and stays open until its own close button is clicked. Completed progress entries bypass the normal 500 ms render throttle, ensuring the viewer captures the final streamed token before the 250 ms completion clear. Sequential requests sharing a `progressGroupId`, as TinyBrain checkpoints do, now reuse the same stream-progress id; the group lookup remains supported for compatibility and keeps an opened viewer attached throughout the run.
  - Each viewer supports header dragging, native resize, and an internal vertical scrollbar when the combined text pane overflows. When `Follow` is checked, that viewer's combined prompt/response pane stays scrolled to the bottom as throttled stream updates render.
  - Received-count cells are character based and displayed without a unit label.
- Modal prompt-progress bar (`.modal__prompt-progress`, injected by `public/js/chat.js`): while any prompt is running, a thin (4px) glowing aggregate progress bar is pinned across the bottom of every open `.modal[aria-hidden="false"] .modal__dialog`, mirroring the dock's `collapsed` aggregate fraction so a modal waiting on the LLM shows the same progress signal as the chat screen. When every remaining entry is a TinyBrain inter-stage waiting entry, the modal aggregate is blue while retaining the entries' cumulative aggregate fraction. The bar is injected as the last flex child of the dialog (no per-modal markup) by `updateModalPromptProgressBars()`, refreshed on every progress render tick, and removed when no prompt is active. A `MutationObserver` on `aria-hidden`/`hidden` toggles adds the bar to a modal that opens mid-prompt. The fill reuses `getPromptProgressAggregateFraction()`.
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

## Entity image upload

- `#entityImageUploadModal`: reusable image upload modal opened from `Upload Image` context menu actions on locations, things, NPCs, and the player. It accepts PNG, JPEG, WebP, and GIF files, previews the selected file, posts its data URL to `/api/images/upload`, and replaces the target entity's current `imageId` with the returned upload image.
- Location uploads clear client-side weather/lighting variant display cache for that location so cached variants do not cover the uploaded base image.

## Editable image regeneration prompt

- `#entityImagePromptModal`: reusable prompt-edit modal opened from `Regenerate Image +` context menu actions on locations, things, NPCs, and the player. The client first posts the entity target to `/api/images/prompt`; the returned final prefixed prompt is placed in a white-text textarea with a translucent black-tint background for editing. The current image is not cleared during this prompt-generation phase.
- Submitting the modal posts the edited prompt to `/api/images/request` with `force: true`. After the request is accepted, the same placeholder/cache refresh paths used by immediate regeneration run for the target entity.

## Empty action confirmation

- `#emptyActionConfirmModal`: opened when the user submits the chat input with no text.
- Confirming resubmits through the normal chat send path with an explicit empty-action flag; cancel/close returns focus to `#messageInput`.
- The matching `/api/chat` request is a normal player-action continuation. Empty action text skips plausibility before prompt rendering and uses the player-action prompt branch for advancing the scene without player text.

## Quest editing

- `#questEditModal` + `#questEditBackdrop`
- Edits quest name, quest giver display name, paused/reward-claimed flags, description, secret notes, rewards, and objectives. The quest giver field is free text with current NPC names offered through a datalist. Item, faction reputation, and NPC disposition rewards use repeatable row editors; faction rows use faction selectors, and NPC disposition rows use NPC selectors plus disposition-type dropdowns from configured disposition definitions, with existing values preserved when option loading fails or a custom saved type is not in the definitions. NPC disposition reward reasons occupy a full-width second row.
- Save uses `/api/quest/edit`.

## Faction creation

- `#factionCreateModal`: full new-faction form (name/home region/descriptions/tags/goals/assets/relations/reputation tiers).
- Submit path:
  - If fields are missing, calls `/api/factions/fill-missing` to complete blanks.
  - Then posts to `/api/factions` to create the faction.

## NPC views and management

- `#npcInventoryModal`: character inventory listing with filters.
- `#containerOpenCheckModal`: blocking pre-open prompt for containers with `requiresCheckToOpen: true`. It asks the player to describe how they try to open the container, posts the attempt to `/api/things/:id/container/open-check`, shows an in-modal progress/status line while the prompt resolves, and opens `#thingContainerModal` only when the response reports `opened: true`. When the server response also reports `permanentlyOpened: true`, the returned container has `requiresCheckToOpen: false` so future opens skip this modal. The resulting prose is written to visible chat and event-checked by the server before the UI refreshes chat history.
- `#thingContainerModal`: two-column thing-container inventory modal using the shared thing-list renderer for current player inventory and selected container contents; on mobile it becomes a two-row vertical split where player inventory takes the top half and container contents the bottom half. Opening a container with unhydrated `containerContents` seeds shows a vendor-style loading spinner and `Container contents are being generated...` in the contents column until `GET /api/things/:id/container` returns, so the normal empty text is reserved for a loaded empty container. Containers with `requiresCheckToOpen: true` are routed through `#containerOpenCheckModal` before this inventory modal is shown. Drag/drop, movement-threshold touch dragging, shift-clicking any non-control card area including the item image, `Add all`, or `Remove all` moves whole stacks, and nested containers reuse the same modal with a breadcrumb/back stack. Dragging an item out of either column drops it into the current location through the normal item drop route, detaching container contents from the open container first. For single-item drag/drop or shift-click transfers, distinct dragged item moves can process concurrently; same-item and bulk moves are guarded, and late responses are ignored unless they target the active container modal session. `Add all`/`Remove all` operate only on the currently visible filtered items in their column, send one bulk API request, and use preflight validation for equipped items and self-containment. Successful prompt-free transfers refresh chat history after the server records a visible `container-transfer` story entry such as `Baato put Flare into Cargo Crate.` or `Baato retrieved Flare from Cargo Crate.`, and those entries are available to base-context history.
- `#moduleWorkbenchModal`: opened from the bundled modules mod's upper-left `modular.svg` badge on module-compatible items. It shows loose module items from the owner inventory and the current location in the inventory column without visible source chips, greys out modules that cannot fit any open slot on the selected base item, highlights only compatible slots during drag, and supports installing modules into empty slots or removing installed modules from occupied slots. Installing across inventory/location sources transfers the module to the base item's holder. The badge itself displays occupied/total slots in its upper-right corner, for example `1/3`.
- Location container cards are also direct drop targets: dragging a loose location item, or a current-player inventory item from an inventory-style modal, onto a container card moves that item into the container and highlights the card during hover.
- `#barterModal`: two-column barter interface opened from the trade icon on eligible current-location or party-member NPC cards, after a lightweight `Barter with <name>?` confirmation so expensive stock/pricing prompts do not start accidentally. While the session prompt and stock generation are running, both inventory columns show loading spinners and hide empty-inventory text. The modal reuses the shared thing-list renderer for player sell offers and merchant buyable stock, shows both actors' currency, stages trades by click or drag/drop without moving items until commit, renders item prices as persistent coin badges on item images in every view mode, hides unavailable offers by default behind per-column checkboxes, and commits through `/api/npcs/:id/trade/commit`. Pending source items are darkened in their owner column while pending copies appear highlighted in the receiving column. Shift-click/shift-drag, and all mobile stack transfers, open a quantity modal for stacks. If the merchant cannot cover their owed currency, a confirmation modal can accept the trade for only the merchant's available currency. The haggle row posts free-text offers to `/api/npcs/:id/trade/haggle`, displays the opposed-check result and merchant response, renders haggle history as chat-like boxes with the speaker label above the response text, and reprices the session unless the NPC refuses further trading. Committing a trade closes the modal after the transaction response, refreshes chat history to show the standalone `⚖️ Trade` event-summary block listing items/currency exchanged, and processes the merchant's queued NPC action payload separately; being refused after haggling or closing a haggled-but-uncommitted session also concludes the trade and lets the merchant take a normal NPC action.
- `#playerAbilitiesModal`: player-only ability picker opened from the chat sidebar Abilities button or the `A` hotkey. It fetches fresh `/api/player` data through the same sidebar refresh path as View/Inventory, uses `aria-modal="false"`, does not show `#npcModalBackdrop`, and does not add `body.modal-open`, so the page is not blurred. Abilities render alphabetically by name as clickable `.npc-view-ability-card` entries matching the View modal format; clicking one inserts `[Ability Name]` at the current cursor/selection in `#messageInput`.
- `#playerSkillsModal`: player-only skill picker opened from the chat sidebar Skills button or the `S` hotkey. It fetches fresh `/api/player` data through the same sidebar refresh path as View/Inventory, uses `aria-modal="false"`, does not show `#npcModalBackdrop`, and does not add `body.modal-open`, so the page is not blurred. Skills render as clickable `.skill-card` entries matching the View modal rank-card format, ordered by rank and then alphabetically by name; clicking one inserts `[Skill Name]` at the current cursor/selection in `#messageInput`.
- `#npcViewModal`: character overview (attributes, skills, faction info, gear, alphabetized read-only ability cards with active/passive/triggered color coding, status, plus read-only resistances/vulnerabilities text boxes).
  - The Attributes section starts with a read-only Calculated Attributes grid sourced from detailed `attributeInfo`, showing each attribute after equipment, status, and mod bonuses; values render green when above base, red when below base, and white when unchanged.
  - Base attributes and skills use the shared allocation partials from the New Game UI.
  - Section order is Skills, the `Apply Point Changes` action row, and a Faction section above Equipment in the modal body.
  - In NPC view mode, the Faction section shows that NPC's faction name.
  - In player view mode, the Faction section lists all factions with resolved reputation tier labels and tier perks as benefits.
  - Attribute and skill allocation areas use the modal body's single scroll container.
  - NPCs render those controls in read-only mode, with visible server-derived unspent attribute/skill point totals.
  - Player view mode enables spending unspent attribute/skill points directly in the modal, with live skill-pool previews that include formula deltas from provisional edits (for example, Intelligence bonus effects in the skill pool formula).
  - Player save flow blocks submit on negative pools and prompts confirmation if positive pools are left.
- `#npcDispositionModal`: adjust dispositions.
- `#npcNeedsModal`: compact need-bar value editor with one icon/name, colored slider, and numeric input row per active need.
- `#npcMemoriesModal`: edit important memories.
- `#npcGoalsModal`: edit goals.
- `#npcEditModal`: full NPC edit form (attributes, skills, abilities, status effects, faction membership, resistances, vulnerabilities, and AI notes).
  - The shared player/NPC editor includes the persisted final `imagePrompt` field.
  - Abilities in the edit form are alphabetized by name, include a required short description field, and have name/type fields color-coded by active/passive/triggered type.
  - NPCs also expose per-character need-bar applicability checkboxes here; unchecked bars are removed for that NPC, and re-enabling them restores the bar at `100`. This section is omitted for the player.
  - NPCs expose a `Willing to trade` checkbox that writes `willingToTrade` through `PUT /api/npcs/:id`.
- `#addNpcModal`: generate and add a new NPC (optional reference image and AI-notes seed).

## Item / scenery editing

- `#thingEditModal`: edit items/scenery (metadata, bonuses, on-hit/equip effects, flags).
  - Includes a short description field directly under the main description.
  - Edit mode includes `imagePrompt`; create mode hides it and leaves new Things blank.
- `#thingStackCombinerModal`: AI-backed item stack combiner wizard opened from real item-holder list headers. It shows one suggested same-quality group at a time, renders each stack with its image/count badge and the standard item hover tooltip, lets clicking a stack choose the keeper, and provides Back, Clear Selection, Cancel, and Next/Skip/Finish controls. Finishing submits selected groups to `/api/things/combine-stacks`; skipped groups are left unchanged.
- `#inventoryTooltip` and `#partyTooltip`: floating tooltips for entity cards.
  - Item tooltips include inflicted status effect durations when available, rendered from canonical minutes as `days/hours/minutes` with zero-value units omitted.
  - Item tooltips show attribute bonuses and equipper status effects whenever those fields are present, including items installed through mod systems that do not use normal equipment slots.
  - Hovering an equippable item also stacks additional tooltip cards below it for currently equipped items in compatible slots (player gear in world/location context; viewed actor gear in inventory modal context).
  - Status effect need bar selectors normalize Health and need bar display names to their ids.

## Location and region editing

- `#locationRegionFixerModal`: blocking movement repair modal shown when preflight or `/api/player/move` reports `code: "location_region_membership_conflict"`. It displays the affected location as `name (id)`, lists each containing region as `name (id)`, posts the selected region to `/api/location-region-membership-conflicts/:locationId/resolve`, then resumes the original movement flow after the duplicate memberships are removed.
- `#locationEditModal`: edit location name/description/level/status effects, controlling faction, vehicle fields, and the containing region. Location and region stubs load and display their short descriptions from the location presentation field or stub metadata, and save long and short descriptions independently through `PUT /api/stubs/:id`. Stub descriptions and stub short descriptions may be left empty to clear their respective presentation text. Changing the Region selector for a hydrated location saves normal location edits first, then calls `POST /api/locations/:id/relocate` to move the location server-side so `location.regionId` and the source/destination `Region.locationIds` stay in sync. Pending regions are shown as disabled `unstub first` options for hydrated locations. Ordinary location stubs also show the Region selector and save it through `PUT /api/stubs/:id` as `targetRegionId`, allowing live or pending-region ownership changes without exit cleanup; region-entry stubs keep the selector hidden because their target region is their identity. When a hydrated selected region differs from the current one, the modal shows a relocation-cleanup section with inbound/outbound direct exits from `GET /api/locations/:id/relocation-options`; selected exits are removed during relocation and a checkbox can make the moved location the target region entrance.
  - Hydrated locations include editable `imagePrompt`; stub mode hides it and keeps the field blank.
- `#regionEditModal`: edit region name/description/parent/level, controlling faction, and vehicle fields.
  - Both include a short description field directly under the main description.
  - Status-effect duration fields accept shared minute-canonical duration input such as `4 hours, 15 minutes`, `1d11h30m`, or bare minute counts.
  - Both include a shared vehicle editor partial with an `Is Vehicle` checkbox that enables/disables fields, a single-select destination picker, a `Vehicle Exit` select rendered as `inside -> outside`, and a fixed-route destinations picker (add/remove list with live substring suggestions, capped at 10 matches). The destination picker edits the active trip target: `currentDestination` for resolved trips and `pendingDestination` while the vehicle is underway. Unresolved named pending targets render in the picker before they resolve to a concrete `locationId`, and region-only pending targets are preserved unless the user explicitly clears or replaces them. Both destination areas also include `New Region` buttons: the active destination button creates a region-only unresolved `pendingDestination`, while the fixed-route button adds a `pending-region:<region name>` route entry that points at that not-yet-generated region name until a timed arrival resolves it. Region edit vehicle-exit options are limited to exits that leave the region.
- `#regionWeatherEditModal`: edit the current location's containing region weather definition from the location context menu.
- `#calendarEditModal`: tabbed field editor for the active `calendarDefinition`, opened from the location/map context menus. It loads `/api/calendar`, edits year name plus ordered months, weekdays, seasons/time descriptions, and holidays, saves through `PUT /api/calendar`, and displays validation failures from the server without mutating the calendar.
- `#setLastSeenModal`: opened from the main-location and map location context menus. It prompts for the same exact-time (`H AM/PM` or `H:MM AM/PM`) or relative (`duration ago`) input supported by `/set_last_seen`, displays the selected location label, and submits through the shared slash-command execution path.
- `#mapFastTravelConfirmModal`: active modal for prompt-backed fast-travel confirmation. Region Map, World Map, and Favorites open it after previewing route time, leave the action textarea blank by default, switch to Adventure when Travel is accepted, then dispatch `/api/chat` before teleporting with travel-time accounting. Character-menu story-tool teleports bypass it.
- `#newExitModal`: create or edit exits (new region/location, existing location, or an existing pending region's entrance, with editable travel time and optional image for new stubs). Exit edit mode exposes `imagePrompt`; create mode hides it so newly created exits remain blank until their image path needs a prompt. User-entered names for new locations/regions are validated server-side before creation; duplicate existing/pending world names, banned name fragments, and slop words return an alert and do not create a stub or exit.
- Summon NPC/item use the shared searchable chooser modal (`.npc-selection-modal`).
  - `Summon NPC` filters existing NPCs by name/location and executes immediately on row click.
  - `Summon Item or Scenery` filters existing thing records by name/type/origin label (including inventory origins like `Bob's inventory`) and executes immediately on row click.
  - Teleport and `Put in Inventory` target selection use the same chooser implementation, so these flows share the same typeahead-without-`select` behavior through the shared `window.showSearchSelectionModal(...)` helper.

## Crafting / processing

- `#craftingModal`: drag-and-drop crafting UI for craft/process and `Modify Location`; craft and process show an available-items/scenery picker that combines active player inventory with current-location items and scenery plus item contents inside current-location containers, including scenery-container contents; nested container contents are item-only. `Modify Location` uses optional selected player-inventory materials/tools. Craft, process, and location modification submits may run with no selected slot inputs when the player is relying on the station, location, abilities, or notes. Dragging an equipped player item into a slot asks whether to unequip it before assignment, then assigns the item only after the normal unequip request succeeds. On touch devices, touch release over a crafting slot assigns the dragged input through the same validation path as desktop drag/drop. Multiple crafting slots stay in a two-column grid on mobile. Ctrl/Cmd+Enter in the notes textarea triggers the primary prose submit button.
- `#salvageIntentModal`: optional prompt before salvage; salvage and harvest require exactly one target item. Ctrl/Cmd+Enter in the intent textarea triggers the primary prose submit button.

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
- Renders card options alphabetically by name for one level at a time and requires exactly `player_abilities_per_level` selections.
- Existing level abilities appear preselected and toggleable; generated options fill up to `player_ability_options_per_level`.
- Each option card includes an upper-right square `👎` toggle. Selecting an option clears its declined state, and declining an option clears its selected state before submit.
- Ability descriptions sit on a full-width row below the name/type row.
- Submit button is horizontally centered with `1.5em` bottom spacing.
- Submit advances to the next missing level (if any) and keeps gameplay blocked until all missing levels are filled.

## Image lightbox

- `#imageLightbox`: full-screen image viewer bound by `public/js/lightbox.js`. It supports image-only content and thing-detail sidecar content. Clicking the media pane, details pane, or transparent backdrop closes the viewer; any keypress also dismisses it.

## Notes

- Most modals are toggled via `hidden` + `aria-hidden`.
- The inline script in `views/index.njk` contains the open/close logic and field wiring.
- `public/js/chat.js` owns the runtime-only quest confirmation modal and the shared slash upload modal flow.
- LLM prompt modals (`#addNpcModal`, `#thingEditModal` create mode, `#newExitModal`, `#craftingModal`, `#salvageIntentModal`) close immediately on submit; no visible waiting state is shown, and errors surface via `alert()` after closing. Add NPC and Create Item/Create Scenery allow additional submissions while prior prompts are running. In Create Item/Create Scenery mode, `#thingEditType` and `#thingEditSlot` label their empty values as `Not specified`; selecting them leaves the generated seed's item/scenery type or slot unset.
