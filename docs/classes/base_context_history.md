# base_context_history.js

`base_context_history.js` contains the shared prompt-history exclusion rules used by base-context prompt assembly and by prompt-visible chat history lookup tools.

## Exported Helpers

- `shouldExcludeEntryFromPromptHistory(entry)`: returns `true` for entries that must stay out of LLM-facing prompt history in every mode.
- `shouldIncludeEntryInBaseContextHistory(entry, options)`: applies the base-context inclusion predicate after the caller has decided whether the entry has renderable text.
- `resolveRecentHistoryBatchInterval(value, defaultValue)`: resolves the configured interval and throws for invalid values.
- `resolveBatchedRecentHistoryTurnCount(options)`: returns the deterministic recent-window size for a total prose-turn count, minimum recent window, and rollover interval.

`shouldIncludeEntryInBaseContextHistory()` requires `hasRenderableContent: true`. Metadata-only records without content, usable summary text, or renderable structured event-summary rows do not enter `<olderStoryHistory>` or `<recentStoryHistory>`.

## Always-Excluded Entries

The prompt-history exclusion helper rejects:

- entries whose normalized `role` is `system`;
- entries with `ephemeral: true`;
- player-only or diagnostic entry types: `check-results`, `game-improvement-suggestions`, `relationship-updates`, `tonal-scale-evaluation`, `tracker-updates`, and `tool-call-debug`;
- entries with `metadata.debugToolCalls === true` or `metadata.checkResults === true`;
- entries carrying structured `toolCalls` or `checkResults` arrays;
- legacy diagnostic text whose `content` or `summary` starts with `Tool calls for`, `Tool call debug: N call(s)`, `Checks for`, or `Checks: N check(s)`.

These exclusions apply to normal base-context history, all-entry generic prompt history, improvement prompt history, and the `getHistory` chat tool.

## Normal Base-Context Mode

With `includeAllEntryTypes: false`, the base-context predicate also excludes:

- `status-summary` entries;
- `level-up` entries;
- `event-summary` entries when the caller passes `omitEventSummaryHistory: true`;
- entries marked with `metadata.excludeFromBaseContextHistory === true`.

Entries that survive those checks can appear in base-context history if the renderer can derive visible text from them.

## All-Entry Mode

With `includeAllEntryTypes: true`, non-diagnostic stored chat entries with renderable text can pass regardless of entry type or `metadata.excludeFromBaseContextHistory`. This mode allows generic prompt flows to inspect administrative or prompt-excluded story rows such as `@@` generic prompt entries, status summaries, level-up entries, and event summaries.

All-entry mode still honors the always-excluded rules. System entries, ephemeral entries, prompt diagnostics, player-only housekeeping `tracker-updates` and `relationship-updates`, `game-improvement-suggestions`, `tonal-scale-evaluation`, structured tool/debug/check rows, and metadata-only entries stay out of prompt history.

## Base-Context Assembly

`server.js` builds base prompt history in `buildBasePromptContext()` before `prepareBasePromptContext()` returns the context used by `prompts/base-context.xml.njk`.

History assembly behavior:

- Boolean options are validated explicitly. `omitInventoryItems`, `omitAbilities`, and `omitCraftHistory` can come from `config.base_context`; `omitEventSummaryHistory` and `includeAllHistoryEntryTypes` are per-call options.
- When craft history omission is enabled, craft/process/salvage/harvest entries and their child entries are removed before base-context filtering.
- Event summaries are renderable from sanitized `content` or from `summaryItems`; lines containing the event-summary strip token are omitted.
- In scene-summary saves, the raw-history boundary follows the stored scene summary store's contiguous coverage from index `1`. Prompt-visible records through the last contiguously covered scene-index entry are candidates for scene-summary rendering; every later prompt-visible record renders from full content.
- `summaries.max_summarized_log_entries` caps only the covered history considered for scene-summary rendering. Uncovered history is never hidden merely because it exceeds `summaries.max_unsummarized_log_entries`; this can happen while automatic summarization is running or after a surfaced summary failure.
- Non-indexed prompt-visible records such as event summaries follow the same chronological coverage frontier. Records after the frontier remain raw. Records at or before it are part of the covered section and retain the existing scene-summary fallback rules.
- `summaries.max_unsummarized_log_entries` remains the automatic scene-summary trigger. The asynchronous threshold check summarizes from the first uncovered scene-summary index entry through the current end, while prompt rendering continues to expose every uncovered record until the new block is installed.
- Line-summary saves retain their per-entry summarized/raw window behavior: the filtered list is capped by `summaries.max_summarized_log_entries + summaries.max_unsummarized_log_entries`, and the configured unsummarized tail renders from full content.
- The final history segments are split into `gameHistory` and `recentGameHistory` by `config.recent_history_turns`, counting prose-turn entries (`player-action`, `npc-action`, `quest-reward`, `random-event`, and untyped assistant prose). `config.recent_history_batch_interval` lets the recent window grow above that minimum and moves one complete interval-sized batch into older history at each deterministic rollover. An interval of `1` keeps the former per-turn rollover.
- User and non-assistant entries receive speaker prefixes with saved in-world time labels when `metadata.worldTime` is present. Assistant prose uses `[Storyteller]`.
- Location and absent-character lines are inserted when those annotations change.
- Hidden server-side story-note entries that pass the predicate render with the `[Hidden from Player]` label. Plot summary and plot expander entries are injected separately as `<plotSummary>` and `<plotExpander>` rather than through ordinary history.

