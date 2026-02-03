# Developer Overview

This doc is a quick-start map to catch up at the beginning of a session. It summarizes the game, the server architecture, and where to look next for details.

## What this game is

- Server-driven, setting-agnostic, LLM-assisted RPG with persistent world state, where the LLM generates the game setting, regions, locations, NPCs, items, and so on, with varying amounts of input from the user, and then acts as the game master.
- Core entities include players/NPCs, locations/regions, items/scenery, quests, factions, skills, and status effects.
- Optional image generation via ComfyUI, NanoGPT, or OpenAI clients.

## Runtime architecture (high level)

- `server.js` bootstraps config, `Globals`, Express + HTTP, `RealtimeHub`, `ModLoader`, and Nunjucks prompt environments, then wires up core helpers.
- `api.js` registers routes; `/api/chat` is the main turn handler (prompt rendering, LLM call, parsing, autosave, and response shaping).
- `Events.js` runs structured LLM event checks and applies world mutations (locations, NPCs, items, quests, status effects).
- `LLMClient.js` owns chat completions: concurrency limits, streaming progress, retries, and prompt logging to `logs/`.

## Core domain models

- `Player` models players/NPCs, with attributes, inventory, gear, quests, dispositions, needs, and progression.
- `Location` and `Region` model the world; `LocationExit` defines travel links.
- `Thing` models items/scenery with rarity, bonuses, and status effects.
- `Faction`, `Quest`, `StatusEffect`, and `Skill` define game systems.
- `Globals` provides access to current player/location/region, config, prompt env, and realtime emit helpers.
- `SceneSummaries`, `SettingInfo`, and `LorebookManager` support memory, settings, and lorebook injection.

## Turn flow mental model

1. Client sends a chat/action to `/api/chat`.
2. Server applies state ticks (status effects, travel metadata) and renders prompt templates.
3. `LLMClient.chatCompletion` runs; progress is broadcast via `RealtimeHub` and prompts are logged.
4. Responses are parsed; `Events.runEventChecks` may apply structured outcomes.
5. Slop/repetition handling runs where applicable; autosaves and response payloads are emitted.

## API + command surface

- High-level API index: `docs/API_README.md`; detailed endpoints: `docs/api/*`.
- Shared response shapes: `docs/api/common.md`.
- Slash command pipeline: `docs/slash_commands.md` and `docs/slashcommands/*`.

## Where to look first (session warm-up)

- `AGENTS.md` for repo-specific constraints and coding rules.
- `docs/README.md` for the full documentation map.
- `docs/server_llm_notes.md` for the end-to-end server + LLM flow.
- `docs/classes/LLMClient.md` and `docs/classes/Events.md` for generation and event-check details.
- `docs/classes/Player.md`, `docs/classes/Location.md`, `docs/classes/Region.md`, `docs/classes/Thing.md` for world state.

## Known quirks

- `/api/attributes` is defined twice; Express binds the first definition (see `docs/api/attributes.md`).
