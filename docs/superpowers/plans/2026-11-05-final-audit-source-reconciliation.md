# Final audit source reconciliation addendum

Source-only reconciliation, 2026-11-05. Compared every detailed row and static/
runtime overlay group in the original [audit](../../ui/widget_audit.md) with
[C01–C48/M01–M18](2026-11-05-full-widget-disposition.md), the master consumer/root
registers and current source. This addendum supplies source coverage; the final [matrix](2026-11-05-full-widget-disposition.md)
and master checkpoint supply the separately accepted behavioral/build proof. No tests,
server operations or runtime changes were made for this reconciliation.

## Requirement coverage

Each original detailed inventory row belongs to the following explicit matrix
IDs; existing focused plans retain the exact consumers and accepted evidence.

| Original source families | Matrix coverage and current disposition |
| --- | --- |
| Shared ESM/SCSS/native foundations, SearchableSelect/PopupDismissal, buttons/fields/focus/badges/tables | C01, C08–C09, C30, C39. Actual shared primitives and opted-in foundation declarations; L09 final package/build proof remains separate. |
| Header/Tools/local service LED, Play/Story Tools/Worlds/System/workflow/mobile tabs, separators, master/detail libraries | C02–C04, C26, C45, C47–C48; M01–M02. Shared equivalent Tabs/TabList/PointerDrag/popup lifetimes. Catalogue Back/rarity rerender, Worlds radio-selected stack and Stories dirty URL/outline navigation retain their documented distinct native/domain state. Local LED presentation and cache/final ownership are verified E14. |
| Custom/native/modeless/floating dialogs, input/recovery, prompt/failure/terminal viewers, immediate entity chooser, warnings/errors | C05, C09–C12; M05–M06. Explicit root destinations below. No undisposed parallel overlay implementation was identified in the named register. Transactions, pending policies and mandatory choices remain distinct. |
| Context/details/filter/view popups and all entity/check/Party tooltips | C06–C07, C17, C27, C42–C44. Shared PopupDismissal/AnchoredPopup/FloatingTooltip, owner-token disposal and injected formatters. Readonly effect/check content is formatting, not a second tooltip lifecycle. E15 supplies final rich-reader/native boundary proof. |
| Portrait/media/count/slot/mod badges; player/location/Party health/need/readouts | C14–C16, C27–C29, C34, C46. ImageFrame/Lightbox/ProgressMeter at actual hosts; tracker pseudo-gradient and native charge progress intentionally distinct. ImageManager jobs/URLs and actor rounding/conditions remain domain. Debug lists/media source now adopted; E14 supplies actual Debug proof; E16 supplies actual registered metadata parity. |
| Item collections/toolbars, inventory/equipment/container/barter, craft/salvage/module, keeper wizard, desktop/touch transfer | C17–C23. Existing single item renderer composes shared views/media; fixed indices, equipment structures, breadcrumbs, transfer protocols and source/backlink validation remain feature-owned. Accepted E9 includes concurrency/session gates and records the direct touch-callback limit honestly. |
| Ability/skill/technique choices, quest/tracker cards, faction/favorites/catalogue collections | C24–C26. CollectionView/native disclosure/actions and existing app-domain renderers; quest offer/reminder decision IDs remain host policy. L05 covers Chat's remaining action/native-reader gate; no new transcript renderer is needed. |
| General fields/YAML/Other/dependent calendar/tonal preview; attributes/skills/formulas/metadata/bonus/module fields; effects/attachments/grants | C30–C33, C39. Field/conditional helpers, ReaderRows and shared domain editors adopted. Formula-variable table/insertion and YAML dirty/save target remain native/domain composition. |
| Charges/reload, memories/goals, dispositions/needs, faction/calendar/weather, vehicles/route targets, entity/stub/cleanup/repair forms | C34–C38. Named real helpers/shared rows and explicit shells; L01 reload proof accepted, L07 contained meters accepted. Persisted IDs/schema validation/application policy remain hosts. |
| Saved form/settings/radio/search, Play load/mismatch/alias, Lorebooks, Debug saves | C09, C29, C40, C48. Existing shared views/dialogs; native alias/delete confirmation is an explicit domain decision, not an unimplemented blanket dialog replacement. Debug/Mods source and behavior are verified E14. |
| Transcript/bubble/actions/edit/composer/prefix/empty/suggestions/slash/guidance; progress/jobs/status/follow/selection; structured checks/Turn/Story Tools | C10–C13, C25, C41–C45. Existing keyed transcript factories remain authoritative; primitives share actual feedback/readers/disclosures. E15 verifies message-action retirement/composer/native readers and source disposition. |
| Maps/World/Relationships, faction/vehicle overlays, RouteTravel and Log | C46–C47. GraphHost lifecycle/owned engine overlays and native route form/list, CollectionView/TextGutter/read-only textarea. Topology/routing/log offsets/abort/filter rules remain hosts; E15 route and E16 marker proof are accepted; these retain their precise native/domain boundaries. |
| Stories library/tree/navigation/badges/fields/dialogs/conflicts/activity | M01–M07, M11. Shared collections/native fields/disclosure/comparison/dialogs; domain revision/URL/approval meanings retained. Runner is independently M12/E12, not inferred from editor evidence. |
| Stories source projections/nested setup/receipts/evidence/written passages/reconciliation/approvals/handoff | M08–M10, M06. Shared presentation with explicit whole-form domain redraw rationale in the L08 plan; E16 nested/focus/receipt and retained approval/handoff evidence are accepted. |
| Scene action/render/WebSocket/gallery/delete/notice; Modules adapter; metadata-driven Modules/Implants/Spells/NSFW/defaultNotes/need bars | M13–M18, C14/C21/C28/C39. Actual shared hook consumers and registry snapshots mapped by the L08 plan. No new mod-only widget or service ownership is required. Real registration parity is accepted E16. |

