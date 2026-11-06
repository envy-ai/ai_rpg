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
| 3. Overlay lifecycles | Partial; ownership/context-menu checkpoint verified | PageFeedback/New Game/technique/attachment/charge/log native roots, general/Party tooltips, all three action choosers, prompt/terminal windows and shared dragging migrated. Custom visibility/backdrop ownership and four context-menu lifetimes migrated. Custom top-owner policy, remaining standalone/Stories forms and toolbar/header/map-edge popup source are adopted in the current checkpoint; consumer verification is tracked below. Lightbox/ImageFrame now adopted in the current media slice; verification below does not complete unrelated overlay compositions. |
| 4. Repeated interactions | Partial | Named tab/navigation, drag, list, paired-field, calendar/status, choice, conditional-control, feedback and follow-scroll consumers migrated. Remaining structured readers, non-item cards and feature compositions retain their gates. |
| 5. Collections/media | Shared item/media consumers verified; wider cards remain | Existing item renderer, toolbar, image/lightbox and eight holder paths compose portable views, preserving per-item async ownership/mobile scrolling. Non-item cards and remaining gallery compositions are tracked below. |
| 6. Larger compositions | Partial | GraphHost adopted by Region/World/Relationships with verified lifecycle. Master-detail/pagination/readers, activity/diff/structured details and remaining feature/mod integration continue without moving domain state into widgets. |

## Twelve-category consumer ledger

Status is intentionally per concrete migration. References describe current source
families; historical audit line numbers may move. Add completion evidence rather
than replacing remaining consumer lists with a blanket category checkmark.

| Category | Completed evidence | Remaining source families and real consumers | Required gate |
| --- | --- | --- | --- |
| Visual foundations | Package selector/tooltip structure; app themes retained | `_globals.scss`, `main.scss`, `settings.scss`, `config.scss`, `page-feedback.scss`: buttons/icon buttons, fields/help/errors, surfaces, badges, tables/scroll regions, spacing/focus; `views/_includes/*` and mod form markup | Independent themeable rules plus actual consumers using them; app branding/domain colors stay adapters; compile outputs and inspect existing layouts. |
| Dialogs/floating windows | NativeDialog: PageFeedback/New Game/techniques/attachments/charges/log; ModelessChooser: ability/skill/technique pickers; FloatingWindow: prompt/failure/terminal; PointerDrag: windows/input/dock; ModalStack: core custom visibility/backdrop/locks | Custom policy mechanics now use ModalStack; feature transactions/focus targets remain injected. Current checkpoint verifies Play/Chat and standalone/Stories consumers; Lightbox/ImageFrame now adopt the distinct media lifecycle; current source and verification remain separately recorded below. | Migrate shared lifecycles across inventoried consumers; preserve modal/modeless/mandatory distinctions, pending guards, Escape/focus/stack ownership, cleanup and same-ID return focus. |
| Popups/tooltips | PopupDismissal: ActionImages; FloatingTooltip: general/Party; AnchoredPopup: Thing/NPC/location/map context menus | Current checkpoint adopts filter/sort/view, header Tools, chat filter and map edge/stub lifetimes; mobile header navigation retains its distinct media-query/scrim state and shares trapFocus. Domain tooltip trigger/content wrappers remain app adapters. | Shared anchoring/dismissal ownership where semantics match; maintain capture action ordering, body portals, compact layouts, focus/touch policy and no detached active references. |
| Choices/search | SearchableSelect image workflow/techniques; NativeSuggestions vehicle targets; named entity/ability/keeper/save choices; OtherEntry/dependent calendar controls; module candidates reuse shared async search selection with original cancellation contract | Item-charge reload and remaining original-audit choice dispositions stay tracked in Group8; fixed module/crafting indices retain domain validation | Search/selection primitives with explicit immediate-action vs commit adapters; preserve values/filtering/availability and request cancellation; exercise actual call sites. |
| Navigation/layout | Tabs in Play/Story Tools/Config/Worlds/calendar/workflow; explicit Scene Gallery registration; TabList mobile groups; PointerDrag separators; header/mobile owned lifetimes | ItemCatalogue Back, Worlds stacked radio-selected editor and Stories dirty-route navigation retain their precise native/domain contracts in the navigation plan; their reader/card work remains tracked separately | One shared behavior per equivalent state model, route/hash and activation hooks app-owned; keyboard/ARIA, resize, fixed-dock node ownership and responsive views verified. |
| Collections/cards | Existing views now own eight item holders, choices/readers, action/quest/tracker cards, Faction/Favorites/Catalogue/Worlds/Lorebooks/Stories/Story Tools lists and keyed Scene Gallery cards | Item-charge reload, debug cards/save lists and final original-audit dispositions remain in the Group8 preaudit; visual structural rules remain Group7 | Extract existing core rather than duplicate; card/action/content slots and collection state independent of schema; each owner migrates its real render path. |
| Forms/repeaters | OrderedTextList/NumberRange/Calendar/StatusEffect; ReaderRows technique/attachment and metadata/NPC rows; shared extension/faction/allocator fields; vehicle NativeSuggestions; current weather/typed Stories fields | Current RegionSecrets/Quest row ownership and remaining structured/conditional/mod forms are tracked in focused domain plans; native field/schema validation and unknown stored metadata remain domain adapters | Merge equivalent row/control lifecycles, preserve optional/zero/false/conditional validation, unknown stored metadata and domain serializers; use real edited forms in coverage. |
| Feedback/async actions | PageFeedback native errors; ActionGroup/SnapshotList prompt/owned-job views; ProgressMeter/Mirrors including image fills; FollowScroll Chat/terminal/viewers; BusyButton/StatusSurface current Chat and standalone consumers; NoticeHost Scene Illustration notices | Broader feedback/readers and remaining domain action compositions retain their ledger gates. IDs/scopes/connections/curves/retries stay app-owned | Presentation consumes snapshots/actions; no ownership/transaction serialization changes; preserve prompt IDs/retries, in-flight item concurrency, scroll selection and original errors. |
| Media | ImageFrame adopts entity image/placeholder lifetime; Lightbox adopts shared core/mod viewer with own structural SCSS | Verify migrated entity/action frames and Scene Illustration binding composition; badge/count/progress presentation and upload/prompt content remain distinct app/domain policies until their seams are reconciled | Shared frame/image/lightbox/slot lifecycle used by actual image/detail/action views; generation/upload URLs and jobs remain services; mobile gestures/late image events preserved. |
| Structured details | Native disclosure helpers in Chat checks, grouped Turn changes and Stories; ordered Stories comparisons/read-only projections; selectable terminal/prompt text; Log gutter/file ownership; one plausibility template authoring source | Effect cards/tables/chips, quest rewards/objectives, catalogue definitions, activity and remaining scene/mystery/detail compositions retain their feature/foundation gates | Generic disclosure/table/chip/text/diff presentation composed by domain renderers; preserve source metadata/navigation and history/live parity. |
| Graphs | GraphHost real Region/World/Relationships lifetimes verified, including duplicate-listener and hull ordering gates; VehicleOverlay helpers retained | Engine-specific topology/layout registration/geometry/hull content/routing intentionally remain app adapters under the approved boundary | Shared graph-host lifecycle/controls where equivalent; topology, routing, geometry/layout and hidden visibility remain adapters; actual map/relationship views exercise cleanup and actions. |
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
| `setLastSeenModal`, `trackerEditModal`, `questEditModal`, `factionCreateModal` | Registered CustomModal controllers with existing field/pending/focus callbacks | ModalStack adopted. Set-last-seen retains pending guard; faction retains Escape; tracker/quest retain their original no-Escape/no-trap policy. Quest external backdrop routes top-owner dismissal. Field transactions remain features. |
| `playerPromptGuidanceModal`, `prefixHelpModal`, `actionSuggestionsModal`, `emptyActionConfirmModal`, `questDecisionReminderModal` | CustomModal; preserve guidance/suggestion focus trapping, request abortion, and next-turn quest gate | ModalStack policy adopted; guidance/suggestions retain exact focus candidate lists, abort and pending guards. Guidance uses explicit shared focus capture/restore. Real Play/Chat focused verification recorded below. |
| `mapFastTravelConfirmModal`, `locationRegionFixerModal` | CustomModal with async preview/repair owner; preserve ordered route/no-route/eligibility and exact location operation | ModalStack transient policy adopted, request closures reset on settlement; route retains original Tab candidate policy, repair no trap; focus capture/restore is shared. Repair intentionally retains original Escape/backdrop cancellation while confirm buttons are disabled; no new pending lock. Preview/repair transport remains feature-owned. |
| `slashUploadModal`, `entityImageUploadModal`, `entityImagePromptModal` | CustomModal shell plus host file/prompt/action rules | ModalStack adopted; slash upload retains pending Escape/backdrop guard. Entity image forms retain root-backdrop close and original no-Escape/no-trap policy. Media transport remains outside package. |
| `npcInventoryModal`, `npcViewModal`, `npcEditModal`, `npcDispositionModal`, `npcNeedsModal`, `npcMemoriesModal`, `npcGoalsModal` | Registered shared-NPC-backdrop controllers; existing actor IDs, drafts, dirty state and point allocation remain features | Shared lifecycle and top-owner Escape/backdrop policy adopted; host IDs/drafts/save/point allocation remain adapters. Prior real nested sibling ownership plus current top-owner checks retained. |
| `thingEditModal`, `thingStackCombinerModal`, `thingContainerModal`, `containerOpenCheckModal` | Shared-NPC-backdrop controllers; combiner wizard and container session/check logic remain distinct compositions | Shared lifecycle adopted; Thing edit retains Escape, container original backdrop-only dismissal, combiner/check retain transaction-owned controls and no generic Escape/trap. Per-item/session verification remains collection workflow work. |
| `barterModal`, `barterStartConfirmModal`, `barterQuantityModal`, `barterCurrencyConfirmModal` | Stacked custom controllers; quantity/currency settlement callbacks retain staged transaction state | Shared visibility/backdrop/lock ownership adopted. These staged transaction shells have no original global Escape/trap route; retain explicit button/settlement decisions without adding generic dismissal. Transaction regressions remain collection workflow work. |
| `craftingModal`, `moduleWorkbenchModal`, `salvageIntentModal` | Custom controllers for source/slot workflows; keep separate dedicated backdrops and per-operation ownership | Shared lifecycle adopted. Craft/salvage retain Escape and dedicated backdrop callbacks; workbench retains backdrop-only/no-Escape policy. Drag/concurrent operations remain collection feature work. |
| `addNpcModal`, `loadGameModal`, `loadModMismatchModal`, `newExitModal` | Custom controllers; save-load elevated nesting, compatibility choice and entity generation remain owners | Shared lifecycle adopted; add/new-exit/mismatch use registered Escape callbacks, load retains original explicit controls. Elevated mismatch priority follows actual CSS; save compatibility/generation remains host-owned. |
| `playerAbilitySelectionModal` | Mandatory custom modal; unresolved server-authoritative choice blocks gameplay and cannot gain generic dismiss | Shared lifecycle adopted; Escape blocked without new trap/Cancel, named unresolved-choice lock retained. Real ability fixture and current arbitration checks cover shell behavior; canonical offer rules remain app-owned. |
| `locationEditModal`, `regionEditModal`, `regionWeatherEditModal`, `calendarEditModal` | Custom controllers plus shared domain forms/repeaters | Shared lifecycle and top-owner Escape adopted inside owning initLocationDisplay scope; no previous blanket close-all window handler. Existing field/calendar tests retained; feature validation remains domain-owned. |
| Chat-created edit, cache-monitor warning, router-unload warning | Custom controllers with existing close/suppression/error detail behavior | Shared lifecycle, top-owner Escape/external backdrop adopted; no new trap/scroll lock. Preference and diagnostic content remain feature-owned. |
| Chat-created turn-event recovery | Mandatory custom controller; Escape consumed without dismissing, explicit enabled server choices and existing Tab trap | Shared mandatory Escape block and original button/summary focus trap adopted; choices/pending/rollback remain host transactions. Real recovery checks included in current verification. |
| `showSearchSelectionModal` runtime entity chooser | CustomModal + searchable option list; click acts immediately rather than explicit radio commit | Pending; summon/teleport/put-in-inventory must share it without losing request/selection locks. |
| `imageLightbox` / `imageLightboxInner` | Distinct media/lightbox controller over shared overlay primitives; any-key dismissal exceptions, media/details/actions and touch sequencing preserved | Lightbox source adopted with injected actual visual priority, native/popup precedence and original any-key exceptions; focused real media/holder verification below. No new trap or lock. |
| Technique editor/use/reset/catalogue dialogs; AbilityAttachmentsEditor | NativeDialog; host still owns disabled snapshots, optimistic revisions and success-driven native close | Migrated and verified in the ownership/native checkpoint below; shared native cancel/close/focus removed from feature code, real technique/attachment cases pass. |
| Item charge reload; Log Viewer `log-error` | NativeDialog; charge request generation/operation replay and source/amount state remain host | Migrated; charge pending/touch/rapid-reopen consumers pass, Log Viewer adopts the same native lifetime; retain original diagnostics and file-request ownership. |
| New Game world autofill, workflow preset, Config add model, Lorebooks upload/delete | Equivalent custom controllers or native adoption preserving existing markup; no forced UI redesign | Adopted through ModalStack with original lock/no-lock, trap false, pending and focus differences. Four custom standalone cases pass; exact evidence in standalone-dialog-consolidation plan. |
| Stories `story-dialog` native reused form/drawer/preparation/instructions shell | NativeDialog lifecycle with the story adapter retaining dialog-kind, pending/leave promises, draft preservation and generation ownership | NativeDialog adopted with whenClosed plus replacement ticket. Exact suspended DOM/drafts/leave promises remain mod-owned. Eight real Stories cases pass; see standalone-dialog-consolidation plan. |
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

