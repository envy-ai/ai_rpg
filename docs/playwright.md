# Playwright

This project uses Playwright for browser-level regression coverage against the Express app. The Playwright Test suite lives in `tests/e2e`, with standalone browser helpers in `playwright_scripts`.

## Install

Install Node dependencies:

```bash
npm install
```

Install the Chromium browser binary used by the test projects:

```bash
npm run playwright:install
```

## Main Test Commands

Default headless Chromium run:

```bash
npm run test:e2e:headless
```

Headed Chromium with an available display:

```bash
npm run test:e2e:headed
```

Headed Chromium using an existing X session for the same user:

```bash
./playwright_scripts/run_on_existing_x_session.sh npm run test:e2e:headed
```

Headed Chromium under `xvfb-run`:

```bash
npm run test:e2e:headed:xvfb
```

All configured projects:

```bash
npm run test:e2e
```

Interactive Playwright UI:

```bash
npm run test:e2e:ui
```

Target a single spec by passing the path after the npm script:

```bash
npm run test:e2e:headless -- tests/e2e/settings.persistence.spec.js
```

## Configuration

- Config file: `playwright.config.js`
- Test directory: `tests/e2e`
- Projects:
  - `chromium`: Desktop Chrome, headless.
  - `chromium-headed`: Desktop Chrome, headed.
- Default port: `4173`
- Default base URL: `http://127.0.0.1:4173`
- Web server command: `npm run start -- --port <port>`
- Live-save browser command: `npm run start -- --port <port> --load-game <save-directory>`. The server loads the requested save before opening the port, so a browser can navigate immediately without posting `/api/load` or racing hydration.
- Web server reuse: enabled when a compatible server is already listening.
- Test timeout: 30 seconds by default; the opt-in playthrough and vehicle regressions use 5 minutes because they can exercise multi-stage generation and save/load processing.
- Expect timeout: 5 seconds.
- Reporter: list output plus HTML report with `open: never`.
- Failure artifacts: traces and videos are retained on failure; screenshots are captured only on failure.
- CI behavior: retries are set to 2, workers are limited to 1, and committed `test.only` calls are forbidden.

Environment variables:

- `PLAYWRIGHT_PORT`: port used by the Playwright web server and default base URL.
- `PLAYWRIGHT_BASE_URL`: full base URL used by specs and some standalone scripts.
- `PLAYWRIGHT_SKIP_WEBSERVER=1`: disables Playwright's automatic server startup for runs against an already-running app.
- `PLAYWRIGHT_SETTINGS_PATH`: path captured by `playwright_scripts/capture_settings_page.js`; defaults to `/settings`.

## E2E Spec Coverage

The isolated cases in `ability-tooltip.spec.js` also exercise Thing and NPC extension fields, collection holders and concurrent container transfers, lightbox layering and error focus, Scene Illustration image replacement, real graph replacement, and Location and Region vehicle choices using routed fixtures.

