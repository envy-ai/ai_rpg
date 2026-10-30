# ReprocessEventsCommand

`/reprocess_events` reruns event processing for the most recent stored gameplay turn without regenerating its prose. It takes no arguments and ignores slash-command messages, including its own row, when selecting the turn.

The command calls `interaction.reprocessLatestEvents()`, uses normal event application and history summaries, and refreshes location/player and relationship displays. It skips completed tracked sections. When nothing remains, it reports that the recorded events are already complete.

Replay does not run the player-action/story prompt, NPC turns, need-bar or quest-check prompts, housekeeping, random/scheduled event resolution, automatic prose summaries, another player move, or clock advancement. Supporting item/NPC/status and other generation necessary to apply an event remains enabled.

Older turns without replay metadata are accepted with a duplication warning. An interrupted partial application can likewise be retried with a warning. Known completed passes and committed technique receipts remain protected. See [EventReprocessor](../classes/EventReprocessor.md) for saved tracking, source validation and failure behavior.

Errors retain their stack and use the existing prompt-failure window or persistent error dialog. Missing helpers, unavailable locations/receipts, edited source prose, concurrent gameplay work and runtime replacement fail explicitly. The command is auto-registered from `slashcommands/reprocess_events.js`.
