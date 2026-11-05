# UI widget merge master plan and progress ledger

Started 2026-11-05. Active objective: complete the remaining UI merge slices in
the [widget audit](../../ui/widget_audit.md), including core and bundled mod
consumers. This ledger survives individual implementation turns. A tested
specimen establishes a primitive; it does not complete its entire category.

## Completion rules

For each family, inventory current consumers from the audit and current source,
identify the generic invariant, migrate those consumers through narrow app/domain
adapters, remove duplicated interaction implementations, and record verification.
Keep transport, gameplay rules, async transactions, persistence, formatting and
extension hooks outside the package. A remaining domain controller may legitimately
compose generic widgets; moving an entire screen into the package is not required.
Record intentionally distinct interactions with source-grounded reasons. Do not
label an uninvestigated family complete or silently drop it from the ledger.

The package remains independent ESM/SCSS with deterministic classic adapters,
app-free examples and explicit ownership/disposal. Preserve existing UI, keyboard,
focus, touch/scroll/drag behavior and original errors. No new numeric clamping,
runtime fallback implementations, framework or visual redesign. The coordinator
owns integration and commits. Coding agents do syntax/build checks; terra owns
tests in the required systemd scope. Tests use isolated fixtures, not the user's
game process; no server restart or save loading is authorized by this plan.

## Six-stage audit roadmap

| Stage | Status | Concrete scope and completion gate |
| --- | --- | --- |
| 1. Library boundary/specimens | Established; expand per family | `packages/ui-widgets`, `client/widget-adapters`, root build, own SCSS, app-free specimen. Each added primitive must import independently and retain explicit teardown. |
| 2. Foundations/isolated widgets | Partial | SearchableSelect/PopupDismissal complete for current consumers. Tokens, buttons, labelled fields, surfaces, tables/status remain tracked below; generic styling must not depend on app tokens or globals. |
| 3. Overlay lifecycles | Partial; ownership/context-menu checkpoint verified | PageFeedback/New Game/technique/attachment/charge/log native roots, general/Party tooltips, all three action choosers, prompt/terminal windows and shared dragging migrated. Custom visibility/backdrop ownership and four context-menu lifetimes migrated. Custom focus/trap/dismiss policy, remaining native/mod forms, toolbar/header popovers and lightbox remain explicit work. |
| 4. Repeated interactions | Partial | Config/Worlds/workflow tabs, memory/goal lists, paired needs/disposition controls, shared calendar and status/modifier domain editors migrated. Play/mobile tabs, other structured forms/repeaters, selectable/searchable lists, busy/status/error and follow-scroll remain. |
| 5. Collections/media | Remaining | Extract around existing `renderThingCollectionPanel`, toolbar/card/image/lightbox and source/slot/transfer composition. Migrate inventory/location/container/barter/crafting/modules and preserve per-item async ownership/mobile scrolling. |
| 6. Larger compositions | Remaining | Master-detail/pagination/readers, activity/diff/structured details, optional graph viewport and mod integration. Migrate Item Catalogue/Worlds/Stories/Story Tools/logs/maps without moving their domain state into widgets. |

## Twelve-category consumer ledger

Status is intentionally per concrete migration. References describe current source
families; historical audit line numbers may move. Add completion evidence rather
than replacing remaining consumer lists with a blanket category checkmark.

