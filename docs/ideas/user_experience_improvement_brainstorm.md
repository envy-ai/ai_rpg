# User Experience Improvement Brainstorm

This document collects UI, workflow, and developer-experience ideas that could make the game easier to understand, play, debug, and resume. It intentionally stays at the product/design level: enough shape to compare ideas and sequence work, but not a binding implementation plan.

The strongest UX opportunity is not adding more screens. It is helping the player answer five questions at any moment:

1. Where am I?
2. What changed because of the last action?
3. What matters here?
4. What can I do next?
5. How do I recover if the generated world surprises me?

## UX thesis

This game is a freeform adventure engine with dense persistent state. The UI should feel like a capable tabletop assistant: it should preserve the primacy of prose, but keep a legible table of facts beside it. The player should be able to play in natural language without being forced through menus, while still having enough visible structure to understand consequences, navigate the world, manage characters, and resume after days away.

Good UX for this project should do three things at once:

- Protect the magic of freeform play.
- Make generated state inspectable and trustworthy.
- Shorten the distance between noticing a thing and acting on it.

## Primary player journeys

These journeys are a useful way to evaluate every idea below.

### Returning after a break

The player loads a save and needs to recover the situation quickly: current scene, time, party, health/needs, active quests, travel state, unresolved risks, recent consequences, and likely next actions. This journey is currently spread across chat history, sidebars, modals, and hidden summaries.

High-value improvements:

- Save resume summary.
- Current-situation strip.
- Quest/thread dashboard.
- Conversation and memory browser.

### Playing a normal turn

The player reads prose, decides what to do, submits an action, waits through prompt work, then receives narration and world-state changes. This is the core loop; small frictions here compound.

High-value improvements:

- Turn state-diff drawer.
- Action composer helpers.
- Clickable entity references in chat.
- Prompt progress timeline.

### Exploring a generated world

The player needs to know what is nearby, where routes go, how long travel takes, what is unknown, and what is risky. The map and Adventure panels should support curiosity without forcing graph-debugger thinking onto normal play.

High-value improvements:

- Map route inspection.
- Current-situation strip.
- Entity history tabs.
- Travel-planner ideas from [travel_planner_journey_risk_brainstorm.md](travel_planner_journey_risk_brainstorm.md).

### Managing a long campaign

The player wants continuity: who matters, what promises were made, where important items moved, which factions care, and what the story seems to be about. This is where LLM-driven games often become foggy unless the UI creates durable memory surfaces.

High-value improvements:

- Quest and thread dashboard.
- Entity history tabs.
- Conversation and memory browser.
- Branching timeline and snapshot manager.

### Debugging or authoring

The developer or power user needs to inspect prompt behavior, generated state, config, mods, world profiles, and failed assumptions without spelunking through logs and raw JSON.

High-value improvements:

- Model/config health panel.
- World inspector/editor.
- In-app prompt lab.
- New-game generation checklist.
- Setting creation studio.

## Guiding principles

- Keep prose central. State surfaces should explain and accelerate play, not replace the action box.
- Show change, not just state. "What just happened?" is more important than another static panel.
- Make names navigable. If prose introduces a character, place, item, faction, quest, or thread, the player should be able to inspect it from that moment.
- Preserve uncertainty honestly. Unknown routes, hidden motives, unvisited stubs, and GM-only data should be labeled as unknown rather than guessed.
- Prefer reversible, inspectable actions for state-heavy workflows.
- Separate player-facing clarity from developer-facing power. Both are valuable, but they should not compete for the same visual space.
- Improve mobile, keyboard, and screen-reader workflows alongside desktop mouse workflows.
- Fail visibly in developer/admin surfaces. Silent UI omission is especially harmful in a generated-state game.

## Evaluation rubric

Use this quick rubric when deciding whether an idea deserves near-term work.

| Question | Good sign | Warning sign |
| --- | --- | --- |
| Does it improve the core turn loop? | It helps every few turns. | It is only useful in rare admin moments. |
| Does it reduce cognitive load? | It answers a concrete player question. | It adds another place to check. |
| Does it reuse existing state? | It presents data already produced by prompts/events. | It needs a new subsystem before it is useful. |
| Does it respect freeform play? | It leaves the final action editable as text. | It turns play into a rigid command menu. |
| Can v1 be small? | It can ship as a read-only or collapsed surface. | It needs full editing, sync, and repair on day one. |
| Does it reveal generated-state bugs? | It exposes malformed or missing links clearly. | It hides errors behind placeholders. |

