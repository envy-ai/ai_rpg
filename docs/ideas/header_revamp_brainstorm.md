# Header Revamp Brainstorm

This document expands the top menu and header revamp idea from [user_experience_improvement_brainstorm.md](user_experience_improvement_brainstorm.md). It is a brainstorm, not an implementation spec. The goal is to turn the current page header into a polished, predictable app shell that supports a complex RPG interface without making every page feel like a separate tool.

## Current State

Top-level pages already share `views/_navigation.njk`, but the header experience is still inconsistent.

Current behavior:

- Each top-level page owns its own `.header` block, title, optional subtitle, and navigation include.
- `views/_navigation.njk` emits global links as generic `.btn` elements.
- The chat page adds Save Game, Load Game, and New Game actions to the same row as navigation.
- The debug page adds a Refresh action with inline margin styling.
- Page-specific styles redefine `.btn` in multiple places, including `public/css/settings.scss`, `public/css/lorebooks.css`, and inline debug styles.
- `.btn-accent` is used by shared navigation, but its visible styling is only defined in settings page CSS.
- Prompt-progress and level-up overlays calculate top offsets by querying `.header` and `.tab-bar`.

The result is that the same navigation partial can look and behave differently depending on which page CSS is loaded. That makes the app feel less cohesive and creates future maintenance risk.

## Core Problem

The header currently mixes several responsibilities in one unstructured row:

- Brand identity.
- Page identity.
- Global navigation.
- Current-page actions.
- Developer tools.
- Save/load game state actions.

Those responsibilities need different visual weights. Global navigation should be stable and predictable. Page actions should stay near the page context they affect. Developer actions should remain discoverable without competing with player-facing actions. Save/load should feel like game state controls, not ordinary page links.

## Goals

- Make the header visually consistent across all top-level pages.
- Separate global navigation from page-specific actions.
- Give the app a stronger RPG-facing identity without sacrificing dense utility.
- Avoid generic `.btn` styling collisions in the shared header.
- Make active page state obvious.
- Keep Save and Load prominent on the chat page without making them appear to be navigation.
- Make New Game reachable from more than one page, but visually distinct from normal route changes.
- Keep developer/debug tools available without letting them dominate the main nav.
- Preserve current modal layering and overlay top-offset behavior.
- Make mobile navigation deliberate instead of letting button wrapping decide the layout.
- Build in accessible semantics: landmarks, `aria-current`, labels, focus states, and touch targets.

## Non-goals

- Do not redesign every page body as part of the header work.
- Do not move chat tabs, map tabs, settings tabs, or config tabs into global navigation.
- Do not require a command palette for the first header pass.
- Do not make debug/developer tools disappear entirely.
- Do not change save/load behavior in the first pass.
- Do not add silent placeholder state chips when the server has not provided the underlying data.
- Do not make the header sticky in the first pass unless the overlay and mobile layout interactions are tested at the same time.

## Audiences

### Active player

Needs fast access to Play, Save, Load, New Game, and possibly Worlds. This user should not have to parse system configuration or debug tools during ordinary play.

### World builder

Moves between Worlds, New Game, Lorebooks, and Play. This user benefits from a clear world/setup group and visible active world/profile state.

### Developer or power user

Needs System, Debug, and eventually inspection tools. These should be grouped as tools, not styled like primary play actions.

## Recommended Direction

Use a shared app-header component with a stable three-zone layout:

- Left: brand and current page identity.
- Center: global navigation.
- Right: context actions and status chips.

The header should be namespaced with classes such as `.app-header`, `.app-nav`, `.app-nav__link`, `.app-header-actions`, and `.app-status-chip`. It should not rely on generic `.btn` styling. Generic page buttons can keep evolving separately without changing the global header.

The current `.header` class can remain temporarily as a compatibility hook for overlay offset calculations, or the overlay code can be updated in the same implementation slice to query `.app-header` first and `.header` only while legacy pages remain.

## Alternative Approaches

### Approach A: Minimal reskin of `_navigation.njk`

Keep the existing page-owned `.header` structure and restyle `.nav-buttons`.

Benefits:

- Fastest implementation.
- Minimal template churn.
- Lower immediate regression risk.

Costs:

- Still mixes navigation and page actions.
- Still vulnerable to `.btn` overrides unless the nav stops using `.btn`.
- Does not create a durable app shell for future status chips or tools.

This is acceptable as an emergency cleanup, but it does not fully solve the design problem.

### Approach B: Shared app-header partial

Create a shared header partial that owns brand, page title, nav, page actions, and optional status chips. Top-level pages pass a small amount of metadata into it.

Benefits:

- Creates one source of truth for top-level navigation.
- Allows page titles and page actions to be consistently placed.
- Enables a responsive design to be solved once.
- Provides a stable place for future save, active world, and backend status.
- Avoids generic button style collisions through namespaced classes.