| Category | Completed evidence | Remaining source families and real consumers | Required gate |
| --- | --- | --- | --- |
| Visual foundations | Package selector/tooltip structure; app themes retained | `_globals.scss`, `main.scss`, `settings.scss`, `config.scss`, `page-feedback.scss`: buttons/icon buttons, fields/help/errors, surfaces, badges, tables/scroll regions, spacing/focus; `views/_includes/*` and mod form markup | Independent themeable rules plus actual consumers using them; app branding/domain colors stay adapters; compile outputs and inspect existing layouts. |
| Dialogs/floating windows | NativeDialog: PageFeedback/New Game/techniques/attachments/charges/log; ModelessChooser: ability/skill/technique pickers; FloatingWindow: prompt/failure/terminal; PointerDrag: windows/input/dock; ModalStack: core custom visibility/backdrop/locks | Custom-modal focus/trap/Escape policy still lives in owners; workflow preset/config/lorebook/Stories native/custom forms and media/lightbox lifecycle remain. Ownership migration does not finish their interaction contracts. | Migrate shared lifecycles across inventoried consumers; preserve modal/modeless/mandatory distinctions, pending guards, Escape/focus/stack ownership, cleanup and same-ID return focus. |
| Popups/tooltips | PopupDismissal: ActionImages; FloatingTooltip: general/Party; AnchoredPopup: Thing/NPC/location/map context menus | Filter/sort/view popovers; app-header Tools/menu; chat filter; map edge menu; domain tooltip trigger wrappers | Shared anchoring/dismissal ownership where semantics match; maintain capture action ordering, body portals, compact layouts, focus/touch policy and no detached active references. |
| Choices/search | SearchableSelect: image workflow and techniques | Index `showSearchSelectionModal`, blocking ability draft, stack keeper choices, saved-game chooser, NewGame settings radio library; world/vehicle target suggestions, module station/slot choices | Search/selection primitives with explicit immediate-action vs commit adapters; preserve values/filtering/availability and request cancellation; exercise actual call sites. |
| Navigation/layout | Existing shared header and mobile Play controller identified | Global Play tabs, Story Tools tabs, config/Worlds/calendar/workflow tabs, mobile Adventure navigation, desktop split-pane resize, app-header drawer, master-detail narrow Back | One shared behavior per equivalent state model, route/hash and activation hooks app-owned; keyboard/ARIA, resize, fixed-dock node ownership and responsive views verified. |
| Collections/cards | Existing `renderThingCollectionPanel` reused inside Play | Index card/list/grid/table core and toolbar; actor inventory/equipment, location items/scenery, containers, barter, crafting/modules, abilities/skills/techniques, quest/tracker/faction/favorites cards; Item Catalogue | Extract existing core rather than duplicate; card/action/content slots and collection state independent of schema; each owner migrates its real render path. |
| Forms/repeaters | OrderedTextList: memories/goals; NumberRange: needs/dispositions; shared CalendarEditor: Worlds/Play; Modifier/StatusEffect editors: NPC/location/item/PlayerStats | Metadata/attribute/skill/ability rows, weather, remaining technique requirement/cost/template/recipe forms, vehicle fields, faction assets/tiers/relations, allocator and mod forms | Merge equivalent row/control lifecycles, preserve optional/zero/false/conditional validation, unknown stored metadata and domain serializers; use real edited forms in coverage. |
| Feedback/async actions | PageFeedback native error content; prompt transport remains app-owned | Chat prompt dock/table/row/modal strips, standalone PageFeedback job dock, busy buttons, status/alert/empty/loading, warning/notification dialogs, terminal/prose follow-scroll, Scene Illustration notices | Presentation consumes snapshots/actions; no ownership/transaction serialization changes; preserve prompt IDs/retries, in-flight item concurrency, scroll selection and original errors. |
| Media | Existing imageManager/ActionImages/lightbox seams identified | Index entity image host/render overlays, avatars/badges/counts, upload/prompt dialogs, `lightbox.js`, lazy action images, mod illustration gallery | Shared frame/image/lightbox/slot lifecycle used by actual image/detail/action views; generation/upload URLs and jobs remain services; mobile gestures/late image events preserved. |
| Structured details | Existing TurnStateDiffDrawer and effect renderer reused | `turn-state-diff-drawer.js`, chat check/debug/plausibility/slop rows, effect cards/tables, quest rewards/objectives, catalogue definitions, terminal/log/history text readers, scene/mystery details | Generic disclosure/table/chip/text/diff presentation composed by domain renderers; preserve source metadata/navigation and history/live parity. |
| Graphs | VehicleOverlay helpers already shared | `map.js`, `world-map.js`, `relationship-graph.js`, Cytoscape lifecycle/layout registration/status/reload, hull plugin | Shared graph-host lifecycle/controls where equivalent; topology, routing, geometry/layout and hidden visibility remain adapters; actual map/relationship views exercise cleanup and actions. |
| Feature workflows/mod UI | Existing hooks and shared domain editors retained | Barter/container/crafting/module workbench, techniques/attachments, NewGame/Worlds/saves, Stories, Story Tools, Lorebooks/log/debug/Mods; mod asset/action/field/section/notification integrations | Compose extracted primitives throughout, retain strict transaction and extension contracts; resolve every audit family by migration or explicit distinct-behavior rationale with verification evidence. |