## Low-effort ideas

### 1. Turn state-diff drawer

Create a compact drawer attached to each turn that groups state changes: time passed, health changes, need changes, faction reputation, disposition, item movement, NPC arrivals/departures, quest progress, location changes, and vehicle progress. Event summaries already exist, so this is mainly a presentation and filtering improvement.

Expanded brainstorm and implementation plan: [turn_state_diff_drawer_brainstorm_plan.md](turn_state_diff_drawer_brainstorm_plan.md).

Player problem:

- The player sees narration and sidebars change, but has to infer which facts changed and why.

First useful version:

- A collapsed "What changed" affordance on assistant turns.
- Grouped rows with icons, entity names, before/after values when available, and the originating reason text.
- A "developer details" expander only when raw event metadata is useful.

Design notes:

- Keep the default collapsed on visually dense turns.
- Highlight consequential changes first: injury, death/incapacitation, quest progress, travel, faction reputation, item gain/loss, and critical need changes.
- Use familiar adventure-game language: "Gained", "Lost", "Moved", "Arrived", "Time passed", "Relationship changed".
- Make entity names clickable where IDs are known.

Benefits:

- Makes LLM consequences easier to audit.
- Helps players understand why sidebars changed.
- Helps developers spot malformed event outcomes.

Likely anchors:

- Existing `event-summary` entries.
- `summaryItems`.
- Chat insight and attachment rendering.
- `docs/api/common.md` `ChatEntry`.

Risks:

- Duplicating event summaries could create clutter.
- Needs filtering and collapse behavior from the start.
- If event summaries lack stable IDs, some rows may need name-only linking with visible ambiguity handling.

### 2. Clickable entity references in chat

Turn recognized NPC, item, location, region, quest, and faction names in assistant prose into links that open the existing tooltip, detail modal, map focus, or quest/thread surface.

Player problem:

- Generated prose creates many proper nouns, but the UI does not always let the player chase them at the moment of curiosity.

First useful version:

- Link only exact known entity names in assistant prose.
- Prefer ID-backed links from event metadata and known current-context entities.
- On ambiguous names, open a chooser rather than guessing.

Design notes:

- Do not link common words, short names, or partial substrings.
- Avoid visual noise: links should be clear on hover/focus, but not make every paragraph look like a wiki page.
- Tooltips should answer "what is this?" quickly, while modals handle deeper inspection.
- Links should work from both mouse and keyboard.

Benefits:

- Makes prose more navigable.
- Reduces sidebar hunting.
- Helps players remember generated names.
- Builds trust that generated objects are real persisted game state.

Likely anchors:

- `moreInfo` tool summaries.
- Existing entity modals and tooltips.
- Chat rendering in `public/js/chat.js`.
- Shared chooser modals for ambiguous targets.

Risks:

- Autolinking must avoid false positives in common words.
- Link generation should use known IDs when possible, not just names.
- Generated aliases can create ambiguity; ambiguity should be surfaced, not silently resolved.

### 3. Current-situation strip

Add a short persistent strip near the chat composer or Adventure panel: location, region, time, weather/light, vehicle state, party count, critical needs, combat/blocker state, pending ability picks, and unsaved/prompt activity when relevant.

Player problem:

- After a reload or a long response, the player has to scan several panels to answer "what is the situation right now?"

First useful version:

- One compact row on desktop and a wrapping/chip-based strip on mobile.
- Only show urgent or orientation-critical data.
- Clicking a chip focuses the corresponding panel or modal.

Design notes:

- This should be a dashboard strip, not another full sidebar.
- Use severity and recency: critical needs and blockers deserve emphasis; ordinary stable facts should be quiet.
- Vehicle state should be phrased for play: "Underway to X, 42m remaining" is more useful than raw metadata.
- The strip should never obscure the action composer.

Benefits:

- Gives players immediate orientation after reload.
- Makes blockers and danger visible.
- Reduces need to scan multiple panels before acting.

Likely anchors:

- Existing `worldTime` payloads.
- Location responses.
- Current player/party state.
- Pending ability selection endpoint.
- Vehicle status data.

Risks:

- Must stay compact on mobile.
- Should not duplicate full sidebar content.
- Too many chips will train players to ignore the strip.

### 4. Action composer helpers

