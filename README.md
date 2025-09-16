# AI RPG Server

AI RPG Server is a Node.js application that runs a single-player, AI-assisted roleplaying experience. It combines an Express REST API, Nunjucks prompt templating, and optional ComfyUI image generation to deliver an all-in-one game master, world builder, and visualizer.

## Highlights

- 🧠 **AI-driven storytelling** – Sends structured prompts to any OpenAI-compatible chat completion API to narrate adventures.
- 🗺️ **Procedural world model** – Manages players, locations, regions, exits, NPCs, and items completely in-memory with rich object models (`Player`, `Location`, `Region`, `LocationExit`, `Thing`, `SettingInfo`).
- 🖼️ **Image generation pipeline** – Queues portrait, location, exit, and item art jobs through ComfyUI using customizable JSON templates.
- 🖥️ **In-browser UI** – Provides chat, new-game wizard, settings manager, configuration form, and debug dashboards using Nunjucks views plus vanilla JS and Cytoscape maps.
- 🧩 **Composable prompts** – Ships with reusable Nunjucks XML/YAML templates for game mastering, regions, locations, NPCs, player actions, and imagery.

## Project Layout

```
├── server.js                # Express app, API routes, prompt orchestration, image queues
├── Player.js                # Player/NPC stats, leveling, validation, serialization
├── Location.js              # Locations, exits, stub promotion, XML parsing
├── LocationExit.js          # Exit metadata and helpers
├── Region.js                # Region blueprints and expansion logic
├── Thing.js                 # Items & scenery registry
├── SettingInfo.js           # Campaign settings and prompt variables
├── ComfyUIClient.js         # REST client for ComfyUI jobs
├── nunjucks_dice.js         # Dice filters shared with prompts and views
├── prompts/                 # Gamemaster, location, region, NPC, portrait, and image templates
├── imagegen/                # ComfyUI workflow templates (JSON rendered via Nunjucks)
├── defs/                    # YAML definitions (attributes, optional location data)
├── public/                  # Static assets (CSS/SCSS, JS, Cytoscape bundles, generated images)
├── views/                   # Nunjucks pages for chat, config, settings, debug, etc.
├── saves/                   # Snapshot JSON saves plus saved campaign settings
├── logs/                    # Prompt/response logs (chat, regions, locations, portraits, etc.)
└── tests/                   # Node scripts that exercise APIs and parsing helpers
```

## Prerequisites

- Node.js 18 or newer (private class fields and top-level `async/await` are required)
- npm 9+
- (Optional) Access to a ComfyUI server when `imagegen.enabled` is true
- Access to an OpenAI-compatible API

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the configuration template and edit it with your credentials:
   ```bash
   cp config.default.yaml config.yaml
   ```
3. Update `config.yaml`:

   - `server.port` / `server.host` control the Express listener (default `0.0.0.0:7777`).
   - `ai.endpoint`, `ai.apiKey`, `ai.model`, `ai.maxTokens`, `ai.temperature` configure the story model.
   - `imagegen.*` enables ComfyUI jobs and selects the workflow template under `imagegen/`.
   - `gamemaster.promptTemplate` chooses the base prompt (XML or YAML) and can merge variables from `SettingInfo`.

   > ⚠️ Treat `ai.apiKey` as a secret. Do **not** commit real keys.

## Running the Server

```bash
npm start
```