- `ui-widgets-package.spec.js`: independently serves only the portable widget package through Playwright routes, verifies the standalone specimen at desktop and narrow widths, and exercises ESM selector and popup lifecycle, keyboard, focus, and disposal behavior without the game server or application globals. Run with `PLAYWRIGHT_SKIP_WEBSERVER=1`; its screenshots are stored under `tmp/`.
- `ui-widgets-surfaces.spec.js`: checks adopted busy button eligibility and content, replaceable status timers, notices and disposal independently of application state.
- `ui-widgets-conditional.spec.js`: checks explicit native field state, Other-entry eligibility and draft retention, cross-document validation, password reveal, and disposal. The standalone specimen also exercises these controls.
- `ui-widgets-graph.spec.js`: exercises injected graph engine replacement, generation-owned listeners and timers, status, and cleanup errors without a graph dependency.
- `ui-widgets-suggestions.spec.js`: checks native suggestion keyboard and pointer selection, delayed blur, stale results, and disposal without a game server.
- `ui-widgets-collection-media.spec.js`: routes the portable package alone and checks collection modes and disposal, stale image events, and reentrant image replacement and cleanup.
- `extension-fields-isolated.spec.js`: checks typed extension values and validation without application state.
- `ui-widgets-modal-stack.spec.js`: exercises shared-backdrop and scroll-lock ownership, explicit focus/Escape policies, native precedence, pending state and disposal. `ui-widgets-package.spec.js` also covers anchored popup portal, action ordering and detachment.
- `status-effect-editor-isolated.spec.js`: exercises effect metadata, zero and omitted fields, unavailable modifiers, need-rate presentation and desktop/phone geometry. `player-stats-effects-isolated.spec.js` verifies the standalone form omits status effects when its optional editor is absent.
- `ui-widgets-controls.spec.js`: exercises independent tabs, ordered and nested repeaters, keyboard and native drag, labelled fields, numeric pair synchronization, ReaderRows order, reentrant cleanup, and teardown. The specimen also tests draft retention and remount.
- Navigation coverage also checks button-only tab selection, dynamic registration and activation sources, the independent navigation specimen, and pointer-capture failure cleanup. Isolated Play cases exercise late Scene Gallery registration, Story Tools lazy activation, phone navigation and dock identity, and both Adventure separators. The Config fixture checks header scrim, native-dialog priority and pagehide lifecycle.
- `ui-widgets-windows.spec.js`: exercises independent modeless chooser focus and Escape ownership, floating-window stacking, pointer dragging, and disposal.
- `lorebooks-dialogs-isolated.spec.js`: exercises upload failure/retry and delete cancellation/confirmation through mocked routes.
- `config-tabs-isolated.spec.js`: renders System Configuration through routes and checks keyboard tab navigation, provider-dependent fields, password reveal and retained form drafts without touching configuration files.
- `ui-widgets-overlays.spec.js`: loads the package directly in an isolated browser fixture and checks native dialog focus, pending dismissal, queued close, teardown and remount, plus tooltip content, positioning, hover transfer, scroll/Escape and cleanup. The package specimen also exercises both overlays without application assets.
- `faction-sparse-editor.spec.js`: verifies directed relation omission, faction row values and disposal, and responsive form geometry.
- `image-generation-lifecycle-error.spec.js`: verifies PageFeedback error details and nested native-dialog focus restoration with the real overlay adapter.


- `settings-npc-naming-isolated.spec.js`: routes a seeded applied World profile and calendar, verifies invalid default dates and stale calendar references, module slot field layout and saving, entirely in the fixture.
- `new-game.smoke.spec.js`: New Game form rendering, the disabled/no-world state when no profile is applied, and immediate redirect to the Adventure tab after submit when a world is available.
- `new-game.form-settings.spec.js`: actual Nunjucks-rendered new-game template and compiled assets through an API-intercepted page fixture; save snapshots, search all saved entries, explicit load/apply, cancellation/stale-list protection, original error details, reviewed-draft locks and effective Start-button availability, phone dialog reachability, and pending-save Escape protection. Missing-world checks cover native disabling before/after JavaScript, top/bottom Worlds links, navigation, forced submit prevention, and absence of allocator/settings/draft work. It blocks and records the documented Google Fonts requests, and fails on unexpected API/assets/network requests, page errors, or browser dialogs.

The conditional-control checkpoint passed nine distinct isolated Chromium cases: direct controls, two specimen cases, New Game Other/date and reviewed-draft behavior, Config provider fields, two final-pagehide cases, and Worlds calendar references. Artifacts are under `tmp/conditional-direct-crossdoc-results`, `tmp/conditional-specimen-results`, `tmp/conditional-app-first-results`, `tmp/newgame-form-unload-final-results`, and `tmp/worlds-conditional-month-results`. The focused `node --test --test-reporter=dot tests/settings_calendar.test.js tests/calendar_editor_ui.test.js` run passed 18 tests.
- `empty-action-confirm.spec.js`: empty chat sends require confirmation before `/api/chat` receives an empty user action.
- `crafting.empty-submit.spec.js`: crafting and location-modification modals submit intentional empty material selections, including the Ctrl+Enter prose shortcut.
- `header.navigation.spec.js`: shared header rendering including the primary Mods route, nav labels, save/load actions, tools menu layering, and mobile non-overlap checks.
- `mobile-lightbox-actions.spec.js`: narrow-only location and character-inventory lightbox actions, real close-button behavior, keyboard pickup routing, shared `Give to...` person selection, correct character-owner drop payloads, and desktop action-bar suppression using mocked transfers.
- `modal-submit-shortcuts.spec.js`: shared modal form submission, explicit non-form actions, filter non-submission, and common-page helper loading.
- `settings.persistence.spec.js`: world profile create/rename/delete persistence and Calendar tab serialization using required Character Options mechanic attributes and enabled-mod preset configuration.
- `story-tools-search.spec.js`: Story Tools search modes, type filters, case sensitivity, delayed filtering, and Mystery Box load/save behavior.
- `playthrough.regression.spec.js`: deterministic playthrough replay and cross-region round-trip checks, gated by environment variables.
- `new-game.vehicles.spec.js`: deterministic vehicle-region generation and vehicle exit UI checks, gated by environment variables.

