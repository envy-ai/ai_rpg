# Header Revamp Brainstorm

This is a finished/archive design note for the app header and top-level navigation revamp. It preserves the original design reasoning, then records the current implemented behavior verified against the live templates, SCSS, and UI docs. It is not a changelog or an implementation plan.

## Current Implemented Behavior

The header revamp has been implemented as a shared app-header component.

- Top-level pages include `views/_includes/app-header.njk` directly. `views/_navigation.njk` remains only as a legacy shim that includes the same partial.
- `views/_includes/app-header-nav.njk` provides the `appNavLink` macro used by the header partial.
- The rendered header uses `<header class="app-header header" role="banner">`. The retained `.header` class is a compatibility hook for existing top-offset logic.
- The brand area links to `/`, displays the `AI RPG` brand, uses `assets/fluentui-emoji/crossed_swords_color_classic.svg` as the mark, and shows per-page `appHeaderTitle` / optional `appHeaderSubtitle` values.
- Primary navigation order is `Play`, `New Game`, `Worlds`, `Mods`, `Lorebooks`, `System`, followed by a native `Tools` disclosure.
- `Tools` contains `Debug` and `Player Stats`, and is open/active when `currentPage` is `debug` or `player-stats`.
- Active primary links receive `aria-current="page"` and `.is-active`.
- `New Game` is an accent navigation link, not a chat-page action button.
- On the chat page only, the right action cluster renders `Save` and `Load` buttons with the stable ids `saveGameBtn` and `loadGameBtn`.
- Header controls use namespaced classes such as `.app-header`, `.app-nav__link`, `.app-header-action`, `.app-tools-menu`, and `.app-header-icon`. They no longer depend on generic `.btn` styling.
- Shared app-header styling lives in `public/css/main.scss`, with theme tokens in `public/css/_globals.scss` and compiled output in `public/css/main.css`.
- Header icons are CSS masks backed by project assets under `assets/material-icons/...`, with the Mods icon using `assets/material-icons/misc/puzzle.svg`.
- Tablet-width layouts move the nav to a second row with horizontal scrolling. Phone-width layouts use wrapping nav controls and render an open Tools panel inside the header flow.
- The player ability-selection offset helper checks `.app-header` first and falls back to `.header`, then accounts for `.tab-bar`.

Current top-level page titles include `Play`, `New Game`, `World Profiles`, `Mods`, `Lorebooks`, `System Configuration`, `Debug`, and `Player Stats`.

## Original Design Context

Before this revamp, top-level pages shared `views/_navigation.njk`, but each page owned its own `.header` block, title, action placement, and button styling. Shared navigation used generic `.btn` elements, page CSS redefined `.btn` in multiple places, and chat Save/Load actions sat in the same row as route links. The same navigation partial could look different depending on which page stylesheet loaded.

The core design problem was that one unstructured header row mixed unrelated responsibilities:

- Brand identity.
- Page identity.
- Global navigation.
- Current-page actions.
- Developer tools.
- Save/load game state actions.

The original recommendation was to create a shared app-header component with a stable three-zone layout:

- Left: brand and page identity.
- Middle: global navigation.
- Right: context actions and game-state actions.

That direction is now the implemented architecture.

## Design Goals Retained

- Keep header geometry, typography, and interaction treatment consistent across top-level pages.
- Separate global navigation from page-specific and game-state actions.
- Give the app a stronger RPG-facing identity without hiding dense utility.
- Avoid generic `.btn` collisions in the shared header.
- Make active page state obvious.
- Keep Save and Load prominent on the chat page without presenting them as navigation.
- Make New Game reachable globally while visually distinguishing it from ordinary route changes.
- Keep developer/debug tools reachable without letting them dominate primary navigation.
- Preserve overlay and modal top-offset behavior.
- Make mobile navigation deliberate instead of relying on uncontrolled button wrapping.
- Use accessible landmarks, link/button semantics, labels, focus states, and active-state semantics.

## Original Non-Goals

These constraints were part of the original design and still describe the intended scope of the header component:

- Do not redesign every page body as part of header work.
- Do not move chat tabs, map tabs, settings tabs, or config tabs into global navigation.
- Do not require a command palette for the app header.
- Do not make debug/developer tools disappear entirely.
- Do not add placeholder status chips when the server has not provided the underlying data.
- Do not make the header sticky unless overlay and mobile interactions are tested with that change.

## Implemented Navigation Language

The revamp intentionally avoids the overloaded word `Settings` in the primary header.

- `/settings` nav label: `Worlds`
- `/settings` page title: `World Profiles`
- `/config` nav label: `System`
- `/config` page title: `System Configuration`

The current app also adds `Mods` as a first-class primary navigation item between `Worlds` and `Lorebooks`.

This split keeps creative RPG setup (`Worlds`, `Lorebooks`, `Mods`) distinct from operational server/application configuration (`System`).

## Original Alternatives

### Minimal Reskin

A smaller option was to keep page-owned headers and only restyle `_navigation.njk`. That would have been quick, but would not have solved mixed responsibilities, generic button collisions, or future responsive layout needs. The current implementation went beyond this option.

### Shared App Header

The recommended option was a shared header partial with namespaced classes and page-provided metadata. This is the implemented approach.

### Full Command Center

The largest option was a dashboard-like header with command palette entry, backend health, active world state, save status, and prompt/log shortcuts. That remains a possible future direction, but those status/dashboard features are not part of the current header.

## Maintenance Notes

When changing the current header, check these points first:

1. Keep `saveGameBtn` and `loadGameBtn` ids unless the chat Save/Load JavaScript is updated at the same time.
2. Keep header controls on namespaced `.app-*` classes. Do not reintroduce generic `.btn` dependencies into shared navigation.
3. Preserve `aria-current="page"` on the active route and real `<a>` / `<button>` semantics for links and actions.
4. If `.app-header` geometry changes, test chat overlays, prompt-progress placement, the player ability-selection modal offset, and mobile layout.
5. If the retained `.header` compatibility class is removed, update any offset code that still falls back to `.header`.
6. Add status chips only when the required data is intentionally injected for the pages where the chip appears. Avoid silent placeholder chips.
7. Keep page-specific actions, such as Debug refresh or System save controls, in local page content/toolbars instead of the primary navigation group.
8. If new icons are added, keep them project-owned, consistently sized, and accessible through text labels, titles, or `aria-label` where needed.

## Still-Plausible Future Ideas

The archive brainstorm included ideas that were intentionally deferred and may still be useful:

- Current world/profile chip.
- Loaded save name, save status, or autosave timestamp.
- Backend/model status indicator.
- Prompt/log activity shortcut.
- World inspector link under Tools.
- Command palette entry.
- Sticky header, but only after overlay and mobile behavior are tested with the new fixed positioning.

These should be treated as new design work rather than unfinished obligations from the original header revamp.

## Verification Pointers

Relevant current references:

- `views/_includes/app-header.njk`
- `views/_includes/app-header-nav.njk`
- `views/_navigation.njk`
- `public/css/main.scss`
- `public/css/_globals.scss`
- `docs/ui/pages.md`
- `docs/ui/assets_styles.md`
- Chat-page Save/Load setup in `views/index.njk`
