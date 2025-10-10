# AI RPG Server

AI RPG Server turns an OpenAI-compatible language model into a solo tabletop game master. The Node.js application keeps track of players, locations, regions, and items; renders structured prompts with Nunjucks; and optionally drives a ComfyUI image pipeline so every scene can ship with fresh artwork. A lightweight browser UI and JSON API sit on top, letting you explore the world, tweak settings, and review logs without leaving the app.

## Features

- **AI-first orchestration** – Uses configurable Nunjucks prompt templates to describe players, regions, locations, and encounters before calling any OpenAI-compatible chat completion API.
- **Rich world state** – Manages players, NPCs, items, exits, and regions entirely in memory with helpers in `Player`, `Region`, `Location`, `Thing`, and related classes.
- **Browser control panel** – Ships Nunjucks views and vanilla JS for chat, new-game onboarding, settings, configuration editing, and debug dashboards (with Cytoscape-powered maps).
- **Optional art generation** – Integrates with ComfyUI to queue portraits, locations, exits, and item renders using customizable workflow JSON templates.
- **Persistent saves and logs** – Stores save-game snapshots, prompt transcripts, and generated images on disk so you can resume or debug any adventure.

## Prerequisites

- Node.js 18 or later
- npm 9 or later
- Access to an OpenAI-compatible API endpoint and key
- _(Optional)_ Running ComfyUI instance if you plan to keep `imagegen.enabled: true` (see [comfy.org](https://comfy.org) for installation instructions)

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the sample configuration and make it your own:
   ```bash
   cp config.default.yaml config.yaml
   ```
3. Edit `config.yaml`:
   - Set `ai.endpoint`, `ai.apiKey`, and `ai.model` to match your provider.
   - Adjust `server.port`/`server.host` if you do not want the default `0.0.0.0:7777` binding.
   - Toggle `imagegen.enabled` or update the ComfyUI settings under `imagegen.server`.

> ⚠️ Never commit real API keys. Treat `config.yaml` as a secret.

## Running

Start the server with:

```bash
npm start
```

By default the app binds to `http://0.0.0.0:7777`. Pass `--port <number>` to `node server.js` (or edit `config.yaml`) if you need a different port. Once running you can:

- Visit `/` for the chat client, player sheet, and regional map.
- Use `/new-game` to roll a fresh campaign.
- Manage configuration at `/config` and saved settings at `/settings`.
- Inspect current world state, logs, and queues at `/debug`.

The front end talks to the JSON API defined in `server.js`. Key routes cover chat (`/api/chat`), player management (`/api/player`), world generation (`/api/locations`, `/api/regions`), saving/loading (`/api/save`, `/api/load`), and optional image jobs (`/api/generate-image`). Real-time events such as job updates are brokered through `RealtimeHub` using WebSockets.

## Project Layout

```
├── server.js              # Express entry point, API routes, prompt orchestration, job queue
├── Player.js / Region.js  # Core world state models (players, regions, items, exits)
├── prompts/               # Nunjucks prompt templates (XML/YAML) for story and imagery
├── imagegen/              # ComfyUI workflow JSON templates rendered via Nunjucks
├── public/                # Static assets, compiled CSS, ES modules, Cytoscape bundles
├── views/                 # Nunjucks views for the in-app UI
├── saves/                 # Game snapshots and saved setting profiles
├── logs/                  # Prompt/response transcripts rotated on server start
└── tests/                 # Node scripts to exercise parsers and API flows manually
```

## Development Tips

- When image generation is disabled the game continues without art; re-enable it after your ComfyUI host is healthy.
- The `tests/` folder contains standalone scripts (`node tests/<name>.js`) you can run against a live server for quick regression checks.
- Logs rotate into `logs_prev/` on startup so you can compare the previous session with the current one.

## Community

Questions, feedback, or want to share your campaign? Join the Discord: https://discord.gg/XNGHc7b5Vs

Happy adventuring!
