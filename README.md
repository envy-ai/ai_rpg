# AI RPG

<img src='screenshots/Screenshot 2025-10-15 at 08-11-17 AI RPG Chat Interface.png' style='width: 80%; margin: auto; height: auto'>

AI RPG turns an OpenAI-compatible language model into a solo tabletop game master. The Node.js application keeps track of players, locations, regions, and items; renders structured prompts with Nunjucks; and optionally drives a ComfyUI image pipeline so every scene can ship with fresh artwork. A lightweight browser UI and JSON API sit on top, letting you explore the world, tweak settings, and review logs without leaving the app.

## Features

- A rich, structured region and location generation system for coherent locations.
- Visual region maps using node graphs.
- Tracking of NPCs and items.
- Multiple party members can accompany you and act independently.
- Levels, classes, stats, skills, and abilities.
- The ability to create your own world setting, with or without help from the AI
- A detailed NPC memory system that keeps track of important memories of individual NPCs.
- Numerical skill and ability checks with real RNG and AI-generated circumstance bonuses to ensure fair action resolution
- A modifiable needs system that tracks, by default, food, rest, and mana.
- A detailed under-the-hood disposition system that tracks separate axes for platonic friendship, romantic interest, trust, respect, etc, and moves slowly over time so you can get that "slow burn" feeling.
- Detailed AI event processing so that the program can understand basically any action you throw at it.
- Probably some more stuff I don't remember right now

## Tips

- Type whatever action you want to take!
- NPC and item images have a small '...' menu in the upper right corner. Access some "creative mode" stuff there.
- If you want to bypass plausibility checking, precede what you type with '!'. You can control the gane world and other characters this way, do things that are implausible, and bypass skill checks.
- If you want to bypass the AI interpreting what you typed in prose along with bypassing plausibility checking, precede what you type with '!!'.
- If you want to enter something into the chat log without affecting anything or having events called, precede what you type with '#'.
- Preliminary support for slash commands is available and there are a few implemented. Type /help for details.
- Regions are pre-generated when you move into them and filled with location "stubs". Moving into a new region can take a long time, so be patient. Moving into a new stub location takes a while too -- about half as long as a new region. Moving to explored locations without taking any actions there skips the AI by default, so it's basically instantaneous.

## Caution

This is still in alpha! Expect bugs! If you want to help, when you find something that doesn't work right, come up with a test case so we can debug.

## Prerequisites

- Node.js 18 or later
- npm 9 or later
- Access to an OpenAI-compatible API endpoint and key
- An LLM with a minimum of 32k of context that can consistently output valid XML.
- _(Optional)_ Running ComfyUI instance if you plan to keep `imagegen.enabled: true` (see [comfy.org](https://comfy.org) for installation instructions)

### Recommended specs

- A large, sophisticated model such as GLM 4.6 or Deepseek 3.1 Terminus (in non-thinking mode)
- qwen-image, either through an API or on ComfyUI.
- 128k+ of LLM context

### Known working LLMs

- GLM 4.6
- Deepseek 3.1 Terminus
- <a href='https://huggingface.co/mradermacher/Circuitry_24B_V.2-GGUF'>Circuitry 24B Q_6</a>
- <a href='https://huggingface.co/TheDrummer/Gemma-3-R1-12B-v1-GGUF'>TheDrummer's Gemma 3 12B</a>
- <a href='https://huggingface.co/bartowski/Goekdeniz-Guelmez_Josiefied-Qwen3-8B-abliterated-v1-GGUF'>Josiefied-Qwen3-8B-abliterated-v1 by Goekdeniz-Guelmez</a> in a pinch. It didn't really "get" region generation when I tested it.

Plenty of other LLMs will work as well. Some will not. Drop by the <a href='https://discord.gg/XNGHc7b5Vs'>Discord</a> or the <a href='https://reddit.com/r/aiRPGofficial'>subreddit</a> and let us know what does and doesn't work!

## Installation

1. Install <a href='https://nodejs.org/en/download/'>Node.js</a> if you don't already have it.

2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the sample configuration and make it your own:
   ```bash
   cp config.default.yaml config.yaml
   ```
4. Edit `config.yaml`:
   - Set `ai.endpoint`, `ai.apiKey`, and `ai.model` to match your provider. You can use local programs like KoboldCPP that support the OpenAI API as well as any external provider that does so.
   - Adjust `server.port`/`server.host` if you do not want the default `0.0.0.0:7777` binding.
   - Toggle `imagegen.enabled` or update the ComfyUI settings under `imagegen.server`. You can also set up external image generation that supports the OpenAI image generation API.

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

## Technical Features

- **AI-first orchestration** – Uses configurable Nunjucks prompt templates to describe players, regions, locations, and encounters before calling any OpenAI-compatible chat completion API.
- **Rich world state** – Manages players, NPCs, items, exits, and regions entirely in memory with helpers in `Player`, `Region`, `Location`, `Thing`, and related classes.
- **Browser control panel** – Ships Nunjucks views and vanilla JS for chat, new-game onboarding, settings, configuration editing, and debug dashboards (with Cytoscape-powered maps).
- **Optional art generation** – Integrates with ComfyUI to queue portraits, locations, exits, and item renders using customizable workflow JSON templates.
- **Persistent saves and logs** – Stores save-game snapshots, prompt transcripts, and generated images on disk so you can resume or debug any adventure.

## Future plans

Near future:

- Quests
- Character goals
- Elapsed in-game time, day/night cycle, seasons, etc
- Configure multiple AIs for different types of prompts so you can throw character prose at the big ones and have the little ones handle housekeeping for speed.

## Development Tips

- When image generation is disabled the game continues without art; re-enable it after your ComfyUI host is healthy.
- Logs are made in `./logs/` and rotate into `./logs_prev/` on startup so you can compare the previous session with the current one. If you have problems, keep those around because they help to diagnose things.

## Community

Questions, feedback, or want to share your campaign? Join the Discord: https://discord.gg/XNGHc7b5Vs or visit our <a href='https://reddit.com/r/aiRPGofficial'>subreddit</a>.

Happy adventuring!
