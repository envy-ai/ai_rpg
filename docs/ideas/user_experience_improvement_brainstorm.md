# User Experience Improvement Brainstorm

This document collects UI, workflow, and developer-experience ideas that could make the game easier to understand, play, debug, and resume. It intentionally avoids prescribing implementation details beyond likely integration points.

## Guiding principles

- Show the player what changed, where it changed, and why it matters.
- Keep freeform text central, but surround it with useful context and shortcuts.
- Make existing systems discoverable before adding entirely new systems.
- Favor reversible, inspectable actions for state-heavy workflows.
- Improve mobile and keyboard workflows alongside desktop mouse workflows.

## Low-effort ideas

### 1. Turn state-diff drawer

Create a compact drawer attached to each turn that groups state changes: time passed, health changes, need changes, faction reputation, disposition, item movement, NPC arrivals/departures, quest progress, and location changes. Event summaries already exist, so this is mainly a presentation and filtering improvement.

Benefits:
- Makes LLM consequences easier to audit.
- Helps players understand why sidebars changed.
- Helps developers spot malformed event outcomes.

Likely anchors:
- Existing `event-summary` entries
- `summaryItems`
- Chat insight and attachment rendering
- `docs/api/common.md` `ChatEntry`

Risks:
- Duplicating event summaries could create clutter.
- Needs filtering and collapse behavior from the start.

### 2. Clickable entity references in chat

Turn recognized NPC, item, location, region, quest, and faction names in assistant prose into links that open the existing tooltip or detail modal.

Benefits:
- Makes the prose more navigable.
- Reduces sidebar hunting.
- Helps players remember generated names.

Likely anchors:
- `moreInfo` tool summaries
- Existing entity modals and tooltips
- Chat rendering in `public/js/chat.js`

Risks:
- Autolinking must avoid false positives in common words.
- Link generation should use known IDs when possible, not just names.

### 3. Current-situation strip

Add a short persistent strip near the chat composer or Adventure panel: location, region, time, weather/light, vehicle state, party count, critical needs, combat/blocker state, and pending ability picks.

Benefits:
- Gives players immediate orientation after reload.
- Makes blockers and danger visible.
- Reduces need to scan multiple panels before acting.

Likely anchors:
- Existing `worldTime` payloads
- Location responses
- Current player/party state
- Pending ability selection endpoint

Risks:
- Must stay compact on mobile.
- Should not duplicate full sidebar content.

### 4. Action composer helpers

Add optional composer tools: recent actions, common verbs, targeted entity picker, inline roll override insertion, and "ask a question" / "generic prompt" mode buttons. The output should remain editable text.