The finite policy-completion API extends ModalStack with `configure(root,
{onDismiss,canDismiss,escape,trapFocus,focusables,dismissOnBackdrop})`,
`requestDismiss`, `setPending`, `rememberFocus` and `restoreFocus`. Dismissal
callbacks receive `{root,reason}` and retain feature cleanup. Explicit false trap,
backdrop and focus policies preserve forms that never owned those behaviors.
Keyboard routing bubbles after popup/floating handlers, defers native top-layer
dialogs, and uses an injected app visual-top resolver at key boundaries only.
Mandatory ability/recovery block Escape; pending callbacks retain their current
transaction gates. Existing repeated Escape/Tab/focus mechanics are replaced by
these registered policies, not left as a competing global routing path.


## Current overlay completion source and verification

Play and Chat now configure portable policy instead of maintaining competing
per-modal global Escape/Tab routes. The app resolver follows actual z-index and
DOM tie order, including elevated load-mismatch and recovery surfaces. Popup
capture, focused floating handlers, actual native `:modal` ownership and custom
bubble routing preserve their ordering. Nonmodal `dialog.show()` does not suppress
custom keys. Default focus traps omit hidden ancestors, non-rendered controls and
disabled fieldsets; injected legacy lists preserve real consumer semantics.

Toolbar filter/sort/view and Chat visibility use AnchoredPopup. Compact filter
outside boundary remains its whole panel; sort/view keep their own roots. Their
click-only outside policy, action selection persistence, width observers and
original geometry remain adapters. Map edge/stub menus preserve their original
mousedown/contextmenu outside policy, no Escape action and async feature-owned
settlement while disposing temporary subscriptions on removal. Header Tools uses
native PopupDismissal. The mobile header remains responsive navigation because
its panel must remain visible on desktop; it shares trapFocus boundary mechanics
and yields to native/custom modal owners rather than adopting popup hidden state.