All 48 core and 18 mod IDs are accounted for above. None of the original detailed
rows requires an additional unlisted generic controller based on this source
reconciliation. This is source coverage, not acceptance of every transaction.

## Every original static overlay root

`client/widget-adapters/modal-stack.js` contains explicit registration lists;
feature `configure` callbacks preserve per-root dismissal/focus/pending semantics.
The master register records those policies separately from transaction proof.

| Exact original roots | Current source owner/destination |
| --- | --- |
| `chatBubbleFilterPopover` | Chat AnchoredPopup adapter; cookie/type filtering remains Chat-owned. |
| `setLastSeenModal`, `trackerEditModal`, `questEditModal`, `factionCreateModal` | ModalStack plus actual time/tracker/quest/faction callbacks; explicit no-Escape/no-trap and pending differences retained. |
| `playerPromptGuidanceModal`, `prefixHelpModal`, `actionSuggestionsModal`, `emptyActionConfirmModal`, `questDecisionReminderModal` | Registered ModalStack roots configured by Chat, including existing focus lists and transaction/quest gate. |
| `mapFastTravelConfirmModal`, `locationRegionFixerModal` | Registered transient policies and native route/repair contents; original cancellation/pending distinctions remain callbacks. |
| `slashUploadModal`, `entityImageUploadModal`, `entityImagePromptModal` | ModalStack shell/policy; file and prompt transport remains app-owned. |
| `playerInputRequestPanel` | Modeless PointerDrag/request queue adapter, deliberately not a blocking modal. |
| `npcInventoryModal`, `npcViewModal`, `npcDispositionModal`, `npcNeedsModal`, `npcMemoriesModal`, `npcGoalsModal`, `npcEditModal` | Shared NPC backdrop registration + top-owner policies and domain row/field adapters. |
| `thingStackCombinerModal`, `thingContainerModal`, `containerOpenCheckModal`, `thingEditModal` | Shared backdrop/lock ownership; keeper, per-item transfer/open-check and edit transaction callbacks remain distinct. |
| `barterModal`, `barterStartConfirmModal`, `barterQuantityModal`, `barterCurrencyConfirmModal` | Explicit stacked ModalStack roots; native fields/staged settlement remain feature code. |
| `playerAbilitiesModal`, `playerSkillsModal`, `playerTechniquesModal` | All three actual ModelessChooser owners, independent choice action/image controls and owned CollectionViews. |
| `craftingModal`, `moduleWorkbenchModal`, `salvageIntentModal` | ModalStack + dedicated backdrop callbacks; actual slot/session/view/action owners retain concurrency. |
| `addNpcModal`, `newExitModal`, `loadGameModal`, `loadModMismatchModal`, `playerAbilitySelectionModal` | ModalStack; generation, explicit load/elevated mismatch and mandatory ability choice keep distinct policies. |
| `locationEditModal`, `regionEditModal`, `regionWeatherEditModal`, `calendarEditModal` | ModalStack configured inside owning location scope; shared domain form editors retain validation and submission. |
| `itemChargeReloadDialog` | NativeDialog plus current CollectionView/StatusSurface and replay/session controller. |
| `imageLightbox`, `imageLightboxInner` | Portable Lightbox and host priority/error/action adapter; inner surface is not a second dialog. |
| `actionSuggestionsBackdrop`, `npcModalBackdrop`, `questEditBackdrop`, `craftingModalBackdrop`, `moduleWorkbenchModalBackdrop`, `salvageIntentBackdrop` | Explicit ModalStack backdrop membership; they are shared chrome, not separate lifetimes/dialogs. |
| `autofillInstructionsModal`, `addModelModal`, `imageWorkflowPresetModal`, `uploadModal`, `deleteModal` | Registered standalone ModalStack roots, original lock/no-lock/trap/pending distinctions; native fields/files remain owned by their page. |
| `saveNewGameSettingsDialog`, `loadNewGameSettingsDialog`, `log-error`, `story-dialog` | NativeDialog owners in NewGame/Log/Stories, including reused-root/queued-close/draft/final-cache boundaries. |

