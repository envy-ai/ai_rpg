# Full widget disposition and remaining verification

Preaudit only, 2026-11-05, against the original [widget audit](../../ui/widget_audit.md)
and [master ledger](2026-11-05-ui-widget-merge-master.md). This is a routing matrix,
not final completion. Group 5/6/Gallery source is frozen but additional session
coverage is running; Group 7 foundations is planned. No runtime/style changes or
tests were performed for this document. Source references name current functions
rather than obsolete audit line numbers. Fresh reads for this pass covered the open
reload, Debug, Runner, shortcut, Mod Manager, meter, route, transcript and metadata
registration seams. Migrated rows reuse their current authored source and accepted
focused plans; this is not a claim that every historical source line was reread.

**Disposition:** `Shared` means actual named consumers use the primitive;
`Native/domain` requires the stated semantic distinction, not a filename exemption;
`Open` names remaining migration or evidence. Shared behavior does not prove every
feature transaction. Existing accepted evidence remains usable only while its
relevant inputs remain unchanged. A test file's existence is not a passing result.

## Evidence map

| Key | Accepted source/evidence boundary |
| --- | --- |
| E1 | [Initial package](2026-11-05-widget-library-extraction.md): independent ESM/SCSS, SearchableSelect/PopupDismissal and real consumers. |
| E2 | [Overlay extraction](2026-11-05-widget-library-overlays.md), [standalone dialogs](2026-11-05-standalone-dialog-consolidation.md), master overlay register/checkpoints: native/modeless/custom/mandatory distinctions, tooltip/popup/window lifetime, actual owner/focus/pending arbitration. Includes the recorded 41-browser/21-source policy/row checkpoint; do not sum historical reruns. |
| E3 | [Domain forms](2026-11-05-domain-form-consolidation.md), [field rows](2026-11-05-form-field-consolidation.md), [ReaderRows](2026-11-05-reader-row-consolidation.md), [vehicle](2026-11-05-vehicle-choice-consolidation.md), [weather/typed fields](2026-11-05-weather-typed-field-consolidation.md), [quest/region](2026-11-05-quest-region-row-consolidation.md): named real forms, serializers, missing/zero/false/unknown values and phone geometry. |
| E4 | Master collection/media and graph checkpoints: actual eight item-holder paths, ImageFrame/Lightbox, concurrent container sessions, real Scene message images; GraphHost on all three engines, listener/hull order, original failures/retry; 22/34 and 18/14 checkpoint groups respectively. |
| E5 | Master feedback/surface/conditional checkpoints and focused plans: ActionGroup/SnapshotList/ProgressMeter/Mirrors/FollowScroll, BusyButton/StatusSurface/NoticeHost, owned jobs, explicit zero, keyed focus, native conditional fields and cached/final boundaries. |
| E6 | [Navigation](2026-11-05-navigation-layout-consolidation.md): 12 distinct Chromium/9 source cases, actual Play/Story Tools/Gallery/mobile groups, same dock node, separators/header, dynamic ownership and differing route models. |
| E7 | [Structured readers](2026-11-05-structured-reader-consolidation.md), [text/Log](2026-11-05-selectable-text-log-reader.md): 11 Chromium/37 Node, canonical browser template, real checks/Turn/Stories conflicts and projection, terminal/prompt selection and Log. |
| E8 | [Action collections](2026-11-05-action-collection-consolidation.md), [quest/tracker](2026-11-05-quest-tracker-display-collections.md): 11 Chromium/19 source, real chooser cards, stale controls, tooltip owner/hover bridge, quest IDs/errors and cached/final action boundaries. |
| E9 | [Group 5 lists](2026-11-05-list-detail-activity-consolidation.md), [Group 6/Gallery](2026-11-05-module-crafting-slot-consolidation.md): current implementation, initial 17 browser/29 source evidence retained by coordinator; **extra committed close/reopen, held unequip and current/stale lightbox/touch gates still pending at this preaudit**. Use final coordinator counts/artifacts, not this provisional subtotal, for acceptance. |
| E10 | [Portable foundations plan](2026-11-05-portable-visual-foundations.md): planned source map only; no implementation/verification credit yet. |

