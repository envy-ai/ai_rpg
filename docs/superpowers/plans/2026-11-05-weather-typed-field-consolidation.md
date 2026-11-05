# Weather rows and Stories native typed fields

## Scope and ownership

This slice starts after checkpoint `c751090`. It closes weather's nested native row lifecycle and shares scalar construction in Stories' recursive HTML renderer. It retains validation, reviewed-document/path/shape authority, nullable values, original IDs/data attributes, delegated events, readonly behavior and save transactions. No generation/approval/notification ownership, backend behavior, new bounds, schema framework or automatic row repair is added.

The form worker owns index weather builders/read/reset blocks, Stories scalar helper/branches, `field.js` serialization helper and focused docs/specimen module. Core owns exports/classic build/specimen mount and parallel feedback work; the coordinator owns README/commit and Terra owns tests. Index writes use fresh bounded replacements; common modal/feedback code remains outside this slice.

## Implemented seams

Weather's persistent season root composes ReaderRows; season removal and clear release nested type rows and Add listeners. Render/reset use clear, preserving the outer static Add action across reopen. Readers provide original native controls to the unchanged validator. Labels/wrappers/classes, positive-frequency rules, duration text, initial blank season/type, manual last-row removal, dynamic-weather disable behavior and canonical payload stay local. Final unload destroys owners; persisted hide leaves them usable.

Stories `typedNativeFieldHtml` uses createField for scalar and string-list branches. It retains IDs, raw JSON `data-typed-path`, typed kinds, native options, compact inline checkbox label placement, help, readonly/disabled attributes and textarea rows. The host appends select options before choosing the current value, including the explicit selected “Current reviewed value” option for values absent from current descriptors. Native DOM serialization escapes values once.

Portable `serializeField({field,input})` clones one owned native field and reflects its current value/checked/textarea/selected state without changing live defaults. Leading textarea LF receives the parser's required compensation. A nonempty unselected single select, file input or indeterminate checkbox rejects because its current state cannot be represented faithfully in HTML. This helper contains no reviewed-document or game validation.

Stories objects/collections continue through typedFields recursion and the existing clone/read/mutate/redraw operations. Descriptor-required fields, authoritative entry shapes, duplicate/restore behavior, identity regeneration, focus restoration, proposal identity and session draft persistence remain mod-owned. DOM row authority would be different behavior here, so these collections do not adopt ReaderRows.

## Verification gates

Syntax checks passed for field.js, the serialization specimen and Stories source. Play weather Nunjucks/inline syntax passed. Core exported/built the helper and mounted the specimen before consumers ran. **Five distinct affected Chromium cases passed**: native HTML round trips, real weather editing, reviewed Stories scalars and two existing Stories draft/new-story regression journeys.

The direct helper case covers leading LF and escaped text, explicit zero/false, checked/selected state, readonly/data attributes, unchanged original defaults and the unrepresentable single-select error. Weather exercises 1280/390px geometry, validation focus, saved data, disabled-state saving, close/reopen and a retained removed season's inert Add button. The reviewed Stories case checks native edited values and document redraw without changing review authority. Existing Stories flows retain local edits and the explicit Create boundary. The standalone direct Stories fixture now loads the real controls adapter.

All browser commands use the standard XDG/DBUS/browser paths, `PLAYWRIGHT_SKIP_WEBSERVER=1`, and this prefix:

```bash
XDG_RUNTIME_DIR=/run/user/1000 \
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
PLAYWRIGHT_BROWSERS_PATH=/home/bart/.cache/ms-playwright \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 \
npm run test:e2e:headless -- <case arguments>
```

Exact case arguments and retained results:

- `tests/e2e/ui-widgets-serialize-field.spec.js tests/e2e/ability-tooltip.spec.js tests/e2e/story-new-story-fill.spec.js --grep 'field serialization reflects|Region weather rows retain|Stories reviewed scalar fields' --output=tmp/weather-fields-first-results --workers=3`: weather and Stories retained (2).
- `tests/e2e/ui-widgets-serialize-field.spec.js --output=tmp/serialize-field-final-results --workers=1`: direct reflection case passed (1).
- `tests/e2e/story-form-fill.spec.js tests/e2e/story-new-story-fill.spec.js --grep 'Generate missing fields preserves|new story fill waits for Create' --output=tmp/story-field-regression-results --workers=2`: existing edited-draft/Create journeys passed (2).

The weather source/UI unit gate also passed **3/3**:

```bash
systemd-run --wait --collect --pipe \
  -p MemoryMax=16G -p MemorySwapMax=0 \
  -p 'WorkingDirectory=/home/bart/ai_rpg' \
  node --test tests/weather_editor_ui.test.js
```

Runtime is frozen after these gates.

## Remaining full-goal work

This slice does not complete the full master ledger. Navigation, feedback/readers, remaining styles and feature/mod compositions remain separately tracked. Distinct allocation pools, fixed directed faction relations and reviewed Stories document ownership already have explicit domain boundaries; they continue to compose shared native/control mechanics where equivalent.