Add optional composer tools: recent actions, continue scene, common verbs, targeted entity picker, inline roll override insertion, and mode buttons for in-character action, out-of-character question, slash command, and no-context prompt. The output should remain editable text.

Player problem:

- New players do not know what kinds of actions are valid, and mobile players pay a high cost for typing precise entity names or prefixes.

First useful version:

- A small tool button beside the composer opens action starters.
- Selecting a helper inserts editable text, not an immediate command.
- Include context-aware entity insertion and known prompt prefixes.

Design notes:

- Keep the blank text box as the primary interface.
- Good starters are verbs, not commands: "Talk to...", "Examine...", "Travel to...", "Ask about...", "Use item on...".
- Recents should be semantic enough to be useful but not expose hidden prompt internals.
- Keyboard behavior must stay predictable for multiline editing and history recall.

Benefits:

- Lowers the barrier for new players.
- Improves mobile usability.
- Makes existing prefixes like `?`, `@`, and `\` easier to discover.
- Encourages better player input without constraining creativity.

Likely anchors:

- Chat input history behavior.
- Slash command help modal.
- Entity chooser modals.
- Existing inline roll override behavior.

Risks:

- Must not turn the game into a rigid command menu.
- Needs good keyboard and focus behavior.
- If suggestions feel generic, experienced players will ignore them.

### 5. Save resume summary

When loading a save, show a concise resume card: current location, party, active quests, recent summary, unresolved consequences, world time, vehicle underway state, pending ability picks, last save timestamp, and any warnings that require action before play can continue.

Player problem:

- Long-running generated campaigns are hard to re-enter because the important context is distributed through history and sidebars.

First useful version:

- A read-only card in the load flow after selecting a save.
- Uses existing save metadata and scene summaries where available.
- Offers direct actions: load, inspect history, view quests/threads, cancel.

Design notes:

- The card should answer "what was I doing?" and "what requires attention?"
- Keep hidden/GM-only information out of player-facing summaries.
- If summaries are missing, say what is unavailable rather than inventing a placeholder.
- This surface can later become the top card in a timeline/snapshot manager.

Benefits:

- Helps players return to long-running games.
- Makes hidden plot summaries practically useful without exposing secrets.
- Warns about blockers before the player acts.

Likely anchors:

- Save metadata.
- Scene summaries.
- Plot summary/expander entries.
- `/api/load` response and load modal.

Risks:

- Needs careful hidden-info filtering.
- Should not slow down load.
- Older saves may not have enough summary data; the UI should state that clearly.

### 6. Model/config health panel

Add a clearer runtime health view for text backend, image backend, config validation, active mods, active world profile, force-output state, prompt concurrency, and recent prompt failures. This is developer-facing, but should still be readable.

Player problem:

- When generation stalls or behaves strangely, the current cause may be buried in config, logs, or backend-specific behavior.

First useful version:

- A read-only status panel with green/yellow/red sections.
- Explicitly separates "hard error", "warning", "disabled by config", and "unknown".
- Shows recent failures with prompt labels and timestamps, not secret payloads.

Design notes:

- Avoid exposing API keys, headers, or raw secrets.
- Use plain operational language: "Text model configured", "Image backend disabled", "3 prompts queued".
- Include copyable diagnostics for bug reports without copying secrets.

Benefits:

- Shortens setup and debugging loops.
- Makes backend failures less mysterious.
- Helps compare OpenAI-compatible and Codex bridge behavior.

Likely anchors:

- `/config`.
- `/debug`.
- `LLMClient.getConfigurationErrors(...)`.
- Mod loader state.
- Prompt-progress data.

Risks:

- Must avoid exposing secrets such as API keys.
- Should distinguish warnings from hard errors.
- Can become noisy if it mirrors every low-level setting.

## Medium-effort ideas

### 7. Top menu and header revamp

Redesign the top menu/header into a consistent shared navigation system across pages. The current main menu behaves and looks inconsistent between pages; a unified header could give the app a stronger visual identity, make page switching predictable, and reduce the sense that different sections belong to different tools.

Expanded brainstorm: [header_revamp_brainstorm.md](header_revamp_brainstorm.md).

Player problem:

- The app has multiple major modes, but global navigation does not always communicate where the player is, which world/profile is active, or which links are operational vs developer tools.

First useful version:

- One shared header partial for top-level pages.
- Clear global groups: Play, Worlds, System, Tools.
- Mobile behavior that remains usable without cramming every action into the first row.

Design notes:

- The header should frame the app, not dominate gameplay.
- Page-specific tabs and actions should look subordinate to global navigation.
- Developer/debug links should remain discoverable without being visually equal to ordinary play actions.
- A small active-save/world indicator can reduce wrong-context mistakes.

Benefits:

- Makes the app feel more cohesive and polished.
- Reduces orientation cost when moving between Play, New Game, Worlds, Lorebooks, System, and Tools pages.
- Creates a shared place for future UX ideas like command palette access, save status, backend health, or active world profile.
- Makes responsive and keyboard navigation easier to handle once instead of per page.

Likely anchors:

- `views/_navigation.njk`.
- `views/_includes/head-common.njk`.
- Top-level page templates in `views/`.
- `docs/ui/pages.md`.
- `docs/ui/assets_styles.md`.
- Page-specific SCSS/CSS for main/settings/config pages.

Risks:

- Cross-page visual changes can create broad screenshot/regression churn.
- Header height, sticky behavior, and modal layering need careful testing.
- Developer/debug links should remain discoverable without cluttering normal gameplay.
- Existing page-specific tabs and action buttons must not be confused with global navigation.

### 8. Global command palette

Add a keyboard-first palette for slash commands, settings pages, NPCs, locations, items, saves, prompt logs, and common UI actions. Use fuzzy search and show the action type clearly.

Player problem:

- A powerful generated-world UI eventually has too many panels, modals, and commands for navigation-by-memory to scale.

First useful version:

- `Ctrl+K` / `Cmd+K` opens a palette.
- Results are grouped by type: Commands, Characters, Locations, Items, Pages, Saves.
- Selecting a result either navigates, focuses, opens a modal, or inserts editable composer text.

Design notes:

- The palette should be fast, predictable, and heavily keyboard-friendly.
- Destructive actions should require confirmation and should not appear next to harmless navigation without clear labeling.
- Context-invalid actions should either be hidden or shown disabled with a short reason.
- Search results should include a secondary label: current location, item owner, command syntax, page group.

Benefits:

- Makes a large UI faster to operate.
- Helps advanced users avoid hunting through panels.
- Gives slash commands and hidden UI actions a discoverable surface.

Likely anchors:

- Slash command registry/help data.
- Entity indexes.
- Existing chooser modals.
- Page route metadata.

Risks:

- Needs permission/context checks so actions do not appear when invalid.
- Search results can become noisy without strong grouping.
- A command palette can become a dumping ground if ownership is unclear.

### 9. Quest and thread dashboard

Create a dashboard that separates hard quests from soft story threads, rumors, consequences, promises, faction obligations, and player agenda notes.

Player problem:

- Adventure play creates obligations and curiosities that are not always formal quests, so the player can lose track of why a place, NPC, or item matters.

First useful version:

- A journal-style view with three sections: Active Quests, Open Threads, Player Notes.
- Each card shows title, related entities, last touched time/location, visible next lead, and current state.
- Manual pin/archive support for player control.

Design notes:

- Do not over-formalize every narrative hint. Soft threads should feel lighter than quests.
- Use states that fit adventure play: active, waiting, suspicious, resolved, failed, archived.
- Show provenance: the chat turn, scene summary, or event that created or updated the thread.
- Let players add their own notes; the best campaign journal is partly authored by the player.

Benefits:

- Helps players decide what to do next.
- Makes emergent narrative state visible.
- Gives hidden plot systems a player-facing counterpart.

Likely anchors:

- Quest model.
- Chat summaries.
- Story Tools.
- Proposed consequence ledger.
- Scene summaries.

Risks:

- Must avoid revealing hidden GM-only details.
- Requires clear lifecycle states.
- Automated thread extraction could be unreliable; v1 should lean on explicit quests, summaries, and manual notes.

### 10. Map route inspection

Let players click a destination on the region/world map and see known route time, required exits, vehicle status, unexplored stubs, and whether the path is currently blocked.

Player problem:

- Travel-time and graph data exist, but the player cannot easily reason about route cost, uncertainty, or broken paths.

First useful version:

- Clicking a known location shows shortest known route from the current location.
- Display total travel time, route steps, unknown segments, and vehicle requirements.
- Broken/missing paths should produce a clear message, not a silent empty route.

Design notes:

- Distinguish "unknown because unexplored" from "known but unreachable".
- Use directed-edge language carefully: "You know a way there" vs "You know a way back".
- For vehicle journeys, surface current trip state and destination semantics clearly.
- This should support planning, not automatically move the player unless they choose a travel action.

Benefits:

- Makes travel-time work visible.
- Improves navigation in large generated worlds.
- Helps debug one-way or stale exits.

Likely anchors:

- Region/world map UI.
- `Location.findShortestTravelTimeMinutes(...)`.
- `/api/exits/options`.
- Vehicle exit filtering.

Risks:

- Unknown stubs and directed edges need honest display.
- Route lookup should fail loudly on malformed graph data.
- A route planner can expose graph bugs that were previously hidden; that is useful, but it needs clear error wording.

### 11. Prompt progress timeline

The prompt-progress overlay already exposes streaming, cancel, retry, and prompt viewing. A timeline view could group a full turn's prompt calls by phase: action, tools, event checks, need checks, NPC turns, random event, summaries, slop remover, image jobs.

Player problem:

- Long turns can feel opaque even when the app is working, especially when several background or follow-up prompts are running.

First useful version:

- A "turn timeline" tab in the existing prompt-progress overlay.
- Rows grouped by phase with status, elapsed time, retry/cancel where allowed, and final outcome.
- Normal players see friendly labels; developer expanders expose prompt labels and log links.

Design notes:

- Use a compact timeline, not a constantly shifting progress wall.
- Preserve the existing quick controls for cancel/retry/view prompt.
- Background tasks should be visually distinct from blocking foreground tasks.
- The timeline should make it obvious whether the player can act now.

Benefits:

- Makes long turns less opaque.
- Helps developers identify slow or failing phases.
- Helps users trust that the app is still working.

Likely anchors:

- `prompt_progress` websocket events.
- `LLMClient` metadata labels.
- Existing prompt viewer window.

Risks:

- Needs coalescing so high-frequency updates stay readable.
- Must not overwhelm normal players.
- Prompt labels may need friendlier phase names.

### 12. Entity history tabs

Add a history tab to NPC, item, location, and quest modals: recent mentions, changes, ownership/movement, status effects gained/lost, relationship changes, and relevant chat turns.

Player problem:

- Persistent entities matter because they accumulate history, but most modals show current facts more clearly than the path that produced them.

First useful version:

- A read-only History tab in one or two high-value modal types first, probably NPCs and items.
- Include recent mentions and state changes from event summaries.
- Link back to chat turns where possible.

Design notes:

- Separate "mentioned in prose" from "state changed".
- For NPCs, include last seen, party membership history, faction reputation, disposition, injuries/death, and important quest/thread links.
- For items, include created, picked up, moved, equipped, split/merged, consumed, altered, or contained.
- Developer-only raw event details can live behind a secondary expander.

Benefits:

- Makes persistence visible.
- Helps inspect whether event checks mutated the right object.
- Makes recurring NPCs and important items easier to follow.

Likely anchors:

- Chat history search.
- Event summaries.
- Object metadata.
- Existing entity modals.

Risks:

- Requires event summaries to preserve enough IDs or names.
- Backfilling old saves may be limited.
- Too much history can bury the current state; keep Overview as the default tab.

### 13. New-game generation checklist

During new-game creation, show a checklist of generation phases: setting load, calendar, factions, player, region, locations, NPCs, items, abilities, intro, images. Allow each phase to display status, logs, and retry where safe.

Player problem:

- Starting a generated RPG can involve many opaque prompts and partial failures, and users need to know whether the game is building, blocked, or safe to enter.

First useful version:

- A visible checklist with phase status and elapsed time.
- Blocking failures show a clear error and next action.
- Non-blocking failures, such as optional images, are labeled as warnings.

Design notes:

- Avoid fake progress percentages. Use named completed/running/waiting/failed phases.
- Retry semantics must be explicit: "retry image" is safer than "retry world creation" after state has already been written.
- If ability selection is pending before the intro, surface that as a gameplay gate rather than a mysterious pause.

Benefits:

- Makes long new-game startup more understandable.
- Helps catch partial failures.
- Provides a better place for pending ability-selection flow.

Likely anchors:

- `/api/new-game`.
- Prompt-progress events.
- Existing deferred game intro behavior.

Risks:

- Some phases are coupled today and may need clearer status events.
- Retry semantics must be explicit to avoid duplicate world state.
- Checklist state must reflect real server progress, not merely client optimism.

### 14. Contextual adventure affordances

Add lightweight "possible approaches" around the current location, visible NPCs, exits, items, and active threads. This is not an AI hints system that solves the game; it is a UI affordance layer that reminds players which verbs and targets are available.

Player problem:

- Freeform input is powerful, but players can freeze when the UI offers no clear affordances beyond a blank box.

First useful version:

- A compact "Try" menu near the composer with context-aware starters:
  - Talk to an NPC.
  - Examine a visible item/scenery object.
  - Travel through an exit.
  - Check on a party member.
  - Work on an active quest/thread.
- Selecting a starter inserts editable text.

Design notes:

- The feature should invite play, not recommend optimal solutions.
- Keep suggestions grounded in visible/persisted state.
- Label generated or speculative suggestions clearly if later versions use AI.
- This pairs naturally with action composer helpers, but focuses on current-scene targets rather than general input tools.

Benefits:

- Reduces blank-page friction.
- Helps new players discover the range of verbs the game supports.
- Makes dense Adventure-panel state actionable.

Likely anchors:

- Current location NPCs/items/scenery/exits.
- Quest/thread dashboard.
- Entity chooser modals.
- Chat composer insertion behavior.

Risks:

- Overly generic suggestions will feel patronizing or noisy.
- AI-generated suggestions could reveal hidden information unless tightly constrained.
- Needs mobile-friendly layout.

## High-effort ideas

### 15. Branching timeline and snapshot manager

Add a visual timeline of saves/autosaves with branch labels, summaries, screenshots, location/time metadata, and "fork from here" workflows.

Player problem:

- Autosaves are useful mechanically, but they do not currently help players understand campaign branches, recover from unwanted outcomes, or experiment confidently.

First useful version:

- A timeline/list hybrid in the load screen.
- Each save shows location, world time, party, recent summary, and whether it is manual/autosave/branch.
- "Load" and "fork" are visually distinct operations.

Design notes:

- Use branch language sparingly; most players understand "continue from here" and "make a copy from here".
- Save cards should make overwrite risk obvious.
- Screenshots or location images can make saves recognizable, but textual metadata should carry the experience when images are missing.
- This becomes much stronger after save resume summaries exist.

Benefits:

- Encourages experimentation.
- Makes autosaves useful instead of opaque.
- Helps players recover from unwanted LLM outcomes.

Likely anchors:

- Save/load APIs.
- Autosave pruning.
- Scene summaries.
- Image snapshots if available.

Risks:

- Save storage and cleanup policy become more important.
- Needs strong distinction between overwrite, fork, and load.
- Requires careful handling of old save metadata.

### 16. World inspector/editor

Build a developer/admin inspector for live world state: players, NPCs, locations, regions, exits, stubs, factions, quests, things, containers, vehicles, indexes, and prompt-linked metadata. Include validation checks, backlinks, safe repair actions, and jump links to edit modals.

Expanded brainstorm: [world_inspector_editor_brainstorm.md](world_inspector_editor_brainstorm.md).

Player problem:

- Complex generated saves can break in ways that are difficult to diagnose from normal UI panels.

First useful version:

- Read-only inspector with validation warnings and backlinks.
- Start with graph integrity, orphaned objects, stale indexes, duplicate names, invalid containment, and vehicle destination consistency.
- Repair actions can come later, after the inspector earns trust.

Design notes:

- Treat this as an admin tool, not a normal gameplay page.
- Show both human labels and stable IDs.
- Every warning should explain why it matters and link to the affected object.
- Repair actions should preview changes before applying them.

Benefits:

- Dramatically improves debugging complex saves.
- Gives explicit visibility into graph and persistence issues.
- Reduces the need for ad hoc console inspection.

Likely anchors:

- Existing `/debug`.
- API docs and shared serializers.
- Integrity checks around movement/save/load.

Risks:

- Large scope if it becomes a full editor.
- Must prevent accidental destructive changes.
- Needs clear separation from player-facing UI.

### 17. Conversation and memory browser

Provide a dedicated browser for chat history, scene summaries, hidden plot notes, NPC memories, selected important memories, and lorebook injections. Include filters by entity, location, prompt label, and hidden/visible status.

Player problem:

- Long campaigns depend on memory, but the player and developer cannot easily inspect what the system remembers, summarizes, hides, or injects.

First useful version:

- A Story Tools expansion focused on search, filters, and source labels.
- Player-facing mode shows visible history and summaries.
- Developer mode can include hidden entries, prompt labels, memory selection, and lorebook hits.

Design notes:

- Source labels matter: visible chat, summary, plot note, NPC memory, lorebook, prompt log.
- Hidden content should be visually and permission-separated from player-facing journal content.
- Filters should support "show me everything about this NPC/location/quest".
- This could share interaction patterns with entity history tabs.

Benefits:

- Makes memory behavior inspectable.
- Helps diagnose context bloat and missing continuity.
- Gives story-heavy players a useful journal.

Likely anchors:

- `SceneSummaries`.
- NPC memory selection.
- Story Tools.
- Lorebook manager.

Risks:

- Hidden entries need careful labeling and possibly developer-only access.
- Search/filter performance matters for long games.
- Too many source types can confuse normal players unless modes are clear.

### 18. Setting creation studio

Turn world/setting creation into a structured studio: genre, tone, rules modules, default skills, factions, slop words, image style, calendars, start conditions, and preview prompts. Provide validation and sample generated output before starting a game.

Expanded brainstorm: [setting_creation_studio_brainstorm.md](setting_creation_studio_brainstorm.md).

Player problem:

- Settings/world profiles are powerful but easy to under-specify, and broken setup choices can surface only after a long generation run.

First useful version:

- A guided editor for the most failure-prone fields.
- Validation before generation.
- Preview snippets for skills, factions, starting location, and tone.

Design notes:

- This should feel like preparing a campaign pitch, not filling a config file.
- Strong defaults and templates are essential.
- Advanced fields should be available without overwhelming first-time users.
- The studio should hand off cleanly into the new-game generation checklist.

Benefits:

- Makes world profiles easier to author and reuse.
- Reduces broken new-game runs from incomplete settings.
- Gives mods and world profiles a clearer authoring surface.

Likely anchors:

- `SettingInfo`.
- Settings API.
- Config validation.
- New-game settings save/load.

Risks:

- Can sprawl into a full content authoring tool.
- Needs strong defaults so casual users are not overwhelmed.
- Preview prompts must not mutate live game state.

### 19. Accessibility and keyboard-first pass

Audit the whole UI for keyboard navigation, focus management, modal layering, screen-reader labels, reduced motion, color contrast, target sizes, and mobile touch behavior.

Player problem:

- Dense adventure UIs become frustrating when focus traps, hidden tabs, popovers, drag/drop, and mobile gestures are not predictable.

First useful version:

- A focused audit of the main chat page and its highest-traffic modals.
- Fix keyboard traps, missing labels, visible focus, modal return-focus, and touch target issues.
- Add regression checks for the most fragile interactions.

Design notes:

- Accessibility is not separate from quality here; it improves power-user keyboard flow and mobile play too.
- Prioritize shared modal/popover utilities to avoid one-off fixes.
- Reduce motion options should cover progress overlays and animated state changes.
- Color should not be the only signal for danger, quality, faction state, or active filters.

Benefits:

- Improves the app for everyone, not just accessibility users.
- Helps the many modals and popovers feel predictable.
- Reduces regressions in a UI with dense panels.

Likely anchors:

- Shared modal and popover utilities.
- Chat input and tab system.
- Playwright screenshot/a11y checks.
- SCSS shared components.

Risks:

- Broad pass touches many files.
- Needs regression testing across desktop/mobile.
- Some legacy UI patterns may need incremental migration.

### 20. In-app prompt lab

Add a developer-facing prompt lab that can run selected prompt templates against current save context, compare outputs, view logs, force fixture outputs, and replay with config overrides.

Player problem:

- Prompt iteration and debugging require jumping between CLI scripts, logs, config files, and game state.

First useful version:

- A dry-run-only browser surface for selected prompt templates.
- Choose current save/context, prompt template, model/config override, and fixture mode.
- View rendered prompt, response, parse result, validation errors, and log path.

Design notes:

- Dry run vs apply must be impossible to confuse.
- Prompt logs should be easy to open from the lab and from prompt progress.
- Failure output should be explicit: render error, backend error, parse error, validation error.
- This is a developer page; clarity beats visual polish.

Benefits:

- Speeds prompt iteration.
- Makes deterministic prompt testing easier.
- Connects existing CLI helpers to the browser workflow.

Likely anchors:

- `scripts/run_prompts.js`.
- Forced output fixtures.
- Prompt logs.
- Config override support.

Risks:

- Must avoid mutating live game state unless explicitly requested.
- Needs strict separation between dry-run and apply modes.
- Running expensive prompts from a browser needs clear cost/latency cues.

## Recommended roadmap

### Phase 1: Make the current loop legible

Best first candidates:

1. Turn state-diff drawer.
2. Current-situation strip.
3. Clickable entity references in chat.
4. Action composer helpers.

Why this phase first:

- It improves the play loop directly.
- It mostly repackages state the app already has.
- It creates shared patterns for chips, links, grouped summaries, and context actions that later features can reuse.

### Phase 2: Improve re-entry and navigation

Best candidates:

1. Save resume summary.
2. Quest and thread dashboard.
3. Map route inspection.
4. Entity history tabs.

Why this phase next:

- It helps long campaigns become sustainable.
- It turns generated persistence into player-visible continuity.
- It addresses the biggest RPG-specific failure mode: losing track of people, places, promises, and routes.

### Phase 3: Strengthen app structure and power-user flow

Best candidates:

1. Top menu and header revamp.
2. Global command palette.
3. Prompt progress timeline.
4. Model/config health panel.
5. New-game generation checklist.

Why this phase next:

- It makes the application feel coherent across pages.
- It gives advanced users faster workflows.
- It makes long-running LLM operations less mysterious.

### Phase 4: Add campaign-scale and developer-scale tooling

Best candidates:

1. Conversation and memory browser.
2. Branching timeline and snapshot manager.
3. World inspector/editor.
4. Setting creation studio.
5. In-app prompt lab.
6. Accessibility and keyboard-first pass, if not already advanced incrementally.

Why this phase later:

- These ideas are valuable but broad.
- They benefit from data, components, and interaction patterns established in earlier phases.
- They are more likely to touch storage, validation, or cross-page navigation.

## Cross-cutting design patterns

### Entity chips

Use a shared entity-chip pattern for NPCs, items, locations, regions, factions, quests, vehicles, and threads. A chip should support label, type icon, status marker, optional location/owner subtitle, and click/focus behavior.

Why it matters:

- Turn diffs, current-situation strips, dashboards, history tabs, route planners, and command palettes all need a consistent way to show game objects.

### Change rows

Use a shared change-row pattern for "before/after/reason/source" presentation. It can power the turn diff drawer, entity history, developer inspector, and prompt/event debugging.

Why it matters:

- This game is state-heavy. A reliable visual language for change is more important than another bespoke modal.

### Source labels

Show where information came from: visible prose, event check, scene summary, plot note, player note, prompt log, config, save metadata, or generated object field.

Why it matters:

- Players and developers need to distinguish facts, summaries, guesses, and hidden/system-only data.

### Progressive disclosure

Default to compact player-facing summaries. Put raw IDs, event payloads, prompt labels, and validation details behind developer expanders or developer pages.

Why it matters:

- The same system serves normal play and debugging. The UI should not make either audience feel like an afterthought.

### Editable suggestions

Whenever the UI suggests an action, insert editable text rather than executing immediately unless the user explicitly chooses a command action.

Why it matters:

- It protects freeform play and prevents the helper UI from becoming a rigid command interface.

## Open design questions

1. Should player-facing state surfaces use an in-world tone ("Your party is exhausted") or a utilitarian UI tone ("Party needs: 2 critical")? A mixed approach may work: utilitarian labels with flavorful details inside expanders.
2. How much hidden or developer-only data should be accessible during normal play? The safest default is separate player and developer modes.
3. Should soft story threads be generated automatically, player-authored, or both? A conservative v1 should allow manual notes and only surface explicit quest/summary data.
4. Should route inspection support "plan and execute" travel in the same flow, or remain inspection-only at first? Inspection-only is safer for v1.
5. Should the command palette be global from the start, or begin as a chat-page action/entity palette? Starting inside the chat page may produce value sooner.

## Best first candidates

These ideas look like the strongest near-term UX payoff:

1. Turn state-diff drawer.
2. Current-situation strip.
3. Clickable entity references in chat.
4. Action composer helpers.
5. Save resume summary.
6. Quest and thread dashboard.
7. Map route inspection.
8. Top menu and header revamp.
