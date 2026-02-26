# Chat Interface (views/index.njk)

The main UI is rendered by `views/index.njk` and powered by `public/js/chat.js` plus a large inline script block inside the template.

## Layout and tabs

- Tab bar controls panels with ids `tab-adventure`, `tab-map`, `tab-world-map`, `tab-character`, `tab-quests`, `tab-factions`, `tab-party`, `tab-story-tools`.
- On mobile (`max-width: 768px`), the tab bar itself (`.tab-bar`) scrolls horizontally with nowrap tab buttons so labels stay readable.
- `initTabs()` in `views/index.njk` handles tab switching and updates `window.location.hash` as `#tab-{name}`.
- Tab activation triggers:
  - `map` -> `window.loadRegionMap()`.
  - `world-map` -> `window.loadWorldMap()`.
  - `party` -> `window.refreshParty()`.
  - `story-tools` -> `window.refreshStoryTools({ preserveSelection: true })`.
  - `factions` -> `window.refreshFactions()`.

## Adventure tab structure

- **Location panel** (`.location-block`):
  - Compact world-time chip at the top (`#worldTimeIndicator`) showing `HH:MM`, date label, and segment/season.
  - Image + context menu for edit/summon/regenerate.
  - On mobile (`max-width: 768px`), item/NPC/location tooltips are constrained to `80vw` for readability.
  - On touch/coarse-pointer devices, tapping any entity `•••` context-menu button temporarily suppresses floating tooltips so the menu remains reachable.
  - Exits list + "New Exit" button.
  - NPC list + "Add NPC" button.
  - Items/Scenery grids + "Craft" and "New Item/Scenery" buttons.
  - Drag/drop behavior:
    - Any location thing card can be dragged to an inventory drop target only when its type is `item`.
    - Dragging a location card between the Items and Scenery grids converts its `thingType` (`item` <-> `scenery`) via `PUT /api/things/:id`.
- **Chat panel** (`.chat-container`):
  - Message list (`#chatLog`) with user/AI messages and event-summary batches.
  - Input area (`#messageInput`, `#sendButton`) with slash command support.
  - Prefix actions preserve raw input markers in the API payload (`?`, `@`, `@@`, `@@@`) even though optimistic local entries render marker-stripped content.
- **Sidebar** (`.chat-sidebar`):
  - Player card (portrait, health, need bars, quick actions, and a top-left warning triangle when unspent skill/attribute points are present).
  - Player "View" opens `#npcViewModal` in editable mode for attributes/skills using shared allocation partials; skills can now be added/removed directly in this modal for the player view. NPCs use the same sections in read-only mode, and their unspent point totals are hidden.
- **Player level-up ability draft modal** (`#playerAbilitySelectionModal`):
  - Opens when the player has any underfilled level (`player_abilities_per_level`) from level 1 through current level.
  - Presents card-style options for the next missing level only; after submit, it advances sequentially to the next missing level.
  - Pre-existing abilities at that level are preselected but can be toggled off.
  - Chat send + travel actions are blocked while this modal is pending.
- Player/NPC "Edit" opens `#npcEditModal`, which includes an `Aliases` textarea (one alias per line) plus `Resistances`/`Vulnerabilities` textareas and saves through `PUT /api/npcs/:id`.
  - Player/NPC Inventory modal keeps active inventory filters (including slot filter selection) when equip/unequip triggers an inventory re-render.
  - Party summary list.
- **World-time chip** (`#worldTimeIndicator`):
  - Rendered in the Adventure tab's left location panel (compact sidebar style).
  - Shows canonical world time (`HH:MM`), date label, and current segment/season.
  - Shows the current light-level description as an unlabeled line when available.
  - Shows a bottom weather line (`Weather: <name>`) when a concrete local weather type is available.
  - Emits event-summary updates when weather changes and when light-level descriptions cross into a new threshold/segment; light-level updates are suppressed for locations marked as no local weather.
  - Hidden until the first `worldTime` payload is received from `/api/chat/history` or `/api/chat`.

## Location name caching

- Inline script maintains a `locationCache` (location id -> display name) used by exit rendering and stub updates.
- Cache entries are refreshed when the current location is rendered, after exit creation responses, and when stubs are renamed.
- `ensureLocationNameCached` fetches missing names for exits when needed.

## Core client controller (public/js/chat.js)