## Current parallel ownership and integration

- Overlay/modeless/window coding owns `views/index.njk`, `public/js/chat.js`,
  PromptWindows/ModelessChooser, relevant package modules and this master ledger.
- Repeated-control/standalone coding owns its assigned source/forms and proposes
  package modules without editing shared exports/build/specimen concurrently.
- Overlay coder integrates shared `src/index.js`, build entries, overlay adapter,
  package README/specimen and stylesheet entry changes supplied by other coders.
- Terra owns browser/test fixtures and verification notes. Coordinator owns root
  docs index, cross-family acceptance, integration and commits. Shared-file
  mutations are coordinated explicitly; do not overwrite another agent's changes.

## Next slice: modeless choices and floating windows

Extract a portable ModelessChooser with injected focus target, choice formatting,
accessible choice label and modal-dismissal policy. The application adapter keeps
bracket insertion, `#messageInput`, `chooser:closed` and chooser class/markup.
Migrate all three real ability/skill/technique pickers. Replace permanent instance
retention with document-owned active lifetime and explicit disposal.

Extract pointer dragging and FloatingWindow adoption from PromptWindows. Reuse
them for live/failure viewers, terminal viewer and player-input dragging. Keep
prompt failure envelopes/deduplication, safe content, header/tab safe anchoring,
viewer stacking policy and stream/poll/queue state in app adapters. Preserve the
existing drag viewport bounds rather than introducing new clamps. Use explicit
dispose on window removal and temporary pointer listener exit.

Custom modal stack/backdrop consolidation remains a required subsequent overlay
slice: index currently enumerates shared modal ownership in close functions and
`hideNpcBackdropIfNoSharedModalOpen`. Record individual modal migrations, including
mandatory recovery vs dismissible forms, rather than marking this stage complete
after modeless/window extraction.

## Verification and progress evidence

- [x] Phase one: independent SearchableSelect/PopupDismissal and current real
  consumers; [plan/evidence](2026-11-05-widget-library-extraction.md).
- [x] Phase two: NativeDialog PageFeedback/New Game and general/Party
  FloatingTooltip; [plan/evidence](2026-11-05-widget-library-overlays.md).
- [x] ModelessChooser: all three real pickers plus app-free lifetime specimen,
  modal-vs-modeless Escape precedence, insertion/focus and destroy/remount.
- [x] PointerDrag/FloatingWindow: prompt live/failure + terminal/player-input,
  independent drag/stack/focused Escape, cleanup, selection and app anchoring.
- [ ] Custom modal/anchored-popup family completion ledger and regressions.
- [ ] Repeated controls/forms/calendar/effects and standalone page migrations.
- [ ] Collection/card/media/transfer/assignment family migrations.
- [ ] Feedback/structured reader/master-detail/graph family migrations.
- [ ] Bundled mod consumers and extension-hook parity across migrated families.
- [ ] Final audit reconciliation: every inventoried family resolved, independent
  package/build/specimens work, required source/docs/SCSS outputs current, and
  scoped behavior/presentation evidence records remaining limitations honestly.

