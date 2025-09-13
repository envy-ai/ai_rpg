# Prompt Templates

This directory contains AI Game Master prompt templates in YAML+Nunjucks format (.yaml.njk).

## Template Format

The new .yaml.njk format provides structured, parseable prompts with the following structure:

```yaml
role: "Game Master Type"
description: "Brief description of the GM's specialty"

systemPrompt: |
  The main prompt text that gets sent to the AI.
  This can be multiple lines and contain detailed instructions.

guidelines:
  - "List of guidelines"
  - "That the AI should follow"

# Conditional sections based on template variables
{% if variableName %}
setting: "{{ variableName }}"
{% endif %}
```

## Available Templates

- **gamemaster.yaml.njk**: General-purpose game master template
- **fantasy-adventure.yaml.njk**: Specialized for fantasy adventure campaigns
- **mystery-investigation.yaml.njk**: Optimized for mystery and investigation scenarios

## Benefits of YAML Format

- **Structured Data**: Each template defines role, guidelines, and settings in organized sections
- **Template Variables**: Nunjucks templating allows dynamic content based on config.yaml variables
- **Extensible**: Easy to add new fields and metadata without breaking existing functionality
- **Parseable**: The YAML structure allows the server to extract specific fields like systemPrompt

## Template Variables

### gamemaster.yaml.njk
- `playerName` - The player's character name
- `gameStyle` - Style of gameplay (narrative-focused, action-packed, etc.)
- `setting` - Game world setting (fantasy, sci-fi, modern, etc.)
- `additionalInstructions` - Any custom instructions

### fantasy-adventure.yaml.njk
- `magicLevel` - How common magic is (rare, uncommon, common, abundant)
- `techLevel` - Technology level (medieval, renaissance, etc.)
- `tone` - Overall tone (heroic, gritty, comedic, etc.)
- `playerClass` - Character class (warrior, mage, rogue, etc.)
- `currentLocation` - Starting location

### mystery-investigation.yaml.njk
- `mysteryType` - Type of mystery (murder, theft, conspiracy, etc.)
- `setting` - Where the mystery takes place
- `difficultyLevel` - How challenging the mystery should be

## Usage

Templates are configured in `config.yaml` under the `gamemaster.promptTemplate` setting:

```yaml
gamemaster:
  promptTemplate: "fantasy-adventure.yaml.njk"
  promptVariables:
    magicLevel: "common"
    techLevel: "medieval"
    tone: "heroic"
    playerClass: "wizard"
```

The server automatically detects .yaml.njk files and parses them to extract the systemPrompt field for the AI.

## Migration from .njk

The old .njk format is still supported for backward compatibility. To use the new structured format:

1. Convert templates to .yaml.njk extension
2. Wrap the main prompt content in a `systemPrompt: |` field
3. Add structured metadata like `role`, `description`, and `guidelines`
4. Update config.yaml to reference the new filename

## Creating Custom Templates

1. Create a new `.yaml.njk` file in this directory
2. Use the structured YAML format with required `systemPrompt` field
3. Add Nunjucks variables: `{{ variableName }}`
4. Use conditionals: `{% if variableName %}...{% endif %}`
5. Update config.yaml to reference your new template