## Core shells, choices, navigation and feedback

| ID / original named families | Current source / actual seam | Disposition and remaining gate |
| --- | --- | --- |
| C01 Shared package, native controls and theme boundary | `packages/ui-widgets/src/index.js`, `styles/index.scss`, `examples`, `client/widget-adapters`, `scripts/build-ui-widgets.mjs` | Shared, E1–E9. Independent specimen/build and 14 deterministic JS/CSS/map/template outputs recorded; recheck after final changes. No app imports in package. E10 remains open. |
| C02 Header/brand/navigation, Tools, game actions; managed local-LLM LED/toggle | `app-header.js:setOpen/syncPrimaryActionStatus`, shared header partials; `local-llm-control.js:init/render` | Header shares PopupDismissal/trapFocus and explicit responsive lifetime, E2/E6. Save/Load forwarding and serialized LLM readiness/control remain domain. **Open L06:** local control's busy presentation/cache boundary is not proven by header tests. |
| C03 Play tabs, Story Tools sections, mobile Adventure tabs/subtabs and dock | index `initTabs/initStoryToolsPanel`; `mobile-adventure-nav.js`; Scene `injectGalleryTab` | Shared Tabs/TabList/explicit registration, E6. Same live dock node, dataset visibility, counts/native details and hash/reselect hooks stay app-owned. |
| C04 Desktop split panes/resize handles; floating drag | index `initializeAdventurePanelResizing`; `PointerDrag`, `FloatingWindow` | Shared injected movement/capture and owned sessions, E2/E6. Existing width/storage/keyboard bounds remain host policy. |
| C05 All static modal IDs/backdrops and runtime shells | Original audit overlay register plus master's individual root destination/policy register; `modal-stack.js` adapter, NativeDialog, ModelessChooser, FloatingWindow | Shared E2. This row covers every listed ID, inner surface and backdrop through those explicit registers, including entity editors, barter/quantity/currency, container/check, craft/module/salvage, save mismatch, repair/route, mandatory ability/recovery, standalone and Stories. Contents/async transactions are separate rows below; inner Lightbox/backdrops are not extra dialogs. |
| C06 Native popup/details actions, filter/sort/view, entity/location/map context, chat filter, map edge | `PopupDismissal`, `AnchoredPopup`, `action-images.js`, index popup initializers and graph-owned edge popup | Shared E1/E2/E6/E8. Native details versus portaled popup geometry, capture ordering/touch/selection stays explicit. |
| C07 Item/equipment/character/location/ability/tracker/faction/party/check-insight tooltips | `FloatingTooltip`, index `initFloatingTooltipController/bind*Tooltip`, Party adapter, Chat `showInsightTooltip` | Shared positioning/hover/owner lifecycle E2/E8; content/equipped comparisons and mobile suppression remain domain. **L05** verifies retained rich static formatters/focus/touch rather than asserting every formatter is portable. |
| C08 Ctrl/Cmd+Enter submit behavior | `public/js/modal-submit-shortcuts.js` | **Open L04:** native form/requestSubmit and explicit action already centralized, but app class selectors/installed-document listener remain outside package. Reconcile portable behavior + thin selector adapter, composition/readonly/disabled guards and explicit disposal; avoid a second shortcut controller. |
| C09 Searchable selects/checkbox choices, immediate entity chooser, saved-game/form radios, mandatory ability/declined cards, keeper wizard, module candidate choice | SearchableSelect; index `showSearchSelectionModal/populateLoadGameOptions`, NewGame `renderSavedEntries`, ability/keeper CollectionViews; `chooseModulesContextCandidate` | Shared E1/E3/E5/E8; Group 6 preserves module zero/single/cancel-error/selected IDs, E9 pending extra sessions. Domain matching, explicit commit and atomic restore remain hosts. |
| C10 Custom warnings/errors, PageFeedback details and browser confirmations/prompts | Chat cache/router/recovery/edit/error roots; `page-feedback.js:dialog/showError`; Log error; feature confirmation handlers | Shared shells/errors E2/E5/E7/E8. Native confirm for an explicit domain decision can remain; **L05/L06** reconcile touched failure alerts and remaining runtime status branches, without replacing confirmations blindly. Alias/domain prompts need explicit disposition. |
| C11 Prompt dock collapsed/one-line/table, modal strips, favicon, standalone owned-job dock | Chat progress functions; PageFeedback jobs/owned scopes; ActionGroup/SnapshotList/ProgressMeter/Mirrors | Shared E5. Transport/IDs/scopes/estimation/retry/cancel/favicon policy remain hosts; one connection owner. Scope flattening and independent pending controls tested. |
| C12 Streaming prompt/failure/terminal windows, nonblocking player-input, follow-scroll/selectable output | PromptWindows; Chat viewer/input functions; `FollowScroll/updateSelectableText` | Shared E2/E5/E7. Native Range/text versus textarea selection remain distinct; queues, source offsets and failure retry context stay domain. |
| C13 Busy/status/spinner/loading/notifications | BusyButton/StatusSurface/NoticeHost in Chat, Config, NewGame, workflow, Lorebooks, PageFeedback and Scene | Shared named consumers E5. Stationary tooltip and current eligibility preserved. Debug/Mods/Runner/local-LLM recurring copies remain **L02/L03/L06**, not covered by a passing primitive specimen. |

