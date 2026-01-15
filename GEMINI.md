# AI RPG Context

## Project Overview
**AI RPG** is a Node.js-based application that leverages OpenAI-compatible Large Language Models (LLMs) to function as an automated Game Master for solo tabletop role-playing games. It dynamically manages game state (players, NPCs, locations, quests) and generates narrative content and visuals on the fly.

## Technology Stack
- **Runtime:** Node.js
- **Framework:** Express.js
- **Templating:** Nunjucks (used for both UI views and LLM prompt generation)
- **Frontend:** Vanilla JavaScript, Cytoscape.js (for map visualization), HTML/CSS (Sass)
- **AI Integration:** OpenAI-compatible API client for text, ComfyUI or OpenAI API for image generation.
- **Data Storage:** In-memory state with JSON-based file persistence (`saves/` directory).

## Architecture
- **Entry Point:** `server.js` is the main application file, handling HTTP requests, WebSocket connections (`RealtimeHub.js`), and orchestrating the game loop.
- **Game Models:** Core logic is encapsulated in class files like `Player.js`, `Region.js`, `Location.js`, `Thing.js` (items), `Quest.js`, and `ModLoader.js`.
- **Prompt Engineering:** The `prompts/` directory contains XML/Nunjucks templates used to structure inputs for the LLM to ensure consistent output formats (often XML).
- **Image Generation:** The `imagegen/` directory contains workflows (e.g., for ComfyUI) to generate assets based on game context.
- **State Management:** The game maintains a rich state of the world, including detailed NPC memories and dispositions.

## Key Directories
- `prompts/`: Nunjucks templates for generating LLM prompts.
- `views/`: Nunjucks templates for the web interface.
- `public/`: Static assets (CSS, JS, generated images).
- `saves/`: Directory for game save files.
- `logs/`: Logs of LLM interactions (rotated on startup).
- `defs/`: YAML definitions for game attributes, items, etc.

## Setup and Execution
1.  **Installation:** `npm install`
2.  **Configuration:** Copy `config.default.yaml` to `config.yaml` and configure the AI endpoint and API keys.
3.  **Run:** `npm start` (starts the server on port 7777 by default).

## Development Conventions
- **Code Style:** Standard Node.js conventions.
- **Prompting:** Changes to game logic often require corresponding updates to prompt templates in `prompts/` to ensure the LLM understands the new context or rules.
- **Debugging:** Use `npm start` and check `logs/` for detailed prompt/response traces. The `/debug` route in the browser provides internal state visualization.