For each completed slice append affected consumers, focused verification result,
build/syntax evidence and any explicitly distinct retained behavior. Passing one
specimen or one consumer is never evidence that a remaining row is complete.

### Verified checkpoint: modeless windows and repeated controls

Portable ModelessChooser now backs the three ability/skill/technique pickers via
the app adapter. PointerDrag/FloatingWindow back prompt live/failure viewers,
terminal chrome and player-input/dock dragging. The app keeps anchoring, terminal
Escape/polling, prompt ownership and choice formatting. Destruction releases
listeners even when hooks throw; chooser close-event disposal is reentrant-safe.

Tabs backs System, Worlds editor/calendar and workflow modes. Repeater/createField
back Worlds calendar rows and workflow resolution fields. OrderedTextList replaces
both NPC memories/goals implementations; NumberRange backs needs/dispositions with
existing app-owned numeric policies. The wider calendar/status/form and navigation
families remain open. See [domain form follow-up](2026-11-05-domain-form-consolidation.md).

Verification: 29 distinct focused Chromium cases passed, covering portable
controls/window lifetimes, applied-profile/calendar initialization, real prompt,
terminal and player-input windows, discipline chooser, workflow choices, System
tabs, Play memories/goals/needs and responsive independent specimens. After the
reentrant chooser fix, affected portable/discipline cases were rerun and unaffected
passes retained. The three directly affected abilities/skills/prompt-dock unit
suites passed 27 cases after assertions were updated to authoritative package and
adapter sources. All test runs used the required 16GB/no-swap systemd scope and
isolated fixtures; artifacts are in `tmp/`. Syntax/template checks, both widget
and main SCSS builds and deterministic generated-asset checks passed. No live game
server or save was started, restarted or mutated.

## Next checkpoint proposal: custom modal ownership and remaining native forms

Planning only until the modeless/window/repeated-control checkpoint is verified.
The static/runtime register below resolves every modal family in the audit to a
shared lifecycle destination or an explicit distinct interaction. The status of
each pending row must be updated after real consumers migrate; a proposed mapping
is not completion evidence.

Proposed portable `ModalStack({document, lockTarget, lockClass})` owns registered
custom overlay order, per-backdrop reference state, Escape ownership and explicit
listener teardown. `register(root, {backdrop, onDismiss, canDismiss, initialFocus,
returnFocus, trapFocus, lockScroll})` returns `open`, `close`, `setPending` and
`destroy`. Existing feature close callbacks remain the source of transaction
cleanup; `onDismiss` requests those callbacks, while controller `close` only
performs shell state transitions, preventing recursive dismissal. App adapters
register explicit behavior (including cases that currently do not trap or return
focus); the library must not impose a blanket new focus/close policy.

Migrate open/close shell statements onto registered controllers and remove sibling
visibility lists and manual shared-backdrop/body-class bookkeeping. Do not paper
over unmigrated callers with broad DOM polling/observation or silent fallback
state. Native `<dialog>` roots use NativeDialog instead, and modeless roots never
join a modal scroll-lock/backdrop group. Async locks and mandatory decisions remain
callbacks/data supplied by owners.