Costs:

- Requires touching every top-level page template.
- Requires careful testing of prompt overlays, tab bars, and mobile height.
- Needs a short compatibility plan for existing JavaScript that expects Save/Load button ids.

This is the recommended approach.

### Approach C: Full command-center header

Build a richer header with command palette entry, live save status, backend health, active world profile, game loaded state, and a tool overflow menu from the beginning.

Benefits:

- Most powerful end state.
- Gives advanced users a strong operational dashboard.
- Sets up future world inspector and prompt tools.

Costs:

- Too much for a first pass.
- Requires more injected data on non-chat pages.
- More risk of distracting from the actual game screen.

This should be a later evolution after the basic app shell is stable.

## Proposed Information Architecture

### Terminology

Avoid using `Settings` as a primary navigation label. In this app, it can mean either RPG setting/world data or application preferences. The header should split those concepts into two distinct words:

- `/settings` nav label: `Worlds`
- `/settings` page title: `World Profiles`
- `/settings` conceptual noun: `world profile`
- `/config` nav label: `System`
- `/config` page title: `System Configuration`

This creates a clearer mental model: Worlds are creative RPG content and reusable game setup data; System is operational application/server configuration.

### Brand

The brand should be short and stable:

- Primary label: `AI RPG`
- Optional small subtitle: current page or mode, such as `Play`, `World Setup`, or `Developer Tools`
- Icon: use a project-owned SVG asset rather than emoji for consistent rendering

Avoid using long page names in the brand position. Long labels belong in the page title zone or document title.

### Primary Navigation

Recommended visible order:

1. Play
2. New Game
3. Worlds
4. Lorebooks
5. System

Rationale:

- Play is the primary experience and should always be first.
- New Game belongs near Play because it starts the play loop.
- Worlds and Lorebooks are world/setup surfaces.
- System is operational and should be available, but not first.

Use clearer labels than the current mixed set:

- `Chat Interface` -> `Play`
- `Game Settings` -> `Worlds`
- `Configuration` -> `System`
- `Lorebooks` stays `Lorebooks`
- `New Game` stays `New Game`

Recommended page titles:

- `/settings`: `World Profiles`
- `/config`: `System Configuration`

### Tools Menu

Developer-oriented entries should move into a clearly labeled Tools area:

- Debug
- Player Stats, if it remains routed but intentionally hidden from main nav
- Future world inspector
- Future prompt/log tools

For the first pass, this can be a visible `Tools` link group on desktop and a `Tools` disclosure on narrow widths. Debug should not be styled as a primary route.

### Chat Page Actions

On the chat page, Save Game and Load Game should move to an action cluster, not the navigation group.

Recommended ordering:

1. Save
2. Load
3. New Game

However, if New Game is already in global navigation, the chat action cluster can show only Save and Load. A separate New Game global nav link is cleaner than duplicating it in the same viewport.

Keep existing ids for first-pass compatibility:

- `#saveGameBtn`
- `#loadGameBtn`

The labels can become shorter on desktop (`Save`, `Load`) with tooltips and accessible labels preserving full meaning.

### Page-Specific Actions

Page-specific actions should not appear as global navigation.

Examples:

- Debug Refresh.
- Worlds Apply/Create/Update.
- Lorebook Upload.
- System Save Configuration.

Those actions should live in the page content header, sticky action bar, or local toolbar for that page. The global header can reserve the right action zone only for actions that affect the whole app or current game state.

## Visual Design Direction

### Shape and Layout

Desktop header:

- One app-header band at the top.
- Left aligned brand block.
- Center or left-middle global nav.
- Right aligned game actions/status.
- Maximum header height should be predictable so the Adventure layout and overlay offset math stay stable.
- Use one row where possible, but allow a controlled second row for page title or overflow rather than uncontrolled button wrapping.

Recommended desktop structure:

```text
[AI RPG] [Play] [New Game] [Worlds] [Lorebooks] [System] [Tools]      [Active world chip] [Save] [Load]
```

Page identity can appear either as:

- A compact subtitle under the brand, or
- A page-title strip below the nav band when the page needs descriptive text.

The chat page should probably suppress a large `AI RPG Chat Interface` H1. The top of the app should prioritize the adventure tabs and game state.

### Button and Link Styling

Global nav links should look like navigation, not form buttons.

Recommended treatment:

- Transparent or low-contrast default state.
- Clear active state using a filled or underlined surface.
- Icon plus short text on desktop.
- Icon-only only when the icon is familiar and has a tooltip/label.
- Keyboard focus ring that is stronger than hover.
- No page-specific `.btn` dependency.

Action buttons should have separate treatment:

- Save/Load: compact utility buttons.
- New Game: accent route/action, visually distinct but not alarming.
- Destructive actions: never share the same style as route links.