Then open [http://localhost:7777](http://localhost:7777).

The Express app serves several pages:

- `/` – Main chat UI with player/location panel and Cytoscape-powered regional map.
- `/new-game` – Guided form to roll a new adventure and initial location.
- `/config` – Edit and persist `config.yaml` directly from the browser.
- `/settings` – CRUD interface for `SettingInfo` presets and applying them to the current session.
- `/debug` – Comprehensive snapshot of players, locations, regions, prompt variables, and logs.

Static assets are served from `public/`, including compiled CSS (`main.css`, `settings.css`) and ES modules under `public/js/` (`chat.js`, `map.js`, `new-game.js`, `config.js`, `player-stats.js`). Styles originate from SCSS sources alongside the compiled files.

## API Overview

The UI consumes a JSON API defined in `server.js`. Key routes include:

- `POST /api/chat` – Sends chat history to the configured AI endpoint. Automatically patches the system message using the active player/location prompt template.
- `GET/DELETE /api/chat/history` – Inspect or clear the stored conversation log.
- `POST /api/player` / `POST /api/player/create-from-stats` – Create a player/NPC with stats; portraits are queued if image generation is enabled.
- `GET /api/player`, `PUT /api/player/attributes`, `PUT /api/player/health`, `POST /api/player/levelup`, `POST /api/player/update-stats` – Manage the current player.
- `GET /api/players`, `POST /api/player/set-current` – Multi-player scaffolding.
- `GET /api/attributes`, `POST /api/player/generate-attributes` – Surface attribute definitions from `defs/attributes.yaml` and run dice-driven generators.
- `GET /api/locations/:id`, `POST /api/locations/generate`, `POST /api/player/move` – Expand and navigate the overworld. Locations can start as “stubs” that are later promoted via AI responses.
- `POST /api/regions/generate`, `GET /api/map/region` – Build a hub region and render it on the Cytoscape map.
- `POST /api/things`, `GET/PUT/DELETE /api/things/:id` – Manage scenery and inventory objects, each with optional art.
- `GET/POST /api/settings` plus RESTful routes for saving/loading/deleting `SettingInfo` definitions and applying them to the current session.
- `POST /api/new-game`, `/api/save`, `/api/load` – Persist and restore campaigns under `saves/`.
- `POST /api/generate-image`, `GET /api/jobs/:jobId`, `GET /api/images/:imageId` – Submit manual image jobs and poll job status/results.

Inspect `server.js` for the comprehensive list and payload details.

## Prompt Templates

- **Location & region generation** – `prompts/location-generator.*.xml.njk`, `prompts/region-generator.*.xml.njk` craft structured XML that the server parses back into objects.
- **Player actions** – `prompts/player-action.xml.njk` (or YAML fallback) rewrites user chat input into a rich system message and optional follow-up prompt before calling the AI model.
- **Image prompts** – `prompts/player-portrait.xml.njk`, `prompts/location-image.xml.njk`, `prompts/locationexit-image.yaml.njk`, `prompts/item-image.xml.njk`, `prompts/scenery-image.xml.njk` define the text sent to ComfyUI.
- **Gamemaster personas** – Switch among `gamemaster.xml.njk`, `fantasy-adventure.yaml.njk`, `mystery-investigation.yaml.njk`, etc., and populate `config.gamemaster.promptVariables` or apply a saved setting to control tone.

All templates have access to dice helpers from `nunjucks_dice.js` (`roll`, `roll_detail`) and can be extended by adding new `.njk` files.

## Image Generation Workflow

When `imagegen.enabled` is true:

1. `ComfyUIClient` queues the rendered workflow JSON from `imagegen/default.json.njk`.
2. A job queue in `server.js` tracks progress, retries transient errors, and times out after 2 minutes.
3. Finished images are stored under `public/generated-images/` with metadata recorded in memory (`generatedImages` map) and returned via `/api/images`.
4. Player, location, exit, and thing records reference the generated `imageId` so the UI can display fresh art.

If the ComfyUI server is offline, jobs fail gracefully and the game continues without visuals.

## Persistence & Logs

- **Saves** – `POST /api/save` and `/api/load` serialize the current player, locations, regions, and settings into timestamped folders inside `saves/`.
- **Settings** – Saved `SettingInfo` snapshots live under `saves/settings/` for reuse across sessions.
- **Logs** – The server writes prompt/response transcripts to `logs/` (chat history, generated locations, NPC rosters, portraits, etc.) for debugging.
- **Generated images** – Saved PNGs accumulate under `public/generated-images/` and can be cleaned up manually if storage becomes an issue.

## Development & Testing

- The `tests/` directory contains standalone Node scripts (e.g., `tests/test_player_save.js`) that hit the running server or exercise parser logic. Execute them individually with `node tests/<file>.js` after `npm start` is up.
- Front-end scripts are ES modules without a bundler pipeline; update files in `public/js/` directly.
- Styles are authored in SCSS (`public/css/*.scss`). If you change the sources, recompile using your preferred Sass toolchain so the matching `.css` files stay in sync.
- Cytoscape and its `fcose` layout engine are vendored under `public/vendor/` for offline use.

## Troubleshooting

- **API errors / 401 responses** – Confirm `config.yaml` has a valid `ai.apiKey` and the endpoint is reachable.
- **Timeouts talking to ComfyUI** – Ensure the `imagegen.server.host`/`port` pair points to a live instance or toggle `imagegen.enabled: false`.
- **Empty chat responses** – Check logs under `logs/` to inspect the generated prompts and AI replies.
- **Missing player/setting context** – Visit `/settings` to apply or reset `SettingInfo`, or `/debug` to verify in-memory state.

## Next Steps

- Extend `prompts/` with new genres, NPC archetypes, or dice mechanics.
- Enhance `tests/` with automated assertions for world generation and image workflows.
- Wire SCSS compilation or a Vite pipeline if you prefer a formal asset build step.

Enjoy crafting worlds with your AI game master!