## Stateful Test Isolation

- The Express game server owns singleton in-memory world/profile state, so specs that mutate it must clean up and avoid destructive startup requests from unrelated read-only tests.
- `settings.persistence.spec.js` runs its two profile-mutating tests serially. Its setup waits for Worlds-page network initialization, starts from an explicitly empty current-profile response, fills required hiding/perception attributes through the Character Options tab, and applies the default Modules preset when that enabled mod is present.
- The `/settings` case in `header.navigation.spec.js` stubs `POST /api/settings/load` because header rendering does not need to clear and reload the shared profile registry.
- Chat interaction specs wait for `window.AIRPG_CHAT` before clicking controls whose listeners are installed by the client constructor.

The focused new-game form-settings spec renders `views/new-game.njk` with Nunjucks inside the test process and fulfills CSS/JS requests from `public/` plus `/assets/*` from the repository asset root. It intercepts `/api/attributes`, pending-load checks, draft reads, and the new-game-settings save/list/load routes; unexpected API or local asset requests fail the spec. Run it with the web server disabled so Playwright does not start the game server:

```bash
XDG_RUNTIME_DIR=/run/user/1000 \
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
PLAYWRIGHT_BROWSERS_PATH=/home/bart/.cache/ms-playwright \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 \
PLAYWRIGHT_HTML_OUTPUT_DIR=tmp/new-game-form-settings-report \
systemd-run --user --scope \
  -p MemoryMax=16G -p MemorySwapMax=0 \
  npm run test:e2e:headless -- tests/e2e/new-game.form-settings.spec.js \
    --output=tmp/new-game-form-settings-test-results
```

Desktop and phone dialog captures are written to `tmp/new-game-form-settings-desktop.png` and `tmp/new-game-form-settings-mobile.png`.

## Gated Regression Specs

The default e2e run skips deterministic regressions that require fixture setup or forced prompt outputs.

Deterministic playthrough attack replay:

```bash
npm run test:e2e:playthrough-regression
```

Playthrough mode is controlled by `PLAYWRIGHT_PLAYTHROUGH_MODE`:

- `attack`: captured attack turn replay; this is the default.
- `region`: cross-region move and return, asserting single back-link exits and no double travel.
- `all`: both scenarios.

Region round-trip shortcut:

```bash
npm run test:e2e:playthrough-region-roundtrip
```

The playthrough regression copies `tests/e2e/fixtures/playthrough_save_start` into `autosaves/`, copies forced outputs into `tmp/`, configures deterministic runtime values through `/api/slash-command`, and removes its runtime autosave and forced-output file during teardown.
Both playthrough modes have a five-minute test timeout.

## Follow-up API scenario harness

Long model-backed mechanics cases use [followup_api_playtest.md](followup_api_playtest.md) for timeout-free API execution, strict logical-completion recording/replay, canonical fixtures, state assertions, and triage. That harness is complementary to Playwright: use it for authoritative mechanics and orchestration, then add/run a focused browser case only when the contract includes visible UI behavior or human visual review. Never translate a narrative-quality requirement into a browser regex or prose classifier.

Vehicle-region regression:

```bash
PLAYWRIGHT_NEW_GAME_VEHICLE_REGRESSION=1 npm run test:e2e:headless -- tests/e2e/new-game.vehicles.spec.js
```