## Every original runtime surface group

- PageFeedback's `document.createElement('dialog')` is adopted by NativeDialog in
  `page-feedback.js:dialog`; persistent errors retain stack and native top layer.
- PromptWindows live/failure shells use FloatingWindow/PointerDrag in the explicit
  classic adapter; Chat keeps snapshots, retry context and failure deduplication.
- Chat edit/cache-monitor/router-unload/recovery roots explicitly register/configure
  ModalStack. Recovery keeps its mandatory choice/Tab policy; warnings remain
  non-trapping. Message-edit semantics are L05, not a second shell implementation.
- Chat terminal output uses the existing PromptWindows/FloatingWindow shell and
  shared selectable-text/follow behavior. Persistent `showChatErrorPopup` delegates
  to PageFeedback rather than maintaining another error dialog.
- `showSearchSelectionModal` explicitly registers/configures/unregisters its runtime
  root and owns a CollectionView/options listener lifetime. Immediate selection,
  pending lock, latest options and module cancellation contract stay in its adapter.
- Technique editor/use/reset/catalogue and attachment native roots share their
  respective NativeDialog creation helpers; ReaderRows owns actual nested editable
  groups and ActionImages releases card bindings. Native readonly catalogue content
  does not need a separate generic dialog implementation.
- FloatingTooltip, AnchoredPopup and PopupDismissal own the actual tooltip/context/
  native-details nodes; map edge popup is explicitly disposed before engine reload.
- Scene notifications delegate to PageFeedback.notify/NoticeHost. Gallery and
  message images use shared Lightbox bindings with explicit per-entry cleanup.

## Package boundary source check

Current `src/index.js` exports only package-local modules. Every source import is
relative to the package; no source/style/specimen reference to AIRPG globals,
`/api`, WebSocket, local/session storage, app directories or external assets was
found in this pass. DOM globals/default `globalThis.document` and owning-document
constructors are intentional browser facilities, not game globals. Native selectors
and `data-*` ownership markers are generic; app ID/class aliases, service calls,
Cytoscape factory, assets/labels/themes and PageFeedback remain in adapters.

`package.json` exposes ESM, independent SCSS, compiled CSS and the side-effect-free
foundation mixins. Sass is a declared development dependency. `styles/index.scss`
imports only package partials; foundations emit opt-in `uiw-*` classes and widget
rules use their owned classes. No body/html reset, app token import or global app
button rule is introduced. Importing the ESM entry defines modules/weak registries;
listeners/timers are established by explicit instances, not app startup hooks.
Final L09 independently imported the ESM entry without browser/app globals and
rebuilt all 21 delivered outputs in an isolated copy, matching their bytes. Earlier
app-free specimens remain valid because package inputs and generated bytes match.

## Final acceptance reconciliation

The master now states current stage/category status and resolves the formerly stale
search-chooser/Scene rows. C29/C48 acknowledge verified actual Debug/Mods owners,
and C13 includes Runner E12 and service E14. Historical proposals remain marked
as chronological records; the final matrix controls current acceptance.

L02/L05/L06 behavior, L08 actual registered/nested/receipt/marker proof and L09
package/build/docs checks are accepted. The subsequent targeted C46 marker check
found and fixed faction-emblem trigger ownership; its actual replacement/focus/
Escape/stale-event case passes. Tests also exposed real Worlds hidden-setting loss
and nested focus ordering, both repaired and verified. No original source family
or static/runtime root remains without a migration or precise native/domain
disposition and supporting scoped evidence.