## Cards, media, collections and transactions

| ID / original named families | Current source / actual seam | Disposition and remaining gate |
| --- | --- | --- |
| C14 Entity image/card/name/action frame; item/scenery counts, slots, module/mod badges | index `renderEntityImage/renderThingCollectionPanel/buildThingCollectionEntry/renderImageBadgesOverlay`; `image-manager.js`; ImageFrame/CollectionView/createCollectionEntry | Shared item/media E4, actions E8. ImageManager generation/cache/URLs remain a service; entity upload/prompt roots use C05 and image progress E5. Original renderer remains the actual eight-holder path. **L08** needs actual registered badge/field/action/page parity; badge shape/corner/order remains host formatting. |
| C15 Player/location-NPC/sidebar-party/Party portraits, level/corpse/condition/health/need overlays | index `buildEntityPortraitContent/updateChatPlayerPanel/renderChatPartyPanel/initPartyDisplay`, existing portrait ratio helpers | ImageFrame shared E4; portrait variant and level/corpse/domain resource formatting retained. **L07:** exact meter/readout/animation and teardown disposition is still required; image tests alone do not prove these overlays. |
| C16 Health/need/numeric overlays and progress; vehicle ETA | index `createHealthBar`, shared health updater, need-bar renderer, vehicle current-location progress | **Open L07:** existing helpers already share actor formatting, but contained fill writes remain direct (including host rounding/bounds); compare ProgressMeter composition where equivalent. Do not convert tracker whole-card pseudo-element or native charge `<progress>` merely for appearance. |
| C17 Item list/grid/table, categories/filter/sort/view, AI search and visible bulk controls | `renderThingCollectionPanel`, thing-list filter partial, AnchoredPopup toolbar | Shared E2/E4. Cookie/search/AI/match/sort/filter semantics remain domain; no parallel inventory renderer. |
| C18 Inventory/equipment, container breadcrumbs/two-sided transfer/open check | index `renderNpcInventory/renderEquipmentList`, container renderer and session operations | Shared CollectionView/media/ModalStack E2/E4. Equipment slots and native breadcrumbs/labels remain domain structures; concurrent per-item requests and stale session boundaries tested. **L05** final equipment/slot/read-only rationale. |
| C19 Barter available/staged/quantity/currency/confirm | index barter renderer/transaction family | Shared collection/media/modal E2/E4; price/willingness/staging/settlement is domain. Native quantity/currency fields need no replacement controller. Retain relevant transaction regression gates. |
| C20 Craft/process/modify-location inputs, station context, notes/status/result, salvage | index craft inventory/slots/open/submit/salvage functions | Existing holder shared E4; fixed slots/preview cleanup and session/lightbox/touch guards implemented E9, **extra actual session proofs pending**. No invented station selector; backend operation/signature concurrency remains domain. |
| C21 Module workbench/installed summaries, multi-candidate context actions, direct card drops | index module workbench/prep/drop functions; `modules-ui.js` thin delegation | CollectionView/fixed slots/media + existing search chooser E4/E9. Source/compatibility/backlinks and server transactions remain domain. **Pending E9** committed close/reopen and stale/current action tests; **L08** registered badges/actions actual parity. |
| C22 Stack-combiner group/keeper wizard | index stack group/keeper, CollectionView + ModalStack | Shared named choice/shell E2/E5. Grouping/keeper IDs and commit remain app; confirm final actual choice evidence remains current. |
| C23 Desktop/touch ghosts, native drops and mobile Lightbox actions | index modal drag/touch helpers and holder-specific handlers; Lightbox action adapters | Shared media/window primitives E2/E4; transfer protocols intentionally differ from window movement. **E9 pending** verifies craft/module current/stale touch and held unequip; no global drag/transaction framework. |
| C24 Ability/skill/discipline/technique action and mandatory selection cards | index real chooser renderers; TechniqueSidebar; ModelessChooser/CollectionView/ActionImages | Shared E8; learning/source availability/ranks/required-choice mechanics remain hosts. Explicit default focus before entry cleanup is tested. |
| C25 Quest cards, offers/decision/reminder/rewards; tracker cards and hidden controls | index quest/tracker display/editor; Chat `createQuestOfferElement`, quest request/decision functions | Display collections/native details/shared shells E2/E3/E8. **L05:** Chat offer still separately builds native details and action/status chrome; preserve authoritative confirmation IDs before deciding helper reuse. Tracker pseudo-progress is explicitly distinct. |
| C26 Faction emblem/reputation/list/detail; Favorites travel cards; Item Catalogue library/filter/page/variants/Back | Group 5 current index + `item-catalogue.js`, shared CollectionView | Implemented E9; exact tier/travel/catalogue semantics stay host. Catalogue rarity buttons are a rerendering value selector, not retained tab panels; Back preserves selection. Foundation/details gates E10/L05 remain. |
| C27 Lazy action icons/image menus; rich Lightbox/details/action slots | `action-images.js`, package Lightbox; core holders/mod hooks | Shared E4/E8. Metadata/generation/editor operations remain page-owned across row replacement; final modal suppression tested. **L08** verifies actual namespaced registrations rather than only seeded core fixtures. |
| C28 Scene Gallery/message illustrations/queue/delete/notices | Scene `injectGalleryTab/renderGalleryGrid/createGalleryCard`, chat hooks | Tabs/media/NoticeHost and SnapshotList/card disposers adopted E4–E6/E9. Delete/GET overlap refetch preserves neighbor identity without tombstones. Scene message/action/WebSocket patching remains app integration; **L08** final mod composition gate. |
| C29 Debug stat cards/portrait/image jobs/results/recent gallery/save browser/JSON | `views/debug.njk` static stats; `loadRecentImages`, generation handler, `displaySaves/showStatus/loadSave/deleteSave`; vendor `<pretty-json>` | **Open L02:** interactive lists/status/busy/image frame still bespoke; recent image click restores generator form, not ordinary Lightbox. Static stats/read-only JSON/native details remain native/vendor with E10 styling and explicit read-only gate, not rewritten inspectors. |

