# Play Interface (views/index.njk)

The main UI is rendered by `views/index.njk` and powered by `public/js/chat.js` plus a large inline script block inside the template.

## Layout and tabs

- Tab bar controls panels with ids `tab-adventure`, `tab-map`, `tab-world-map`, `tab-character`, `tab-quests`, `tab-factions`, `tab-party`, `tab-story-tools`.
- The tab bar now uses icon-only buttons sourced from `assets/material-icons/game-tab-icons/`, with `story_tools.svg` assigned to the Story Tools tab and accessible tab names preserved via `aria-label`/`title`.
- On mobile (`max-width: 768px`), the tab bar itself (`.tab-bar`) still scrolls horizontally with nowrap tab buttons so the icon strip remains usable without wrapping.
- `initTabs()` in `views/index.njk` handles tab switching and updates `window.location.hash` as `#tab-{name}`.
- Tab activation triggers:
  - `map` -> `window.loadRegionMap()`.
  - `world-map` -> `window.loadWorldMap()`.
  - `party` -> `window.refreshParty()`.
  - `story-tools` -> `window.refreshStoryTools({ preserveSelection: true })`.
  - `factions` -> `window.refreshFactions()`.
  - Hidden tab panels explicitly override any display styles so inactive tabs never render, even when they define their own flex layouts.

## Adventure tab structure

