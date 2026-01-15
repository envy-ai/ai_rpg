# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI RPG is a Node.js/Express application that turns OpenAI-compatible LLMs into solo tabletop game masters. The system uses a sophisticated template-driven prompt architecture with Nunjucks to orchestrate AI-generated narratives while maintaining rigid game logic through structured event extraction.

## Commands

### Development
```bash
npm start          # Start the server (production)
npm run dev        # Start with nodemon (development)
```

### Configuration
- Copy `config.default.yaml` to `config.yaml` before first run
- Edit `config.yaml` to set AI endpoint, API key, model, and image generation settings
- Never commit `config.yaml` - it contains secrets

### Testing
```bash
node examples/location_generation_integration.js  # Test location generation
```

### Access Points
- Chat interface: `http://localhost:7777/`
- New game: `http://localhost:7777/new-game`
- Configuration editor: `http://localhost:7777/config`
- Settings profiles: `http://localhost:7777/settings`
- Debug dashboard: `http://localhost:7777/debug`

## Architecture

### Core Data Models

The game state is built on an ES13 class hierarchy using private fields (`#field`):

**Player** (`Player.js`)
- Central character state: attributes, skills, inventory, health, needs, status effects, party, quests, XP
- Uses static indexes (`Player.indexById`, `Player.indexByName`) for O(1) lookups
- Manages 13 gear slots with equipment bonuses
- Tracks NPC dispositions (friendship, romance, trust, respect)

**Region** (`Region.js`)
- Large geographic areas containing multiple locations
- Stores location blueprints, NPCs, level scaling, region-specific events
- Maintains secrets, concepts, and memory generation timestamps

**Location** (`Location.js`)
- Individual rooms/areas within regions
- Contains NPCs, Things (items/scenery), and LocationExit connections
- Tracks visited status, stub vs. fully-generated state
- References parent Region

**Thing** (`Thing.js`)
- Items and scenery objects with rarity, status effects, metadata, bonuses
- Equipable to player gear slots
- Can be in inventories or placed in locations

**Quest** (`Quest.js`)
- Composed of QuestObjective instances
- Tracks completion, rewards (items/currency/XP), giver, secret notes

**Pattern**: All models serialize via `.toJSON()` and reconstruct via `.fromJSON()` for save/load. Circular dependencies are avoided by storing IDs instead of object references.

### Triple Nunjucks Environment System

The application uses **three separate Nunjucks environments**:

1. **promptEnv** (`prompts/`) - AI prompt generation (autoescape: false)
   - Templates: `*.xml.njk`, `*.yaml.njk`
   - Rendered with game state context for LLM consumption
   - Parsed as XML/YAML to extract systemPrompt/generationPrompt/temperature

2. **imagePromptEnv** (`imagegen/`) - Image generation payloads (autoescape: false)
   - Templates: `*.json.njk`
   - Rendered to ComfyUI workflow JSON or API request bodies

3. **viewsEnv** (`views/`) - HTML rendering (autoescape: true)
   - Standard web interface templates

**Key function**: `prepareBasePromptContext()` in `server.js` builds the context object passed to all prompt templates, containing:
- Setting metadata (theme, genre, magic/tech levels)
- Player/NPC/Location state as XML
- Recent chat history and prose
- Dynamic definitions (skills, items, status effects)

### Server Orchestration - Main Game Loop

The core game loop is the `/api/chat` POST route in `server.js`:

1. Apply status effect need bar changes
2. Resolve travel metadata and plausibility checks
3. Generate player action prose via `LLMClient.chatCompletion()`
4. Parse events using `Events.processResponse()` with 70+ structured extraction prompts
5. Apply events to game state (mutate Player, Location, Region, Thing, NPC objects)
6. Run NPC turns (if enabled and not in combat)
7. Generate NPC memories on location changes
8. Process party memories on intervals
9. Return updated game state snapshot as JSON

**WebSocket integration**: `RealtimeHub` broadcasts real-time updates (`spinner:update`, `job:complete`) to connected clients during processing.

**Concurrency control**: `LLMClient` uses semaphores to limit concurrent API requests (configured via `ai.max_concurrent_requests`).

### Event Processing System

`Events.js` implements a declarative event extraction system:

**Flow**:
1. LLM generates narrative prose from `gamemaster.xml.njk`
2. `Events.processResponse(text, context)` sends 70+ specialized prompts to extract structured events
3. Events are organized by category:
   - Location events (exits, movement, alterations)
   - Item events (currency, pickup/drop, consumption, transfers)
   - NPC events (attacks, status changes, arrivals/departures, party changes)
   - Misc (quests, combat status, time passage, XP, dispositions)
4. `Events.apply(context)` mutates game state by calling applier functions:
   - `applyExitDiscovery()` - Create/connect locations
   - `applyItemEvents()` - Update inventories
   - `applyNpcEvents()` - Spawn NPCs, update health/status
   - `applyQuestEvents()` - Register new quests
   - (20+ other specialized appliers)

**Critical**: Events are extracted FROM prose (declarative) rather than imperative commands. This allows the LLM creative freedom while maintaining game logic consistency.

### Image Generation Pipeline