## Forms, readers, graphs and native feature composition

| ID / original named families | Current source / actual seam | Disposition and remaining gate |
| --- | --- | --- |
| C30 Text/textarea/number/select/checkbox/file fields, help/error/buttons, YAML dirty/saving editor | createField/setFieldState/bindSecretToggle/serializeField; main/config/settings/native templates | Shared controls E3/E5; YAML parsing/dirty/save target remains ConfigManager. Native file input/security/textarea text needs no custom editor. E10 visual foundations and L05 read-only/error/keyboard coverage remain. |
| C31 Other entry, NewGame reviewed eligibility, calendar starting month/day/time, world tonal scales/notation | OtherEntry; NewGame/Worlds native CollectionView options; Worlds scale preview | Shared conditional/dependent ownership E3/E5. Calendar/stale references/all-axis validation/preview remain domain. Native selector preview is not a second generic navigation model. |
| C32 Attribute/skill point pools/warnings; numeric/formula variables, rank/metadata/bonus/ability rows | AttributeSkillAllocator, field/ReaderRows adapters, TechniqueMechanicsEditor/formula-variable table | Shared row/field E3/E8; formulas/budgets/revisions/pools remain domain. Native table/variable insertion stays app adapter; E10/L05 verify readonly structure and keyboard insertion. |
| C33 Fixed/percentage modifiers/status effects, ability attachments/permanent effects/technique grants | ModifierEditor/StatusEffectEditor/StatusEffectFields; techniques/attachments ReaderRows | Shared app-domain editors over portable rows/fields E3/E8. Player Stats intentionally retains its distinct fields and never saves absent effects as empty. Effect interpretation/rendered HTML is C44. |
| C34 Item charge/ammo pools, reload sources/slot/preview/amount | index item-charge native fields/`<progress>`; `item-charges.js:renderSources/openDialog` | NativeDialog and rapid reopen/pending/touch proven E2. **Open L01:** raw source buttons/list and local status remain, no page-owner teardown; source choice/final continuation gates are separate from shared native shell. Resource math/replay stays domain. |
| C35 Memories/goals/reordering; dispositions/needs sliders | OrderedTextList/NumberRange actual Play editors | Shared E3. Preserve order/ranges/normalization and actor semantics; visual readouts C15/C16. |
| C36 Faction assets/relations/tiers; calendar months/weekdays/seasons/holidays/time references; weather | FactionEditor/CalendarEditor/RegionWeatherEditor over Repeater/ReaderRows/createField | Shared domain compositions E3. Worlds absent calendar/generate/apply differs from live save; native date references retain blank/stale rules. |
| C37 Vehicle fields/active targets/fixed routes/tags/ETA/exit choice | vehicle partial, NativeSuggestions + CollectionView token views; app serializers | Shared E3. Named/region/unresolved targets and explicit clear remain host; ETA fill C16 and route details C46. |
| C38 NPC/player/Thing/scenery/location/stub/region/exit editors, cleanup/repair | Existing forms/serializers + ModalStack, shared field/domain row modules | Shared equivalent controls E2/E3; server mutation, stubs, membership and repair are domain. Every modal root is tracked in C05; static unique fields do not require another controller. |
| C39 Generic mod settings/entity fields, modules slot-type editor; workflow typed hidden state/conditional/resolution/preset; Config provider/model/secrets | ExtensionFieldEditor/native descriptors, modules row builders; shared workflow tabs/selects/fields/dialog; Config helper bindings | Shared named seams E1–E3/E5. Namespaces/unknown stored IDs/workflow serialization/discovery remain domain. E10 visual + **L08 actual extension parity** still required. |
| C40 NewGame saved-form names/snapshots/radio lists; Play save browser/mismatch/alias; Lorebooks upload/delete/toggle/stats/preview | NativeDialog/ModalStack/CollectionView and guarded host drafts; Group 5 Lorebooks | Shared E2/E5/E9. Save compatibility/atomic apply and upload/enabled/preview policy stay domain. Debug saves are independently open C29; alias cancellation/native prompt rationale belongs L05. |
| C41 Transcript/bubble/header/body/timestamp/actions/edit; composer/prefix/help/empty/suggestions/slash/guidance | Chat `appendChatBubble/appendMessageSections/setMessageContent/createMessageActions`, setup* methods | Already-central message chrome/Markdown hook; shared follow/feedback/shells E2/E5/E7. Entry identity/reconciliation, resend/redo/edit and turn requests remain domain. **Open L05** supplies final native/composition rationale and actual action retirement/prefix/confirmation/edited-message proof; do not label whole transcript migrated from follow-scroll alone. |
| C42 Plausibility/skill/attack/slop/insight disclosures and JSON debug content | Chat shared native detail builder; canonical `views/popups/plausibility.njk` -> browser build; Turn/native formatters | Shared E7. Domain outcome/calculation and Markdown stay host; vendor JSON remains C29. |
| C43 What changed drawer/chips/grouped needs/dispositions/entity navigation | TurnStateDiffDrawer + createDisclosure | Shared disclosure E7; severity/dedup/count/order/entity events and outer toggle remain domain, not a generic before/after diff. E10 chip foundation. |
| C44 Effect/tooltip cards, quest objective/reward lines, catalogue mechanics and formula/receipt tables | index shared `renderTooltipEffectCard/Section`, native lists/tables; Catalogue/techniques domain readers | Native/domain: already centralized formatting without independent listener state; preserve literal/zero/resource/technique semantics. E3/E7/E8 cover named inputs; **L05/E10** final readonly table/long-content/focus/escape and registered-effect gate. |
| C45 Story Tools paged/history/search/highlights/text edits/scene summaries/mystery boxes/threads/mentions | index `initStoryToolsPanel` Group 5 CollectionViews + Tabs | Implemented E6/E9. Request freshness, selection/editor drafts and prose endpoints remain hosts; not a portable history/database controller. |
| C46 Region/World/Relationships graphs, hidden controls/tooltips; vehicle/faction map overlays; Route and Travel form/steps | GraphHost + map/world/relationship adapters; shared VehicleOverlay; index `requestMapFastTravelConfirmation` | Shared graph lifetime E4 and shell E2. Engine owns VehicleOverlay position listeners, released with engine. Topology/hull/travel stays domain. Route steps are one native ordered-list, readonly spans/no row subscriptions; no new controller solely for markup. **L05** final route hidden blocker/step/action/confirmation/cancel evidence; **L08** actual vehicle/faction marker identity/overlay-follow parity. |
| C47 Log session/filter/files/reader/gutter/errors | Log Viewer CollectionView/TextGutter/NativeDialog; native readonly textarea | Shared E7; exact LF/empty/scroll/selection/abort rules remain host, no terminal gutter. |
| C48 Mod Manager enabled checkbox list/restart metadata/status | `views/mods.njk:renderMods/refreshMods`, native checked form | **Open L06:** repeated list/status presentation remains outside shared ownership. Enablement/restart semantics and native checkboxes remain domain; do not create a generic mod registry or move restart policy. |

