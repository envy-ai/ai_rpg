# Playwright

This project now includes Playwright-based browser testing for both headless and headed Chromium.

## Install

Install dependencies:

```bash
npm install
```

Install Playwright browser binaries:

```bash
npm run playwright:install
```

## Run Tests

Headless Chromium:

```bash
npm run test:e2e:headless
```

Headed Chromium:

```bash
npm run test:e2e:headed
```

Headed Chromium by attaching to an existing X session (same user only):

```bash
./playwright_scripts/run_on_existing_x_session.sh npm run test:e2e:headed
```

One-off end-to-end new-game flow (starts server, creates a setting, starts a game, sends `look around`):

```bash
node playwright_scripts/test_new_game_end_to_end.js
```

This script now logs live progress milestones and streams server stdout/stderr to the console while long generation steps run.
It also validates `/api/new-game` completion and fails fast when game creation reports an error.

Deterministic playthrough regression replay (loads fixture autosave, configures forced prompt outputs, runs a captured attack turn):

```bash
npm run test:e2e:playthrough-regression
```

Notes:
- This test is intentionally gated behind `PLAYWRIGHT_PLAYTHROUGH_REGRESSION=1` so normal e2e runs are unaffected.
- It copies fixtures into runtime `autosaves/` and `tmp/` paths, then cleans them up after the test.
- `PLAYWRIGHT_PLAYTHROUGH_MODE` selects which scenario runs:
  - `attack` (default): captured deterministic attack replay.
  - `region`: cross-region move + return, asserting single back-link exits and no double-travel.
  - `all`: run both scenarios.

Region round-trip mode shortcut:

```bash
npm run test:e2e:playthrough-region-roundtrip
```

Deterministic new-game vehicle region regression (uses captured `region_generation` log output as forced prompt output, starts a new game, and verifies generated vehicle locations carry `vehicleInfo`):

```bash
PLAYWRIGHT_NEW_GAME_VEHICLE_REGRESSION=1 npm run test:e2e:headless -- tests/e2e/new-game.vehicles.spec.js
```

Notes:
- This test is gated behind `PLAYWRIGHT_NEW_GAME_VEHICLE_REGRESSION=1` so regular e2e runs stay unchanged.
- It copies `tests/e2e/fixtures/new_game_vehicle_region_forced_outputs.json` into `tmp/` at runtime, then cleans it up.
- The fixture’s `region_generation` payload is derived from `logs/2026-03-05T01-02-17-626Z_region_generation_region_generation.log`.
- It performs a final `/api/save` and intentionally retains that save in `saves/` so the generated world can be loaded and inspected manually after the test.
- It also validates vehicle exit button rendering in the Adventure UI: inbound exits use the configured vehicle icon, and outbound exits in vehicle context render `Exit Vehicle:` without a left-side vehicle icon.

One-off settings-page capture + validation against an already-running server:

```bash
npm run playwright:settings:screenshot
```

This captures desktop/mobile screenshots and writes `tmp/playwright_settings_capture/result.json`.
The script fails if the redesigned settings layout is not present.

Settings persistence regression (create -> rename-as-new-id -> delete original -> refresh verification):

```bash
npm run test:e2e:headless -- tests/e2e/settings.persistence.spec.js
```

Notes:
- The test uses the selected-setting action panel (`Edit` / `Delete`) rather than deprecated inline row action buttons.
- It validates API-level persistence state in addition to UI interactions.

Headed Chromium with virtual display (Linux servers/containers):

```bash
npm run test:e2e:headed:xvfb
```

All projects:

```bash
npm run test:e2e
```

Interactive UI mode:

```bash
npm run test:e2e:ui
```

## Configuration

- Config file: `playwright.config.js`
- Test directory: `tests/e2e`
- Default test server URL: `http://127.0.0.1:4173`
- The Playwright runner starts the app automatically with:
  - `npm run start -- --port 4173`

You can override runtime values with environment variables:

- `PLAYWRIGHT_PORT`
- `PLAYWRIGHT_BASE_URL`
- `PLAYWRIGHT_SKIP_WEBSERVER=1` (skip auto-start and target an already-running server)
- `PLAYWRIGHT_SETTINGS_PATH` (path for settings capture script, defaults to `/settings`)

## Existing X Session Helper

- Script: `playwright_scripts/run_on_existing_x_session.sh`
- Purpose: find an existing X session environment from a process owned by the current user, export the required variables, and run the command you pass in.
- Default command (if no args): `npm run test:e2e:headed`
- This script fails if no same-user `DISPLAY` is found.
