# Conditional native controls — implementation plan

Status: source inventory and plan only. Runtime implementation waits for the choice checkpoint release. Core owns the separate New Game final-unload Save/Load continuation fix; this plan does not modify those workflow functions.

## Source and retained authority

- `public/js/new-game.js:setupOtherSelect`, `setFormEnabled`, `applySelectValue`, `resolveSelectionValue`: class/race select-with-custom-entry controls. `__other` selects the existing text entry; hiding disables it without clearing its value. Empty custom input focuses when eligible. Known/custom matching, trimmed payloads and loaded draft values remain adapters.
- New Game `populateStartingDayOptions`, `getSelectedStartingMonthLength`, staged `applyLoadedNewGameSettings`: native calendar-dependent choices. Invalid preferred day gets the existing disabled placeholder; loading validates the active calendar before changing form/allocator state. The existing calendar/default rules remain domain-owned, with no new clamping or replacement values.
- Worlds `populateDefaultStartDateControls`, `populateSettingsCalendarSelect`, `populateSettingsCalendarDaySelect`, `refreshCalendarReferenceControls` and CalendarEditor `setupRow`: native reference/day choices. Default-start fields use explicit invalid placeholders; seasonal/holiday reference fields preserve unavailable saved names/days as stale choices until their existing validator rejects them. Those policies are different and must remain different.
- ConfigManager `initializeAiBackendFields` / `updateAiBackendVisibility`: backend/session predicates set section hidden state, required flags and provider heading. Hidden fields retain values. No new automatic disabling/clearing of provider credentials is allowed.
- Config `togglePassword` and `views/config.njk`'s `ai-apiKey` input/button: a native password/text reveal action, not a list. Source search found one consumer. Its thin native property/event behavior can share a small reusable binding rather than a schema/controller hierarchy; the rationale is native platform authority and the absence of domain state, not a blanket single-consumer exemption.

## Proposed minimal portable seams

1. A native field-state helper in `field.js`, proposed `setFieldState(element, {visible?, disabled?, required?}, {visibility = 'hidden', display = 'block'} = {})`. Only explicitly supplied state changes. Validate native control support for disabled/required. Visibility uses either the native hidden property or the caller's existing display policy. It neither computes predicates nor subscribes to app sources. Config sections/required controls and the custom-entry binding consume this common native state application.
2. A focused select/custom-entry owner, proposed `OtherEntry(select, input, {otherValue, enabled, focusEmpty = true})`. Same-document native controls, explicit boolean master eligibility, one owned change subscription. `setEnabled(boolean)` applies the latest host master; `sync()` uses that stored explicit eligibility and the current select value; `destroy()` aborts its subscription. The binding shows the existing custom entry for the sentinel and disables it whenever custom entry is inactive **or master eligibility is false**. It never infers master eligibility from the custom input's own disabled state, clears values or serializes game data. Class and race are two actual consumers.
3. A small native reveal binding, proposed `bindSecretToggle(input, button, {onChange})`, returning a disposer. Native button activation toggles password/text, updates aria-pressed and reports the visibility to the host's icon/accessibility-label callback. Values are untouched. Config supplies its existing eye icons and specific “Show/Hide API key” name. Remove the old inline handler so there is one owner. This is a small element/disposer binding, not a new heavy class or secret-value model.

Names can be adjusted to fit the package registry before implementation. Core owns exports/classic build/specimen mount; the worker owns the focused modules/helper additions after coordination. No catch-all selection/conditional framework is proposed.

## Master eligibility and reviewed lock gotcha

The current `setupOtherSelect` updater writes `other.disabled = !isOther` after `setFormEnabled(false)` disables all controls. Programmatic loaded-value change events can therefore temporarily re-enable a custom Other field while a reviewed draft is loading. The reviewed setup finally disables all fields again, but the intermediate ownership violation remains.

Additionally, the current Start failure path calls `setFormEnabled(true)`. A reviewed draft's edit lock must remain authoritative independently of whether Start becomes eligible for retry. The adapter should compute explicit latest **editable-field eligibility** from the host's action-enabled state and reviewed-draft lock, apply it to editable controls and pass it to both OtherEntry owners. Start readiness and Save/Load availability retain their existing separate domain predicates. The no-world path returns before constructing these owners and retains its server-rendered disabled fieldset guard.

Keep known/custom values and native change events through apply/restore; the new binding must not clear a hidden custom value or steal focus when master eligibility is false. Class/race custom text controls also need an accessible visible label consistent with the existing composite field pattern, without moving their value/name/ID or changing the form payload.

## Dependent select composition

Use the existing CollectionView native-option composition where the option list is rebuilt. Keep native select visibility, disabled placeholders, stale options, preferred-value metadata and explicit selection after appending options. CalendarEditor already owns dynamic row change subscriptions/disposal; compose that signal rather than introducing a second dependent-select controller over its domain model.

The adapters still compute month/day ranges, calendar/default lookup, allowed empty values, stale-reference flags, strict validation and atomic load. Do not convert a stale Worlds day into New Game's blank placeholder, normalize an invalid stored reference into a fabricated valid date, or add a numeric clamp. A generic range/calendar widget is unnecessary for these distinct policies.

## Verification gates and ownership

Terra owns test changes/execution. Reuse current isolated Config, New Game form settings and Worlds/calendar fixtures. Minimal portable examples exercise field-state application, an explicit master checkbox controlling OtherEntry, native option rebuilding and secret reveal/disposal without game imports.

Required direct gates: same-document/native validation, hidden/required/disabled flags only when explicitly supplied; Other inactive versus active/master-disabled state and preserved values; destroyed owner cannot react; secret type/aria state, unchanged text and inert disposed button. No schema serialization or automatic retry tests are needed for these synchronous bindings.

Required actual consumers:

- Class/race known→Other→known→Other preserves text; eligible empty Other focuses; disabled/reviewed Other never re-enables or steals focus during loaded-value changes.
- Reviewed draft with custom class/race stays locked during loading, after settled review and after a failed Start while the explicit Start retry remains correct. Ordinary normal-form pending/failure eligibility still works.
- New Game long→short month invalid day shows the existing placeholder; explicit valid day and saved calendar/allocator application remain atomic.
- Worlds default date and nested season/holiday day selectors keep their different blank/stale policies, update after month edits, reject stale values at the original focused validator and dispose row subscriptions normally.
- Config backend/session switches preserve entered values, toggle exactly the original visible/required targets and keep native validation/provider labels; secret reveal toggles the one native input without changing its value, duplicate activation or focus policy.
- Desktop/phone checks cover custom-entry label/control geometry and existing Config sections; no layout redesign.

No runtime edits, git, server, test execution or terminal-title changes are authorized to this worker before release. README/commit belongs to the coordinator; shared package build/head/SCSS and the independent navigation inventory belong to core. This plan closes only these conditional/native control seams after implementation and verification; the remaining full master ledger continues separately.