## Every original bundled-mod subfamily

| ID / named family | Current source / disposition and remaining gate |
| --- | --- |
| M01 Stories search/sort/archive library and activity jobs/proposals | `story-editor.js:renderLibrary/renderActivity`: Group 5 collection ownership E9. PageFeedback job scope/YOLO/run state remains mod; no new connection/poll owner. |
| M02 Workspace section navigation, breadcrumbs/Previous/Up/Next, outline tree/mobile drawer | `openUrl/navigate/selectTab/renderTree/drawerHtml`: native links/details and URL/dirty async gates differ from retained-panel Tabs, E6 rationale. **L05** verify dirty-route refusal/expansion/focus; drawer is feature composition, not exempt by being a mod. |
| M03 Draft/approved/stale/machine-accepted/execution badges | Stories `badge` formatting stays host; E10 shared structural badge declarations, L08 preserves state labels and approval/evidence meaning. |
| M04 Scalar/line-list fields and remembered disclosures | Stories native fields/serializeField/createDisclosure, E3/E7; the mod's open-state Set and value formatting remain authoritative. |
| M05 Native form/dialog/drawer and suspended parent; leave review/source-buffer conflicts | Stories NativeDialog + ticket/whenClosed; field comparisons, E2/E7. Retained live draft DOM/nested close/reopen and conflict actions already tested. |
| M06 New story/instructions/generation/YOLO scopes; typed descriptor scalar/option/boolean/nullable/list/object/map/nested editor | `newStory/typedFields/editSetupField/editTypedCollection/readTyped`: scalar shared field serialization, E3; native form inside owned dialog retains schema/revision/draft. **L08** nested add/remove/duplicate/restore + zero/false/null/empty/focus proof/disposition still needs reconciliation, not a new schema framework by default. |
| M07 Before/after differences and selected proposal review | Stories `diffHtml/proposalDialog` uses createFieldComparison, E7; explicit acceptance/freshness stays mod. |
| M08 World/protagonist source selectors and recursive readonly projections | `renderSources/projectionHtml` uses createValueProjection plus native selects, E3/E7; live versus saved source authority remains host. |
| M09 Setup review/staged receipts/fact/evidence/outcome cards/written passages | Stories native disclosures/projections/field comparison, E7; **L08** verify reviewed/canonical and intention/observation projections at actual consumers rather than inferring complete coverage from one comparison specimen. |
| M10 Reconciliation/timeline diff/preparation/scoped approval recovery/Play handoff | Stories existing workflow over shared dialogs/readers, E2/E7/E9; server permission/history/canonical mutation stays mod. **L08** current integrated approval/handoff regression gate. |
| M11 Persistent inline errors/announcements | Stories `announce/fail`: existing PageFeedback original stack, inline role/status; E2/E7. E10 styling; reuse StatusSurface only if actual duplicated lifetime, no controller for a literal text assignment. |
| M12 Play goal/notes/checkpoint/start/pause/resume/undo/latest/completion | `story-authoring.js:StoryAuthoringRunner` has native details/fields/buttons, raw status and UI registrations. **Open L03:** UI handler unsubscribe/observer/keyboard/channel lifetime and cached restoration are unresolved. Keep backend leave/pause/beacon/heartbeat/actor loop/request claiming canonical choices authoritative; do not silently change them while extracting presentation. |
| M13 Scene action button/queue/success, Gallery tab/cards/delete/Lightbox/notices | Scene shares Tabs/NoticeHost/Lightbox/SnapshotList, C28/E9. Chat/WebSocket patching and generation queue counts stay mod; L08 actual hook parity and E9 extra sessions remain separate. |
| M14 Modules browser adapter | `mods/modules/public/js/modules-ui.js`: thin delegation to core `prepareModulesContextActionRequest`; C21/E9. No duplicate workbench implementation. |
| M15 Modules settings/presets/terminology/slot rows, item fields/badges/install-remove/actor sections | `mods/modules/mod.js` registration -> ExtensionFieldEditor/Worlds/core views and slots, E3/E9. **L08** preserves namespace/default/unknown saved IDs/badge mask/corner/order/action context and exact handler IDs. |
| M16 Implants settings/presets/terminology/slot fields/badges/install actions/actor sections | `mods/implants/mod.js`: same registration pipeline, not another generic widget. **L08 actual** field→badge/action roundtrip missing from module-only evidence. |
| M17 Spells labels/resource/cost-map/formula fields and actor status sections | `mods/spells/mod.js`: native descriptor fields/shared extension/reader slots. Formula/mana/need-bar IDs remain domain; **L08** zero/false/maps/unknown resource validation and rendered section parity. |
| M18 NSFW Boost character textarea, Story Authoring default notes, need-bar definitions | `mods/nsfw-boost/mod.js` entity textarea; Story defaultNotes setting; core need-bar definitions: shared native descriptor/field path E3, not custom controls to invent. **L08** real registered values/labels/hidden persistence and need/actor-section rendering gate. |

