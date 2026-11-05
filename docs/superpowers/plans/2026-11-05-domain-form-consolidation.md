# Shared calendar and effect form editors

Status: implemented and verified after checkpoint `9d60e63`. This completes the bounded calendar/effect form consolidation, not the remaining widget audit. The parent widget merge plan owns overall sequencing and acceptance.

## Goal and ownership

Consolidate actual duplicate form construction and collection in application-owned modules. Compose the portable `Tabs`, `Repeater`, `createField` and `NumberRange` controls without moving calendar/effect domain rules into the independent widget package. Keep native/custom modal lifecycle, network operations, draft application and persistence in each page adapter.

The form worker owns new `public/js/calendar-editor.js` and `status-effect-editor.js`, standalone Worlds and Player Stats adapters, and agreed bounded Play editor internals. The core worker owns modal shells and shared loading/build integration. Testing remains with the testing worker.

## Source contracts

The source of truth is the current application, with these differences preserved deliberately:

- Worlds calendar permits an absent definition, keeps its hidden serialized value, builds list-style seasons, uses live month/season/day select choices, displays stale references and performs local validation. Calendar generation/default application, profile loading, summaries, previews and dependent default-start fields remain page-owned.
- Play calendar loads/saves the active definition through `/api/calendar`, uses free-text references and server validation, displays season tabs, and creates a blank season/light-description row during initial rendering/loading. Deleting the final individual time row is allowed; deleting the final season recreates its blank editor. The seasonal tab wrapper and its focus/draft behavior must remain intact.
- Player Stats and Location effect rows edit description, duration, maximum-health percentage and modifiers. They retain stored hidden names and other fields. NPC rows also edit optional names and accept a name-only row.
- Item target/equipper effects have existing static fields and must adopt the common field reader/modifier editor without replacing their surrounding static layout or target/equipper flags.
- Modifier rows preserve separate fixed and percentage values, including explicit zero. Need rates require fixed deltas and do not expose percentage input. Caller-owned option sources retain authoritative attribute/skill/need identities.
- Location supports attribute/skill modifiers in incoming JSON effects. `Location.#normalizeStatusEffects` calls `status_effect_list.normalizeStatusEffectInstances` without options; that helper defaults `includeNeedBars` to false and omits need bars before constructing a `StatusEffect`. The shared Location adapter will therefore offer attribute/skill choices only. It will still clone hidden original metadata in the client collector. This UI work will not expand backend mechanics or alter save normalization.
- Missing static controls preserve their original stored values; present empty controls omit the edited optional scalar. In particular, Play queries an equipper-duration input that has no corresponding markup; its original duration must survive editing other fields.
- Missing saved modifier option IDs remain selectable as explicitly unavailable values, so an unrelated edit cannot silently remove their stored modifiers.
- Duration text remains unparsed except for the existing numeric-string conversion. Canonical minute/duration validation remains in `StatusEffect` and API handling. IDs, application timestamps, technique grants/provenance and other hidden stored data must survive visible-field edits.

## Application interfaces

### ModifierEditor and StatusEffectEditor

`ModifierEditor({getOptions, normalizeNeedBarKey, allowNeedBars})` provides the existing `createRow(initial)`, `renderList(root, entries)` and `collect(root)` seam. It uses the shared repeater lifecycle while retaining current `thing-modifier-*` control classes, native selectors and fixed/percentage values, with visible labeled field wrappers. Option discovery remains injected: Play supplies live definitions; standalone Player Stats supplies its existing native form definitions.

`StatusEffectEditor(root, {modifiers, editableName = false})` owns repeated effect rows through `add(effect)`, `render(effects)`, `collect()`, `clear()` and `destroy()`. It preserves original fields before applying visible edits. `editableName` selects the existing NPC name/description contract; the description-only variant retains hidden names. Common `StatusEffectFields.read`/`populate` helpers accept existing static inputs and original data for item target/equipper adoption.

Do not add technique mechanics editing here: `TechniqueMechanicsEditor` already shares that separate domain editor with ability attachments. General labeled fields/repeated-row lifecycle can be adopted there later without duplicating mechanics.

### CalendarEditor

`CalendarEditor` receives explicit year/list elements and narrow field/layout/reference adapters. It owns shared field schemas, creation and traversal of months, weekdays, seasons, holidays and nested light-description rows. Methods are `load(definition)`, `readDraft()`, `add(kind, value, {focus = false})`, `clear()` and `destroy()`. Constructor policies `ensureSeason` and `ensureTime` preserve the selected adapter’s initial blank-row behavior.

The Worlds adapter supplies reference selectors and its existing strict validator; the Play adapter supplies free-text reference fields and the season-tab shell. Shared data traversal returns explicit draft values; it does not silently normalize or repair invalid references. Page adapters retain the selected branch's nullable/empty semantics and final validation. Existing labels, classes and field ordering should be retained through small layout hooks, without screen-name branches inside the shared module.

The portable `createRowActions` helper adds explicit move-label/class options so Play retains its existing `Move Up`/`Move Down` wording. No domain-specific option belongs in that helper.

## Ordered implementation and acceptance

