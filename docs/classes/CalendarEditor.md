# CalendarEditor

`public/js/calendar-editor.js` is the application-owned calendar form shared by Worlds and Play. It composes portable `createField`, `Repeater` and `Tabs`; it contains no network requests, profile/save ownership or modal lifecycle. Worlds loads it in its page head; Play loads it before inline initialization.

## Construction

`new CalendarEditor({yearInput, lists, prefix, createField, createActions, setupRow, onChange, onInput, seasonTabs, ensureSeason = false, ensureTime = false, layout = {}})` receives explicit same-document year input and list roots named `months`, `weekdays`, `seasons`, `holidays`.

The shared module owns calendar field schemas, native row construction, nested light-description lists, ordering and draft traversal. Hosts supply:

- `createField(kind, key, label, className, value, options)`, returning `{field, input}`. Worlds supplies live reference selects; Play supplies free-text references. Both use the portable labeled field builder.
- `createActions(kind)`, returning shared repeater action controls with caller labels/classes.
- Optional `setupRow(kind, row, fields, data, signal)` for reference wiring. The provided signal ends when that row is removed or replaced.
- Optional `onChange({kind, action, row})` for structural changes and `onInput(event)` for row input events. Initial loading does not emit structural changes.

`prefix` retains each host's classes. `layout` supplies label overrides, field ordering, textarea rows and seasonal time-section presentation. An optional `seasonTabs` root enables the existing Play season-tab presentation; Worlds uses list seasons. These adapters contain presentation/reference differences, not duplicated schema builders.

## Operations

`add(kind, value, {root = lists[kind], focus = false, notify = true})` adds a known calendar row and returns it. Kinds are `months`, `weekdays`, `seasons`, `holidays`, and nested `times`. Weekday values are strings; other values are records. Nested time rows require their time-list root. Omitted values create blank records. Seasons contain name, start month/day, optional day length, general/vegetation/interior descriptions and ordered time descriptions.

`load(definition = null)` replaces all rows, assigns year name, loads seasons before month reference fields, and emits no structural notifications. The host's `ensureSeason`/`ensureTime` policies determine initial blank rows. Worlds permits no definition or no seasons/times. Play retains its initial blank season/time rows and recreates a blank season when its last season is deleted; a user may still delete the final individual time row.

`readDraft()` returns trimmed strings and ordered nested arrays without pretending to validate or normalize domain data. The Worlds adapter retains strict local name/reference/day validation, missing-reference options, hidden serialization, optional absence, preview/summary updates and default-start-date controls. The Play adapter converts numeric/nullable fields as before and delegates validation to `/api/calendar`.

Season tab reordering moves the same panel DOM rather than reconstructing drafts. Shared `Tabs` is remounted around those retained panels; every description, reference, day-length and nested time edit survives. `selectSeason(index)` explicitly selects a displayed season and rejects unknown indices. Tab labels follow edited season names.

`clear()` releases row listeners/nested repeaters and clears lists/tabs without changing the year field. `destroy()` also releases all root repeaters and references; it is idempotent. Further operations throw. Add/remove/move use native buttons and delegated row actions; no polling, backend changes or silent repair is added.

Both adapters keep existing control classes and Play's season panel/tab IDs. The affected browser fixtures cover seeded Worlds profile initialization, strict references and the active Play calendar's seasonal tabs/reorder/draft/save flow; see [Playwright guidance](../playwright.md) for runner commands and reported evidence.

Exact affected commands, retained evidence and delivered-style checks are recorded in the [domain form consolidation plan](../superpowers/plans/2026-11-05-domain-form-consolidation.md#focused-verification-evidence).