### Icons

Move away from emoji in the global header.

Reasons:

- Emoji render differently across platforms.
- Some emoji have inconsistent baseline and color weight.
- SVG icons can inherit color and size reliably.
- Existing tab icons already use project assets.

Recommended icon sources:

- Reuse existing `public/assets/material-icons/...` patterns.
- Add a small `app-nav-icons` directory if needed.
- Keep icon sizes fixed, likely `20px` desktop and `22px` touch layouts.

### Color

The header should use the existing glass/dark game UI language, but should not become a saturated blue/purple strip that competes with content.

Recommended palette behavior:

- Dark translucent app band using existing glass variables.
- Active nav: restrained blue/cyan accent.
- New Game/accent: warm gold or amber, used sparingly.
- Developer tools: neutral gray/steel treatment.
- Errors or destructive actions: red only for genuinely destructive local actions.

## Responsive Plan

### Desktop

- Single horizontal app band.
- Global nav visible.
- Save/Load visible on chat.
- Optional status chips visible if data is available and useful.
- Tools menu visible but visually secondary.

### Tablet

- Brand remains visible.
- Nav may scroll horizontally within its own area.
- Action labels can shorten, but accessible labels remain full.
- Status chips collapse before navigation does.

### Mobile

Recommended mobile behavior:

- First row: brand, active page label, and Save/Load where applicable.
- Second row: horizontally scrollable global nav chips.
- Tools can be a compact disclosure at the end of the nav row.
- Avoid uncontrolled wrapping of mixed-size buttons.
- Keep touch targets at least 44px high.

Do not hide Play, New Game, and Worlds behind a menu in the first mobile pass. Those are primary flows and should remain visible or one horizontal scroll away.

## Accessibility and Semantics

The shared header should use explicit structure:

- `<header class="app-header">`
- `<nav class="app-nav" aria-label="Primary">`
- `aria-current="page"` on the active route.
- Real `<button>` elements for actions that open modals or mutate state.
- Real `<a>` elements for route navigation.
- Tooltips or `aria-label` for compact/icon-only controls.
- Visible focus states for every interactive element.
- No reliance on color alone for active state.

The Tools disclosure, if added, should be keyboard-operable and close predictably. A native `<details>` element may be enough for an early pass if its styling and focus behavior are tested.

## Data and Template Shape

### Header partial

Recommended new partial:

- `views/_includes/app-header.njk`

Inputs:

- `currentPage`
- `pageTitle`
- `pageSubtitle`
- `pageKicker` or `pageSection`, if needed
- `showGameActions`
- `showTools`
- Optional status chip data only when explicitly injected

The existing `views/_navigation.njk` can either:

- Be replaced by the new app header, or
- Become a small compatibility include that calls the new nav macro.

### Navigation data

The nav can be data-driven inside the partial:

```text
Play        /          chat
New Game    /new-game  new-game
Worlds      /settings  settings
Lorebooks   /lorebooks lorebooks
System      /config    config
Debug       /debug     debug, grouped under Tools
```

Keep the data close to the partial unless it needs server-side configuration later. A server-provided nav registry is unnecessary for the first pass.

### Page templates

Top-level templates should stop hand-authoring the shared header. Instead they should set page metadata and include the same partial.

Affected templates:

- `views/index.njk`
- `views/new-game.njk`
- `views/config.njk`
- `views/settings.njk`
- `views/lorebooks.njk`
- `views/debug.njk`
- `views/player-stats.njk`, if retained

## Styling Plan

Primary SCSS location:

- `public/css/main.scss`

Recommended class family:

- `.app-header`
- `.app-header__inner`
- `.app-header__brand`
- `.app-header__title`
- `.app-header__subtitle`
- `.app-nav`
- `.app-nav__link`
- `.app-nav__icon`
- `.app-nav__label`
- `.app-header-actions`
- `.app-header-action`
- `.app-status-chip`
- `.app-tools-menu`

Avoid:

- `.btn` inside the global header.
- Inline styles such as `style="margin-left: auto;"`.
- Page CSS redefining shared header components.

Page-specific button styles can remain, but they should not be able to alter the global header.

## Migration Plan

### Phase 1: Structure and style isolation

- Add the new app-header partial.
- Add namespaced app-header SCSS to `main.scss`.
- Compile `main.css`.
- Update top-level templates to use the new partial.
- Keep `#saveGameBtn` and `#loadGameBtn` on the chat page.
- Preserve `.header` as an outer compatibility class or update the overlay offset code in the same slice.
- Remove inline debug header action styling by moving Refresh into local page content or a namespaced header action.

### Phase 2: Navigation grouping and responsive behavior

- Move Debug under Tools.
- Make mobile nav use a controlled scroll/disclosure pattern.
- Add active states with `aria-current`.
- Replace emoji nav icons with project SVGs.
- Verify that labels fit at narrow widths.

