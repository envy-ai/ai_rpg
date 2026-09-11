# LogViewer

`LogViewer.js` provides a read-only file browser for the current (`logs`) and previous (`logs_prev`) server sessions. `server.js` registers its routes after static middleware. It does not load saves, rotate logs, edit files, or delete files.

## Page and UI

Tools → **Log Viewer** opens `/log-viewer`, with `assets/material-icons/misc/logviewer.svg` in the shared menu and page heading. The compact split-pane layout reuses the app header and Story Tools inputs, selection buttons, tags, content panels, and shared modal theme.

- The top session dropdown defaults to `logs`; `logs_prev` selects the previous session.
- Regular files appear in a left sidebar ordered by filesystem creation time, newest first. Equal timestamps use filename order. Modification times do not determine ordering.
- The sidebar filter splits on whitespace and matches every term as a case-insensitive filename substring. It does not search log contents.
- The newest matching file is selected initially. Filtering preserves a matching selection; otherwise it selects the first match or clears the reader when no files match.
- The right pane displays a read-only, unwrapped, monospaced textarea, synchronized line numbers, filename, creation date, byte size, and line count. Log content is assigned as text, never rendered as HTML.
- **Refresh** explicitly reloads the selected session. There is no polling or auto-tail. Session changes retain the filter and clear old contents immediately. Canceled requests cannot overwrite a newer selection.
- Mobile stacks the file list above a bounded reader; both remain independently scrollable within the shared scrolling page shell.
- Errors show a themed modal with client/server backtraces. Missing directories or files are errors, while an existing empty directory has an explicit empty state.

UI sources: `views/log-viewer.njk`, `public/js/log-viewer.js`, and `public/css/log-viewer.scss`. Compile with `npm run scss:build:log-viewer` (also included in the aggregate SCSS build/watch commands).

## API

- `GET /api/log-viewer/files?session=logs|logs_prev` → `{ success: true, files: [{ name, createdAt, size }] }`.
- `GET /api/log-viewer/file?session=logs|logs_prev&name=<encoded filename>` → `{ success: true, file: { name, createdAt, size, content } }`.
- JSON responses use `Cache-Control: no-store`. Failures return `{ success: false, error, stack }`, with 400 for invalid arguments, 403 for forbidden file types, 404 for missing paths, and 500 for other filesystem/metadata errors.

Only the two fixed session directories are accepted. Filename validation rejects path separators, traversal names, null bytes, and non-string inputs. Directories and symlinks are not listed; direct requests for them are rejected. Reads use a no-follow file handle and verify it is a regular file before reading. Creation metadata must be available; there is no modification-time fallback. Contents are full UTF-8 text, without truncation. These are diagnostic endpoints under the same access model as the existing Tools pages; logs and error backtraces can contain sensitive diagnostic information.

## Verification

- `node --test tests/log_viewer.test.js`: ordering, session isolation, literal content, path/symlink rejection, creation metadata, and response errors/cache headers.
- `node playwright_scripts/check_log_viewer.js`: isolated Express/Nunjucks/Playwright test using fixture logs under `tmp/`. Exercises Tools navigation, filtering, session switching, stale-response protection, literal HTML text, responsive layout, synchronized scrolling, and the error modal. Does not boot `server.js`, load a save, or rotate production logs. Screenshots: `tmp/log-viewer-desktop.png`, `tmp/log-viewer-mobile.png`.