**Async architecture**: Image generation runs independently of the main game loop to avoid blocking gameplay.

**Flow**:
1. Game logic queues image jobs (portraits, locations, items, scenery)
2. `processJobQueue()` polls `job.queue[]` periodically
3. Jobs are submitted to configured engine:
   - **ComfyUI**: Renders `imagegen/*.json.njk` template, submits workflow via WebSocket
   - **NanoGPT/OpenAI**: Sends API request with prompt from `*-image.xml.njk` template
4. Status is polled until completion
5. Image ID is stored in Thing/Location/Player object
6. Clients fetch images via `/api/image/*` routes

**Configuration**: Set `imagegen.engine` to `comfyui`, `nanogpt`, or `openai`. Adjust `imagegen.maxConcurrentJobs` for parallel processing.

### API Routes

All routes are defined in `server.js` and follow RESTful patterns:

**Players**: `/api/player`, `/api/player/create-from-stats`, `/api/player/set-current`, `/api/player/health`, `/api/player/attributes`, `/api/player/equip`, `/api/player/levelup`, `/api/players/:id/portrait`

**Locations**: `/api/locations/:id`, `/api/locations/:id/exits`

**NPCs**: `/api/npcs/:id`, `/api/npcs/:id/teleport`, `/api/npcs/:id/equipment`, `/api/npcs/:id/portrait`

**Regions**: `/api/regions/:id`

**Chat**: `/api/chat` (POST - main game loop), `/api/chat/history`, `/api/chat/message`

**Quests**: `/api/quests/confirm`, `/api/player/quests/:questId`

**Pattern**: Routes typically return full object snapshots with nested data. WebSocket broadcasts supplement REST responses for real-time updates.

### Globals Singleton

The `Globals.js` class provides shared access to:
- `config` - Merged config.default.yaml + config.yaml
- `currentPlayer` - Active player instance
- `Player/Location/Region/Thing` - Class references
- `emit()` - RealtimeHub event broadcaster

Avoids circular dependencies by providing a central import point.

### Custom Nunjucks Filters

**Dice rolling** (`nunjucks_dice.js`):
- `{{ "1d20" | roll }}` - Returns total
- `{{ "2d6+3" | roll_detail }}` - Returns detailed breakdown

Available in all three Nunjucks environments.

## File Structure

```
server.js              # Express app, API routes, main game loop
api.js                 # Additional API route definitions
Player.js              # Player class with attributes, inventory, party
Region.js              # Region class with location blueprints
Location.js            # Location class with NPCs, Things, exits
LocationExit.js        # Exit connection between locations
Thing.js               # Items and scenery objects
Quest.js               # Quest and QuestObjective classes
Skill.js               # Skill definitions and helpers
StatusEffect.js        # Status effect (buffs/debuffs) class
Events.js              # Event extraction and application system
LLMClient.js           # AI API client with semaphore concurrency
ComfyUIClient.js       # ComfyUI image generation client
NanoGPTImageClient.js  # NanoGPT image API client
OpenAIImageClient.js   # OpenAI image API client
RealtimeHub.js         # WebSocket broadcaster
Globals.js             # Singleton for shared state access
SettingInfo.js         # World setting metadata
Utils.js               # Utility functions
ModLoader.js           # Mod system loader
lorebook.js            # Lorebook/codex management
SlashCommandRegistry.js # Slash command system
nunjucks_dice.js       # Dice rolling filters

prompts/               # Nunjucks prompt templates (XML/YAML)
  base-context.xml.njk       # Universal game state context
  gamemaster.xml.njk         # Main narrative generation
  location-generator.*.xml.njk  # Location creation
  npc-generate-*.xml.njk     # NPC skill/ability assignment
  player-portrait.xml.njk    # Character image prompts
  item-image.xml.njk         # Item image prompts
  (30+ other specialized templates)

imagegen/              # Image generation workflow templates
  qwen_image.json.njk        # Qwen image model workflow
  sdxl_illustrious.json.njk  # SDXL/Illustrious workflow

views/                 # HTML Nunjucks templates
  index.njk                  # Main chat interface
  new-game.njk               # Character creation
  config.njk                 # Configuration editor
  debug.njk                  # Debug dashboard

public/                # Static assets
  js/                        # Client-side JavaScript modules
    chat.js                  # Chat interface logic
    player-stats.js          # Player sheet rendering
    map.js                   # Cytoscape region map
    world-map.js             # World map visualization
  vendor/                    # Third-party libraries
    cytoscape.min.js         # Graph visualization
    markdown-it.min.js       # Markdown rendering
    nunjucks.js              # Client-side templating

defs/                  # YAML game definitions
  attributes.yaml            # Attribute definitions
  skills.yaml                # Skill definitions
  banned_npc_names.yaml      # Filtered NPC names
  banned_location_names.yaml # Filtered location names

saves/                 # Game save files (JSON)
autosaves/             # Automatic save backups
logs/                  # Prompt/response transcripts
logs_prev/             # Previous session logs (rotated on startup)

slashcommands/         # Slash command implementations
  help.js                    # Command help
  teleport.js                # Teleport to location
  heal.js                    # Heal player
  kill.js                    # Kill NPC
  (10+ other commands)

examples/              # Integration examples
  location_generation_integration.js

mods/                  # Optional mod system
  scene-illustration/        # Scene illustration mod
```