### Phase 3: Optional status chips

- Add status chips only where data is already available or intentionally injected.
- Candidate chips:
  - Current setting.
  - Loaded save name or unsaved state.
  - Backend label.
  - Game loaded/not loaded.
- Chips should be compact and dismissable only if that state is useful.

### Phase 4: Future affordances

- Command palette entry.
- World inspector link.
- Prompt/log activity shortcut.
- Backend health indicator.
- Save status and autosave timestamp.

## Implementation Gotchas

1. Generic `.btn` collisions are the root styling hazard. Header controls should use namespaced classes so `settings.scss`, `lorebooks.css`, and inline debug styles cannot change them.

2. `.btn-accent` currently has no global definition in `main.scss`; it is defined in `settings.scss`. Any current shared header usage of `.btn-accent` will vary by page.

3. Chat Save and Load behavior depends on `#saveGameBtn` and `#loadGameBtn`. Moving or renaming those controls requires updating chat-page JavaScript.

4. Prompt-progress and player-ability-selection overlays query `.header` and `.tab-bar` to compute safe top offsets. If `.header` is removed or its geometry changes, those offset helpers must be updated and tested.

5. Header height changes can affect the Adventure tab's available height, mobile stacking, and modal top offsets. Screenshot testing should cover desktop and mobile.

6. The debug page has inline `.btn` styles that can override shared button assumptions. Header controls should be insulated from those styles, and debug-specific button styling should eventually be namespaced.

7. Lorebooks uses `public/css/lorebooks.css` without an SCSS source. If future implementation needs to alter Lorebooks-specific styles, create the corresponding SCSS source instead of hand-editing CSS.

8. Replacing emoji with SVG assets requires accessible labels and consistent icon sizing. Decorative icons should use empty alt text or `aria-hidden`.

9. Current page metadata must be set consistently. If any route omits `currentPage`, the header should fail visibly in development or render no active state rather than pretending another page is active.

10. New status chips should not depend on data that only exists on the chat page unless the server injects it on every page that renders the chip.

## Testing Plan

Manual checks:

- Load `/`, `/new-game`, `/settings`, `/config`, `/lorebooks`, `/debug`, and `/player-stats` if retained.
- Confirm active route state is correct on each page.
- Confirm Play, New Game, Worlds, Lorebooks, System, and Tools order is stable.
- Confirm Save and Load open the same chat modals as before.
- Confirm Debug Refresh remains available where intended.
- Confirm keyboard tab order follows visual order.
- Confirm focus rings are visible.
- Confirm mobile width does not create overlapping controls or clipped labels.
- Confirm prompt-progress overlay still anchors below the header and tab bar.
- Confirm player ability selection modal still offsets below top controls.

Automated or scripted checks:

- Run Playwright headless smoke coverage for the main UI.
- Add or update a screenshot script that captures header states at desktop, tablet, and mobile widths.
- Check for console errors on each top-level route.
- If SVG icons are added, verify asset paths return 200s.

Recommended viewports:

- `1440x900`
- `1024x768`
- `768x1024`
- `390x844`

## Rollout Slice Recommendation

The first implementation slice should be:

1. Introduce the namespaced app-header partial and SCSS.
2. Convert all top-level pages to use it.
3. Keep the nav labels text-based with temporary existing icons or no icons.
4. Preserve Save/Load ids and current behavior.
5. Keep status chips out of scope.
6. Verify desktop and mobile layout with Playwright screenshots.

This slice solves the biggest inconsistency, reduces styling risk, and leaves richer status/dashboard ideas for a later pass.

## Open Design Questions

1. Should Debug be visible in the desktop header by default, or hidden under Tools on all widths? Recommended default: under Tools.

2. Should New Game appear as a primary global route on every page, or only as a chat/setup action? Recommended default: global route on every page.

3. Should the chat page keep a large H1 at all? Recommended default: no. Use the app brand plus tabs and current game state instead.

4. Should the header become sticky? Recommended default: not in the first pass.

5. Should status chips ship in the first implementation? Recommended default: no. Add them after the shell is stable.

6. Should the app use SVG icons immediately? Recommended default: yes if suitable assets already exist, otherwise use text-only labels for the first slice and add icons in Phase 2.

## Success Criteria

- Header controls have the same geometry, typography, and interaction treatment on every top-level page.
- Global navigation is visually distinct from page actions.
- Active page state is unmistakable.
- The chat page still supports Save and Load without behavior changes.
- Debug/developer tooling remains reachable but no longer competes with core play navigation.
- Mobile layout is controlled and does not depend on arbitrary flex wrapping.
- Page-specific `.btn` styles cannot alter the shared header.
- Overlay offset behavior remains correct after the header change.