`prompts/base-context.xml.njk` emits `<olderStoryHistory>` from `gameHistory` only when it is non-empty and prompt-level `omitGameHistory` is not active. `config.prompt_uses_caching === true` keeps that block available and also ignores prompt-level inventory, ability, and quest-list omissions. The builder also ignores per-call `omitEventSummaryHistory` in caching mode. It continues to honor `omitCraftHistory` and `includeAllHistoryEntryTypes` as accepted rare/specialized exceptions; those options can change story-history text, including `<olderStoryHistory>` when affected entries are old enough. Without those exceptions, `<recentStoryHistory>` is the first omission-sensitive point. The plot-analysis and tonal-scale-evaluation prompts retain their self-context exclusions after `</gameState>`.

For scene-summary saves, adding chat records between summary batches only appends to the uncovered history. It does not slide an oldest raw record into the summarized section. The summarized prefix changes only when a newly generated contiguous scene-summary block is installed (or stored summaries are explicitly edited/rebuilt). The recent/older split inside the resulting prompt history changes only at the configured recent-history batch interval.

Character records in base context also include non-empty relationship sections. `<relationships>` lists how that character relates to other characters by resolved name, and `<reciprocalRelationships>` lists how off-scene/non-party characters relate to that character. Empty sections are omitted, and reciprocal labels from characters already present in the prompt cast are omitted because those characters render their own outgoing labels.

## Prompt Paths

- Regular player, NPC, question, event, generation, scheduled-event, plot, mystery, barter, crafting, and other base-context prompts use normal base-context history unless a caller passes an omission option.
- Location stub expansion and region generation pass `omitEventSummaryHistory: true` so mechanical event bundles do not steer generation.
- Crafting, processing, salvage, and harvest prompts can use craft-history omission through `base_context.omit_craft_history` or explicit prompt options.
- Generic prompt actions `@...`, `@@...`, and `@@@...` render through `base-context.xml.njk` with `includeAllHistoryEntryTypes: true`.
- `@@...` entries are persisted with `metadata.excludeFromBaseContextHistory: true`; `@@@...` entries are not persisted. Both markers still receive all-entry context for the prompt being answered.
- No-context generic prompt actions `\...` render through `prompts/generic-prompt-nocontext.xml.njk`; they do not call `prepareBasePromptContext()` and do not receive chat tools.
- Improvement prompts render through the base-context wrapper with `includeAllHistoryEntryTypes: true`; their stored `game-improvement-suggestions` entries are visible to the player but excluded from every future prompt-history path.
- Manual tonal-scale evaluations store visible `tonal-scale-evaluation` entries, but those entries are excluded from every future prompt-history path because the latest evaluation is injected separately through structured base context.
- Housekeeping tracker and relationship update entries are stored visibly for the player as `tracker-updates` and `relationship-updates`, but both types are excluded from every future prompt-history path because current tracker and relationship state already appears in structured base context.

## History Tool Behavior

`chat_tool_calls.js` uses `shouldExcludeEntryFromPromptHistory()` for `getHistory`.

- Regular prompts search assistant prose-like history only.
- Generic prompts pass `includeAllHistoryEntryTypes: true` into the tool loop, so `getHistory` can search all non-diagnostic stored entry types.
- Search text prefers `content`. In all-entry mode, entries without content can also expose `summary` or structured fields.
- Diagnostic and player-only exclusions remain in force for tool searches, so `getHistory` does not return `tool-call-debug`, `check-results`, `game-improvement-suggestions`, `tonal-scale-evaluation`, `tracker-updates`, `relationship-updates`, system entries, or legacy diagnostic text blocks.