## Development Patterns

### Adding New Prompt Templates

1. Create `prompts/your-template.xml.njk` or `prompts/your-template.yaml.njk`
2. Use `prepareBasePromptContext()` output as template context
3. Render with `promptEnv.render('your-template.xml.njk', context)`
4. Parse XML/YAML to extract structured fields
5. Pass to `LLMClient.chatCompletion()`

### Adding New Event Types

1. Add event extraction prompt to `Events.js` in `EVENT_PROMPT_ORDER`
2. Implement parser in `Events.processResponse()` to extract structured data
3. Implement applier function (e.g., `applyYourEvent()`) in `Events.apply()`
4. Update relevant models to handle new event type

### Adding New Player Attributes

1. Update `defs/attributes.yaml` with attribute definition
2. Player class automatically loads and validates new attributes
3. Update `prompts/base-context.xml.njk` to include in context
4. Update relevant event extraction prompts to recognize attribute changes

### Adding New API Routes

1. Define route in `server.js` or `api.js`
2. Follow existing patterns: use `Globals.currentPlayer`, mutate models directly
3. Broadcast updates via `Globals.emit('eventName', data)` for WebSocket
4. Return JSON snapshots (avoid partial updates)

### Adding New Slash Commands

1. Create `slashcommands/your-command.js` extending `SlashCommandBase`
2. Implement `execute(args, context)` method
3. Register in `SlashCommandRegistry.js`
4. Command is automatically available via `/your-command` in chat

## Configuration

### AI Model Settings

In `config.yaml`:
- `ai.endpoint` - OpenAI-compatible API endpoint
- `ai.apiKey` - API key for authentication
- `ai.model` - Model identifier
- `ai.maxTokens` - Maximum tokens per response
- `ai.temperature` - Default temperature (0.0-1.0)
- `ai.stream` - Enable streaming responses
- `ai.max_concurrent_requests` - Concurrent API request limit

### Prompt Overrides

Override AI settings per prompt type in `config.yaml`:
```yaml
prompt_ai_overrides:
  player_action:
    temperature: 0.85
    frequency_penalty: 0.0
  npc_action:
    temperature: 0.85
```

### Image Generation

- `imagegen.enabled` - Enable/disable image generation
- `imagegen.engine` - `comfyui`, `nanogpt`, or `openai`
- `imagegen.api_template` - ComfyUI workflow template (e.g., `qwen_image.json.njk`)
- `imagegen.maxConcurrentJobs` - Parallel image processing limit

### Game Mechanics

- `plausibility_checks.enabled` - Enable skill checks and combat
- `event_checks.enabled` - Enable event extraction (disable for pure narrative mode)
- `npc_turns.enabled` - Allow NPCs to act independently
- `combat_npc_turns.enabled` - NPCs act during combat
- `quests.enabled` - Enable quest system
- `summaries.enabled` - Enable chat log summarization for context management

## Important Notes

### Lazy Circular Dependencies

Models use lazy requires to avoid circular dependency errors:
```javascript
// In Player.js
function getLocationModule() {
    if (!locationModule) {
        locationModule = require('./Location.js');
    }
    return locationModule;
}
```

Pattern is used in Player, Location, Region, Thing to cross-reference each other.

### XML Template Parsing

Prompt templates are rendered as XML/YAML and then parsed:
```javascript
const rendered = promptEnv.render('template.xml.njk', context);
const parsed = parseXMLTemplate(rendered);
// Extract: systemPrompt, generationPrompt, temperature, etc.
```

This enables dynamic prompt construction with validation.

### Save/Load Serialization

Models implement:
- `toJSON()` - Serialize to plain object
- `static fromJSON(data)` - Reconstruct from plain object

Handles:
- Private fields (`#field`)
- Nested objects (inventories, party members)
- ID references (converts object refs to IDs)

### Log Rotation

On server start:
- `./logs_prev/*.log` are deleted
- `./logs/*.log` are moved to `./logs_prev/`
- New logs are written to `./logs/`

Enables before/after session comparison for debugging.

### Streaming Progress

During long operations, use `RealtimeHub` for progress updates:
```javascript
Globals.emit('spinner:update', { text: 'Generating location...' });
```

Client-side JavaScript listens for WebSocket events and updates UI.

## Special Input Prefixes

Users can type special prefixes in chat:
- `!` - Bypass plausibility checking (creative mode)
- `!!` - Bypass AI interpretation AND plausibility (direct world control)
- `#` - Add to chat log without triggering events (out-of-character)
- `/` - Execute slash command (e.g., `/teleport`, `/help`)

## Known Working Models

Tested LLMs that consistently output valid XML:
- GLM 4.x series
- Deepseek 3.1 Terminus
- Circuitry 24B Q_6
- TheDrummer's Gemma 3 12B
- Josiefied-Qwen3-8B-abliterated-v1

Requires minimum 32k context, recommended 128k+ for best experience.
