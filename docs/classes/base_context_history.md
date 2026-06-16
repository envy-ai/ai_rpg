# base_context_history.js

`base_context_history.js` contains the shared prompt-history exclusion rules used by base-context prompt assembly and by prompt-visible chat history lookup tools.

## Exported Helpers

- `shouldExcludeEntryFromPromptHistory(entry)`: returns `true` for entries that must stay out of LLM-facing prompt history in every mode.
- `shouldIncludeEntryInBaseContextHistory(entry, options)`: applies the base-context inclusion predicate after the caller has decided whether the entry has renderable text.

`shouldIncludeEntryInBaseContextHistory()` requires `hasRenderableContent: true`. Metadata-only records without content, usable summary text, or renderable structured event-summary rows do not enter `<olderStoryHistory>` or `<recentStoryHistory>`.

## Always-Excluded Entries

The prompt-history exclusion helper rejects:

- entries whose normalized `role` is `system`;
- entries with `ephemeral: true`;
- diagnostic entry types: `check-results`, `game-improvement-suggestions`, and `tool-call-debug`;
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

All-entry mode still honors the always-excluded rules. System entries, ephemeral entries, prompt diagnostics, `game-improvement-suggestions`, structured tool/debug/check rows, and metadata-only entries stay out of prompt history.

## Base-Context Assembly

`server.js` builds base prompt history in `buildBasePromptContext()` before `prepareBasePromptContext()` returns the context used by `prompts/base-context.xml.njk`.

History assembly behavior:

- Boolean options are validated explicitly. `omitInventoryItems`, `omitAbilities`, and `omitCraftHistory` can come from `config.base_context`; `omitEventSummaryHistory` and `includeAllHistoryEntryTypes` are per-call options.
- When craft history omission is enabled, craft/process/salvage/harvest entries and their child entries are removed before base-context filtering.
- Event summaries are renderable from sanitized `content` or from `summaryItems`; lines containing the event-summary strip token are omitted.
- The filtered list is capped by `summaries.max_summarized_log_entries + summaries.max_unsummarized_log_entries`.
- The tail `summaries.max_unsummarized_log_entries` entries render from full content. Earlier capped entries render as scene-summary blocks when scene summaries cover them; otherwise their sanitized summaries are used.
- The final history segments are split into `gameHistory` and `recentGameHistory` by `config.recent_history_turns`, counting prose-turn entries (`player-action`, `npc-action`, `quest-reward`, `random-event`, and untyped assistant prose).
- User and non-assistant entries receive speaker prefixes with saved in-world time labels when `metadata.worldTime` is present. Assistant prose uses `[Storyteller]`.
- Location and absent-character lines are inserted when those annotations change.
- Hidden server-side story-note entries that pass the predicate render with the `[Hidden from Player]` label. Plot summary and plot expander entries are injected separately as `<plotSummary>` and `<plotExpander>` rather than through ordinary history.

`prompts/base-context.xml.njk` emits `<olderStoryHistory>` from `gameHistory` only when it is non-empty and prompt-level `omitGameHistory` is not active. `config.prompt_uses_caching === true` keeps that prompt-level history block available for cache-stability runs. `<recentStoryHistory>` is emitted from `recentGameHistory`.

## Prompt Paths

- Regular player, NPC, question, event, generation, scheduled-event, plot, mystery, barter, crafting, and other base-context prompts use normal base-context history unless a caller passes an omission option.
- Location stub expansion and region generation pass `omitEventSummaryHistory: true` so mechanical event bundles do not steer generation.
- Crafting, processing, salvage, and harvest prompts can use craft-history omission through `base_context.omit_craft_history` or explicit prompt options.
- Generic prompt actions `@...`, `@@...`, and `@@@...` render through `base-context.xml.njk` with `includeAllHistoryEntryTypes: true`.
- `@@...` entries are persisted with `metadata.excludeFromBaseContextHistory: true`; `@@@...` entries are not persisted. Both markers still receive all-entry context for the prompt being answered.
- No-context generic prompt actions `\...` render through `prompts/generic-prompt-nocontext.xml.njk`; they do not call `prepareBasePromptContext()` and do not receive chat tools.
- Improvement prompts render through the base-context wrapper with `includeAllHistoryEntryTypes: true`; their stored `game-improvement-suggestions` entries are visible to the player but excluded from every future prompt-history path.

## History Tool Behavior

`chat_tool_calls.js` uses `shouldExcludeEntryFromPromptHistory()` for `getHistory`.

- Regular prompts search assistant prose-like history only.
- Generic prompts pass `includeAllHistoryEntryTypes: true` into the tool loop, so `getHistory` can search all non-diagnostic stored entry types.
- Search text prefers `content`. In all-entry mode, entries without content can also expose `summary` or structured fields.
- Diagnostic exclusions remain in force for tool searches, so `getHistory` does not return `tool-call-debug`, `check-results`, `game-improvement-suggestions`, system entries, or legacy diagnostic text blocks.