| Register: current roots/owners | Destination and preserved difference | Status / real-consumer gate |
| --- | --- | --- |
| PageFeedback error/content; New Game snapshot Save/Load | NativeDialog; existing top-layer, pending, same-ID focus behavior | Done in phase two; retain existing regressions. |
| `playerAbilitiesModal`, `playerSkillsModal`, `playerTechniquesModal` | ModelessChooser; no backdrop/inert/page lock, insert without submit or closing | Current modeless slice; all three real pickers must pass. |
| Prompt live/failure windows and terminal viewer | FloatingWindow + PointerDrag; prompt focused Escape, terminal existing global Escape remains app policy | Current window slice; prompt ownership/stream/selection/anchor rules stay adapters. |
| `playerInputRequestPanel`, prompt progress dock | PointerDrag for modeless shells; server input queue/numeric/confirmation and dock lifecycle remain app-owned | Current drag slice; never treat these as blocking modals. |
| `setLastSeenModal`, `trackerEditModal`, `questEditModal`, `factionCreateModal` | Registered CustomModal controllers with existing field/pending/focus callbacks | Pending; edit/create/save/cancel and nested errors, no sibling visibility lists. |
| `playerPromptGuidanceModal`, `prefixHelpModal`, `actionSuggestionsModal`, `emptyActionConfirmModal`, `questDecisionReminderModal` | CustomModal; preserve guidance/suggestion focus trapping, request abortion, and next-turn quest gate | Pending; capture/restore existing per-owner policies and test real chat flows. |
| `mapFastTravelConfirmModal`, `locationRegionFixerModal` | CustomModal with async preview/repair owner; preserve ordered route/no-route/eligibility and exact location operation | Pending; route confirmation/blocked route/repair and focus tests. |
| `slashUploadModal`, `entityImageUploadModal`, `entityImagePromptModal` | CustomModal shell plus host file/prompt/action rules | Pending; no upload/prompt transport moves into package. |
| `npcInventoryModal`, `npcViewModal`, `npcEditModal`, `npcDispositionModal`, `npcNeedsModal`, `npcMemoriesModal`, `npcGoalsModal` | Registered shared-NPC-backdrop controllers; existing actor IDs, drafts, dirty state and point allocation remain features | Pending; opening nested editors, independent close/backdrop retention and actual field saves. |
| `thingEditModal`, `thingStackCombinerModal`, `thingContainerModal`, `containerOpenCheckModal` | Shared-NPC-backdrop controllers; combiner wizard and container session/check logic remain distinct compositions | Pending; retain keeper/stack metadata, session invalidation and per-item concurrent transfers. |
| `barterModal`, `barterStartConfirmModal`, `barterQuantityModal`, `barterCurrencyConfirmModal` | Stacked custom controllers; quantity/currency settlement callbacks retain staged transaction state | Pending; nested decisions, cancel, pending, data correction and backdrop ownership. |
| `craftingModal`, `moduleWorkbenchModal`, `salvageIntentModal` | Custom controllers for source/slot workflows; keep separate dedicated backdrops and per-operation ownership | Pending; touch scroll vs drag, concurrent distinct operations and implausibility feedback. |
| `addNpcModal`, `loadGameModal`, `loadModMismatchModal`, `newExitModal` | Custom controllers; save-load elevated nesting, compatibility choice and entity generation remain owners | Pending; pending/reopen/error/selection without state or backdrop leakage. |
| `playerAbilitySelectionModal` | Mandatory custom modal; unresolved server-authoritative choice blocks gameplay and cannot gain generic dismiss | Pending; required-selection/decline/pending/error path and tooltip parity. |
| `locationEditModal`, `regionEditModal`, `regionWeatherEditModal`, `calendarEditModal` | Custom controllers plus shared domain forms/repeaters | Pending; field validation and nested region/calendar/vehicle state remain project-owned. |
| Chat-created edit, cache-monitor warning, router-unload warning | Custom controllers with existing close/suppression/error detail behavior | Pending; browser preference and continuing-turn diagnostics stay app-owned. |
| Chat-created turn-event recovery | Mandatory custom controller; Escape consumed without dismissing, explicit enabled server choices and existing Tab trap | Pending; recovery submission/rollback/error tests, no generic Cancel introduced. |
| `showSearchSelectionModal` runtime entity chooser | CustomModal + searchable option list; click acts immediately rather than explicit radio commit | Pending; summon/teleport/put-in-inventory must share it without losing request/selection locks. |
| `imageLightbox` / `imageLightboxInner` | Distinct media/lightbox controller over shared overlay primitives; any-key dismissal exceptions, media/details/actions and touch sequencing preserved | Pending media slice; do not silently replace its current key behavior with ordinary Escape-only modal. |
| Technique editor/use/reset/catalogue dialogs; AbilityAttachmentsEditor | NativeDialog; host still owns disabled snapshots, optimistic revisions and success-driven native close | Migrated and verified in the ownership/native checkpoint below; shared native cancel/close/focus removed from feature code, real technique/attachment cases pass. |
| Item charge reload; Log Viewer `log-error` | NativeDialog; charge request generation/operation replay and source/amount state remain host | Migrated; charge pending/touch/rapid-reopen consumers pass, Log Viewer adopts the same native lifetime; retain original diagnostics and file-request ownership. |
| New Game world autofill, workflow preset, Config add model, Lorebooks upload/delete | Equivalent custom controllers or native adoption preserving existing markup; no forced UI redesign | Pending standalone slice; actual forms/confirmation and trigger focus verified. |
| Stories `story-dialog` native reused form/drawer/preparation/instructions shell | NativeDialog lifecycle with the story adapter retaining dialog-kind, pending/leave promises, draft preservation and generation ownership | Pending mod slice; new-story nested instructions and review/approval flows must pass. |
| Scene Illustration notifications/gallery and other mod-provided surfaces | Compose shared notification/media/modal primitives where equivalent; registered mod actions/assets remain integration adapters | Pending mod reconciliation; inventory all supplied mod surfaces before claiming category completion. |