Benefits:
- Lowers the barrier for new players.
- Improves mobile usability.
- Makes existing prefixes like `?`, `@`, and `\` easier to discover.

Likely anchors:
- Chat input history behavior
- Slash command help modal
- Entity chooser modals

Risks:
- Must not turn the game into a rigid command menu.
- Needs good keyboard behavior.

### 5. Save resume summary

When loading a save, show a concise resume card: current location, party, active quests, recent summary, unresolved consequences, world time, vehicle underway state, pending ability picks, and last save timestamp.

Benefits:
- Helps players return to long-running games.
- Makes hidden plot summaries practically useful.
- Warns about blockers before the player acts.

Likely anchors:
- Save metadata
- Scene summaries
- Plot summary/expander entries
- `/api/load` response and load modal

Risks:
- Needs careful hidden-info filtering.
- Should not slow down load.

### 6. Model/config health panel

Add a clearer runtime health view for text backend, image backend, config validation, active mods, current setting, force-output state, and prompt concurrency. This can be a developer-facing debug/config improvement.

Benefits:
- Shortens setup and debugging loops.
- Makes backend failures less mysterious.
- Helps compare OpenAI-compatible and Codex bridge behavior.

Likely anchors:
- `/config`
- `/debug`
- `LLMClient.getConfigurationErrors(...)`
- Mod loader state

Risks:
- Must avoid exposing secrets such as API keys.
- Should distinguish warnings from hard errors.

## Medium-effort ideas

### 7. Top menu and header revamp

Redesign the top menu/header into a consistent shared navigation system across pages. The current main menu behaves and looks inconsistent between pages; a unified header could give the app a stronger visual identity, make page switching predictable, and reduce the sense that different sections belong to different tools.

The revamp could include:

- One shared page-header partial used by all top-level pages.
- Consistent page ordering, labels, icons, active-state styling, and disabled/hidden states.
- Clear grouping for play, world/setup, configuration, tools, and developer/debug pages.
- A responsive mobile layout that does not collapse into cramped or inconsistent buttons.
- A compact status area for current save/setting/backend state where useful.
- A clearer visual hierarchy between global navigation, page-specific tabs, and in-page actions.
- Consistent treatment of destructive or developer-only actions so they do not look like ordinary navigation.

Benefits:
- Makes the app feel more cohesive and polished.
- Reduces orientation cost when moving between chat, settings, config, lorebooks, debug, and new-game pages.
- Creates a shared place for future UX ideas like command palette access, save status, backend health, or current setting.
- Makes responsive and keyboard navigation easier to handle once instead of per page.

Likely anchors:
- `views/_navigation.njk`
- `views/_includes/head-common.njk`
- Top-level page templates in `views/`
- `docs/ui/pages.md`
- `docs/ui/assets_styles.md`
- Page-specific SCSS/CSS for main/settings/config pages

Risks:
- Cross-page visual changes can create broad screenshot/regression churn.
- Header height, sticky behavior, and modal layering need careful testing.
- Developer/debug links should remain discoverable without cluttering normal gameplay.
- Existing page-specific tabs and action buttons must not be confused with global navigation.

### 8. Global command palette

Add a keyboard-first palette for slash commands, settings pages, NPCs, locations, items, saves, prompt logs, and common UI actions. Use fuzzy search and show the action type clearly.

Benefits:
- Makes a large UI faster to operate.
- Helps advanced users avoid hunting through panels.
- Gives slash commands a discoverable surface.

Likely anchors:
- Slash command registry/help data
- Entity indexes
- Existing chooser modals

Risks:
- Needs permission/context checks so actions do not appear when invalid.
- Search results can become noisy without strong grouping.

### 9. Quest and thread dashboard

Create a dashboard that separates hard quests from soft story threads, rumors, consequences, promises, faction obligations, and player agenda notes.

Benefits:
- Helps players decide what to do next.
- Makes emergent narrative state visible.
- Gives hidden plot systems a player-facing counterpart.

Likely anchors:
- Quest model
- Chat summaries
- Story Tools
- Proposed consequence ledger

Risks:
- Must avoid revealing hidden GM-only details.
- Requires clear lifecycle states: active, paused, resolved, failed, archived.

### 10. Map route inspection

Let players click a destination on the region/world map and see known route time, required exits, vehicle status, unexplored stubs, and whether the path is currently blocked.

Benefits:
- Makes travel-time work visible.
- Improves navigation in large generated worlds.
- Helps debug one-way or stale exits.

Likely anchors:
- Region/world map UI
- `Location.findShortestTravelTimeMinutes(...)`
- `/api/exits/options`
- Vehicle exit filtering

Risks:
- Unknown stubs and directed edges need honest display.
- Route lookup should fail loudly on malformed graph data.

### 11. Prompt progress timeline

The prompt-progress overlay already exposes streaming, cancel, retry, and prompt viewing. A timeline view could group a full turn's prompt calls by phase: action, tools, event checks, need checks, NPC turns, random event, summaries, slop remover, image jobs.

Benefits:
- Makes long turns less opaque.
- Helps developers identify slow or failing phases.
- Helps users trust that the app is still working.

Likely anchors:
- `prompt_progress` websocket events
- `LLMClient` metadata labels
- Existing prompt viewer window

Risks:
- Needs coalescing so high-frequency updates stay readable.
- Must not overwhelm normal players.

### 12. Entity history tabs

Add a history tab to NPC, item, location, and quest modals: recent mentions, changes, ownership/movement, status effects gained/lost, and relevant chat turns.

Benefits:
- Makes persistence visible.
- Helps inspect whether event checks mutated the right object.
- Makes recurring NPCs and important items easier to follow.

Likely anchors:
- Chat history search
- Event summaries
- Object metadata

Risks:
- Requires event summaries to preserve enough IDs or names.
- Backfilling old saves may be limited.

### 13. New-game generation checklist

During new-game creation, show a checklist of generation phases: setting load, calendar, factions, player, region, locations, NPCs, items, abilities, intro, images. Allow each phase to display status, logs, and retry where safe.

Benefits:
- Makes long new-game startup more understandable.
- Helps catch partial failures.
- Provides a better place for pending ability-selection flow.

Likely anchors:
- `/api/new-game`
- Prompt-progress events
- Existing deferred game intro behavior

Risks:
- Some phases are coupled today and may need clearer status events.
- Retry semantics must be explicit to avoid duplicate world state.

## High-effort ideas

### 14. Branching timeline and snapshot manager

Add a visual timeline of saves/autosaves with branch labels, summaries, screenshots, location/time metadata, and "fork from here" workflows.

Benefits:
- Encourages experimentation.
- Makes autosaves useful instead of opaque.
- Helps players recover from unwanted LLM outcomes.

Likely anchors:
- Save/load APIs
- Autosave pruning
- Scene summaries
- Image snapshots if available

Risks:
- Save storage and cleanup policy become more important.
- Needs strong distinction between overwrite, fork, and load.

### 15. World inspector/editor

Build a developer/admin inspector for live world state: players, NPCs, locations, regions, exits, stubs, factions, quests, things, containers, vehicles, and indexes. Include validation checks, backlinks, safe repair actions, and jump links to edit modals. See `docs/ideas/world_inspector_editor_brainstorm.md` for an expanded brainstorm.

Benefits:
- Dramatically improves debugging complex saves.
- Gives explicit visibility into graph and persistence issues.
- Reduces the need for ad hoc console inspection.

Likely anchors:
- Existing `/debug`
- API docs and shared serializers
- Integrity checks around movement/save/load

Risks:
- Large scope if it becomes a full editor.
- Must prevent accidental destructive changes.

### 16. Conversation and memory browser

Provide a dedicated browser for chat history, scene summaries, hidden plot notes, NPC memories, selected important memories, and lorebook injections. Include filters by entity, location, prompt label, and hidden/visible status.

Benefits:
- Makes memory behavior inspectable.
- Helps diagnose context bloat and missing continuity.
- Gives story-heavy players a useful journal.

Likely anchors:
- `SceneSummaries`
- NPC memory selection
- Story Tools
- Lorebook manager

Risks:
- Hidden entries need careful labeling and possibly developer-only access.
- Search/filter performance matters for long games.

### 17. Setting creation studio

Turn setting creation into a structured studio: genre, tone, rules modules, default skills, factions, slop words, image style, calendars, start conditions, and preview prompts. Provide validation and sample generated output before starting a game. See `docs/ideas/setting_creation_studio_brainstorm.md` for an expanded brainstorm.

Benefits:
- Makes settings easier to author and reuse.
- Reduces broken new-game runs from incomplete settings.
- Gives mods/settings a clearer authoring surface.

Likely anchors:
- `SettingInfo`
- Settings API
- Config validation
- New-game settings save/load

Risks:
- Can sprawl into a full content authoring tool.
- Needs strong defaults so casual users are not overwhelmed.

### 18. Accessibility and keyboard-first pass

Audit the whole UI for keyboard navigation, focus management, modal layering, screen-reader labels, reduced motion, color contrast, target sizes, and mobile touch behavior.

Benefits:
- Improves the app for everyone, not just accessibility users.
- Helps the many modals and popovers feel predictable.
- Reduces regressions in a UI with dense panels.

Likely anchors:
- Shared modal and popover utilities
- Chat input and tab system
- Playwright screenshot/a11y checks

Risks:
- Broad pass touches many files.
- Needs regression testing across desktop/mobile.

### 19. In-app prompt lab

Add a developer-facing prompt lab that can run selected prompt templates against current save context, compare outputs, view logs, force fixture outputs, and replay with config overrides.

Benefits:
- Speeds prompt iteration.
- Makes deterministic prompt testing easier.
- Connects existing CLI helpers to the browser workflow.

Likely anchors:
- `scripts/run_prompts.js`
- forced output fixtures
- prompt logs
- config override support

Risks:
- Must avoid mutating live game state unless explicitly requested.
- Needs strict separation between dry-run and apply modes.

## Best first candidates

These ideas look like the strongest near-term UX payoff:

1. Turn state-diff drawer.
2. Clickable entity references in chat.
3. Current-situation strip.
4. Top menu and header revamp.
5. Action composer helpers.
6. Save resume summary.
7. Map route inspection.
