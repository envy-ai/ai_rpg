# Prompt Templates

This directory contains Nunjucks templates for AI prompts. This allows for dynamic, configurable prompts with variables.

## Available Templates

### `gamemaster.njk`
The default general-purpose Game Master prompt.

**Variables:**
- `playerName` - The player's character name
- `gameStyle` - Style of gameplay (narrative-focused, action-packed, etc.)
- `setting` - Game world setting (fantasy, sci-fi, modern, etc.)
- `additionalInstructions` - Any custom instructions

### `fantasy-adventure.njk`
Specialized for fantasy adventure RPGs with epic quests and magic.

**Variables:**
- `magicLevel` - How common magic is (rare, uncommon, common, abundant)
- `techLevel` - Technology level (medieval, renaissance, etc.)
- `tone` - Overall tone (heroic, gritty, comedic, etc.)
- `playerClass` - Character class (warrior, mage, rogue, etc.)
- `currentLocation` - Starting location

### `mystery-investigation.njk`
Optimized for mystery and investigation scenarios.

**Variables:**
- `mysteryType` - Type of mystery (murder, theft, conspiracy, etc.)
- `setting` - Where the mystery takes place
- `difficultyLevel` - How challenging the mystery should be

## Using Templates

1. **Configure in config.yaml:**
```yaml
gamemaster:
  promptTemplate: "fantasy-adventure.njk"
  promptVariables:
    magicLevel: "common"
    techLevel: "medieval"
    tone: "heroic"
    playerClass: "wizard"
```

2. **Create custom templates:**
   - Add new `.njk` files to this directory
   - Use Nunjucks syntax for variables: `{{ variableName }}`
   - Use conditionals: `{% if variableName %}...{% endif %}`
   - Use defaults: `{{ variableName | default("fallback") }}`

## Template Syntax Examples

```njk
You are a {{ role | default("Game Master") }}.

{% if playerName %}
The player's name is {{ playerName }}.
{% endif %}

{% if difficulty == "hard" %}
Make challenges very difficult.
{% elif difficulty == "easy" %}
Keep things simple and accessible.
{% else %}
Provide moderate challenges.
{% endif %}
```

## Best Practices

1. **Always provide defaults** for optional variables
2. **Use descriptive variable names**
3. **Include clear instructions** in the prompt
4. **Test prompts** with different variable combinations
5. **Document variables** in comments or README
