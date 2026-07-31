# Developer Overview

This is a session warm-up map for the project shape, runtime flow, and first files to inspect. Keep detailed endpoint, class, and design notes in the focused docs linked below.

## What this game is

- Server-driven, setting-agnostic, LLM-assisted RPG with persistent world state. The LLM helps create settings, regions, locations, NPCs, items/scenery, factions, quests, and turn narration.
- Core entities include players/NPCs, locations/regions/exits, things, quests, factions, skills, status effects, scheduled events, mystery boxes/threads, scene summaries, and world-profile settings.
- Optional image generation runs through ComfyUI, NanoGPT, or OpenAI clients. Text generation runs through `LLMClient` using an OpenAI-compatible backend or the Codex, Cline, and Kimi CLI bridges.

## Runtime architecture (high level)

- `server.js` loads merged config and definitions, initializes `Globals`, Express + HTTP, `RealtimeHub`, `ModLoader`, `ModExtensionRegistry`, Nunjucks prompt/view environments, image clients, lorebooks, and in-memory world maps before registering `api.js`.
- `api.js` registers the HTTP API and owns most gameplay orchestration. `/api/chat` is the main turn handler: ability gates, autosaves, prompt rendering, chat-tool loops, LLM calls, slop/repetition handling, event checks, due vehicles/scheduled events, NPC turns, summaries, and response shaping.
- `Events.js` runs LLM event checks and applies world mutations. The XML event pipeline is the default; the legacy grouped prompt path remains a compatibility option through config.
- `LLMClient.js` owns chat completions: backend selection, model overrides, concurrency limits, streaming/progress broadcasts, cancellation/retry, XML/regex validation, prompt stats, and prompt/error logs under `logs/`.
- `ModLoader` and `ModExtensionRegistry` let enabled mods contribute definitions, prompts, chat tools, XML events, settings fields, entity fields, UI hooks, and startup validators.

## Core domain models

- `Player` models players and NPCs: attributes, skills, inventory, gear, abilities, quests, party state, dispositions, needs, barter state, faction standings, hidden/dead state, memories, and mod state.
- `Location`, `Region`, and `LocationExit` model the world graph, stubs, travel links, vehicles, weather, favorites, visits, random events, controlling factions, and generated assets.
- `Thing` models items and scenery, including stacks, containers, rarity, value, flags, status effects, attribute bonuses, prompt-scaled bonus metadata, checksums, and mod-owned extension fields.
- `Faction`, `Quest`, `StatusEffect`, `Skill`, `ScheduledEvent`, `MysteryBox`, and `MysteryThread` define persistent gameplay systems around relationships, objectives, mechanics, timing, and hidden continuity.
- `Globals` provides current player/location/region access, config, world time/calendar helpers, scene summaries, save metadata, runtime maps, and realtime emit helpers.
- `SceneSummaries` is implemented in `SceneSummaies.js` despite the class name; `LorebookManager` is implemented in `lorebook.js`.

## Turn flow mental model

1. Client sends a chat/action to `/api/chat`.
2. The route checks pending player choices, applies time-based needs/status work, handles travel metadata, snapshots world time, and runs an autosave when configured.
3. Prompt templates render through `promptEnv`; enabled chat tools include built-ins plus mod-registered tools.
4. `LLMClient.chatCompletion` or the chat-tool loop runs. Realtime progress, prompt cancellation/retry, prompt logging, and output-character stats are handled there.
5. Player-facing prose is stored, summarized, and optionally cleaned by slop/repetition systems.
6. `Events.runEventChecks` parses structured outcomes and mutates world state. Quest checks, need checks, mystery updates, due scheduled events, vehicle arrivals, NPC turns, scene summaries, and background plot/offscreen prompts run from this path as configured.
7. The response returns filtered client payloads, refresh hints, updated messages, event summaries, world time, player/location state, and stream metadata.

## API + command surface

- High-level API index: `docs/API_README.md`; detailed endpoint notes: `docs/api/*`.
- Shared response shapes: `docs/api/common.md`.
- Slash command pipeline: `docs/slash_commands.md` and `docs/slashcommands/*`.
- Prompt cancellation/retry endpoints live with miscellaneous API docs; Story Tools continuity endpoints live in `docs/api/mystery-boxes.md`, `docs/api/mystery-threads.md`, and `docs/api/scene-summaries.md`.

## Where to look first (session warm-up)

- `AGENTS.md` for repo-specific constraints and coding rules.
- `docs/README.md` for the full documentation map.
- `docs/server_llm_notes.md` for the end-to-end server + LLM flow.
- `docs/classes/LLMClient.md`, `docs/classes/CodexBridgeClient.md`, `docs/classes/ClineBridgeClient.md`, `docs/classes/KimiBridgeClient.md`, and `docs/classes/Events.md` for generation, tool loops, prompt validation, bridge transports, and event checks.
- `docs/classes/Player.md`, `docs/classes/Location.md`, `docs/classes/Region.md`, `docs/classes/Thing.md`, `docs/classes/Globals.md`, and `docs/classes/ScheduledEvent.md` for world state.
- `docs/modding.md`, `docs/modding_hooks.md`, `docs/classes/ModLoader.md`, and `docs/classes/ModExtensionRegistry.md` for the mod system.

## Compatibility notes

- `/api/attributes` is defined twice; Express binds the first definition (see `docs/api/attributes.md`).
- `Events.js` retains the config-gated legacy grouped event-check pipeline for compatibility with non-XML event checks.
