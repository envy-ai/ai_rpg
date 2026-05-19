# base_context_history.js

`base_context_history.js` centralizes the base-context history inclusion predicate used while building prompt history.

- Normal base-context history excludes status summaries, level-up entries, entries marked with `metadata.excludeFromBaseContextHistory`, and optionally event-summary entries for prompt paths that request event-summary omission.
- Generic prompt actions (`@`, `@@`, and `@@@`) pass `includeAllHistoryEntryTypes: true` through `/api/chat` into `prepareBasePromptContext()`. In that mode, any stored chat log entry with renderable text can be included, regardless of entry type or `excludeFromBaseContextHistory`.
- No-context generic prompts (`\`) still use `prompts/generic-prompt-nocontext.xml.njk`, so they do not use base-context history.

The helper still requires `hasRenderableContent: true`; metadata-only records without text are not rendered into `<olderStoryHistory>` or `<recentStoryHistory>`.
