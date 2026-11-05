# Conditional native controls

Implemented after checkpoint `99cdba4`; runtime is frozen after focused verification. Core's preceding New Game Save/Load final-unload guards remain intact.

## Source and retained authority

- `public/js/new-game.js:setupOtherSelect`, `setFormEnabled`, `applySelectValue`, `resolveSelectionValue`: class/race select-with-custom-entry controls. `__other` selects the existing text entry; hiding disables it without clearing its value. Empty custom input focuses when eligible. Known/custom matching, trimmed payloads and loaded draft values remain adapters.
- New Game `populateStartingDayOptions`, `getSelectedStartingMonthLength`, staged `applyLoadedNewGameSettings`: native calendar-dependent choices. Invalid preferred day gets the existing disabled placeholder; loading validates the active calendar before changing form/allocator state. The existing calendar/default rules remain domain-owned, with no new clamping or replacement values.
- Worlds `populateDefaultStartDateControls`, `populateSettingsCalendarSelect`, `populateSettingsCalendarDaySelect`, `refreshCalendarReferenceControls` and CalendarEditor `setupRow`: native reference/day choices. Default-start fields use explicit invalid placeholders; seasonal/holiday reference fields preserve unavailable saved names/days as stale choices until their existing validator rejects them. Those policies are different and must remain different.
- ConfigManager `initializeAiBackendFields` / `updateAiBackendVisibility`: backend/session predicates set section hidden state, required flags and provider heading. Hidden fields retain values. No new automatic disabling/clearing of provider credentials is allowed.
- Config `togglePassword` and `views/config.njk`'s `ai-apiKey` input/button: a native password/text reveal action, not a list. Source search found one consumer. Its thin native property/event behavior can share a small reusable binding rather than a schema/controller hierarchy; the rationale is native platform authority and the absence of domain state, not a blanket single-consumer exemption.

## Portable seams

1. `setFieldState(element, {visible?, disabled?, required?}, {visibility = 'hidden', display = 'block'} = {})` applies only explicitly supplied native state. Config sections/required controls and OtherEntry consume it; predicates and values remain host-owned.
2. `OtherEntry(select, input, {otherValue, enabled, focusEmpty = true})` owns same-document select/type-text controls and associated labels. Master eligibility is explicit. `setEnabled`, `sync` and idempotent `destroy` preserve values and release the change listener. Class and race are actual consumers; no disabled-state inference or game serialization moves into the owner.
3. `bindSecretToggle(input, button, {onChange})` returns an idempotent disposer. It toggles native password/text and ARIA state; Config supplies its existing eye icons and specific Show/Hide API key label. The inline handler was removed so one owner receives activation. This is a small element/disposer binding, not a secret-value model or list controller.

Core integrated exports/classic build and the isolated `conditional-fields.js` specimen. Initial custom-label styling is in authoritative SCSS. No general selection/conditional framework was added.

## Master eligibility and reviewed lock gotcha

Before migration, `setupOtherSelect` wrote `other.disabled = !isOther` after `setFormEnabled(false)` disabled all controls. Programmatic loaded-value changes could temporarily re-enable custom entries while a reviewed draft loaded.

`editableFormEnabled()` now derives **editable-field eligibility** from `isFormEnabled && !reviewedDraftToken`, applies it to editable controls and supplies both OtherEntry owners. The Start failure path may restore action readiness while reviewed fields stay locked. Start readiness and Save/Load availability retain their separate domain predicates. The no-world path returns before constructing owners and retains its server-rendered disabled fieldset guard.

Keep known/custom values and native change events through apply/restore; the new binding must not clear a hidden custom value or steal focus when master eligibility is false. Class/race custom text controls also need an accessible visible label consistent with the existing composite field pattern, without moving their value/name/ID or changing the form payload.

## Dependent select composition

Use the existing CollectionView native-option composition where the option list is rebuilt. Keep native select visibility, disabled placeholders, stale options, preferred-value metadata and explicit selection after appending options. CalendarEditor already owns dynamic row change subscriptions/disposal; compose that signal rather than introducing a second dependent-select controller over its domain model.

The adapters still compute month/day ranges, calendar/default lookup, allowed empty values, stale-reference flags, strict validation and atomic load. Do not convert a stale Worlds day into New Game's blank placeholder, normalize an invalid stored reference into a fabricated valid date, or add a numeric clamp. A generic range/calendar widget is unnecessary for these distinct policies.

Implemented lifetime: New Game owns/disposes its day option view and month-change subscription; atomic rollback restores owned option content and Other label/input state. A document-owned disposed flag guards pending reviewed initialization and Start continuations, including allocator waits, before they can touch released owners or navigate/report against a discarded page. Persisted hide retains live owners. Normal keepalive Start transport and existing settings workflow guards remain unchanged.

Worlds caches native option-only views weakly. CalendarEditor row signals destroy dynamic select views and delete their cache entries. Static default selectors have document lifetime; their views own no external subscriptions, observers or async delivery, so there is no strong unload registry or artificial remount. Config's conditional source listeners and secret binding release on final hide, retaining values and cached-page usability.

## Verification gates and ownership

Passed: **9 distinct isolated Chromium cases and 18 calendar source/UI cases**. This includes portable controls/specimens, actual New Game/Config/Worlds consumers and reviewed initialization/Start final-unload guards. Core's final widget/main/settings builds were deterministic and syntax/template checks passed; the focused critic found no actionable issue. Commands and artifacts are recorded in [Playwright verification](../../playwright.md). Runtime source is frozen.

Terra owns test changes/execution. Reuse current isolated Config, New Game form settings and Worlds/calendar fixtures. Minimal portable examples exercise field-state application, an explicit master checkbox controlling OtherEntry, native option rebuilding and secret reveal/disposal without game imports.

Required direct gates: same-document/native validation, hidden/required/disabled flags only when explicitly supplied; Other inactive versus active/master-disabled state and preserved values; destroyed owner cannot react; secret type/aria state, unchanged text and inert disposed button. No schema serialization or automatic retry tests are needed for these synchronous bindings.

Required actual consumers:

- Class/race known→Other→known→Other preserves text; eligible empty Other focuses; disabled/reviewed Other never re-enables or steals focus during loaded-value changes.
- Reviewed draft with custom class/race stays locked during loading, after settled review and after a failed Start while the explicit Start retry remains correct. Ordinary normal-form pending/failure eligibility still works.
- New Game long→short month invalid day shows the existing placeholder; explicit valid day and saved calendar/allocator application remain atomic.
- Worlds default date and nested season/holiday day selectors keep their different blank/stale policies, update after month edits, reject stale values at the original focused validator and dispose row subscriptions normally.
- Config backend/session switches preserve entered values, toggle exactly the original visible/required targets and keep native validation/provider labels; secret reveal toggles the one native input without changing its value, duplicate activation or focus policy.
- Desktop/phone checks cover custom-entry label/control geometry and existing Config sections; no layout redesign.

README/commit belongs to the coordinator; shared package build/head/SCSS and navigation belong to core. Terra owns tests. This slice closes only these conditional/native control seams; the remaining full master ledger continues separately.