### Anchored popup follow-up

Proposed `AnchoredPopup` adopts a root/trigger with injected placement, optional
portal target, focus policy and open/close callbacks. It owns active listeners,
outside/Escape dismissal, trigger expanded state and portal restoration. Position
functions initially copy existing per-presentation geometry (no new bounds or
clamping). Retain native PopupDismissal for native details; shared lower-level
dismissal may be composed without converting markup or keyboard semantics.

| Current consumer | Shared behavior / adapter responsibility | Gate |
| --- | --- | --- |
| Thing context menu (`thingMenuState`, `openThingContextMenu`) | Active popup, body portal and original parent/sibling restoration, resize/captured-scroll listeners; item actions/width/position remain adapter | Real item/scenery/inventory actions and detached-source cleanup. |
| NPC card context menus | Trigger/root dismissal and expanded state; NPC party/hidden/death/action rules remain adapter | Distinct cards/actions and no double handler after rerender. |
| Location image and map-location menus | Shared active lifecycle; anchored image vs point geometry and preserveContext/focus differences remain adapters | Native keyboard focus, map right-click/context action and no delayed focus stealing from opened dialog. |
| Filter/sort/view popovers | Shared toggling/exclusivity/Escape/outside; panel-width compact mode, ResizeObserver and toolbar selection state remain owner | Inventory/location/barter/container/craft/module toolbars across narrow/wide layouts. |
| Chat-bubble visibility popup | Shared dismissal/trigger state; registered types and cookie persistence remain chat-owned | Checked state/persistence and composer reachability. |
| App-header Tools/mobile navigation and map edge menu | Compose popup/disclosure primitive while retaining native details/header-responsive routing and edge mutation policies | Header navigation/viewport changes and map edge operations. |

## Verified ownership/native/context-menu and domain-editor checkpoint

Source is frozen for coordinator commit after 28 unique focused Chromium cases
and 18 unit cases passed. Tests were run by terra in the required constrained
scopes; coding agents did syntax/build checks only. Browser evidence includes
portable ModalStack, close-dispatch-safe NativeDialog waiters, a real NPC sibling
backdrop, charge/attachment/technique native consumers and rapid charge reopening,
AnchoredPopup portal/action/detach, real item/location/NPC/map target actions, and
shared calendar/status editor regressions. Failure-only reruns retained unaffected
passes. Artifacts are under `tmp/`, including `modal-stack-rerun-results`,
`native-close-wait-results`, `modal-sibling-results`,
`modal-native-consumers-results`, `charge-touch-results`, `charge-reopen-results`,
`anchored-popup-results`, `context-consumers-results`, and `map-menu-rerun-results`.