- **Location panel** (`.location-block`):
  - Compact world-time chip at the top (`#worldTimeIndicator`) showing `h:MM AM/PM`, date label, and segment/season.
  - On desktop, a vertical drag handle on the panel's right edge resizes the location column horizontally. Width preferences are stored in browser `localStorage` and clamped so the chat column remains usable; double-click, `Home`, or `Escape` resets the panel to its default width.
  - On narrow/mobile layouts, the Adventure stack now drops the desktop fixed-height panel chain so the location column and sidebar size to content instead of keeping their own nested vertical scroll areas.
  - The location-name prefix icon (`#locationNameIcon`) switches from map pin (`📍`) to a vehicle icon when the current location is a vehicle or its containing region is a vehicle; it prefers `vehicleInfo.icon` and falls back to `🚗`.
  - When in a vehicle context and the vehicle is not underway, a second header line renders under the location name as `Current location: <name>` using the active vehicle exit destination.
  - When in a vehicle context and the vehicle is underway, that header block instead renders `Enroute to <destination>`, a smaller `X days, Y hours, Z minutes to arrival` countdown line (omitting zero-value units), and a black/red progress bar with the vehicle icon positioned at the current trip progress point.
  - When in a vehicle context and the outside location has an image, a lower-right picture-in-picture overlay (`#locationVehiclePip`) renders over the main location image at 30% size, `16:9` aspect ratio, with 3% right/bottom margin.
  - When the containing region is a vehicle, the header name is rendered as `<vehicle region>: <location>` (example: `Starship Enterprise: Captain's Quarters`).
  - Image + context menu for edit/summon/regenerate, plus `Edit Weather` for the containing region, `Edit Calendar` for the active game calendar, and `Set Last Seen`, which opens a modal for the same `H AM/PM`, `H:MM AM/PM`, or `duration ago` input accepted by `/set_last_seen` and then executes that slash command for the selected location.
  - The main location edit modal includes a `Local Weather` selector that writes `generationHints.hasWeather` as automatic, weather-exposed, weather-visible-outside, or sheltered/no local weather. Changing this hint clears cached weather/lighting display variants while leaving the base location image intact.
  - `Edit Weather` opens a region-weather modal that loads `/api/regions/:id`, edits the region's dynamic weather definition, and saves through `PUT /api/regions/:id`. The modal can disable dynamic weather or edit per-season weather types with name, description, relative frequency, and duration range fields.
  - `Edit Calendar` opens a tabbed field editor backed by `GET /api/calendar` and `PUT /api/calendar`. The modal edits year name, ordered months, ordered weekdays, seasons with light-level time descriptions, and holidays; saving validates and normalizes the full calendar object server-side, refreshes the world-time chip, and reloads the current location so date/season/light-level effects are visible.
  - When image generation is enabled and the current location has a base `imageId`, the renderer requests `/api/images/location-variant/request` for the current lighting/weather display variant. During ordinary UI refreshes, a session display cache keyed by `locationId + sourceImageId` keeps the last valid variant on the visible location image and Adventure background while the server confirms the current condition key, avoiding a base-image flash. Cached variants or completed realtime jobs replace only the visible location image and Adventure background; `lastRenderedLocation.imageId` remains the base image id so edit/regenerate actions keep targeting the authoritative location image.
  - `Modify Location` appears directly under the location image/level area and uses the same current-location enable/disable lifecycle as `Craft Item` and `Craft Scenery`.
  - `Modify Location` opens the shared crafting modal in `modify-location` mode, with four optional player-inventory material/tool slots, notes for the attempted location change, inline `<N>` roll override support, and `Modify Location` / `Modify Location (no prose)` submits. It can be submitted with no selected materials/tools; server outcomes may consume selected inputs and may grant newly uncovered portable byproduct items, but preserved tools/materials are not re-granted as received items.
  - On mobile (`max-width: 768px`), item/NPC/location tooltips are constrained to `80vw` for readability.
  - Equippable item tooltips include stacked comparison cards for currently equipped compatible-slot items (using the active actor context).
  - On touch/coarse-pointer devices, tapping any entity `•••` context-menu button temporarily suppresses floating tooltips so the menu remains reachable.
  - Clicking/tapping a thing image now opens a combined lightbox: the item image on the left and the full tooltip content on the right, reusing the same stacked compatible-equipped comparison cards shown on hover for equippable items. On wider screens the image column is capped to the left `67%` of the viewport and the tooltip pane is vertically centered without stretching to the full viewer height; if the tooltip content is too tall, that desktop tooltip pane scrolls vertically on its own. Mobile switches to a vertical layout with a scrollable viewer instead of adding a second inner tooltip scrollbar. Clicking/tapping either the image pane or the tooltip pane dismisses the viewer.
  - `Summon NPC`, `Summon Item or Scenery`, `Teleport`, and item `Put in Inventory` target selection now all reuse the same searchable chooser pattern: a filter input over a clickable result list, with no native `<select>` widget.
  - Exits list + "New Exit" button.
  - Exit button labels append the stored travel time in compact form, for example `North Hall (1h10m)`.
  - Exits whose destination is a vehicle render a left-side vehicle icon on the travel button, using the destination vehicle's `vehicleInfo.icon` and falling back to `🚗` when icon metadata is missing.
  - Vehicle exits that leave a vehicle context render with a left-side `⬅️` icon and an `Exit Vehicle: <destination>` label.
  - Non-vehicle exit traversal applies the exit's stored `travelTimeMinutes` to world time on success; event-driven traversal uses that mechanical exit time instead of a duplicate LLM-authored `time_passed`. Event-applied player/party movement that is not already covered by exit travel uses the shortest directed location route time, or `1` minute when no route exists.
  - Compact location item/scenery filter popovers temporarily raise their owning panel above neighboring content so overlapping titles or card text do not paint over the open popup.
  - Unexplored region exit labels are destination-driven: vehicle destinations render as `Unexplored huge vehicle: <region>`, while non-vehicle destinations render as `Unexplored Region: <region>`; if the exit itself is marked vehicle to a non-vehicle destination, the label renders as `<vehicleType> to unexplored region: <region>`.
  - When move plausibility is configured for `unexplored_locations`, exit-button travel uses the chat/event-move path for unresolved region-entry exits and for expanded destination locations whose exit payload reports `destinationVisited === false`; merely being expanded no longer makes a location count as explored.
  - `exit.isVehicle`/`exit.vehicleType` are treated as edge metadata only and must not be used to infer that the destination location/region is itself a vehicle.
  - NPC list + "Add NPC" button.
  - NPC and party-member card health bars sit just below the portrait image so they do not overlap the in-portrait need bars.
  - Character-card and player-card health bars now show a centered outlined `current/max` readout directly above the bar itself; readout values are rounded upward for display while bar fill still uses raw health, and the player sidebar no longer repeats a separate `HP:` text row below the portrait metadata.
  - Player, location-NPC, sidebar-party, and Party-tab portraits now show a top-left bare `L.<level>` text badge on the image itself instead of repeating the level in separate text rows.
  - Dead NPC/party cards show a skull icon plus corpse countdown under the top-left `L.<level>` badge when `corpseCountdown` is numeric; persistent corpses (`persistWhenDead`) omit the countdown text.
  - Alive player/NPC/party portraits that have status effects with negative `Health` need-bar deltas show a red blood indicator in that same level-stack slot with the summed per-round health loss, and dead actors suppress that live-drain indicator.
  - Items/Scenery grids + "Craft" and "New Item/Scenery" buttons.
  - Thing cards render a lower-right thumbnail count badge from persisted `thing.count`; item cards always show it, while scenery cards suppress the badge when the count is `1`.
  - Location item/scenery sections now use the same inventory-style thing-list renderer and search/slot-filter pipeline as the player/NPC inventory modal and crafting inventory. All four shared panels now expose a shared three-control header: a view popup, a sort popup, and the icon-only filter popup. View state is tracked per panel on the current player record, so changing one panel to `Table` or `Grid` does not affect the others, survives rerenders, persists across page reloads, and is serialized into saves. The default shared panel view is `Grid` until overridden by those saved per-panel preferences.
  - Shared thing-list view modes:
    - `Classic` keeps the existing card layout.
    - `Table` renders as a real HTML table with draggable `<tr>` rows, a half-height shared image cell and row height derived from the base icon size, a left-aligned vertically centered rarity-colored item name cell, collapsed 2px cell borders, inline action icons (craft/process/salvage/harvest) in the utilities cell, and the `•••` context-menu button anchored in the upper-right corner of the name cell. Player/NPC inventory and crafting tables also add a header row (blank icon header plus `Title`, `Level`, `Value`, `Equip`, and `Actions`) and the matching `Level`, `Value`, and `Equipment Slot` columns; the equipment column hosts the `Equip` / `Unequip` button, while the location item/scenery tables intentionally omit both the header row and those extra columns.
    - `Grid` renders compact image-only tiles with the same thumbnail size, a `2px` rarity-colored border on the image itself, and a `1px` gap between tiles. Inventory-style grid views that already allow equipment actions show an interactive grid equipment pill at the top center of equippable item tiles; the pill uses the slot label, renders solid when equipped and outlined when available, toggles equip/unequip on click, and briefly fades centered `Equipped`/`Unequipped` feedback over the tile.
    - `Small Grid` uses the same grid layout rules as `Grid`, but overrides the shared item-view size tokens to `0.7x` so the image, count badge, overlay icons, grid equipment pill, and context-menu button all shrink together.
  - Shared thing-list filters:
    - Text search matches item/scenery names, descriptions, short descriptions, visible detail fields, metadata text, numeric detail values, and status-effect text shown in tooltips/details.
    - Location item/scenery panels expose `Show all`, `Equippable only`, and `Non-equippable only`.
    - Player/NPC inventory and crafting inventory also expose `Equipped only`.
  - Shared thing-list sort popup:
    - `Alphabetical`, `Chronological` (item creation time), `Level`, `Quality`, `Stack Size`, `Value`, and `Equipment Slot`.
    - Repeated sorts are intentionally stable so the current visible order becomes the secondary order for the next sort.
  - Narrow panels still collapse only the filter controls behind the shared icon-only filter popover toggle, while sort and view each stay in their own collapsed popups.
  - View popups close immediately after a view selection, and both the view and sort popups close when the user clicks anywhere outside the popup/toggle pair.
  - Item and scenery thing-card context menus include `Separate`, which runs the `thing-separate` prompt and replaces the source thing with the returned thing stack(s); an explicit empty `<items>` result is treated as a no-op rather than an error.
  - When `Separate` returns a container, the first returned container receives the other returned item-type things; returned scenery remains in the source destination.
  - Item thing-card context menus also include `Split Stack` for stacks with `count > 1` (prompting for an exact integer split amount) and `Merge Stacks` for item cards outside equipment views; merge scans same-name/same-checksum items in the same inventory or location and folds them into the selected stack while excluding equipped items. While open, item menus are temporarily moved to a fixed body-level floating layer anchored to their trigger button, preventing lower location sections and modal scroll containers from painting over or clipping them, and shrinking the menu width to the widest option.
  - Things marked `Container` show an `Open Container` context-menu action and container badge action. The container modal uses two shared thing-list panels: current player inventory on the left and the selected container contents on the right, with persisted view keys `containerPlayerInventory` and `containerContents`; on narrow/mobile layouts those panels split the modal vertically with player inventory in the top half and container contents in the bottom half.
  - Container transfers move whole stacks by dragging between columns, long-press touch-dragging between stacked mobile panels, shift-clicking an item, or using the column-level `Add all` / `Remove all` buttons. Bulk buttons only affect items currently visible after that column's active search/slot/equipment filters, send the visible IDs in one bulk API request, and `Add all` fails before moving anything if the visible set includes an equipped item or the open container itself. Distinct item drag/drop operations can process concurrently; repeated moves for the same item and bulk transfers stay guarded until their current request finishes. The modal applies move responses only while they still belong to the active container session and refreshes the final container payload after overlapping item moves settle. Partial transfers use `Split Stack` first, then move the new stack. Nested containers open in the same modal with a breadcrumb/back stack while server-side validation rejects containment cycles.
  - Drag/drop behavior:
    - Any location thing card can be dragged to an inventory drop target only when its type is `item`.
    - Dragging a location card between the Items and Scenery grids converts its `thingType` (`item` <-> `scenery`) via `PUT /api/things/:id`.
    - Dragging an item out of an open inventory-style modal drops it into the current location via the normal item drop route; touch devices use pointer/touch long-press drag, suppress native browser long-press image/callout behavior on thing icons, disable native touch gestures on wired modal drag icons, and suppress the follow-up short-tap click when the drag completes.
    - Location-card and modal-inventory drops snapshot the dragged item at drop time, so a later drag cannot overwrite an earlier pending drop. Drops for different items can overlap, while a drop for the same item is ignored if that same item is already being processed.