## Concrete routing after Group 7 (not completion claims)

1. **L01 Reload-source ownership:** adopt current `item-charges.js:renderSources`
   with CollectionView/entry subscriptions and status presentation where equivalent.
   Add cache/final owner/continuation boundaries to its native dialog. Preserve
   replay operation IDs, amount/compatibility, drag/select, pending dismissal and
   success callback. Reuse E2 rapid reopen/touch evidence plus actual detached
   source/current source and final pending read/reload tests.
2. **L02 Debug actual dynamic surfaces:** migrate save list, recent/result-image
   cards and duplicated status/busy presentation; keep recent click's form-fill
   behavior, explicit load/delete and image-job controller. Original failures need
   persistent stack details. Static stats/readonly API examples/native details and
   vendor pretty-json keep their native/vendor role with foundation/geometry tests.
3. **L03 StoryAuthoringRunner integration:** share applicable native field/status/
   action/disclosure presentation and own returned input/ability unsubscribe handles,
   observer and keyboard bindings. Establish cached restore versus final UI disposal
   while preserving leave/pause/beacon and one existing heartbeat/poll/channel owner.
   Test actual checkpoint/manual/reviewed input/ability interception/undo and a
   pending operation across the chosen boundary. This is not covered by StoryEditor.
4. **L04 Shortcut boundary:** extract existing native requestSubmit/explicit-action
   behavior or justify its remaining host adapter with actual portability evidence.
   App class aliases stay adapter; maintain composition/defaultPrevented/disabled/
   readonly and native dialog/form semantics. Add explicit listener disposal.