Shared asset ordering is explicit: portable overlay/details assets load before
immediate consumers; Play registers ModalStack synchronously after its markup;
standalone pages defer registration before their controller initialization.
Production-metadata rendered Play has exactly one script for each overlay,
PopupDismissal and ModalStack asset. Syntax checks cover rendered inline scripts
and changed browser/package modules; widgets:build compiles package/specimen SCSS.
Real Play three-case policy and Config header Tools checks passed after scope/load
ordering fixes. Portable ModalStack policy/native/hidden-control checks passed.
Full focused popup/owner combination and ReaderRows evidence is added at checkpoint
by the test owner. Standalone twelve unique cases (eight Stories, four custom)
are recorded in [the standalone consolidation plan](2026-11-05-standalone-dialog-consolidation.md#verification-evidence).

ReaderRows independently consolidates reader/disposer row lifecycle in techniques
and all three attachment row groups over Repeater. Schema validation/serialization
remains feature-owned. Package exports, classic controls registration and the
app-free reader-row specimen are integrated. Its consumer gate remains explicit;
this does not mark all repeated forms/structured readers complete. The full
collection/media/readers/feedback/navigation/graph/mod scope remains active above.


Current build checkpoint: `npm run widgets:build` succeeds and recompiles both
package and specimen SCSS, including the ReaderRows example. A second build
produces byte-identical output across all nine generated JS/CSS assets. Node syntax
checks pass for 27 package/browser/adapter/specimen modules. Rendered production
Play inline JavaScript parses with route metadata and contains one copy of each
shared overlay/details/ModalStack asset. Map edge/stub menus are explicitly
disposed at graph replacement and loading/error clear boundaries, before old
Cytoscape destruction, so body-mounted callbacks cannot retain old graph owners.


Focused real-popup checks now pass: toolbar selection/Escape (`tmp/toolbar-reader-results`)
and isolated actual Cytoscape edge menu (`tmp/map-reader-final-results`), including
its intentionally unchanged no-Escape behavior and disposal during map reload.
The real Play policy three-case rerun is retained in `tmp/play-policy-clean-results`.
These checks exercise source consumers, not replacement mock controllers.

### Verified policy, standalone and row-reader checkpoint

Final focused evidence covers **41 unique Chromium cases and 21 unique UI/source
unit cases**. Browser groups are eight Stories, four standalone flows (the Config
case also checks desktop Tools/mobile navigation), five portable modal/native
arbitration cases, seven actual Play modal/popup/action/input cases, eleven
ReaderRows/technique/attachment cases, and six popup/chooser/floating/prompt
combinations. Reruns strengthen or replace the same cases and are not counted
again. Exact commands and artifact directories are in [Playwright guidance](../../playwright.md),
the [standalone plan](2026-11-05-standalone-dialog-consolidation.md#verification-evidence)
and the [row-reader plan](2026-11-05-reader-row-consolidation.md#verification).

The seven directly affected UI/source suites passed 21 unique cases after their
barter backdrop assertion was updated to the authoritative shared ownership
adapter. Their command used the required 16 GB/no-swap systemd wrapper; unaffected
passes were retained and the affected suite rerun. Browser runs used the same
memory limits and isolated fixtures. No live game process or save was started,
restarted or mutated. Build, generated-asset consistency, syntax/template and
whitespace checks passed. Focused source review found no confirmed regressions.

Baseline review also confirmed that Location-region repair originally allowed
Escape/backdrop cancellation during its request, despite disabled buttons. Its
adapter preserves that policy without adding a transaction lock. Mandatory
recovery/ability and existing pending guards remain explicit policies of their
respective owners. ReaderRows cleanup handles owner destruction from a disposer,
empties the captured root during clear and preserves original cleanup errors.

This checkpoint completes the registered custom-policy and ordinary popup
adoptions described above. The media/lightbox lifecycle and remaining form,
collection, navigation, feedback, reader, graph and mod compositions still require
the migrations and verification gates in the full ledger.

## Current finite collection/media slice

Extract the existing shared Play presentation path, without creating a second
inventory renderer. `CollectionView` adopts a root, count and empty state; it owns
mounted-entry disposal, mode classes, injected table-column chrome and rendering
already-selected records. Item sorting/filter/AI search, counts wording, equipment
rules, caching and holder transactions remain in `renderThingCollectionPanel`.
`createCollectionEntry` consolidates native entry-root construction used by the
existing classic/grid/table branches; media/name/action content remains supplied
by those current app formatters. All eight real shared call sites migrate through
this seam: module workbench, NPC inventory, barter, both container panes, crafting,
location items and scenery. No changes to per-item request/session ownership,
scroll-versus-drag policy or transaction success/error decisions.

Extract existing `lightbox.js` into portable `Lightbox` adopting a supplied root
and explicit elements. Preserve non-Tab key dismissal exceptions, click panes,
close-before-run and close-on-success action sequencing, render generation guards,
trigger focus and pending-action control behavior. App adapter keeps global name,
image URL/data provider conventions and original error presentation. A portable
`ImageFrame` adopts an image host and owns image/placeholder replacement and its
load/error/binding lifetime; entity IDs, imageManager jobs, display overrides,
badges, progress snapshots and request/error policy stay app-owned. Existing
renderEntityImage and explicit placeholder reset use this seam, covering core
entity frames and the mod ActionImages path; Scene Illustration keeps composing
the shared lightbox through its existing adapter.

Preserved gotchas: table optional columns must stay aligned with existing rows;
classic-only slot/count/badge behavior cannot be homogenized; desktop/mobile
lightbox geometry and separate rich-details scrolling remain exact SCSS;
async action completion must not close a newer lightbox session; stale image
load/error events from replaced elements must not overwrite current content.
No new numerical bounds, transport, framework, silent fallback or UI redesign.

Build source/portable adapter assets before adding constructors to callers. Add
independent collection modes/empty/count/disposal and image/lightbox examples.
Focused tests must exercise real holders (including container/barter/crafting/
modules), mobile action/session/focus paths, delayed image events and mod gallery
composition. Subsequent navigation, feedback/readers/graphs, remaining forms and
mod families remain open in the full ledger.


### Current collection/media consumer register

| Source/consumer | Shared adoption and preserved adapter | Verification gate |
| --- | --- | --- |
| `renderThingCollectionPanel` / `buildThingCollectionEntry` | CollectionView mode/count/empty/table/mounted lifetime and native entry-root builder; existing filter/sort/AI/cache/formatter logic remains | Portable modes/table/disposal plus real view/filter/entry behavior; no parallel inventory renderer |
| Module workbench inventory, NPC inventory | Existing callbacks now pass through the same shared view; slots/equipment/per-item requests stay features | Real equipped/table/grid presentation and module source/slot actions |
| Barter player + merchant inventory | Shared view in existing side renderer; staged offer/currency/quantity state remains app-owned | Offer/context/mobile action and existing concurrent transaction behavior |
| Container player + contents panes | Both current call sites use shared view, returning the same visible-item arrays | Session invalidation, separate pending item transfers and mobile action checks |
| Crafting inventory | Shared view with current source/slot callbacks and explicit empty-grid policy | Item add/remove and distinct concurrent craft/harvest behavior unchanged |
| Location items + scenery | Shared view and entry-root construction with original count/empty/rarity/badge contexts | View/filter/count plus item/scenery context and action behavior |
| `renderEntityImage`, explicit placeholder reset | ImageFrame owns native replacement/error/binding disposal; imageManager URLs/overrides/jobs/badges/progress stay adapter | Delayed detached errors, reentrant cleanup and actual entity refresh |
| `lightbox.js`, entity/item rich viewers | Portable Lightbox; app adapter keeps global name, persistent original-error feedback and actual visual-owner comparison | Custom below/above, native above, popup capture, mobile actions/focus and slow old action versus newer session |
| ActionImages | Existing shared renderEntityImage path now composes ImageFrame; generation/terminal outcomes remain ActionImages/imageManager | Existing lazy menu/regeneration regression retained, no duplicate image path |
| Scene Illustration gallery/message images | Existing `lightboxController.bind` now delegates to portable weak binding lifetime; no gallery/job/controller redesign | Existing mod bind composition with portable disposal and source gallery checks; no historical thumbnail DOM retention |

Custom/media key arbitration is injected, not inferred from visibility alone:
ModalStack and Lightbox compare the actual app visual resolver, preserving higher
custom owners. Native `:modal` and captured popup keys retain priority. Header
navigation yields when lower than media. Lightbox keeps ignored Tab/interactive
Enter-Space behavior. Original action errors now reach the required persistent
PageFeedback stack UI through the adapter. Async completion cannot hide a newer
viewer, and binding cleanup pointers detach before reentrant callbacks.

Source assets were built before consumer constructors. Shared controls are now
explicitly synchronous on Play before inline initialization; other pages retain
deferred constructor registration. Lightbox SCSS moved verbatim into a portable
mixin included at its original app position, preserving desktop/mobile cascade.
Package and app SCSS compile. Focused tests and exact evidence are appended after
the current runs; this source adoption leaves remaining navigation, readers,
feedback, graph, form/card and bundled-mod categories open.

## Injected graph-host lifecycle plan and source adoption

Originally recorded before the collection/media/forms checkpoint; implementation
was released after commit d44cba0. The shared invariant is an owned graph engine
in an adopted DOM host, not a shared topology/layout algorithm. Current source
adoption and verification are recorded below.

Source authority: Region `map.js` has `ensureCytoscape` replacement (around157),
body edge/stub popup ownership and DOM pointermove/contextmenu listeners installed
inside `renderMap` (around1148/1500). Those container listeners currently outlive an
individual engine replacement. World `world-map.js` explicitly destroys hulls then
its engine (`destroyWorldCyInstance`, around15), initializes styles at35 and creates
new convex hull resources after layout at842. Relationships
`relationship-graph.js` has independent destroy/engine initialization (around300/
326), status/empty/error replacement at453, and deferred final-layout work at580
that catches stale destroyed-engine errors instead of owning its timer lifetime.
Current docs/ui/maps.md and relationships.md describe the authoritative topology,
route/favorite/stub/vehicle and hidden-character rules that stay in adapters.

Proposed portable `GraphHost(root,{createEngine,destroyEngine,statusClasses})`
requires an injected engine factory; importing it needs no Cytoscape/browser
engine global or service. `mount()` releases the prior active generation before
creating the next engine. Active `own(dispose)` resources release before engine
destruction (hulls, popup ownership, engine-derived DOM listeners). `listen` owns
DOM listeners through the active generation's AbortSignal. `defer(callback,delay)`
owns scheduled post-layout work and rejects stale generation execution without
catching unrelated real errors. `status(text,{kind})` releases active graph state
before showing the supplied app loading/empty/error content/classes. `clear()` and
idempotent `destroy()` release resources/timers/engine and DOM references, retaining
original disposal errors and causes. Exact names can be refined at implementation;
no automatic engine loading, layout fallback or full-document observer is added.

Migrate all three real graph controllers. Region retains all topology, linking,
ghost geometry, menu mutations, faction overlay and focus/travel logic; active DOM
pointer/context listeners and edge popup enter the engine generation's explicit
teardown. World retains region colors/labels, ancestry, vehicle followers, hull
construction and force-layout options, registering only their resource lifetime
with GraphHost. Relationships retains hidden/missing actors, portraits, directed
curves/manual endpoints/labels and renderer-specific layout choices; its scheduled
finalizer becomes owned generation work. Plugin registration stays the explicit
application engine factory. World/relationship transport request IDs and reload
control state remain owners; no new Region transport/sort/routing policy is
introduced during lifecycle extraction.

Verification requires an app-free injected-engine specimen (replacement, status,
resource/listener/timer/disposal ordering and original errors) plus real Cytoscape
Region/World/Relationships fixtures. Reload repeatedly, prove old DOM context/link
handlers and body map menus are gone, ensure hull resources stop before old engine,
ignore stale finalizers, and retain actual node/edge/hidden/missing actor/focus/
route semantics. Source syntax/build and generated asset reproducibility remain
required. Wider feedback/readers/navigation/choice/card/form/mod families remain
active after this finite graph slice; graph extraction does not close them.

### Collection/media build and focused evidence

`widgets:build`, `scss:build:main` and `scss:build:settings` succeed. A second full
build reproduces all thirteen generated JS/CSS/map assets byte-for-byte. Node
syntax checks pass across thirty-six package/specimen/adapter/media/header
modules. Production-metadata rendered Play inline JavaScript parses, and shared
controls/overlay/details/ModalStack scripts each occur exactly once. The combined
form partial loads after legacy main rules; Worlds module narrow rows load after
their desktop settings rules. Both delivered CSS outputs are compiled.

Focused passed checks so far cover portable CollectionView modes/disposal,
ImageFrame stale/reentrant cleanup, real custom/native/lightbox Escape ordering,
old async action versus newer viewer, popup priority and concurrent container
transfers with late closed-session responses. Actual crafting/module-workbench
holder rendering and the real Scene Illustration script's message-image
replacement/shared-lightbox composition pass in `tmp/holder-scene-results`.
Final unique totals and retained consumer/visual/unit evidence are recorded by the
coordinator at checkpoint; no unrun broader family is marked complete here.

The focused phone geometry check exposed intrinsic native control widths inside
new form-label wrappers and the ability row's five desktop columns at narrow
width. The form partial now fits text/select/textarea controls to their fields
(with checkbox/radio widths unchanged) and stacks the ability row at the existing
640px breakpoint. Main CSS is compiled; all thirteen generated outputs reproduce
identically after this fix. Desktop columns and existing field validation remain.

Final source is frozen for checkpoint review. Latest rendered Play inline syntax
and the same thirty-six module syntax checks pass after the domain form updates.
Responsive form checks at 1280px and 390px pass on the final compiled CSS, along
with real faction rows and allocator checks. The coordinator appends the final
aggregate browser/unit count after affected module/source suites finish. The
injected graph-host proposal above remains planning only until that checkpoint.

Checkpoint review found a concrete persisted-navigation lifetime issue: unconditional
pagehide teardown destroyed live CollectionView/Lightbox/toolbar owners while the
browser retained their document and caches. Those document-owned UI hooks and the
independent specimen now skip `event.persisted`, with core cleanup subscriptions
removed only after actual disposal, so a cached hide cannot consume a once-only
listener. Stories NativeDialog/timer/named-lock and dock observers preserve the
same retained document boundary. No fallback remount is needed. Existing
PageFeedback socket, local-LLM polling shutdown and Story runner leave policies
are transport/job ownership and remain unchanged. Global PopupDismissal has no
pagehide teardown to correct. Source syntax/template checks and widgets:build pass;
focused actual PageTransitionEvent verification checks cached hide followed by
continued use and later real disposal, without broad unrelated reruns. The test
owner records its result at checkpoint.

### Verified collection, media and form-field checkpoint

Final evidence covers **22 unique Chromium cases and 34 unique Node UI/source
cases**, using the required 16 GB/no-swap scopes and isolated browser transport.
The browser set includes independent collection/image lifecycle cases, actual
collection/lightbox/Scene Illustration consumers, concurrent container transfers
with late-response isolation, Thing/NPC typed saves and row remounts, responsive
form geometry, factions, Worlds modules, allocator flows, module error/legacy-ID
boundaries and persisted-pagehide behavior in Play and Stories. The explicit
PageTransitionEvent checks prove the UI handlers' cached-hide/continued-use/final
disposal contract; they do not claim a full browser cache/transport integration run.

All 34 affected source cases passed after five obsolete lightbox source-location
assertions were updated to the authoritative package/SCSS modules. Unaffected
passes were retained and affected cases rerun. Exact commands/artifacts are in
[Playwright guidance](../../playwright.md) and the
[form-field plan](2026-11-05-form-field-consolidation.md). The final module syntax,
rendered-template, main/settings/package/specimen SCSS, thirteen generated-output
consistency and whitespace checks pass. New document links resolve. No live game
server was restarted and no save was loaded or mutated.

Focused review found no additional verified form metadata or table-parity
regressions after the persisted-navigation issue was fixed. Malformed Worlds
module configuration now preserves the raw field and underlying error, sends no
invalid save, and never substitutes defaults. Unavailable saved Thing module IDs
survive unrelated edits. Numeric/nullable/modifier and per-item transaction rules
remain host-owned.

Graph lifecycle and vehicle suggestions/tokens are the next source slices.
Remaining non-item cards, broader navigation, feedback, structured readers,
foundations and mod compositions retain their full ledger gates; this checkpoint
does not complete those families.


### GraphHost current source register

Portable GraphHost is exported and available in the existing synchronous overlay
adapter before actual graph constructors. It owns native active-generation
AbortController listeners, timers, guarded callbacks, reverse-order resource
cleanup, injected engine creation/destruction and status DOM. A factory failure
cleans partial content and preserves original error/cleanup causes. No external
graph library, app global, polling, transport or layout fallback is introduced.

| Actual consumer | Source adoption | Retained app boundary / verification gate |
| --- | --- | --- |
| Region Map `map.js` | Existing getCytoscape factory mounts through GraphHost; current alias nulled before creation; DOM pointer/context listeners, layouts, menu and link reset are generation resources; loading/error clears old ownership | Nodes/exits/stubs/factions/vehicle/link geometry/routes/focus unchanged; actual reload, context/link handler duplication, old layout and body-menu cleanup checks |
| World Map `world-map.js` | Existing engine/plugin factory adopted; status/replacement shared; layout stop/hull cleanup happen before engine destroy; guarded callback checks captured signal before new hull assignment | Region ancestry/colors/labels/hull algorithms and layout options/request IDs unchanged; actual reload/hull teardown and stale-resource checks |
| Relationships `relationship-graph.js` | Shared create/destroy/status; captured-engine layout/drag callbacks; owned deferred finalizer replaces swallowed stale timer failure | Hidden/missing actors, portraits, curves/endpoints/label geometry/layout/request IDs unchanged; real empty/error/reload/visible-edge tests |
| Portable specimen `examples/graph-host.js` | Supplied DOM engine demonstrates mount/replace, owned resource/click/defer and status/clear/destroy, with no app/API dependency | Factory failure, stale callbacks, resource/engine ordering and original error propagation |

All graph pagehide adapters skip persisted cached documents and unsubscribe only
on actual unload. The current shared controls adapter also exports the domain
owner's NativeSuggestions, whose independent specimen is mounted; vehicle query,
row identity/serialization and named-target transport remain domain-owned.
Vehicle suggestion roots now explicitly honor `[hidden]` in the original SCSS
rule, correcting the pre-existing display:flex override without new popup policy.
Build/syntax and focused real consumer evidence are recorded after current tests.
Remaining feedback/readers/non-item cards/navigation/foundations/choices and other
bundled-mod compositions remain on the full ledger; this source slice does not
complete those categories.

### GraphHost focused verification and build checkpoint

Portable lifecycle/factory/error cleanup cases pass (2) and actual Region edge
popup replacement passes (1) in `tmp/graph-first-results`. Actual World and
Relationships engines retain topology, hidden/missing actor behavior and old-engine
disposal in `tmp/graph-real-results` (1 combined real-consumer case). The independent
package/specimen suite passes all seven cases in `tmp/widget-specimen-graph-results`.
The affected relationship source suite passes five cases. The test owner retains
these results and records any final focused Region handler/reload follow-up.

`npm run widgets:build`, `scss:build:main` and `scss:build:settings` pass. A repeated
build produces byte-identical output across thirteen generated JS/CSS/map assets.
Node syntax checks pass for forty-one graph/package/specimen/adapter modules;
production-metadata rendered Play inline JavaScript parses and each shared
constructor/service asset occurs once. NativeSuggestions exports/classic controls
registration and its independent specimen are integrated; vehicle serializer,
query and actual owner evidence remains in the domain owner's focused plan.
Runtime source is frozen for checkpoint review, with no graph topology/backend or
transport policy changes. Remaining UI families stay open in the master ledger.

Final graph lifetime follow-ups pass: after two Region reloads, a single real DOM
contextmenu produces exactly one edge-menu append in
`tmp/graph-region-listener-results`; old World hull canvas is detached before its
old Cytoscape engine is destroyed in `tmp/graph-hull-order-results`. These replace
the same unique Region and World/Relationships cases, rather than inflating counts.

Narrow instruction-required diagnostic integration now routes original loader
failures through PageFeedback while retaining inline status. All three touched
JSON readers preserve parse exceptions; unsuccessful payloads throw into common
catch. Region/World loading transitions are inside catch coverage, so graph factory
and teardown failures surface too. World/Relationships request-generation guards
and Relationship reload finally remain. Rare error-status cleanup failure retains
both stacks and original cause while still attempting persistent diagnostics.
Endpoints, options, jobs and transport ownership are unchanged. Syntax checks pass;
focused actual failed JSON/factory/recovery verification is assigned to the test
owner, retaining prior valid graph/domain evidence.

### Verified graph and vehicle checkpoint

Final evidence covers **18 unique Chromium cases and 14 source cases**: two
portable graph lifecycle/error cases, two actual Region/World/Relationships
cases, six vehicle cases, seven independent-specimen regressions and one actual
three-loader error/recovery case. The latter verifies each original JSON parse
message/stack in native PageFeedback and inline status, successful deliberate
reload and restored Relationships reload controls (`tmp/graph-error-retry-3-results`).
Region duplicate-listener and World hull-order follow-ups strengthen the same
consumer cases; they are not counted again. The source set contains five
Relationships and nine vehicle serializer cases. All tests used the required
16 GB/no-swap systemd scopes and isolated browser transport. Commands and artifact
directories are in [Playwright guidance](../../playwright.md) and the
[vehicle plan](2026-11-05-vehicle-choice-consolidation.md).

Build/syntax/generated-output checks above passed; the coordinator's final
`widgets:build` also left all generated widget/package/specimen outputs identical.
Focused source review found no additional confirmed regression. Region's lack of
a transport request-order guard is preexisting; this lifecycle extraction retains
that policy while preserving the existing World/Relationships guards. No game
server restart, save loading or backend modification was used.

The graph host and vehicle suggestion/token migrations are complete for the
listed current consumers. Weather forms, remaining scalar/structured mod
presentation, non-item cards, navigation, feedback, readers and foundations retain
their original ledger requirements and remain active.

## Current finite feedback and follow-scroll slice

Inventory: Chat owns dock mode/persistence/longest-row selection, throttling,
completion holds, estimated progress math, prompt snapshots and action transport;
its view methods around `createPromptProgressActions`, `create/updateProgressBar`,
keyed table reconciliation and modal strips duplicate generic DOM lifecycle.
Standalone PageFeedback.render rebuilds owned-job/entry rows and view/cancel/retry
controls independently, while its named scope filtering and single connection
are already authoritative. Terminal and streamed-response viewers repeat queued
bottom scrolling with follow/selection guards. Chat log additionally tracks user
upward scroll, history readiness and observed row/viewport resize. Those policies
must remain explicit rather than applying one blanket scrolling rule.

Implement focused portable primitives: `ActionGroup` owns keyed native controls,
latest descriptors, disabled/active/pending presentation and disposal, with all
async transactions in injected host callbacks. `SnapshotList` owns keyed create/
update/remove row lifecycle, used by Chat's current table and standalone owned-job
rows. `ProgressMeter`/`ProgressMirrors` adopt existing fill/state-class presentation
for table/collapsed/one-line/modal bars; hosts supply already-computed fractions
and preserve their existing numeric policy. `FollowScroll` owns queued frame,
optional native resize/mutation observation, user-intent and selection boundary
mechanics, with host canScroll/follow predicates preserving Chat history and
terminal/viewer distinctions. Package modules have no prompt/job/socket/API IDs
or transport. Existing CSS and markup classes remain adapters; portable specimens
exercise snapshots/actions/disposal and scrolling without app globals.

Migrate actual Play progress table/one-line actions, all bar variants and open-modal
mirrors plus PageFeedback owned-job dock controls/rows. Keep dock mode chrome,
formatting, favicon, completion pulse/throttle and scope union logic app-owned.
Migrate Chat log, terminal output and each prompt viewer to the same scrolling
lifetime, preserving selection, explicit Follow/force behavior, deferred hidden
views and history-loading gates. Explicit teardown preserves persisted pagehide
and releases callbacks/observers on real disposal. Assets build before constructor
references, and focused real consumers must cover prompt/action pending, scopes,
terminal/viewer selection, chat late images and no extra connection owner.

Scene Illustration's notification fallback, recurring non-prompt busy/status and
broader structured feedback/readers remain explicit follow-on families after this
coherent shared progress/scroll checkpoint; no category is marked complete by one
specimen. Its current notice source and injected-style/timer lifecycle are
inventoried for the next shared notice host. No new transport, polling, clamping,
framework, redesign or fallback loader is introduced.


### Feedback/scroll actual consumer register and current evidence

| Actual owner | Shared presentation/lifetime | Preserved host policy |
| --- | --- | --- |
| Chat table rows and one-line controls | SnapshotList keyed table reconciliation, ActionGroup retained native buttons, existing one-line identity retained | Current entry/label/model formatting, active viewers, cancel/retry pending groups and action transport/client IDs |
| PageFeedback owned-job dock | SnapshotList job/prompt namespaces plus ActionGroup; exact label-plus-buttons DOM, current scope union/filter unchanged | Complete snapshot/trackJob scopes, status precedence, one standalone connection and per-action independent pending requests |
| Prompt table/collapsed/one-line meters | ProgressMeter with host-computed fraction and completion/waiting state | Existing unknown-to-zero normalization, aggregate bounds, estimated curves, TinyBrain gaps, throttle/completion pulse/mode persistence/favicon |
| Open custom modal strips | ProgressMirrors over explicit targets from the existing visibility observer | Same open-dialog predicate/aggregate; no new global observer or modal locking policy |
| Entity image-generation progress | ProgressMeter adopts existing overlay/fill | imageManager jobs, entity targets/IDs, seasonal state and original progress math/ARIA remain adapter-owned |
| Chat history log | FollowScroll tracks existing upward-scroll intent and native size/content observations | Existing two-pixel bottom rule, history-ready/load-count gate, explicit force/immediate behavior and hidden-view deferral |
| Terminal output and each prompt viewer | FollowScroll owns queued frames and shared native selection detection, destroyed per window | Independent Follow checkboxes, pointer/range selection guards, force behavior and original poll/stream ownership |

All new widgets remain snapshot/action/DOM presentation with no API/prompt/job
transport. Action controls are minimally reconciled so unchanged nodes retain
focus/hover/pending state. Disposal preserves cached pagehide and releases owned
frames/observers/listeners on real UI teardown. The terminal Follow checkbox now
uses its actual terminal controller, correcting the prior mismatched helper.
SnapshotList row-disposal callbacks may destroy their owner; captured cleanup runs
once and the obsolete removal pass preserves original errors rather than reading
nulled state. Package ProgressMeter requires finite supplied values, preserves
explicit zero and adds no numeric clamp; prior invalid/unknown policy is explicit
in app adapters.

Focused passed evidence includes `tmp/feedback-first-results` (five cases),
`tmp/feedback-owned-actions-results` (one), `tmp/follow-intent-results` (one), and
`tmp/snapshot-reentrant-results` (one), plus twenty-two directly affected source
cases reported by the test owner. Real image-fill and final independent specimen
checks are recorded after their current runs; no unrun consumer is claimed done.
Weather/typed Stories field evidence is separate (five browser/three source cases)
and Quest/Secrets ownership remains in its focused current domain plan.

Build evidence: widgets/main/settings SCSS builds pass, thirteen generated
JS/CSS/map assets regenerate byte-identically, forty-six package/specimen/adapter/
feedback modules parse, and current production-metadata Play inline JavaScript
parses with one copy of each shared constructor/service asset.

### Required follow-on feedback surfaces

After this coherent progress/scroll checkpoint, finish the inventoried recurring
BusyButton/StatusSurface/NoticeHost families before calling feedback complete.
Chat `setSendButtonLoading` stores/restores pending chrome independently; guidance,
slash-upload/player-input and index status helpers repeat text/hidden/state/ARIA
changes, including the nonmodal chatSpinnerStatusBar which must preserve stationary
tooltip hover. Extract adopted native button/status presentation with explicit
host busy booleans, prior disabled/content state and original concurrent ownership;
do not move request IDs or add a global pending lock.

Scene Illustration `showNotification` currently checks an absent optional toast
host then creates styled nodes with two removal timers. Replace that fallback with
one explicit shared notice host and owned timer/animation/disposal lifetime,
preserving existing success/info appearance/duration; errors with original detail
must use persistent shared diagnostics. Reconcile actual mod generation/delete/
queue notice callers, not only a sample notification. Notice/Busy/Status specimens
and real consumer/error/persisted-navigation checks are required. Larger structured
readers/diffs, non-item cards/navigation/foundations and other mod compositions
remain active in the twelve-category ledger after those surfaces.

Final specimen/follow checks pass in `tmp/specimen-follow-final-results`: the
serialized-field HTML preview now wraps within the specimen at desktop width,
and FollowScroll retains streaming, new-direct-row resize coverage and disposal.
The prior six package cases are retained. Text/nested mutation records now request
following without rebuilding direct-row observation sets; only direct root child
list changes resynchronize those targets. This preserves event-driven intent/
timing and introduces no polling or diagnostic/history scan loop.

Against the final Quest WeakSet/field/feedback sources and styles, widgets/main/
settings builds pass, thirteen generated assets reproduce byte-identically,
forty-six relevant modules pass syntax checks, and production-metadata Play inline
JavaScript parses with each constructor/service asset loaded once. Runtime source
is frozen for checkpoint; the coordinator records final aggregate counts. The
Notice/Busy/Status follow-on above remains planning only until that checkpoint.

### Verified feedback, weather and quest/region checkpoint

Final evidence covers **27 unique Chromium cases and 48 unique Node UI/source
cases**. Browser groups include nine feedback/image cases, five weather/Stories
field cases, five Quest/Region cases, seven independent-specimen cases and the
additional observed streaming/new-row follow-scroll case. Source groups cover
feedback, image progress, weather, quest and region adapters. Strengthened reruns
retain unaffected passes and do not inflate these counts. Exact constrained
commands, groups and artifacts are recorded in [Playwright guidance](../../playwright.md),
the [weather/field plan](2026-11-05-weather-typed-field-consolidation.md) and the
[quest/region plan](2026-11-05-quest-region-row-consolidation.md).

Verified behavior includes stable action/row identity and focus, independent
pending cancellation, original cleanup errors under reentrant disposal, explicit
zero progress, modal mirrors, real image progress/completion, socket ownership,
manual follow/selection, field HTML roundtrips and retained Stories drafts.
Quest current selections survive a pending directory, live clear and late
delivery; one shared lookup error reports once without losing saved references.
Applied-route locks, objective identities/flags/zero values and desktop/phone
row geometry also pass. No gameplay/save/transport policies were moved into the
package. Tests used isolated transport and the required 16 GB/no-swap scopes;
no live server restart or save loading was used.

Focused source review found no additional confirmed regression. Build, syntax,
generated-output consistency and new documentation-link checks pass. The listed
progress/scroll and form consumers are migrated; the required Notice/Busy/Status
follow-on and the remaining choices, navigation, structured readers, non-item
cards, foundations and mod integration retain their full ledger gates.

## Current finite BusyButton / StatusSurface / NoticeHost slice

Inventory: Chat `setSendButtonLoading` replaces button chrome and unconditionally
reenables on exit, while ability-selection independently sets eligibility; guidance,
slash upload and player-input repeat text/hidden/state status changes. The index
nonmodal spinner strip repeats visibility/class/ARIA updates and must never hide a
stationary tooltip. Config repeats success/error messages and expiry timers in its
manager and test-result helper; Lorebooks duplicates that with a different duration;
workflow presets and New Game settings add text/color/state variants. Scene
Illustration's success/info/error notices currently use an optional-toast fallback,
injected styling and two unowned removal timers, dropping caught Error details.

Implement three adopted native presentation primitives, without transaction policy:
BusyButton keeps explicit latest idle eligibility and optional owned busy content.
Leaving busy requires current host disabled state; it never restores an old disabled
snapshot. Latest content can be supplied explicitly; externally replaced content is
preserved rather than overwritten by stale captured chrome. Integrate Chat send,
Config save/validation, and ActionGroup's existing per-action pending presentation
(which supplies current descriptor disabled state). Ability-selection eligibility
updates compose with the same button owner, preserving pending chrome/locks.

StatusSurface owns text/visibility/state-class or attribute/color presentation plus
an optional owned expiry timer. Each update cancels obsolete expiry so an earlier
success cannot hide a newer error. App wrappers retain their original normalization,
state names, color/classes and hide/display differences. Migrate Chat's three status
families, the index spinner strip, Config/test results, Lorebooks, workflow presets
and the New Game status-only wrappers, coordinating bounded file ownership.

NoticeHost owns supplied notice-root entries and explicit TTL/exit timers, with
independent CSS reproducing current Scene Illustration position/colors/duration.
PageFeedback exposes the app notice host; Scene Illustration always delegates to
it, removing the optional-toast fallback. Success/info preserve current transient
behavior; caught/broadcast errors pass original Error/backtrace through persistent
PageFeedback. Queue counters, jobs, requests, connections and gallery behavior stay
in their existing controllers. No new global pending lock, automatic promise wrapper,
clamping, polling, framework or fallback loader is introduced.

Build primitive assets before callers. Independent specimens and real send/ability
eligibility, pending actions, stale-status expiry, stationary spinner hover, Config/
New Game/Lorebooks and actual Scene Illustration notice/error cases must verify the
migration. Cached pagehide preserves live owners; real disposal cancels owned timers.
Readers/diffs, navigation/layout, non-item cards, foundations and remaining mod/form
compositions remain on the full ledger after this finite group.

### Verified choices and busy/status/notice checkpoint

The five choice surfaces in [ChoiceSurfaces](../../classes/ChoiceSurfaces.md)
now compose CollectionView and owned subscriptions. BusyButton, StatusSurface and
NoticeHost have independent specimens and actual Chat, Config, Lorebooks,
workflow, New Game and Scene Illustration adapters. Feature selection, request,
queue, save and gameplay state stays outside the package.

**18 distinct Chromium cases and 13 Node UI/source cases pass.** Browser evidence
comprises eight choices, two New Game cached/final-unload cases, seven surface/
specimen/Scene/Config/Lorebooks cases and one retained ActionGroup regression.
Node evidence covers nine ability/skill and four spinner cases. Exact constrained
commands and artifacts are recorded in [Playwright guidance](../../playwright.md)
and the [choice plan](2026-11-05-choice-surface-consolidation.md). Reruns do not
inflate these counts.

Review found and resolved late New Game Save/Load completions writing destroyed
owners. Explicit workflow epochs now guard submission, preparation and final UI
updates; persisted pagehide keeps the current workflow live. The allocator-await
pre-open path is source-reviewed, rather than independently delayed by the fixture.
Config/Lorebooks unchanged source lines retain their original line endings.

Widgets, main and settings SCSS builds pass; thirteen generated JS/CSS/map outputs
rebuild byte-identically. Fifty-five relevant modules pass syntax checks, and the
production-metadata Play inline script parses with each shared constructor asset
loaded once. Changed documentation links and whitespace checks pass.

This checkpoint resolves the named consumers, not the full audit. The planned
[conditional native controls](2026-11-05-conditional-native-controls.md), navigation,
structured readers, non-item cards, visual foundations and remaining mod/feature
compositions retain their full master-ledger requirements.

## Next navigation/layout source plan (reviewed)

The [navigation/layout plan](2026-11-05-navigation-layout-consolidation.md) maps
Play and Story Tools retained tabs, Scene Gallery's late-injected duplicate tab
owner, three mobile Adventure selection groups, the live dock, two split-pane
handles and shared header ownership. Proposed reuse is existing Tabs/PointerDrag
plus a focused button-only TabList. No navigation runtime changes have been made.

ItemCatalogue's narrow Back/retained selection, Worlds' stacked radio-selected
editor and Stories' asynchronous dirty-route navigation have explicit distinct
native contracts in that plan; they are not forcibly converted into retained-panel
tabs or counted as completed reader/card migrations. Actual consumer and lifecycle
gates remain open until implementation and delegated verification are recorded.
Conditional native controls proceed independently using the current controls
adapter and package exports.

## Verified conditional native controls

OtherEntry now owns New Game class/race custom-entry visibility and subscriptions,
using explicit latest editable-form eligibility. Hidden custom values survive
switches; reviewed fields stay locked during loading and after a failed Start,
while Start retains its separate retry state. Config composes native field-state
and reveal helpers without clearing hidden credentials or changing provider rules.
New Game and Worlds rebuild dependent native options through CollectionView,
preserving New Game/default-date invalid placeholders and Worlds' stale-reference
options and validators. Dynamic calendar rows dispose through their existing row
signals; passive static option views have weak document ownership.

Final-unload guards protect pending New Game reviewed initialization and Start
responses from updating disposed conditional controls. Cached hides retain the
current owners. No request cancellation, domain payload, calendar validation or
gameplay transaction was moved into the portable helpers.

**Nine unique Chromium cases and eighteen Node calendar/UI cases pass.** Browser
coverage comprises the direct helper contract, two specimen/layout cases, three
New Game/Config cases, two final-pagehide cases and the Worlds calendar case.
Focused source review found no additional concrete regression. Widgets/main/
settings builds pass; thirteen generated outputs reproduce byte-identically,
fifteen relevant modules pass syntax checks, four templates render, five inline
scripts parse and Play constructor assets load once. Browser evidence and exact
artifacts are recorded in the [conditional-control plan](2026-11-05-conditional-native-controls.md)
and [Playwright guidance](../../playwright.md). The navigation plan above is the
next runtime slice; readers, cards, foundations and remaining mod/feature
compositions remain required under the full ledger.

### Verified navigation and layout lifetimes

Play global tabs, all four Story Tools panels and Scene Gallery share Tabs with
explicit late registration and per-activation hooks. The three mobile Adventure
button groups share TabList, preserving dataset/native-details behavior and the
same live prompt dock node. Mobile/header observer, RAF and event lifetimes now
have cached-hide-preserving final cleanup. Both actual Adventure separator handles
compose PointerDrag's injected movement/capture seam, retaining existing app width,
storage and keyboard policies. The independent navigation specimen covers these
portable capabilities; actual-consumer test evidence is recorded below.

ItemCatalogue, Worlds and Stories keep the distinct native navigation contracts
recorded in the focused plan; this does not resolve their remaining reader/card
or feature composition gates. Navigation runtime changes are confined to the
approved surfaces and contain no new route, request, numeric clamp or poll policy.

**Twelve distinct Chromium cases and nine affected source/UI tests pass.** Browser
groups cover portable tabs, real mobile/Gallery/Story Tools and separator behavior,
capture-acquisition failure cleanup, retained Config/header/window compatibility,
the independent specimen and viewport layout. The strengthened Config/header case
counts once. Exact commands and artifacts are in [Playwright guidance](../../playwright.md).
Tests use isolated fixtures and the required 16 GB/no-swap scopes; no live server
restart or save loading occurred.

Source review found no additional concrete regression. A capture-acquisition error
now releases partial drag ownership and preserves the original exception. Thirteen
generated assets reproduce byte-identically after widgets/main/settings builds;
fifty-five relevant modules and the production-metadata Play inline script parse,
with shared constructor assets each loaded once. Documentation links and whitespace
checks pass. The current separator contract preserves labels and orientation;
numeric ARIA value synchronization is not claimed.

The [remaining-family routing plan](2026-11-05-remaining-reader-collection-foundations.md)
orders the required structured readers/template duplication, selectable text/log
gutter, non-item collections, indexed module/craft slots, foundations and mod-parity
work. These remain active requirements, not completed by the navigation checkpoint.

## Verified structured and selectable readers

Chat's four check readers, grouped Turn need/disposition details and Stories'
remembered disclosures compose native disclosure chrome. Stories comparisons and
recursive projections consume ordered host-formatted values while retaining
source/buffer/proposal actions, missing/empty/zero/false/null policy and escaping.
Native details owns keyboard/open behavior; Turn normalization, counts, severity,
entity IDs and its distinct outer toggle remain app-owned. Vendor JSON inspectors
retain their existing native integration.

Terminal/prompt/failed-response viewers share the extracted incremental text
updater, preserving native text-node/Range behavior and existing follow policies.
Log Viewer composes TextGutter and CollectionView with disposed guards, original
abort/filter/selection rules, literal text, newline counts and scroll synchronization.
Cached hide retains live owners; final hide releases callbacks and ignores late
results. `views/popups/plausibility.njk` is the single authoring source; the browser
path receives its exact bytes during the existing build, with both runtime paths
and loader contracts retained.

**Eleven distinct Chromium cases and thirty-seven Node cases pass.** Browser
coverage includes independent helpers/specimens, real Chat live/history/insight and
skill/attack/slop disclosures, Turn grouping/keyboard, Stories conflict/comparison/
projection/draft flows, prompt/terminal selection and the isolated Log journey.
Node coverage comprises thirty-three Turn and four terminal cases. Strengthened
reruns count once; exact commands/artifacts are in [Playwright guidance](../../playwright.md)
and the [structured](2026-11-05-structured-reader-consolidation.md) and
[selectable-text/Log](2026-11-05-selectable-text-log-reader.md) plans.

Focused baseline/current source review found no concrete regression. Widgets/main/
settings builds pass; fourteen generated JS/CSS/map/template outputs rebuild
byte-identically, sixty-two modules pass syntax checks, Play/Log render, Play inline
JavaScript parses and shared constructor assets load once. The generated browser
plausibility asset equals its canonical source. Documentation links and whitespace
checks pass. No live server restart or save loading occurred.

Groups 3–8 of the remaining-family plan still require action/non-item collections,
quest/trackers, faction/Favorites/Catalogue/Stories activity, module/crafting indexed
slots, portable visual foundations and final mod/metadata parity plus full audit
reconciliation. These remain the active goal after this checkpoint.

## Verified action, quest and tracker collections

Ability/skill choosers and TechniqueSidebar discipline/card roots compose the
existing CollectionView and entry helpers. Native markup, insertion, ranks,
sorting, costs, source availability and catalogue revisions remain app-owned.
ActionImages releases menu subscriptions, popup/image-frame bindings and observed
hosts through its existing observers while retaining page-owned metadata/promises
and submitted generation/editor work. Card replacement leaves those operations
live; final document disposal suppresses obsolete UI.

Quest and tracker views retain their rebuild policy, sorting/count/empty state,
first-active-open/completed-closed details and exact action IDs/payloads. Requests
continue across card replacement. Tracker whole-card CSS progress remains distinct
from a contained progress bar; existing parsing/bounds are unchanged. FloatingTooltip
now accepts explicit ownership so old-trigger cleanup cannot hide a newer tooltip,
and interactive hover transfer retains its owner. ModelessChooser captures its
default focus-return condition before entry cleanup removes the focused control.

**Eleven distinct Chromium cases and nineteen affected Node cases pass.** Coverage
includes all three action choosers, zero ranks, stale card/menu controls, focus,
quest completion/retry/abandon/edit IDs and server stacks, tracker visibility/value,
tooltip ownership and cached/final async boundaries. In-flight image prompt work
survives ordinary rebuild/cache while final unload prevents a late editor. Exact
commands/artifacts are in [Playwright guidance](../../playwright.md) and the
[action](2026-11-05-action-collection-consolidation.md) and
[quest/tracker](2026-11-05-quest-tracker-display-collections.md) plans.

Focused review identified and resolved the remaining quest-edit alert and late
image-editor modal continuation. Original parser/Error/server diagnostics now
propagate through persistent feedback in these touched paths. Widgets/main/settings
builds pass; fourteen generated outputs reproduce byte-identically, sixty-four
modules pass syntax and current production Play renders/parses with shared assets
loaded once. The latest index-only parser change was re-rendered and checked.
Changed test scripts, documentation links and whitespace checks pass. No live
server restart or save loading occurred.

Remaining groups 5–8 retain the original audit scope: list/detail/activity families,
module/crafting indexed slots and choices, portable visual foundations, mod/metadata
parity and final requirement-by-requirement reconciliation. Worlds, Lorebooks and
Story Tools lists must be investigated alongside the named Group 5 consumers;
their distinct route/selection policies do not by themselves resolve repeated
content ownership.

## Verified library, activity, indexed-slot and Gallery collections

Faction/Favorites, Catalogue, Worlds profiles, Lorebooks, Stories library/activity
and Story Tools page/history/scene/thread/box/mention/type content now compose
existing collection owners. Host selection, filtering, paging, recorded values,
travel eligibility, mutations, jobs/proposals and approval authority remain local.
Catalogue retains its 60-row pages/mobile Back; Story Tools retains 250-entry pages;
Lorebooks retains its first-50 preview. Parsed template nodes are explicitly adopted
into the live document. Stories' independent final cleanup survives collection
disposal errors without skipping timers/dialog/lock cleanup.

Module candidates reuse the shared search chooser, retaining zero/single/multiple
behavior, exact IDs/sources and original cancellation errors. The chooser closes
before request preparation resumes. Craft/workbench slots keep fixed indices and
native markup, with entry/preview/action/image ownership and originating-session
guards. Committed responses still update global state and report original errors;
retired sessions cannot overwrite newer slots/status/busy state. Scene Gallery
uses keyed cards for single-delete identity/focus and explicit full-fetch rebuilding.
A committed delete during a pending load invalidates that old snapshot and starts
one fresh read, preventing resurrection without tombstones or polling.

**Nineteen distinct Chromium cases and twenty-nine affected Node cases pass.**
Coverage includes library/filter/sort/selection/paging/Back, stale controls, native
document ownership, thread/box stale responses, Gallery focus and DELETE/GET ordering,
all three module candidate branches and fixed-slot/async session boundaries. The
Story Tools history case exercises 251 entries and filter/page reset. Crafting
touch/lightbox action callbacks are exercised directly; physical gestures/open
lightbox dispatch were not repeated in those supplemental cases. Existing holder
UI evidence is retained. Exact commands, artifact groups and this limit are in
[Playwright guidance](../../playwright.md) and the
[list/detail/activity](2026-11-05-list-detail-activity-consolidation.md) and
[module/crafting](2026-11-05-module-crafting-slot-consolidation.md) plans.

The focused source review found the Gallery overlap gap; its fix passed the exact
delayed ordering case. Widgets/main/settings builds pass; fourteen outputs reproduce
byte-identically and the canonical/browser template matches. Sixty-seven modules
pass syntax checks; Play/Worlds render and both inline scripts parse with shared
assets present once. Changed test scripts and documentation links pass. Unchanged
Lorebooks line endings are preserved; changed-line/blank whitespace is clean, with
normalized content/syntax checked after hygiene. No live server restart/save loading.

Remaining work is the reviewed portable visual-foundation plan and the original-audit
parity matrix. The preaudit has already identified item-charge reload collections,
Debug lists/status, StoryAuthoringRunner presentation/registrations, submit-shortcut
ownership and explicit Chat/native/vendor dispositions that still need concrete
resolution and evidence. The full goal remains active.

## Verified foundations, reload sources and submission shortcuts

Portable declaration-only Sass mixins now compose native field/button/surface/
badge/table styles at existing app selectors and cascade positions. Opt-in package
classes expose local theme variables without app imports or unclassed-control
resets. All five app/mod stylesheet outputs preserve selectors and values; only
independent declaration order changes. Representative default/focus computed
metrics match exactly at desktop and phone widths.

Reload sources use CollectionView and entry-owned listeners with StatusSurface.
Native pending/replay rules remain host-owned. Captured owners preserve committed
callbacks and global refresh across ordinary close/reopen while protecting a newer
dialog; final unload retires UI and suppresses late callbacks. SubmitShortcut owns
one native document listener, requestSubmit/validation and explicit actions; app
class aliases/top-owner/error policy stay in a thin generated adapter at the same
public URL. Cached pagehide preserves both owners.

**Fifteen distinct Chromium cases and three Node source checks pass:** six actual
foundation page cases, one independent style/theme specimen, two direct/adapter
shortcut cases and six reload lifetime/retry cases. Actual Runner behavior remains
L03; compiled style parity and representative measurements do not prove its actor
integration. Focused production review found no defect; its obsolete fake-DOM test
require finding was addressed with actual browser coverage and passing source checks.
All 21 generated JS/CSS/map/template outputs reproduce byte-identically, 72 modules
pass syntax, and Play/Worlds/Config render with parsed inline scripts and correctly
ordered single assets. Changed test scripts pass syntax. Exact scope/artifacts are
in [Playwright](../../playwright.md), [foundations](2026-11-05-portable-visual-foundations.md)
and [reload/shortcut](2026-11-05-reload-submit-shortcut-consolidation.md).

L01/L04 are resolved. L02/L03/L05–L09 remain active in the
[full disposition matrix](2026-11-05-full-widget-disposition.md): Debug, Runner,
Mod Manager/local controls, resource fills, native/domain evidence and actual
registered mod parity precede final original-audit reconciliation. No live server
restart or save load occurred.

## Verified Story Authoring Runner UI

The actual Play Runner composes native disclosure/field builders, ActionGroup and
StatusSurface. Goal/notes IDs, Start/Pause/Resume eligibility, reviewed checkpoint
and literal latest/completion content retain their domain rules. Owned listeners,
input/ability unregister functions and the ability-modal observer release on final
departure; persisted hides retain UI and preserve the original leave policy that
stops transport. No automatic reconnection is introduced. Pending final responses
cannot repaint destroyed widgets; a submitted late Start is paused without creating
a heartbeat or actor loop.

**Six unique Chromium cases pass:** five actual-controller cases with mocked host/
protocol services and one rendered Play/Chat hook case. Checkpoint/manual draft,
input/ability/Undo, keyboard/observer, cached/final lifetime and delayed start/state/
settings/packet are covered. This is UI/protocol evidence, not backend actor-loop
or LLM evidence. Both changed test scripts and Runner source pass syntax; focused
review found no introduced defect. Artifacts/limits are in [Playwright](../../playwright.md)
and [StoryAuthoringRunner](../../../mods/story-authoring/docs/StoryAuthoringRunner.md).

L03 is resolved. Debug/Mod Manager/local service presentation, resource fills,
native/domain and actual mod parity, and final original-audit reconciliation remain
L02/L05–L09. No server restart or save load occurred.