- `AIRPGChat` owns chat history, input handling, and the websocket lifecycle.
- Maintains:
  - `chatHistory` (system + local), `serverHistory` (from `/api/chat/history`).
  - `pendingRequests` for in-flight requests and status UI.
  - Websocket state (`ws`, `wsReady`, reconnect timers).
- Uses `markdown-it` for rendering message content when available.

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
- `prompt_progress`, `prompt_progress_cleared` (floating top-left prompt-progress overlay with per-prompt cancel/retry controls plus a header-level "Abort + Reload" action that cancels all tracked prompts and reloads the latest autosave; includes contract/expand toggle, drag handle on the header, native resize handle, and a 3.5-second hidden-placeholder-row debounce before the empty table state is hidden).
- `quest_confirmation_request` (modal prompt).

`processChatPayload()` also consumes `payload.worldTime` from streamed/final chat responses, updates the world-time chip, and emits transition summaries (`segment`/`season`) into the event-summary flow.
It also renders `needBarChanges`, `dispositionChanges`, and `factionReputationChanges` into the same event-summary bundle box so they appear together.

## Key API calls from the chat UI

Not exhaustive, but the core UI calls include:

- `/api/chat` (send a new action).
- `/api/chat/history` (reload server history; Story Tools uses `?includeAllEntries=true` to fetch unpruned/unfiltered entries, including hidden server-only entries).
- `/api/chat/message` (edit/delete chat entries).
- `/api/slash-command` (slash command execution).
- `/api/quests/confirm` (quest confirmation).
- `/api/quest/edit` and `/api/player/quests/:id` (quest edit / abandon).
- `/api/factions` + `/api/player/factions/:id/standing` (faction panel edits).
- `/api/player` and `/api/player/skills/:name/increase` (sidebar + skill adjust).
- `/api/player/ability-selection` + `/api/player/ability-selection/submit` (player level-up ability draft flow).
- `/api/player/move` (direct travel fallback path; sends `destinationId` plus `expectedOriginLocationId` for server-side origin verification).
- `/api/player/update-stats` (player-view modal point allocation submit; unspent pools are server-derived from submitted level/attributes/skills).
- `/api/locations/:id` and `/api/locations/:id/exits` (location details + exit edits).
- `/api/things/:id` (thing updates; location drag/drop uses this to convert item/scenery type).
- `/api/map/region` and `/api/map/world` (map tabs).

History window note:
- Client-visible chat history is capped by `client_message_history.max_messages` (turn-based) and is independent from `recent_history_turns`, which only controls base-context prompt segmentation.

## LLM prompt modals (immediate close)

LLM-backed modal submits close immediately (no visible waiting state); errors surface via `alert()` after the modal closes. Most listed flows keep an internal in-flight guard, while Add NPC intentionally allows concurrent submits.

- `#addNpcModal` (adds an NPC via `/api/locations/:id/npcs`; supports concurrent submissions when the modal is reopened during an in-flight request).
- `#thingEditModal` create mode (adds item/scenery via `/api/locations/:id/things`; name is optional and can be generated).
- `#newExitModal` (creates/edits exits via `/api/locations/:id/exits`).
- `#craftingModal` (crafting/processing via `/api/craft`, including a no-prose submit path for craft/process).
- `#salvageIntentModal` (salvage/harvest via `/api/craft`, including `Harvest (no prose)` / `Salvage (no prose)` submits).

## Insights and attachments

Chat entries can include attachments rendered as inline "insights":

- `skill-check`, `attack-check`, `plausibility`, `slop-remover`.
- Attack-check insight details include the computed damage multiplier/effectiveness line used in combat resolution.
- Plausibility is rendered client-side with Nunjucks using `public/templates/plausibility.njk`.
- Slop removal insight lists slop words / n-grams.

## Location + entity images

`views/index.njk` defines helpers:

- `renderEntityImage({ element, entityType, entityId, imageId, ... })` sets `data-*` and delegates to `window.AIRPG.imageManager`.
- `renderImageBadgesOverlay` adds badges for crafting/processing/harvest/salvage on item images.
  Images can be enlarged through `public/js/lightbox.js`.

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

## Story Tools tab

- `initStoryToolsPanel()` renders an editor-friendly history view for all chat entries.
- Uses `GET /api/chat/history?includeAllEntries=true` to include hidden entries and entries that are normally omitted from client chat history.
- Paging:
  - Entries are ordered oldest-first.
  - Pages are fixed at 250 entries each.
  - Page tabs are shown in a vertical list on the left.
  - Initial load defaults to the last page and auto-scrolls to the bottom so the latest entry is visible.
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