The vehicle regression copies `tests/e2e/fixtures/new_game_vehicle_region_forced_outputs.json` into `tmp/`, appends deterministic forced outputs for region-stub and location generation, creates a temporary world profile, and removes those temporary runtime files and settings during teardown. It performs a final `/api/save` and leaves that save available under `saves/` for manual inspection.
The vehicle regression has a five-minute test timeout.

## Isolated collection and form verification (2026-11-05)

The collection/media and form extraction was checked with 22 distinct Chromium cases using `PLAYWRIGHT_SKIP_WEBSERVER=1`, route-backed fixtures, and no game server or save mutations. The cases comprise three package collection/image lifecycles; eleven real Play collection, lightbox, Scene Illustration, and Thing/NPC form cases; one direct extension-field case; two faction cases; two Worlds cases; two New Game allocator cases; and one Stories page lifecycle case. The additional cases check malformed module configuration and unavailable saved module IDs, plus cached page hide and final unload in Play and Stories. Reports and screenshots are under `tmp/collection-media-first-results`, `tmp/image-reentry-results`, `tmp/collection-media-second-results`, `tmp/container-session-final-results`, `tmp/form-owners-2-results`, `tmp/holder-scene-results`, `tmp/form-geometry-final-results`, `tmp/lightbox-error-results`, `tmp/faction-rows-results`, `tmp/world-modules-results`, and `tmp/allocator-owner-results`, `tmp/module-boundaries-2-results`, `tmp/world-invalid-syntax-results`, `tmp/persisted-final-results`, and `tmp/persisted-story-final-results`.

Each run used Chromium through `systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 npm run test:e2e:headless -- <specs> --grep <case-filter> --output=tmp/<results>`, with `PLAYWRIGHT_SKIP_WEBSERVER=1` and the browser/report paths configured as above. Thirty-four distinct affected Node source/UI cases also passed in the same memory limits; the moved lightbox checks now inspect package source and SCSS.

## Isolated graph and vehicle verification (2026-11-05)

Eighteen distinct Chromium cases passed with route-backed fixtures and no game server or save mutations: two portable graph lifecycles, three actual graph consumer cases, six portable/actual vehicle suggestion and route cases, and seven existing standalone package cases. Region Map context handling was checked after repeated reloads; the World Map check confirms real hull removal before engine destruction, and Relationships checks visible, hidden and missing actors. Each graph loader also reports its original JSON parsing error and supports a deliberate retry. Vehicle coverage includes zero ETA, fixed-route order, pending and unavailable destinations, delayed results, and lookup failure/retry. Artifacts are under `tmp/graph-first-results`, `tmp/graph-region-listener-results`, `tmp/graph-hull-order-results`, `tmp/graph-error-retry-3-results`, `tmp/vehicle-first-results`, `tmp/vehicle-second-results`, `tmp/vehicle-late-final-results`, `tmp/vehicle-additional-results`, and `tmp/widget-specimen-graph-results`.

The runs used `PLAYWRIGHT_SKIP_WEBSERVER=1` and `systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 npm run test:e2e:headless -- <specs> --grep <case-filter> --output=tmp/<results>`. Fourteen directly affected Node cases passed under the same memory limits across `tests/relationship_graph_ui.test.js` and `tests/vehicle_editor.active_destination.test.js`.

## Isolated feedback and editor verification (2026-11-05)

The feedback and editor extraction was checked with 27 distinct Chromium cases in route-backed fixtures with no game server or save mutations: ten feedback and image-progress cases, five weather and Stories field cases, five Quest and Region cases, and seven existing standalone specimen cases. They cover focus and per-action pending state, reentrant disposal, user scroll intent, typed field HTML round trips, weather and quest save/reopen, pending Quest lookup preservation and coalesced errors, and desktop/phone row layout. Artifacts are under `tmp/feedback-first-results`, `tmp/feedback-owned-actions-results`, `tmp/follow-intent-results`, `tmp/snapshot-reentrant-results`, `tmp/image-progress-real-pass-results`, `tmp/weather-fields-first-results`, `tmp/serialize-field-final-results`, `tmp/story-field-regression-results`, `tmp/quest-region-final-results`, `tmp/quest-objective-real-results`, `tmp/quest-applied-pending-results`, `tmp/quest-lookup-failure-results`, and `tmp/widget-specimen-feedback-results`, and `tmp/specimen-follow-final-results`.

