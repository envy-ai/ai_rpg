# base_context_history.js

`base_context_history.js` centralizes the base-context history inclusion predicate used while building prompt history.

- Normal base-context history excludes system-role entries, prompt diagnostics such as `tool-call-debug`, `check-results`, and `game-improvement-suggestions`, status summaries, level-up entries, entries marked with `metadata.excludeFromBaseContextHistory`, and optionally event-summary entries for prompt paths that request event-summary omission.
- Generic prompt actions (`@`, `@@`, and `@@@`) pass `includeAllHistoryEntryTypes: true` through `/api/chat` into `prepareBasePromptContext()`. In that mode, ordinary stored chat log entries with renderable text can be included regardless of entry type or `excludeFromBaseContextHistory`, but system-role entries and prompt diagnostics are still excluded. This keeps visible `game-improvement-suggestions` entries available to the player while hiding them from every base-context prompt, including all-entry `@@` modes.
- No-context generic prompts (`\`) still use `prompts/generic-prompt-nocontext.xml.njk`, so they do not use base-context history.

The helper still requires `hasRenderableContent: true`; metadata-only records without text are not rendered into `<olderStoryHistory>` or `<recentStoryHistory>`.
