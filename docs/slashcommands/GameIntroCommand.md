# GameIntroCommand

## Purpose
Slash command `/game_intro` (alias `/intro`) to generate intro narration from the base-context intro prompt and append it to chat history.

## Args
- None.

## Behavior
- Calls `Globals.generateGameIntro()` to run the `game_intro` prompt.
- Appends a visible assistant chat entry (`type: game-intro`).
- Triggers the standard autosave flow after the intro entry is stored; autosave failures are logged as warnings and do not fail the command.
- Emits `chat_history_updated` via `Globals.realtimeHub` so clients refresh immediately.
- Replies with a confirmation message.