Runs used `PLAYWRIGHT_SKIP_WEBSERVER=1` and `systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 npm run test:e2e:headless -- <specs> --grep <case-filter> --output=tmp/<results>`. Forty-eight distinct affected Node cases passed under the same memory limits across feedback ownership, prompt progress, image progress, weather, Quest and Region source suites.

## Isolated choices and status verification (2026-11-05)

Eighteen distinct Chromium cases passed without a game server or save mutations: ten choice and New Game lifecycle cases, seven busy/status/notice cases, and one retained ActionGroup regression. They cover native saved-game options, immediate selection and pending dismissal, mandatory ability choices, detached radio and stack cards, cached and final unload, concurrent illustration requests and original error stacks, latest disabled state during pending operations, and persistent Lorebooks errors. Reports are under `tmp/choice-first-results`, `tmp/choice-detached-results`, `tmp/play-load-select-results`, `tmp/stack-detached-reopen-results`, `tmp/newgame-unload-results`, `tmp/surfaces-first-results`, `tmp/chat-busy-final-results`, `tmp/config-busy-validation-2-results`, `tmp/surface-specimen-final-results`, and `tmp/lorebooks-status-final-results`.

The isolated runs used `PLAYWRIGHT_SKIP_WEBSERVER=1` and `systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 npm run test:e2e:headless -- <specs> --grep <case-filter> --output=tmp/<results>`. Thirteen directly affected Node source/UI cases passed in the same memory limits across the ability, skill and chat spinner checks.

## Standalone Browser Scripts

One-off new-game flow:

```bash
node playwright_scripts/test_new_game_end_to_end.js
```

This script starts the server, creates and applies a world profile through `/settings`, starts a game through `/new-game`, sends `look around`, writes `tmp/playwright_new_game_run/result.json`, writes `tmp/playwright_new_game_run/server.log`, and captures `tmp/playwright_new_game_run/final-chat.png`.

Settings page capture:

```bash
npm run playwright:settings:screenshot
```

This runs `playwright_scripts/capture_settings_page.js` against `PLAYWRIGHT_BASE_URL` or `http://localhost:7777`, captures desktop and mobile screenshots under `tmp/playwright_settings_capture/`, writes `result.json`, and verifies that the settings workspace layout is present while `.settings-grid` is absent.

Major screen capture:

```bash
node playwright_scripts/capture_major_screens.js
```

This targets `MAJOR_SCREENS_BASE_URL`, then `PLAYWRIGHT_BASE_URL`, then `http://127.0.0.1:7777`. It captures top-level pages and chat tabs into a timestamped `tmp/major_screens_*` directory.

Fitty overflow check:

```bash
node playwright_scripts/check_fitty_overflow.js
```

This targets `http://127.0.0.1:7777`, checks visible `.entity-name`, `.party-name`, and `#chatPlayerName` elements for horizontal overflow, and writes `tmp/fitty-overflow-check.json`.

Item-to-currency context-menu verification:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4174 node playwright_scripts/verify_item_currency_conversion_ui.js
```

This helper intentionally refuses to run against a loaded game. Against an isolated no-save `Adventurer` session, it creates disposable valued and valueless inventory items, verifies the conversion warning and clear missing-value alert, confirms that cancelling leaves both the item and currency unchanged, then accepts the warning and checks the item deletion and currency payout. It writes its screenshot and result JSON under `tmp/item-currency-browser-verification/`.

## Existing X Session Helper

`playwright_scripts/run_on_existing_x_session.sh` finds a same-user process with `DISPLAY`, exports the related X/session environment variables, and runs the command passed to it. With no arguments, it runs:

```bash
npm run test:e2e:headed
```

The helper exits with an error if it cannot find a same-user X display. It also fills `XAUTHORITY` from `$HOME/.Xauthority` when the selected process does not provide one and that file exists.
