# Choice presentation and lifecycle

## Scope

This finite group starts after checkpoint `90492e1`. Compose existing CollectionView around five repeated choice presentations: runtime entity search, Play saved-game options, New Game saved-form cards, mandatory ability draft cards and stack keeper cards. Preserve native markup and immediate versus explicit commit, mandatory cardinality, pending, revision, route/source, draft and ID policies. NativeSuggestions' blur/clear semantics do not apply to these surfaces. No new all-purpose selection framework is needed.

The form worker owns these index/New Game choice functions. Core owns Busy/Status/Notice functions, shared exports/build/SCSS and any status-only wrappers in New Game/config; both workers coordinate fresh bounded writes. The coordinator owns README/git and Terra owns tests. Navigation layout is outside this checkpoint.

## Implementation

- The dynamic entity chooser owns a CollectionView plus its filter/action subscriptions. Close releases them, load delivery checks the existing closed flag and failed immediate action cannot update a released owner. The host still decorates/searches records, blocks duplicate actions/dismissal while pending and performs the domain request.
- Play save/autosave options use CollectionView with keepVisibleWhenEmpty. Native loading/empty placeholders and confirm state remain local. The first save is explicitly selected after options are appended. Source switches, sorting and stale fetch tokens are unchanged.
- New Game saved-form radio cards use CollectionView and owned change listeners. Filtering out a selection clears it; choosing a card does not load. Explicit Load retains staged calendar/allocator validation, atomic application and request epochs. Native close clears cards; final unload aborts dialog reads and native lifetimes while cached hide preserves them.
- Required ability cards use CollectionView, explicit select/decline/tooltip listener lifetimes and ImageFrame subtree disposal. Existing name sets, per-level limits, mandatory dismissal policy, original IDs, image/attachment content and submit/retry rules remain host-owned.
- Stack keeper cards use CollectionView with owned click/tooltip listeners and image disposal. Rebuild/close releases former controls; group order, keeper Map, staged commit, busy state and eligible-item rules remain unchanged.

Existing tooltip helpers accept optional owner signals for these new consumers. Other tooltip callers retain their original lifetime. No image transport/revision policy moves into choice controllers.

## Distinct native/control work still required

The next source-grounded boundary and proposed APIs are recorded in the [conditional native controls plan](2026-11-05-conditional-native-controls.md). That document is planning only until the coordinator releases implementation after this checkpoint.

Source inventory found saved-form radio cards with world metadata in New Game, not an independent world-profile picker. The page's loaded-world guard and reviewed draft lock remain domain rules.

New Game `setupOtherSelect` (class/race) shares a native select/custom-text visibility and disabled-state invariant, but it is not an immediate search list. `resolveSelectionValue` and loaded custom values remain host serialization. Its current updater writes `other.disabled = !isOther` after `setFormEnabled(false)` and can re-enable a custom entry in a reviewed locked form; the next adapter must preserve the master disabled contract. Starting month/day controls in New Game and Worlds depend on the active calendar and must retain strict reference/atomic-load behavior. ConfigManager backend/session sections combine hidden state, required attributes and provider labels. Source search found exactly one password reveal control (`ai-apiKey` in config.njk) and its one native `togglePassword` helper, with no duplicate secret field in other pages. These are required subsequent conditional/control seams, not completed by this list slice. Extract a focused primitive only where its invariant actually matches; do not force all conditional fields into a generic list or search widget.

## Verification gates

New Game syntax and Play Nunjucks/inline syntax passed. No new package export or style dependency is needed. **Eight distinct Chromium choice cases and nine affected source/UI cases passed.** The browser cases cover actual entity filter/pending/late-close; mandatory choose/decline and failed-submit retry; saved-form explicit Load, empty/no-match and cancelled late list response; native Play loading/first-selected/empty-disabled/close; and staged keeper selection. Strengthened entity and saved-form cases retain a former control and verify its click is inert after cleanup/filtering; the keeper case also verifies its detached card is inert.

All browser commands use the standard XDG/DBUS/browser paths, `PLAYWRIGHT_SKIP_WEBSERVER=1` and this prefix:

```bash
XDG_RUNTIME_DIR=/run/user/1000 \
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
PLAYWRIGHT_BROWSERS_PATH=/home/bart/.cache/ms-playwright \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 \
npm run test:e2e:headless -- <case arguments>
```

Exact case arguments and retained results:

- `tests/e2e/ability-tooltip.spec.js tests/e2e/new-game.form-settings.spec.js --grep 'search selection filters choices|level-up ability choices show|failed ability submit keeps|load searches every save|empty save list and search|canceling a pending list request' --output=tmp/choice-first-results --workers=3`: 6/6.
- `tests/e2e/ability-tooltip.spec.js --grep 'Play load dialog keeps|stack keeper choices retain' --output=tmp/choice-extra-results --workers=2`: keeper retained (1).
- `tests/e2e/ability-tooltip.spec.js --grep 'Play load dialog keeps' --output=tmp/play-load-select-results`: native select passed after correcting the fixture's empty-option assertion (1).
- `tests/e2e/ability-tooltip.spec.js tests/e2e/new-game.form-settings.spec.js --grep 'search selection filters choices|load searches every save' --output=tmp/choice-detached-results`: strengthened detached-control assertions passed (2 existing cases, not additional unique coverage).

The keeper case also passed after strengthening its reopen boundary: a retained old card cannot select a keeper in a newly opened chooser (`--grep 'stack keeper choices retain' --output=tmp/stack-detached-reopen-results`). This retains the same unique case count.

Affected source/UI tests passed 9/9:

```bash
systemd-run --wait --collect --pipe \
  -p MemoryMax=16G -p MemorySwapMax=0 \
  -p 'WorkingDirectory=/home/bart/ai_rpg' \
  node --test tests/player_abilities_modal_ui.test.js tests/player_skills_modal_ui.test.js
```

Core separately requested the ability interaction owner's send-button eligibility update through `BusyButton.setIdleState({disabled:blocking})` so it cannot release another owner's busy state. That bounded integration belongs to the parallel Busy/Status/Notice contract. Runtime is frozen after this delivery.

## Remaining full goal

The master ledger remains authoritative for conditional controls, navigation, styles and feature/mod compositions. This group closes shared presentation/disposal for the five named consumers after verification; it does not move their domain selection models into the library or mark the whole audit complete.
