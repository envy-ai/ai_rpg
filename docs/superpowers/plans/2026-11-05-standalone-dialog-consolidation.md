# Standalone and Stories dialog lifecycle consolidation

Status: implemented and verified after checkpoint `de8686c`. This is a finite overlay slice; the remaining form families below remain open in the master ledger.

## Scope and native contracts

The current roots already have shared ModalStack registration. Replace duplicated visibility/Escape/outside policy with configured shared ownership, preserving each caller's established behavior:

| Consumer | Shared owner | Application policy retained |
| --- | --- | --- |
| Config `addModelModal` | ModalStack configured dismissal | Empty/duplicate model validation, previous selection on cancel, input initial focus, model-selector return focus, existing body lock; no new focus trap. |
| Worlds `autofillInstructionsModal` | ModalStack configured dismissal | Guidance/image capture, close before generation starts, generate-button identity, initial textarea focus, existing no-lock/no-trap policy. |
| Workflow `imageWorkflowPresetModal` | ModalStack configured dismissal | One pending name promise, name validation, Enter submit, name/null settlement and mode-specific labels; existing body lock and input initial focus. |
| Lorebooks `uploadModal` / `deleteModal` | ModalStack configured dismissal | Native file/filename controls, selected-book identity and existing API success/failure/close behavior; existing no-lock/no-trap policy, no new pending dismissal guard. |
| Stories reused `story-dialog` | NativeDialog | Same root/body/footer, retained suspended-parent DOM fragments, dialog-kind and leave-review promises, creation counters/identity/cancellation, submit-only disabling, authoring data and async authority. |

No custom modal is converted into new native markup. Stories already uses native top-layer markup; remove its duplicate native Tab trap/global Escape ownership while retaining its cancellation adapter. Shared native focus return must complete before a queued reopen. Replacement content is still rendered synchronously so existing form listener attachment and ownership remain correct. Body-lock state uses the shared explicit owner rather than independent class toggles.

New Game snapshot Save/Load dialogs and Log Viewer's error dialog already use NativeDialog in current source. The audited New Game file has no additional unmigrated custom autofill root; do not invent one. The actual guidance modal is in Worlds.

## Shared API dependency and ownership

Core supplies `AIRPG_MODAL_STACK.configure(root, {onDismiss, canDismiss, escape, trapFocus, focusables})`, `requestDismiss`, `rememberFocus`, `restoreFocus`, pending policy and shared keyboard ordering, alongside existing `setVisible`/`setLock`. A narrow root-backdrop dismissal option may remove equivalent root-click duplication. Configure only current behavior; do not impose new traps or network locks. Worlds/Lorebooks registrations retain `lockScroll: false`.

The standalone worker owns these page controllers and Stories source. Core owns package runtime/exports/build/specimen, modal registration and Play/Chat common overlay policy. The coordinator owns README integration and commits. Terra owns test changes/execution in the required memory-limited scopes. No server restart, loaded save or git mutation is authorized to this worker.

## Acceptance

- Config cancel restores the previous model; valid names add once; malformed/duplicate names retain the current dialog.
- Workflow naming settles once on submit or cancellation, preserves its field on validation failure, and does not steal focus from a later dialog.
- Worlds guidance/image selection remains local; cancel launches nothing, submit closes before generation and preserves the captured caller.
- Lorebooks cancel, success and failure follow their previous transaction rules; opening/closing one owner cannot clear another owner's lock.
- Stories nested instructions restore the exact parent body/footer nodes, listeners, edit counters and creation identity. Cancel/Escape/submit, PageFeedback-over-dialog focus, same-task content replacement and close/reopen remain valid. Native modal ownership wins over background custom-modal Escape handling.
- Original errors/causes remain visible through existing page feedback; no fallback implementation, polling, new numeric clamping or redesign.

## Remaining form-family inventory for subsequent slices

These are source-grounded next seams, not completed by this dialog slice:

1. `techniques.js:rowsEditor` owns a row-to-reader Map and repeated Add/Remove lifecycle used by requirements, normal/failure costs, template attributes/skills, effects/status magnitudes and recipe components. AbilityAttachments repeats the same Map/Add/Remove invariant for scalar modifier groups, granted techniques and effect rows. A small reader/disposer composition over Repeater can share that lifecycle while keeping existing TechniqueMechanicsEditor branch validators, formula modes and attachment revisions.
2. Play `createThingMetadataRow`, attribute bonuses and NPC skill/ability builders repeat native field/Add/Remove construction. Their serializers differ: metadata intentionally accepts text or JSON, attribute/skill rows have numeric rules, and abilities retain IDs/images/status attachments and type styling. Share row ownership/visible fields, not one serializer or a screen-specific giant renderer.
3. FactionEditor already shares asset/tier/relation domain rows across live/create/Worlds forms. Asset/tier add/remove and field construction can consume the same primitives; relation rows are fixed by target faction and Clear changes directed relation state rather than deleting the row, so they are not an interchangeable free-form repeater.
4. Worlds module slot-type rows and item module-slot rows share editable-row mechanics. Keep minimum-entry/unique-ID validation, slot clearing and existing module types in their domain adapters. Existing caught parse/edit errors must be addressed explicitly rather than retained as new silent fallback behavior.
5. Thing/NPC mod extension fields duplicate descriptor-to-native-field creation and already share `parseThingEditModFieldValue`. Extract their common scalar construction/reading using registered metadata, retaining namespaced persistence, module-specific extension slots and boolean/optional-number/object/array contracts. Stories typed setup fields are a genuinely different document-draft lifecycle: mutation clones the complete reviewed draft, preserves authoritative shapes, regenerates only descriptor-marked identities and redraws with focus restoration. Reuse scalar/native field behavior there without replacing its reviewed object/path authority with a DOM-only list.
6. AttributeSkillAllocator already shares New Game and character-view point allocation. Its floor/pool/rank actions and read-only modes are domain rules, not equivalent to free-form NPC/Player Stats fields. Field/stepper presentation may compose portable primitives while leaving those rules intact.
7. Vehicle Location/Region forms already share a partial and the same adapter methods. Current-target single selection and fixed-route multiple tokens duplicate suggestion rendering/dismissal, but route order, pending named/region destinations, ETA and exit validity remain vehicle semantics. Track this as searchable-choice/token-list composition with exact clear/async behavior, not a generic field repeater that discards unresolved destinations.

## Verification evidence

Terra ran **12 unique affected Chromium cases**: 8 Stories cases and 4 actual custom-dialog flows. All browser commands used this prefix:

```bash
XDG_RUNTIME_DIR=/run/user/1000 \
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
PLAYWRIGHT_BROWSERS_PATH=/home/bart/.cache/ms-playwright \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_HTML_OUTPUT_DIR=tmp/<report> \
systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 \
npm run test:e2e:headless -- <case-arguments>
```

- `tests/e2e/story-new-story-fill.spec.js tests/e2e/story-form-fill.spec.js tests/e2e/story-approval-recovery.spec.js --output=tmp/stories-native-results --workers=4`: 7 retained passes. The direct Story form fixture needed the actual overlay/stack adapters; after that fixture dependency was supplied, `tests/e2e/story-form-fill.spec.js --output=tmp/story-form-native-results` passed the remaining case.
- `tests/e2e/config-tabs-isolated.spec.js tests/e2e/settings-npc-naming-isolated.spec.js tests/e2e/image-workflow-loras.spec.js tests/e2e/lorebooks-dialogs-isolated.spec.js --grep 'System tabs|world editor|workflow preset naming|Lorebooks upload' --output=tmp/standalone-modal-results --workers=4`: Config passed. Three initial test expectations imposed focus restoration absent from the original flows and were corrected to the preserved contracts.
- `tests/e2e/settings-npc-naming-isolated.spec.js tests/e2e/image-workflow-loras.spec.js tests/e2e/lorebooks-dialogs-isolated.spec.js --grep 'world editor|workflow preset naming|Lorebooks upload' --output=tmp/standalone-modal-rerun-results --workers=3`: Worlds/workflow passed. The Lorebooks fixture needed its header pending-load route; `tests/e2e/lorebooks-dialogs-isolated.spec.js --output=tmp/lorebooks-modal-results` then passed.

Coverage includes exact suspended-parent DOM identity, accepted/cancelled/reopened Stories creation, pending/provider errors and PageFeedback, approval recovery, model cancellation, guidance submission, one-settlement workflow names and Lorebooks upload/delete outcomes. Existing no-trap/no-lock/no-added-focus-return policies remain explicit.

The implementation worker ran `node --check` on Config, workflow, Lorebooks and Stories sources, compiled modified Worlds/Lorebooks Nunjucks templates, and compared unchanged byte segments against temporary pre-edit copies: Config mixed newlines and Lorebooks CRLF were retained outside the changed blocks. No new styles, server restart, save loading or backend changes were involved. Broader package build/policy evidence is recorded by core in the master ledger.

Changed ignored mod paths for targeted coordinator staging are only `mods/story-authoring/public/js/story-editor.js` and `mods/story-authoring/docs/StoryEditor.md`; no mod backend file changed.
