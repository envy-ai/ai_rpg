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

- `ui-widgets-package.spec.js`: independently serves only the portable widget package through Playwright routes, verifies the standalone specimen at desktop and narrow widths, and exercises ESM selector and popup lifecycle, keyboard, focus, and disposal behavior without the game server or application globals. Run with `PLAYWRIGHT_SKIP_WEBSERVER=1`; its screenshots are stored under `tmp/`.

- `new-game.smoke.spec.js`: New Game form rendering, the disabled/no-world state when no profile is applied, and immediate redirect to the Adventure tab after submit when a world is available.
- `new-game.form-settings.spec.js`: actual Nunjucks-rendered new-game template and compiled assets through an API-intercepted page fixture; save snapshots, search all saved entries, explicit load/apply, cancellation/stale-list protection, original error details, reviewed-draft locks and effective Start-button availability, and phone dialog reachability. Missing-world checks cover native disabling before/after JavaScript, top/bottom Worlds links, navigation, forced submit prevention, and absence of allocator/settings/draft work. It blocks and records the documented Google Fonts requests, and fails on unexpected API/assets/network requests, page errors, or browser dialogs.
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
