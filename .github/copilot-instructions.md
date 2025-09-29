# AI RPG Game Master - Copilot Instructions

## Architecture Overview

This is a **text-based RPG with AI Game Master** built on Node.js/Express with a unique template-driven prompt system:

- **Core Components**: Express server (`server.js`), ES13 Player class (`Player.js`), Nunjucks templating for both views and AI prompts
- **Data Flow**: User chat → AI Game Master → Dynamic responses using YAML+Nunjucks prompt templates
- **Storage**: In-memory player data (temporary), YAML definition files for game mechanics

## Key Development Patterns

### 1. Dual Nunjucks Environments

The system uses **two separate Nunjucks environments**:

```javascript
// Views (autoescape enabled) - for HTML rendering
const viewsEnv = nunjucks.configure("views", {
  autoescape: true,
  express: app,
});

// Prompts (autoescape disabled) - for AI prompt generation
const promptEnv = nunjucks.configure("prompts", { autoescape: false });
```

### 2. YAML+Nunjucks Prompt Templates

AI prompts are structured as `.yaml.njk` files in `/prompts/`:

```yaml
role: "Game Master"
systemPrompt: |
  You are a creative AI Game Master...
{% if playerName %}
player:
  name: "{{ playerName }}"
{% endif %}
```

- Templates are rendered with variables from `config.yaml`
- Parsed as YAML to extract `systemPrompt` field
- See `renderSystemPrompt()` function in `server.js`

### 3. ES13 Player Class with Private Fields

The `Player.js` class uses modern JavaScript patterns:

```javascript
class Player {
    #attributes = {};  // Private fields with #
    #health;

    static #generateUniqueId() { ... }  // Static private methods
}
```

- Definitions loaded from `defs/attributes.yaml`
- Dynamic attribute initialization from YAML config
- Validation and modifier calculations built-in

### 4. Configuration-Driven Game Master

Game behavior controlled via `config.yaml`:

```yaml
gamemaster:
  promptTemplate: gamemaster.yaml.njk
  promptVariables:
    gameStyle: narrative-focused
    setting: fantasy
```

## Critical Development Workflows

### Starting Development Server

```bash
npm start                    # Production mode
npm run dev                  # Development with nodemon
```

### Testing Player System

```bash
node test_debug_page.js      # Comprehensive player system test
```

### Key Debugging Routes

- `/debug` - Shows current player state and system info
- `/config` - Live configuration editor (saves to `config.yaml`)
- Main chat interface at `/` with system prompt debugging

## File Structure Conventions

```
/defs/           # YAML game definitions (attributes, locations)
/prompts/        # AI prompt templates (.yaml.njk)
/views/          # HTML templates (.njk)
/public/         # Static assets (CSS, JS)
/saves/          # Player save files (future feature)
```

## Integration Points

### AI Service Integration

- Configurable AI endpoint in `config.yaml`
- Chat API expects OpenAI-compatible format
- System prompts dynamically generated from templates

### Player-Action Integration

When a player exists, user messages trigger `player-action.yaml.njk` template with:

```javascript
{
    player: currentPlayer.getStatus(),
    actionText: userMessage.content
}
```

### Custom Nunjucks Filters

Dice rolling functionality available in all templates:

```javascript
// Available in both view and prompt templates
{
  {
    "1d20" | roll;
  }
} // Returns total
{
  {
    "2d6+3" | roll_detail;
  }
} // Returns detailed breakdown
```

## Project-Specific Conventions

- **No Database**: Currently uses in-memory storage with Map collections
- **YAML Everywhere**: Configuration, definitions, and prompt templates all use YAML
- **Glass Morphism UI**: Consistent design pattern across all pages
- **API-First Player Management**: RESTful endpoints for all player operations
- **Template-First AI Prompts**: No hardcoded AI prompts - everything uses the template system

## Common Development Tasks

### Adding New Player Attributes

1. Update `defs/attributes.yaml` with new attribute definition
2. Player class automatically loads and validates new attributes
3. Update relevant prompt templates to use new attributes

### Creating New Game Master Personalities

1. Create new `.yaml.njk` file in `/prompts/`
2. Update `config.yaml` to reference new template
3. Add any new variables to `promptVariables` section

### Adding New Pages

1. Create `.njk` template in `/views/`
2. Add route in `server.js`
3. Include navigation links in existing templates

### Additional instructions

- Always make use of vscode's todo list functions and keep a detailed todo list with subtasks for each request.
