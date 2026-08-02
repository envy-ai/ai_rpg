# SceneSummaryCommand

## Purpose
Slash command `/summarize` (alias `/scene_summary`) summarizes scene-summary-indexed chat history into stored scene summaries and writes a plain-text export.

## Args
- `range` (string, required): `check`, `all`, `N`, `N-M`, or `N..M`.
- `redo` (boolean, optional): when true, delete overlapping stored summaries before rebuilding the requested range.

## Behavior
- Reads chat history from `interaction.getChatHistory()` or `interaction.chatHistory`; unavailable or empty history produces an ephemeral reply.
- `range=check` counts total, summarized, and unsummarized entries with the shared scene-summary index and replies without calling the LLM summarizer.
- Other ranges call `Globals.summarizeScenesForHistoryRange({ chatHistory, startIndex, endIndex, redo })`; a missing summarizer throws `Scene summarization is unavailable on this server.`
- `range=all`, with or without `redo`, rebuilds from scene-summary entry 1 through the current end. The generated result atomically replaces the complete scene list and entry-id mapping store only after validation succeeds, so stale mappings are removed and a failed rebuild preserves the previous store.
- `range=N` summarizes one indexed entry; `range=N-M` and `range=N..M` summarize inclusive indexed ranges. Invalid, reversed, zero, or negative ranges produce ephemeral replies.
- Successful summarization requires at least one returned scene. The command writes `exports/summary-<timestamp>.txt`, echoes the formatted export to the server console, and replies with the output path.
- If the model starts its first scene after the first requested entry, that leading setup is included in the first stored scene so the requested range remains contiguous.
- Redo generation uses following-scene context but replaces only the complete original overlap range. Existing summaries remain unchanged if the model does not return enough boundary context or validation otherwise fails.
- Export or formatting failures produce ephemeral replies that include the failing operation and error message.

## Notes
- Scene-summary entry numbers are 1-based scene-summary index numbers, not raw `chatHistory` array offsets.
- The shared scene-summary index excludes prompt-history-excluded entries, diagnostics such as `tool-call-debug` and `check-results`, `event-summary`, `status-summary`, `plot-summary`, `plot-expander`, summary-style entries, and omitted-result markers.
- Hidden story-note entries remain eligible when they contain narrative text, including `supplemental-story-info`, `offscreen-npc-activity-daily`, `offscreen-npc-activity-weekly`, and `while-you-were-away`.
- The server summarizer requires a configured AI backend. It chunks long ranges by `summaries.scene_summary_max_entries_per_prompt`, logs prompts through `LLMClient.logPrompt()` under the `scene_summarize` prefix, and stores scene bounds in `Globals.getSceneSummaries()`.
