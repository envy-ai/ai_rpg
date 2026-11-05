# Region Secret and quest row ownership

## Scope

This continues the accepted weather/Stories form slice while the independent feedback pass runs. Migrate equivalent Add/Remove/read lifetimes through existing ReaderRows/createField; retain domain validation, unknown IDs, saved identities, hidden metadata, zero policies and async option ownership. No new backend behavior, generated persisted IDs, clamping, quest execution or shell/feedback ownership is introduced.

The form worker owns Region Secret functions and bounded quest row builders/readers/clear blocks in index plus the approved `_form-rows.scss` wrapper rules. Core owns compiled SCSS and parallel feedback blocks; the coordinator owns README/git and Terra owns tests. Fresh bounded index edits avoid common modal and feedback blocks.

## Canonical and distinct contracts

`Quest.js:QuestObjective` serializes id, description, completed and optional. Client rows preserve existing IDs and leave new ID allocation to the canonical model. The quest form has no separate editable condition list; optional/completed flags stay fixed native checkboxes within each free objective row.

`POST /api/quest/edit` documents optional replacement collections and typed benefit rules. Physical reward names/descriptions, faction reputation nonzero integers, grouped NPC dispositions, party-member targets and pinned route knowledge remain the existing collectors. Scalar XP/offset/currency behavior stays untouched. Unknown faction IDs still receive authoritative server validation. Applied benefits cannot be removed or retargeted canonically; the existing client applied-route select/Remove lock remains in place.

Region secrets remain trimmed nonblank strings in DOM order. Initial blank row creation is preserved; removing the last row does not automatically create a replacement.

## Implementation

Region Secrets uses one persistent ReaderRows owner. The quest form uses five persistent owners for item rewards, faction rewards, NPC dispositions, mixed typed benefits and objectives. Open/close/rerender clears owners, retaining static Add buttons. Individual row readers replace unowned DOM scans while original domain filtering, grouping and party-before-route ordering remain unchanged. Final unload destroys owners; persisted hide leaves them usable.

createField adds visible labels to the existing native controls; original input classes, IDs/metadata, min/step/native validation and compact checkbox flag layout remain local. `_form-rows.scss` moves existing named grid areas onto the field wrappers and retains the desktop/mobile grids. Core compiles main CSS after the source update.

NPC/route rows abort owned change listeners and stale delivery when removed/rebuilt. Requests/cache remain shared transport. A source review found that saved party/route options were formerly blank until lookup completed, letting an immediate Save drop the saved benefit. The adapters now seed the explicit current option before awaiting, retain it through failure and rebuild against the live current selection after awaiting. A live Clear stays clear; pinned source/destination and saved benefit ID remain available during loading. No unknown destination is invented. Original lookup/JSON errors surface through the existing page feedback owner; directory failure does not become a successful empty selection. A quest-scoped WeakSet reports a shared original Error once while all active rows retain their own current values and finish loading. A different error or later deliberate failed request can report normally; obsolete removed rows do not claim reporting ownership.

## Verification gates

Play Nunjucks and inline JS syntax passed after the scoped source edits. Core compiled the authoritative main SCSS. **Five distinct Chromium cases and 19 distinct source/UI cases passed.** Browser coverage checks Region trim/order/save/reopen; objective edits/IDs/flags, scalar zero, item rewards and unknown factions; save before NPC/route directory completion; all row-variant desktop/phone geometry; live Clear and unchanged detached selects after late directory responses; and one shared error dialog with retained payloads followed by a separately reported deliberate failed lookup. Persistent Add/Remove remains usable across reopen.

The first objective success fixture omitted a valid `/api/players` response, causing the newly explicit error dialog to take focus during fill. Supplying the real response shape fixed the fixture; no production timing delay or compatibility branch was added.

All browser commands used the standard XDG/DBUS/browser paths, `PLAYWRIGHT_SKIP_WEBSERVER=1` and this prefix:

```bash
XDG_RUNTIME_DIR=/run/user/1000 \
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
PLAYWRIGHT_BROWSERS_PATH=/home/bart/.cache/ms-playwright \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 \
npm run test:e2e:headless -- <case arguments>
```

Exact accepted case arguments:

- `tests/e2e/ability-tooltip.spec.js --grep 'Region secret rows preserve|Quest editor saves existing benefits|Quest reward and objective row controls' --output=tmp/quest-region-final-results --workers=3`: 3/3.
- `tests/e2e/ability-tooltip.spec.js --grep 'Quest editor preserves objective' --output=tmp/quest-objective-real-results --workers=1`: 1/1.
- `tests/e2e/ability-tooltip.spec.js --grep 'Quest shared NPC lookup failure' --output=tmp/quest-lookup-failure-results --workers=1`: 1/1.

The pending-directory case also passed a strengthened applied-route assertion: both its select and Remove remain disabled (`--grep 'Quest editor saves existing benefits' --output=tmp/quest-applied-pending-results`). This rerun retains the same unique case count.

Source/UI verification used:

```bash
systemd-run --wait --collect --pipe \
  -p MemoryMax=16G -p MemorySwapMax=0 \
  -p 'WorkingDirectory=/home/bart/ai_rpg' \
  node --test tests/quest_editor_reward_ui.test.js \
    tests/quest_list_reward_ui.test.js tests/region_secrets_config.test.js
```

Eighteen cases were retained; after updating the changed ReaderRows source assertion, `tests/quest_editor_reward_ui.test.js` reran 8/8 under the same memory-limited prefix, yielding 19 distinct passes. Runtime is frozen after these gates.

## Remaining full-goal work

These free-row forms do not resolve all form or widget audit families. Select-with-Other/dependent selects, configuration conditional/secret fields, allocator rank presentation and feature/mod compositions remain source-review items in the master ledger. Fixed domain state is not forced into list semantics merely because it has fields.
