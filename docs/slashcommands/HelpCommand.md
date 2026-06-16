# HelpCommand

## Purpose
`/help` lists the registered slash commands with their descriptions and usage strings.

## Command
- Name: `/help`
- Aliases: none
- Args: none
- Description: `List available slash commands and their usage.`
- Execution overlay: default slash-command overlay behavior.

## Usage
```text
/help
```

## Execution Path
- `public/js/chat.js` treats chat input beginning with `/` as a slash command and posts `command`, parsed `args`, raw `argsText`, `userId`, and `clientId` to `/api/slash-command`.
- `api.js` resolves the command through `SlashCommandRegistry.getSlashCommandModule(...)`, builds the interaction context, and calls `HelpCommand.execute(interaction)`.
- `slashcommands/help.js` calls `SlashCommandBase.listCommands()` and replies through `interaction.reply(...)`.

## Behavior
- Reads the live slash-command registry through `SlashCommandBase.listCommands()`.
- Lists canonical commands only; aliases remain dispatch labels and do not appear as separate help entries.
- Sorts commands alphabetically by canonical command name.
- Includes each command's description when available.
- Includes each command's `usage` string. Commands without a custom `usage` getter use the base generated form from `SlashCommandBase`.
- Replies publicly with `ephemeral: false`.
- Replies with `No slash commands are currently available.` if the registry returns no canonical commands.

## Output Format
The normal reply begins with:

```markdown
**Available slash commands:**
```

Each command entry uses this shape:

```markdown
* **/<command>** - <description>  
Usage: ```/<command> <args>```
```

The chat client renders slash-command replies as local system messages with markdown enabled.

## Related Files
- `slashcommands/help.js`: command metadata and reply formatting.
- `SlashCommandBase.js`: `listCommands()` implementation and default usage generation.
- `SlashCommandRegistry.js`: command and alias registration.
- `api.js`: `/api/slash-command` request normalization, command lookup, validation, and interaction construction.
- `public/js/chat.js`: slash-command client parsing, API dispatch, reply rendering, and overlay handling.
