# housekeeping_history.js

`collectHousekeepingPlayerTurns(chatHistory)` groups player actions, assistant prose and event/status text into persisted turns. `buildHousekeepingTurnHistory(chatHistory, options)` selects those turns using the saved last-run boundary or the initial configured interval, then supplements the current turn with its authoritative action, prose and event text.

The optional `includeSourceEntries: true` adds each turn's original eligible `sourceEntries`, including named-actor prose and private notes. Both collection and building accept it; default turn shapes stay unchanged. These records remain read-only source references.

`buildHousekeepingTurnHistory` accepts optional positive integer `maxTurns`. It limits the oldest selected batch before adding current-turn supplements and additionally returns `batchTurns`, `currentTurn`, and `deferredTurnCount`. The persisted boundary comes only from `batchTurns`; a persisted current turn beyond the limit may be supplied without skipping deferred history. A current turn at/before the boundary still raises an error, using turn ordering when its ID exists and timestamp recovery when the boundary was deleted. Omitting `maxTurns` preserves ordinary housekeeping's selection, return shape, and boundary behavior. Faction housekeeping uses these options plus its own whole-turn character budget.

Historical entries pass `shouldExcludeEntryFromPromptHistory()` from `base_context_history.js` before turn grouping or interval selection. System notices, debug/tool/check records, metadata-marked diagnostics and legacy diagnostic text cannot start a turn or contribute prose/events, even when their entry type otherwise matches the housekeeping allowlist. Ordinary event/status summaries remain eligible under the existing rules. Filtering reads the original records without changing chat history or saved boundaries.

Missing or invalid turn/boundary data retains the existing explicit errors. Tests live in `tests/housekeeping_history.test.js`.