- **Chat panel** (`.chat-container`):
  - Message list (`#chatLog`) with user/AI messages and event-summary batches.
  - Parent-linked `event-summary` and `status-summary` entries render as a collapsible `What changed` turn state-diff drawer inside their parent turn row, while orphan summaries still render as standalone summary cards. The drawer is built by `public/js/turn-state-diff-drawer.js`, keeps the persisted chat entries intact for history/search/base-context use, groups rows by exact `summaryItems[].category` metadata emitted by the server or live structured-event path, orders rows by `severity` within each category, treats legacy uncategorized event rows as `Other`, defaults uncategorized `status-summary` rows to `Status`, and reuses the chat markdown renderer for summary text. `new_exit_discovered` rows with `metadata.newExitDiscovered` render a clickable map pill; clicking it switches to the Map tab, loads the exit's origin region, and centers the new destination or region-exit bubble. Legacy parentless direct-travel summaries are attached client-side to the following visible `while-you-were-away-player` arrival prose when present; new direct-move summaries are parented server-side to visible arrival prose, the prior travel prose response, or the travel user/comment entry. Routine `time_passed` rows such as `⏳ 2 minutes passed.` are shown as a right-aligned label in the collapsed drawer header instead of as a body row; the `Time` category is omitted when that routine elapsed-time row is its only item, and the `What changed` button count ignores those elapsed-time rows. When elapsed time is the only row, the drawer remains visible with `What changed (0)` greyed out.
  - Drawer rows preserve `sourceType` as row metadata and render `entityRefs` as compact entity chips. Id-backed chips are keyboard-focusable buttons that emit the `airpg:turn-diff-entity-selected` event with the exact `{ type, id, name, category, severity, sourceType, text }` detail; name-only refs render as non-clickable chips so the client does not guess at ambiguous entities. The chat page routes exact id-backed selections to existing UI targets: characters open the character view, locations open the location context menu, visible things are scrolled/highlighted, container things can open the container modal, and quest/faction refs switch to their panels.
  - Direct arrival paths still refresh chat history after success, so visible reunion prose such as `while-you-were-away-player` entries appears immediately after direct moves and player teleports. Direct exit moves that bypass event-driven movement still run a normal travel prose prompt when the destination is unexplored; explored bypass moves keep using a prompt-skipping comment entry before `/api/player/move`.
  - Player-action `<hidden>...</hidden>` notes are filtered out of the Adventure chat feed even when they remain in stored history. When root config `show_hidden_notes` is true, the Story Tools full-history view receives the raw stored text so those notes are visible there; when false, Story Tools receives the filtered text too.
  - Input area (`#messageInput`, `#sendButton`) with slash command support.
  - Empty input opens `#emptyActionConfirmModal`; confirming sends an intentional empty player action so the Game Master continues the scene without player text.
  - Slash commands can now return typed UI actions; `request_file_upload` opens the shared `#slashUploadModal`, reads one or more selected text files, and forwards them to `/api/slash-command/upload`.
  - `/api/slash-command` also returns `executionOptions.showExecutionOverlay`; when a command disables it, the client cancels the pending `Executing command...` overlay before running reply actions. `/import_item` uses this so the upload modal and browser file picker are not blocked by the execution overlay.
  - `?` prefix-help modal includes an explicit roll-override note: include `<N>` anywhere in action/crafting text to force the die roll to integer `N`.
  - Prefix actions preserve raw input markers in the API payload (`?`, `\`, `@`, `@@`, `@@@`) even though optimistic local entries render marker-stripped content.
  - The prefix-help modal documents `\` as a no-context prompt that is logged, excluded from future base-context history, and run without chat tools.
- **Sidebar** (`.chat-sidebar`):
  - Outer panel shape keeps only the bottom-right corner rounded.
  - On desktop, a vertical drag handle on the sidebar's left edge resizes the player/party column horizontally. Width preferences share the Adventure panel `localStorage` entry and are disabled on stacked mobile layouts.
  - Player card (portrait, health, need bars, quick actions, a top-left `L.<level>` badge, and a lower-left warning triangle positioned `1em` above the health bar when unspent skill/attribute points are present).
  - On narrow/mobile layouts, the sidebar no longer keeps a separate inner vertical scrollbar just to fill leftover Adventure-tab height.
  - Player "View" opens `#npcViewModal` in editable mode for attributes/skills using shared allocation partials; skills can now be added/removed directly in this modal for the player view. The modal now includes a Faction section above Equipment: NPCs show a single faction, while player view lists all factions with reputation tier labels and associated tier perks. NPCs use the same allocation sections in read-only mode, their unspent point totals are hidden, and abilities render as read-only cards matching the level-up ability selector style with active/passive/triggered type color coding.
- **Player level-up ability draft modal** (`#playerAbilitySelectionModal`):
  - Opens when the player has any underfilled level (`player_abilities_per_level`) from level 1 through current level.
  - Is suppressed entirely when no game is loaded/started, but new-game startup now flips the loaded gate before opening-scene generation so the modal can appear during fresh game setup.
  - Opens immediately before option generation with the message `Ability options for level-up are being generated`, then updates to card picks when generation completes.
  - Ability option card names and uppercase type labels use the same active/passive/triggered colors as character-view ability cards.
  - During new-game startup, pending ability picks block the opening-scene intro until the final submit completes.
  - Passive ability-selection state polls are non-blocking; chat input is only disabled when the modal is actively pending/loading/submitting.
  - Offsets itself below header/tab controls so the top-row buttons remain clickable (including normal pointer cursor behavior) while options generate.
  - Presents card-style options for the next missing level only; after submit, it advances sequentially to the next missing level.
  - Pre-existing abilities at that level are preselected but can be toggled off.
  - Chat send + travel actions are blocked while this modal is pending.
- **Load game modal** (`#loadGameModal`):
  - Uses elevated z-order above all other overlays when open.
  - Any visible `.modal` is forced above the elevated load backdrop layer to prevent blur-overlay occlusion.
  - On confirm, closes immediately and calls `/api/prompts/cancel-all` (`waitForDrain: false`) before issuing `/api/load`.
- Player/NPC "Edit" opens `#npcEditModal`, which includes an `Aliases` textarea (one alias per line) plus `Resistances`/`Vulnerabilities` textareas and saves through `PUT /api/npcs/:id`.
  - NPC edit mode also shows AI notes plus per-character need-bar applicability checkboxes; the player view omits the need-bar applicability section.
  - Player/NPC Inventory modal keeps active inventory filters (including slot filter selection) when equip/unequip triggers an inventory re-render, and serves as the shared thing-list card/filter implementation that location item/scenery sections and the crafting inventory now reuse.
  - Party summary list.
- **World-time chip** (`#worldTimeIndicator`):
  - Rendered in the Adventure tab's left location panel (compact sidebar style).
  - Shows canonical world time (`h:MM AM/PM`), date label, and current segment/season.
  - Shows the current light-level description as an unlabeled line when available.
  - Shows a bottom weather line (`Weather: <name>`) when a concrete local weather type is available.
  - Also updates immediately from realtime `chat_history_updated` payloads that carry `worldTime`, including slash-command-driven clock changes such as `/time`.
  - Positive slash-command time jumps can also request a current player/location reload through that same realtime event so need bars and other time-sensitive sidebar/card data redraw immediately.
  - Emits event-summary updates when weather changes and when light-level descriptions cross into a new threshold/segment; light-level updates are suppressed for locations marked as no local weather.
  - Hidden until the first `worldTime` payload is received from `/api/chat/history` or `/api/chat`.

## Location name caching

- Inline script maintains a `locationCache` (location id -> display name) used by exit rendering and stub updates.
- Inline script also maintains `locationDetailsCache` (location id -> `{ id, name, regionName, imageId }`) for richer vehicle-context resolution.
- Shared inline helpers `formatMinutesDurationLabel(...)` and `formatStatusEffectDuration(...)` format minute-based duration text for vehicle arrival countdowns, item/status-effect tooltips, and NPC status rows.
- Cache entries are refreshed when the current location is rendered, after exit creation responses, and when stubs are renamed.
- `ensureLocationDetailsCached` fetches missing location details when needed; `ensureLocationNameCached` now wraps it and returns only name/region fields.

## Core client controller (public/js/chat.js)

- `AIRPGChat` owns chat history, input handling, and the websocket lifecycle.
- Maintains:
  - `chatHistory` (system + local), `serverHistory` (from `/api/chat/history`).
  - `pendingRequests` for in-flight requests and status UI.
  - Websocket state (`ws`, `wsReady`, reconnect timers).
- Input history recall now waits to see whether native `ArrowUp`/`ArrowDown` caret movement actually changed the textarea cursor position before stepping through prior drafted messages, so wrapped/multiline editing keeps the expected arrow-key behavior.
- Uses `markdown-it` for rendering message content when available.
- Uses `public/js/turn-state-diff-drawer.js` to attach parent-linked event/status summaries to the assistant message that caused them without changing the stored `ChatEntry` records.

## Websocket events

The chat client listens on `/ws?clientId=...` and handles:

- `connection_ack` (client id sync, image realtime enabled).
- `chat_status` (spinner / progress messages).
- `player_action`, `npc_turn` (streamed partial messages).
- `chat_complete` (final response; may include `completionSoundPath`, which the client plays as an audio cue for non-travel actions; travel actions defer playback until travel completion).
- `chat_error` (display errors).
- `generation_status`, `region_generated`, `location_generated` (world generation status).
- `location_exit_created`, `location_exit_deleted` (refresh location + map).
- `image_job_update` (image job completion via `ImageGenerationManager`).
- `chat_history_updated` (refresh history, quest panel, and Story Tools data).
- Skill and attack tool calls create one visible `check-results` history entry per prompt/turn and update that same chat box through `chat_history_updated` as each check starts and completes. The entry is prompt-excluded on the server, independent of `debug_tool_calls`, and renders each check as a collapsed readable row with expanded skill/attack details. Completed collapsed summaries show actor/target plus outcome without roll/DC/margin/health numbers; those remain in the expanded details. Skill summaries prefix the existing outcome degree with the listed success/failure icon (`💣`, `🧨`, `❌`, `😞`, `😰`, `✔️`, `⭐`, or `🌟`); attack summaries use `⚔️` for hit rows with `(💥-Nhp)` appended and `💨` for miss rows.
- When `debug_tool_calls` is enabled, prose-prompt tool calls also create one separate `tool-call-debug` history entry and update that same visible chat box through `chat_history_updated` as each tool starts and completes; the entry is prompt-excluded on the server. The chat client renders each recorded call as its own collapsible sub-box keyed by tool name, marks cached tool results as `cache hit`, and shows parameters/results through `@andypf/json-viewer`.
- NPC turns now draw a pending `npc-action` planned-action chat box during `next_npc_list`/NPC action-plan processing and update that same `npc-message` box through `chat_history_updated` with the finalized planned-action text. When the later `npc_turn` stream payload arrives, the client updates the existing timestamped/entry-id final prose message instead of appending a duplicate when possible.
- Streamed NPC turns can include the same tool-derived attack summaries, action resolutions, and plausibility payload arrays as player actions; the client renders attack/skill results through live `check-results` chat bubbles and keeps plausibility details on the existing plausibility insight path.
- `prompt_progress`, `prompt_progress_cleared` (floating prompt-progress overlay with per-prompt eye/cancel/retry controls plus a header-level "Abort + Reload" action that cancels all tracked prompts and reloads the latest autosave; the eye control opens a separate floating viewer with one combined text pane that renders the selected prompt first in a differently styled inline span, exposes a `Copy Prompt` action and a `Follow` checkbox, and streams the selected prompt's response text live beneath it as chunks arrive. When `Follow` is checked, the combined prompt/response pane stays scrolled to the bottom on each throttled viewer refresh. For `codex_cli_bridge`, that preview now comes from the Codex app-server transport: assistant-message deltas are decoded back into plain bridge `content` text as they arrive, with backend status text only used until real assistant text starts; Codex received counts are manually derived from those decoded text deltas/replacements as characters instead of trusted Codex/stdout counts; server received-count/preview notifications and client overlay rerenders are both throttled to 500 ms so the unitless received total and average do not churn every frame; the overlay auto-closes the load-game modal before showing prompt activity, renders in the upper modal layer above the full interface, auto-anchors below top navigation controls so header options remain clickable, includes contract/expand toggle, drag handle on the header, native resize handle, keeps the same progress table wrapper/table/header while replacing only body rows on rerender, keeps a runtime-only remembered minimum table width while visible so disappearing rows do not shrink the table, and has a 3.5-second hidden-placeholder-row debounce before the empty table state is hidden).
- `quest_confirmation_request` (modal prompt).

`processChatPayload()` also consumes `payload.worldTime` from streamed/final chat responses, updates the world-time chip, and emits transition summaries (`segment`/`season`) into the event-summary flow.
It also renders `needBarChanges`, `dispositionChanges`, and `factionReputationChanges` into the same active event-summary bundle box so same-turn deltas appear together, with category metadata preserved on every row. Async memory/disposition work persists one aggregated `Disposition Check` event-summary batch per memory batch rather than one box per NPC; if disposition changes arrive directly at the client outside an active bundle, the client still renders them as a dedicated `Disposition Changes` summary batch rather than a loose standalone event line. Need and disposition summary rows are grouped per character as collapsed rows; the closed row shows the character name plus nonzero icon/delta pills from the configured need/disposition definitions, and the expanded row shows the existing detailed summary text below those pills. Need-bar changes with `all`/`fill` magnitude display the signed bar maximum in the pill, such as `+1000` or `-1000`, even when the actual capped delta was smaller. When `time_passed` advances world time for the turn, the same bundle appends an `⏳ <natural duration> passed.` line using `A`, `A and B`, or `A, B, and C` formatting; when it is parent-linked into the `What changed` drawer, that elapsed-time line appears in the drawer header, is omitted from the body categories, and does not increment the button count. If elapsed time is the only row, the drawer shows the elapsed-time label beside a disabled grey `What changed (0)` button. If exit travel time overrides the prompt-authored turn duration, the displayed line uses the effective travel minutes. Prose-mode craft/process/salvage/harvest result summaries now append that same `⏳ <natural duration> passed.` line from the action's applied craft time. Direct moves persist a travel row even when no time advances, add the same elapsed-time row when exit time applies, and parent those rows to visible arrival prose, prior travel prose, or the travel user/comment row so direct travel still appears as a `What changed` drawer. Map fast travel that advances time keeps the same travel/time summary behavior and parent-links to visible arrival prose when available. Need-bar summaries now use the configured bar icon, include the model-provided reason text when present, and emit one standalone notification per change outside active bundles. Quantity-bearing item event summaries append stack suffixes like `(x2)` or `(x10)` after the item name when the quantity is greater than `1`.
When a live assistant response element is available, the active event/status bundles attach to that message as the same `What changed` drawer; otherwise they retain the standalone summary rendering path.

## Key API calls from the chat UI

Not exhaustive, but the core UI calls include:

- `/api/chat` (send a new action).
- `/api/chat/history` (reload server history; Story Tools uses `?includeAllEntries=true` to fetch unpruned entries, including hidden server-only entries, with player-action hidden-note blocks preserved only when `show_hidden_notes` is true).
- `/api/chat/message` (edit/delete chat entries).
- `/api/slash-command` (slash command execution).
- `/api/slash-command/upload` (shared slash-command file upload follow-up).
- `/api/quests/confirm` (quest confirmation).
- `/api/quest/edit` and `/api/player/quests/:id` (quest edit / abandon).
- `/api/factions` + `/api/player/factions/:id/standing` (faction panel edits).
- `/api/player` and `/api/player/skills/:name/increase` (sidebar + skill adjust).
- `/api/player/thing-list-view-preferences` (persist shared location/inventory/crafting panel view selections on the current player).
- `/api/player/ability-selection` + `/api/player/ability-selection/submit` (player level-up ability draft flow).
- `/api/player/move` (direct travel fallback path; sends `destinationId` plus `expectedOriginLocationId` for server-side origin verification; unexplored bypass exits may first run travel prose with exit metadata, but this endpoint remains the authoritative move/time application).
- `/api/images/location-variant/request` (on-demand current-location weather/lighting image variant; server resolves conditions and returns a cached image id or realtime image job).
- `/api/player/update-stats` (player-view modal point allocation submit; unspent pools are server-derived from submitted level/attributes/skills, and the in-modal skill pool preview tracks formula deltas from provisional stat changes such as Intelligence bonus adjustments).
- `/api/locations/:id/modify` (current-location modification crafting flow; selected player-inventory slots and notes run dedicated modification checks, may consume selected items, may grant newly uncovered portable byproduct items, may mutate the location through `alter_location`, and preserve the base location level).
- `/api/locations/:id` and `/api/locations/:id/exits` (location details + exit edits).
- `/api/things/:id` (thing updates; location drag/drop uses this to convert item/scenery type).
- `/api/things/:id/separate` (item/scenery separation prompt action from thing-card context menus).
- `/api/map/region` and `/api/map/world` (map tabs).

History window note:
- Client-visible chat history is capped by `client_message_history.max_messages` (turn-based) and is independent from `recent_history_turns`, which only controls base-context prompt segmentation.

## LLM prompt modals (immediate close)

LLM-backed modal submits close immediately (no visible waiting state); errors surface via `alert()` after the modal closes. Most listed flows keep an internal in-flight guard, while Add NPC and Create Item/Create Scenery intentionally allow concurrent submits.

- `#addNpcModal` (adds an NPC via `/api/locations/:id/npcs`; supports concurrent submissions when the modal is reopened during an in-flight request).
- `#thingEditModal` create mode (adds item/scenery via `/api/locations/:id/things`; name is optional and can be generated; submit closes immediately and allows additional create prompts while prior item/scenery creation is still running).
- `#newExitModal` (creates/edits exits via `/api/locations/:id/exits`, including a travel-time field that accepts the shared duration syntax such as `1m`, `1h10m`, or `2 hours`; selecting an existing pending region and leaving the location/name blank targets that pending region's entrance instead of creating a new location; new user-named locations/regions are server-rejected with an alert when the name conflicts with an existing/pending location or region, banned name fragment, or slop word).
- `#craftingModal` (crafting/processing via `/api/craft`, plus `modify-location` mode via `/api/locations/:id/modify`, including empty-slot submits for craft/process/modify-location, no-prose submit paths, and notes placeholders that mention `<N>` roll override support).
  - The left-side player inventory list in this modal now uses the same shared thing-list renderer as the main inventory and location panels, including per-panel `Classic`/`Table`/`Grid` views, search/slot/equipment filters, and the shared stable sort popup, with narrow panels collapsing the filter controls behind the shared icon-only filter toggle.
  - The player-inventory section header now renders the `Player Inventory` title/count row with the crafting hint directly beneath it, while the icon-only filter toggle remains a separate control on the right.
  - Equipped items in the crafting inventory are highlighted with a red outline and are rejected from slot assignment across drag/drop, double-click, and keyboard assignment with a `must be unequipped first` alert.
  - In `modify-location` mode, the modal title is `Modify Location`, the workspace label is `Modification Materials`, empty material slots are valid, and submit refreshes chat history, inventory, party/sidebar state, and the current location when the endpoint returns.
- `#salvageIntentModal` (salvage/harvest via `/api/craft`, including `Harvest (no prose)` / `Salvage (no prose)` submits, with intent placeholders that mention `<N>` roll override support).

## Insights and attachments

Chat entries can include attachments rendered as inline "insights":

- `skill-check`, `attack-check`, `plausibility`, `slop-remover`.
- Attack-check insight details include the computed damage multiplier/effectiveness line used in combat resolution.
- `resolveAttack`, `resolveSkillCheck`, and `resolveOpposedSkillCheck` tool calls are recorded live in `check-results` chat bubbles rather than as top-right hover insight buttons. Legacy separate prompt checks still use the older `attack-check` and `skill-check` attachment renderers.
- `resolveSkillCheck` and `resolveOpposedSkillCheck` tool calls can still return `actionResolutions[]` and `plausibilities[]`; the live chat handler suppresses duplicate skill-check rendering when a server-recorded `check-results` entry exists, while plausibility details keep using the existing plausibility insight path.
- Craft/process/salvage/harvest and location-modification success-degree outcomes are also recorded as `check-results` chat bubbles after the server resolves their `ActionResolution`, so they use the same collapsed success/failure icon row and expanded skill-check details as prose tool-call checks.
- When `use_legacy_prompt_checks` is enabled, those attack/skill insights come from the legacy separate prompt path instead of prose-prompt tool calls.
- Plausibility is rendered client-side with Nunjucks using `public/templates/plausibility.njk`.
- Slop removal insight lists slop words, regex-match names, and n-grams.

## Location + entity images

`views/index.njk` defines helpers:

- `renderEntityImage({ element, entityType, entityId, imageId, ... })` sets `data-*`, resolves existing image IDs through the extension-agnostic `/api/images/:imageId/file` route, and delegates generation/job tracking to `window.AIRPG.imageManager`.
- `renderImageBadgesOverlay` adds badges for crafting/processing/harvest/salvage on item images.
  Thing-image clicks now route through `public/js/lightbox.js` with a sidecar tooltip/details pane, while non-thing images still use the plain image-only lightbox.

## Quest, faction, and party panels

Inline script functions in `views/index.njk` render these tabs:

- `initQuestPanel()` uses `/api/quest/edit` and `/api/player/quests/:id`.
  - Quest edit modal supports per-faction reputation reward deltas via multiline `faction name or id: +/-points` input.
  - Quest reward lists resolve faction reputation reward IDs to faction names when rendering.
- `initFactionPanel()` uses `/api/factions` and `/api/player/factions/:id/standing`.
- The faction form includes fields for name, home region, short description, description, tags, goals, assets, relations, reputation tiers, and player standing.
- New faction creation now uses a dedicated modal (not `window.prompt`) with full faction fields (including assets/relations/reputation tiers).
- The new-faction modal includes an optional "Generation Notes (AI Guidance)" field that is sent only to `/api/factions/fill-missing` to steer autofill.
- On create submit, if any relevant faction fields are blank, the UI calls `/api/factions/fill-missing` before posting to `/api/factions`.
- `initPartyDisplay()` renders party cards and ties into the chat sidebar.
- Party-member context menus now include both `Dismiss` and `Dismiss everyone else`; the latter keeps the selected member and removes every other current party member using the same party-removal path.
- Non-party NPC context menus now also include `Recruit all party members`; it recruits every current-location NPC with `wasEverInPlayerParty === true` that is not already in the party.

## Story Tools tab

- `initStoryToolsPanel()` renders an editor-friendly history view for all chat entries.
- Uses `GET /api/chat/history?includeAllEntries=true` to include hidden entries and entries that are normally omitted from client chat history; player-action `<hidden>` note blocks appear there only when `show_hidden_notes` is true.
- Paging:
  - Entries are ordered oldest-first.
  - Pages are fixed at 250 entries each.
  - Page tabs are shown in a vertical list on the left.
  - Initial load defaults to the last page and auto-scrolls to the bottom so the latest entry is visible.
- Search:
  - The Story Tools search box filters the already-loaded full history client-side; no extra API request is made.
  - Typing in the search box waits 1 second after the user stops typing before applying the filter.
  - Search defaults to `All words`, which is case-insensitive, splits on whitespace, and requires every typed term to match somewhere in the entry.
  - The search mode selector also supports `Substring` for exact phrase matching and `Regex` for JavaScript `RegExp` patterns without slash delimiters.
  - The `Aa` toggle makes matching and highlighting case-sensitive in all search modes.
  - Invalid regex input shows an inline error/status message and no matching entries; it does not fall back to another mode.
  - Matches include displayed content/event-summary text plus role, type, visibility, timestamp, `locationId`, and `parentId` metadata.
  - Filtered results keep the 250-entry paging model, preserve original `Entry #` numbers, show a matched-vs-total status, and highlight matched text with safe DOM text nodes rather than raw HTML.
- Each entry card shows metadata (`role`, `type`, visibility, timestamp, optional `locationId`/`parentId`) and an `Edit` action.
- `Edit` reuses the shared chat edit modal by calling `window.AIRPG_CHAT.openEditModal(entry)`.
- `window.refreshStoryTools()` is exposed globally and is triggered on tab activation and after edit/delete/chat-history updates.

## Player overview sync

`initPlayerOverviewSync()` periodically refreshes `/api/player` and updates:

- Chat sidebar player card and party list.
- Quest panel data.

## See also

- `docs/ui/modals_overlays.md` for the full modal inventory.
- `docs/ui/maps.md` for map-specific behaviors.