The real map test exposed `isLocationFavorite` being nested in a scope unavailable
to outer context-menu synchronization. The existing helper was moved to the common
scope; no duplicated predicate/fallback was added. Visible domain status labels
required wrapper geometry; their authoritative partial loads after legacy row
rules, with narrow/desktop verification on the compiled output.

Build evidence: `npm run widgets:build` and `npm run scss:build:main` pass; repeated
widget generation produces byte-identical assets. All changed runtime/build
modules, inline popup/location script regions and modified Nunjucks templates
parse. Current source adoption and verification do not complete the remaining
custom focus/trap/dismiss, other popup, media, reader or graph families.

## Queued source slice: existing collection renderer and media lifetime

Planning only. Close the remaining overlay-policy/anchored families below first,
then investigate/extract around the
actual `renderThingCollectionPanel`/`buildThingCollectionEntry` seam rather than
adding a parallel inventory implementation. Separate generic mounted collection
view/count/empty/list-grid-table mechanics from item sort/filter/search/equipment
rules and card/action formatting. Supply table columns and card renderers through
adapters. Migrate every current holder (location items/scenery, actor inventory,
container panes, barter offers, crafting/module inputs) in a consumer ledger;
preserve per-item in-flight/session ownership and mobile scroll-vs-drag policy.

For media, first extract the existing shared `lightbox.js` as an independently
adoptable root/elements controller and keep its application global registration,
error hook and entity data providers in an adapter. Preserve its actual non-Tab
key dismissal exceptions, rich details, async action sequencing, show-generation
guard and trigger focus. Then extract entity image frame/placeholder/render-state
presentation around `renderEntityImage`; imageManager remains the source of jobs,
URLs and generation. Avatar/badge/count and mod illustration consumers must use
those seams or receive an explicit distinct-composition rationale.

Required verification: app-free collection and media specimens, real item-holder
view/filter/card actions, container/barter/crafting/module paths affected by the
shared renderer, mobile lightbox actions, delayed image events and error/focus
behavior. Tests must exercise real adapters and preserve transaction/service
boundaries, not just render sample cards. Larger readers/diffs, feedback snapshots,
graph hosts and remaining mod surfaces remain on the full ledger after this slice.

## Immediate next checkpoint: finish the overlay family before collection breadth

After the current commit, prioritize the remaining common overlay policy while
the caller register is fresh. Extend explicit custom-modal ownership with
top-owner dismissal, existing pending/mandatory gates, existing Tab traps and
focus-return behavior. Register owner callbacks rather than infer gameplay state.
Move the duplicated key/focus mechanics into portable controllers and remove
their old per-modal routing. Mandatory ability/recovery cannot gain generic Cancel;
modeless/native/media surfaces retain their documented distinctions.

Complete remaining anchored toolbar filter/sort/view, chat visibility, header
Tools/responsive disclosure and map-edge lifetimes, using current geometry and
selection-vs-action policy. The existing entity menu migration supplies the common
lifetime; compact-width observers, cookies, routes and edge mutations remain app
adapters. Validate focus/escape ordering across popup, native dialog, custom modal
and chooser combinations, including stopped propagation and pending dismissal.

The standalone/domain owner can migrate workflow/config/Lorebooks custom forms
and the Stories reused native shell in parallel, coordinating shared service APIs
and avoiding simultaneous changes to core index/modal handlers. Keep individual
native/custom register rows accurate; source adoption does not claim unrun
consumer coverage. Once this register's equivalent lifecycles and explicit
distinct cases are reconciled, resume the collection/media plan above.
