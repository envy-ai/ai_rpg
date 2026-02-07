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

## Existing X Session Helper

- Script: `playwright_scripts/run_on_existing_x_session.sh`
- Purpose: find an existing X session environment from a process owned by the current user, export the required variables, and run the command you pass in.
- Default command (if no args): `npm run test:e2e:headed`
- This script fails if no same-user `DISPLAY` is found.