5. **L05 Native/domain reader and Chat gate:** record source rationale and targeted
   tests for centralized transcript/actions/composer/quest offers, RouteTravel,
   static effect/catalogue/receipt/formula tables and Stories navigation/outline.
   Reuse existing factories; share genuinely repeated chrome via existing helpers,
   not controllers solely for native lists/readonly tables. Tests must prove IDs,
   escaping/zero values, dirty/mandatory decisions, stale actions, keyboard and
   long-content behavior. Existing test files alone provide no acceptance credit.
6. **L06 Remaining recurring page presentation:** reconcile Mod Manager's list/
   status and local-LLM button/status/cache boundary with current shared controls.
   Keep restart/readiness/service ownership in hosts; no new controller around
   a unique LED or second transport loop.
7. **L07 Resource/ETA display seams:** decide actual ProgressMeter reuse for current
   contained health/need/vehicle fills, preserving host decimal rounding, readouts,
   ARIA, animation and existing normalization. Explicitly distinguish tracker CSS
   whole-card gradient and native item-charge progress. Portrait source variants
   and corpse/condition overlays remain domain adapters with real rendering proof.
8. **L08 Full extension/mod parity:** one actual registered field/badge/action/page
   fixture plus bundled Mods/Implants/Spells/NSFW/default-notes/need-bar consumers;
   retain namespaces/defaults/unknown IDs/hidden fields/0/false/null/empty lists,
   configured asset paths/corners/order, context and exact handler identity. Include
   Stories nested descriptors/receipts/approval/handoff and Scene hooks. Reuse
   accepted unchanged-input evidence; fill only missing gates, not broad reruns.
9. **L09 Final package/foundations/audit closure:** E10 remains planned until actual
   consumers compile and desktop/phone/current theme/focus/disabled/long-content
   gates pass. Reconcile every row above and each original static/runtime overlay
   root against final source, current evidence and a precise shared/native/domain
   disposition. Rebuild independent package/specimens and deterministic adapters;
   count accepted cases once. The full user goal remains active until then.
