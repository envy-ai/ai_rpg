# GameIntroCommand

## Purpose
`/game_intro` generates opening-scene narration and appends it to the active chat history as visible assistant prose. `/intro` is an alias for the same command.

## Args
- None.

## Registration and help
- Implemented by `slashcommands/game_intro.js`.
- Registered through `SlashCommandRegistry.initializeSlashCommands()` with canonical name `game_intro` and alias `intro`.
- `/help` lists the canonical `/game_intro` command with the command description from the module.

## Behavior
- Requires `Globals.generateGameIntro` to be available and callable. If it is missing, the command throws `Game intro generation is unavailable.`.
- Calls `Globals.generateGameIntro()` and requires it to return a stored chat-entry object. If no object is returned, the command throws `Game intro generation did not produce a chat entry.`.
- Requires `Globals.realtimeHub.emit` after generation. If the realtime hub is unavailable, the command throws `Realtime hub is unavailable; cannot refresh chat history.`.
- Emits a global `chat_history_updated` event with an empty payload after generation so connected clients refresh chat history.
- Sends a public slash-command reply confirming that intro prose was appended to chat history.

## Intro generation path
`Globals.generateGameIntro` is assigned to `runGameIntroPrompt()` in `api.js`. That helper is shared by `/game_intro`, immediate new-game intro generation, and deferred new-game intro generation after startup ability selection.

The helper:
- Renders `base-context.xml.njk` with `promptType: 'game-intro'`.
- Calls `LLMClient.chatCompletion()` with `metadataLabel: 'game_intro'` and `validateXML: false`.
- Logs the prompt and response through `LLMClient.logPrompt()` using `prefix: 'game_intro'`.
- Parses the LLM response as XML and requires a non-empty `<introProse>` element.
- Applies slop removal when `Globals.config.slop_buster === true`. When slop removal records diagnostics, it stores a related `type: slop-remover` entry with the intro entry as parent.
- Resolves the entry location from the explicit helper arguments or `currentPlayer.currentLocation`.
- Stores a visible assistant entry with `type: 'game-intro'`, `content` and `summary` set to the parsed intro prose, and the resolved `locationId`.
- Calls the shared visible-prose refresh helper for stream/client/request-aware updates.
- Runs the standard autosave flow after the intro entry is stored. Autosave failures are logged as warnings and do not fail the command.
- Returns the stored chat entry.

## Prompt contract
The prompt include `prompts/_includes/game-intro.njk` asks for 2-4 short paragraphs of concrete opening narration and requires XML shaped as:

```xml
<gameIntro>
  <introProse>...</introProse>
</gameIntro>
```

Missing XML, XML parse errors, or an empty `<introProse>` value raise clear errors from the parser.
