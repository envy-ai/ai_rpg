# housekeeping_history.js

`collectHousekeepingPlayerTurns(chatHistory)` groups player actions, assistant prose and event/status text into persisted turns. `buildHousekeepingTurnHistory(chatHistory, options)` selects those turns using the saved last-run boundary or the initial configured interval, then supplements the current turn with its authoritative action, prose and event text.

Historical entries pass `shouldExcludeEntryFromPromptHistory()` from `base_context_history.js` before turn grouping or interval selection. System notices, debug/tool/check records, metadata-marked diagnostics and legacy diagnostic text cannot start a turn or contribute prose/events, even when their entry type otherwise matches the housekeeping allowlist. Ordinary event/status summaries remain eligible under the existing rules. Filtering reads the original records without changing chat history or saved boundaries.

Missing or invalid turn/boundary data retains the existing explicit errors. Tests live in `tests/housekeeping_history.test.js`.