1. Commit/verify the existing repeated-controls slice before runtime edits to this phase.
2. Introduce the shared modifier/effect module and migrate Player Stats, NPC and Location repeated effects plus item target/equipper modifiers and field collection. Retain matching DOM contracts for existing automation.
3. Verify zero values, omitted optional scalars, duration strings, hidden original metadata and supported modifier kinds. Confirm that removed/detached rows cannot retain active owned callbacks after disposal.
4. Introduce shared calendar construction/traversal and migrate both Worlds and Play. Preserve Worlds absent/strict-reference policy, Play season-tab behavior, nested time rows, all authored fields and current save payload shapes.
5. Verify seeded initial profile/calendar loading, stale references, draft preservation through reorder/tab changes, nested row deletion, both calendar save branches and error display. Keep endpoint mutations mocked in browser fixtures.
6. Update focused class docs and UI references; the coordinator updates `docs/README.md` and the master audit status. Build authoritative SCSS outputs if styles change. Syntax-check changed sources and compile modified Nunjucks templates. The testing worker runs affected tests in the required memory-limited systemd scope.

No server restart, loaded-save mutation or backend semantic expansion is required. No git operations are performed by the delegated form worker.

## Implementation evidence

- `public/js/status-effect-editor.js` is shared by Player Stats and Play NPC/Location effects plus static item target/equipper fields and modifiers. The common collector distinguishes absent controls from present empty values, preserves original metadata and retains unavailable modifier identities. Location selects only canonically supported attribute/skill kinds.
- `public/js/calendar-editor.js` supplies the actual shared schemas, construction, nested repeaters, season navigation and raw draft traversal for Worlds and Play. Existing reference and final validation/serialization rules stay in the page adapters.
- `createRowActions` adds generic move-label/class overrides used to preserve Play labels. Standalone scripts load their domain module locally; the core owner integrates Play scripts.
- All changed standalone JS modules pass `node --check`; `index.njk`, `settings.njk` and `player-stats.njk` compile. The testing worker supplied the browser/unit evidence below.

The visible-label migration also gives shared effect forms semantic field placement: name/description and the nested modifier list span the row, numeric fields share the remaining columns, and narrow layouts use one column. `_status-effect-editor.scss` is included by `main.scss`; its compiled CSS was rebuilt successfully. Static item cause-effect layout is unchanged.

## Focused verification evidence

The testing worker ran the following browser cases with the shared prefix:

```bash
XDG_RUNTIME_DIR=/run/user/1000 \
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
PLAYWRIGHT_BROWSERS_PATH=/home/bart/.cache/ms-playwright \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_HTML_OUTPUT_DIR=tmp/<report> \
systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 \
npm run test:e2e:headless -- <case-arguments>
```

`<report>` is a distinct temporary report directory and `<case-arguments>` is one row below. These are recorded commands, not an instruction to run a live server or load a save.

| Case arguments | Passing domain cases |
| --- | ---: |
| `tests/e2e/status-effect-editor-isolated.spec.js --output=tmp/status-layout-results` | 2 |
| `tests/e2e/ability-tooltip.spec.js --grep 'NPC status edits' --output=tmp/npc-status-layout-results` | 1 |
| `tests/e2e/ui-widgets-modal-stack.spec.js tests/e2e/ability-tooltip.spec.js --grep 'shared modal backdrop\|Location status editor' --output=tmp/modal-status-results --workers=2` | 1 Location case, plus the separately owned modal check |
| `tests/e2e/ability-tooltip.spec.js --grep 'item effect edits' --output=tmp/item-status-results` | 1 |
| `tests/e2e/player-stats-effects-isolated.spec.js --output=tmp/player-stats-save-results` | 1 |
| `tests/e2e/ability-tooltip.spec.js --grep 'Play character editor preserves' --output=tmp/play-player-status-results` | 1 |
| `tests/e2e/ability-tooltip.spec.js --grep 'Play calendar retains' --output=tmp/calendar-play-results` | 1 |
| `tests/e2e/settings-npc-naming-isolated.spec.js --output=tmp/world-calendar-results` | 1 |
| `tests/e2e/ability-tooltip.spec.js --grep 'Play calendar keeps minimum' --output=tmp/calendar-minimum-corrected-results` | 1 |

This is **10 unique domain browser cases**. The final delivered stylesheet received an additional focused rerun of `tests/e2e/status-effect-editor-isolated.spec.js --grep 'labeled modifier' --output=tmp/status-layout-final-results` (1 passed), retaining unaffected behavioral passes. Checks compare actual label/input boxes as well as root geometry. Inspected artifacts include `tmp/status-effects-1280.png`, `tmp/status-effects-375.png`, `tmp/npc-status-1280.png` and `tmp/npc-status-390.png`.

The unit cases ran under:

```bash
systemd-run --wait --collect --pipe \
  -p MemoryMax=16G -p MemorySwapMax=0 \
  -p 'WorkingDirectory=/home/bart/ai_rpg' \
  node --test tests/calendar_editor_ui.test.js tests/settings_calendar.test.js
```

There were 17 retained passes, followed by the same scoped command limited to `node --test tests/calendar_editor_ui.test.js` after updating its migrated-helper assertion: 6/6 passed. The combined valid evidence covers **18 unique unit cases**. The manual-last-time-row test deliberately expects zero rows, matching the old `appendCalendarRowActions` direct removal path; initial empty-season rendering still inserts a blank time row, and last-season removal recreates a blank season.

No server restart, loaded-save mutation or backend change was used for this verification. All test execution was performed by the testing worker; the implementation worker performed syntax/template/SCSS compilation only.
