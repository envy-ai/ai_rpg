# Chat Interface (views/index.njk)

The main UI is rendered by `views/index.njk` and powered by `public/js/chat.js` plus a large inline script block inside the template.

## Layout and tabs
- Tab bar controls panels with ids `tab-adventure`, `tab-map`, `tab-world-map`, `tab-character`, `tab-quests`, `tab-factions`, `tab-party`.
- `initTabs()` in `views/index.njk` handles tab switching and updates `window.location.hash` as `#tab-{name}`.
- Tab activation triggers:
  - `map` -> `window.loadRegionMap()`.
  - `world-map` -> `window.loadWorldMap()`.
  - `party` -> `window.refreshParty()`.
  - `factions` -> `window.refreshFactions()`.

## Adventure tab structure
- **Location panel** (`.location-block`):
  - Image + context menu for edit/summon/regenerate.
  - Exits list + "New Exit" button.
  - NPC list + "Add NPC" button.
  - Items/Scenery grids + "Craft" and "New Item/Scenery" buttons.
- **Chat panel** (`.chat-container`):
  - Message list (`#chatLog`) with user/AI messages and event-summary batches.
  - Input area (`#messageInput`, `#sendButton`) with slash command support.
- **Sidebar** (`.chat-sidebar`):
  - Player card (portrait, health, need bars, quick actions).
  - Party summary list.

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
- `chat_complete` (final response).
- `chat_error` (display errors).
- `generation_status`, `region_generated`, `location_generated` (world generation status).
- `location_exit_created`, `location_exit_deleted` (refresh location + map).
- `image_job_update` (image job completion via `ImageGenerationManager`).
- `chat_history_updated` (refresh history and quest panel).
- `prompt_progress`, `prompt_progress_cleared` (LLM progress footer).
- `quest_confirmation_request` (modal prompt).

## Key API calls from the chat UI
Not exhaustive, but the core UI calls include:
- `/api/chat` (send a new action).
- `/api/chat/history` (reload server history).
- `/api/chat/message` (edit/delete chat entries).
- `/api/slash-command` (slash command execution).
- `/api/quests/confirm` (quest confirmation).
- `/api/quest/edit` and `/api/player/quests/:id` (quest edit / abandon).
- `/api/factions` + `/api/player/factions/:id/standing` (faction panel edits).
- `/api/player` and `/api/player/skills/:name/increase` (sidebar + skill adjust).
- `/api/locations/:id` and `/api/locations/:id/exits` (location details + exit edits).
- `/api/map/region` and `/api/map/world` (map tabs).

## Insights and attachments
Chat entries can include attachments rendered as inline "insights":
- `skill-check`, `attack-check`, `plausibility`, `slop-remover`.
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
- `initFactionPanel()` uses `/api/factions` and `/api/player/factions/:id/standing`.
- `initPartyDisplay()` renders party cards and ties into the chat sidebar.

## Player overview sync
`initPlayerOverviewSync()` periodically refreshes `/api/player` and updates:
- Chat sidebar player card and party list.
- Quest panel data.

## See also
- `docs/ui/modals_overlays.md` for the full modal inventory.
- `docs/ui/maps.md` for map-specific behaviors.
