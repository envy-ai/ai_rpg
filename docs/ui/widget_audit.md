# Widget audit for a decoupled UI library

Audited 2026-11-05. The best starting point is to extract the existing shared interaction machinery, merge its duplicated implementations, and keep game rules in adapters. A new framework or replacement component package is not assumed.

Phase one extracts SearchableSelect and PopupDismissal into the independent
[`packages/ui-widgets`](../../packages/ui-widgets/README.md) ESM/SCSS package, with
generated classic app adapters preserving current URLs and contracts. The package
includes explicit lifecycle/disabled APIs and an app-free specimen. See the
[implementation plan](../superpowers/plans/2026-11-05-widget-library-extraction.md)
for the bounded slice and verification status. Other families below remain audit
findings and a deferred roadmap, rather than completed migrations.

## Scope and terminology

This is a static source audit of the current browser UI: core pages, inline Nunjucks scripts, client modules, shared partials/styles, and bundled mod UI. A widget means an independently meaningful control, presentation unit, or interaction lifecycle; a feature screen is a composition of widgets. Native inputs and buttons are grouped by behavior rather than counting every instance. Backdrops and tooltips are included, but are not counted as dialogs merely because their markup uses a `.modal` class.

The inventory includes runtime-created interfaces, not only files in `public/js/widgets`. Mod source requires an unignored scan (`rg --files -uu mods`); an ordinary file scan misses it. Vendor internals, generated images, test fixtures and historical mockups are outside the implementation inventory. Existing test files are mapped below; their presence is not a claim that tests were run or that every interaction is covered.

Source notation below uses `index:123` for line 123 of [views/index.njk](../../views/index.njk), `chat:123` for [public/js/chat.js](../../public/js/chat.js), and otherwise names the source file. Line numbers describe the audit snapshot and will move with subsequent edits.

## Categories and proposed ownership

| Family | Proposed library responsibility | Remains in the project |
| --- | --- | --- |
| Visual foundations | Tokens, buttons, icon buttons, labels/help/errors, surfaces, badges, tables, spacing and focus styles | Asset locations, branding, rarity/ability/status colors selected from domain data |
| Dialogs and floating windows | Modal and modeless shells, focus/keyboard ownership, dismissal, stacking, scrolling, drag/resize | Contents, allowed actions, server decisions and progression gates |
| Popups and tooltips | Anchoring, viewport positioning, outside/Escape dismissal, hover/focus lifecycle | Entity-specific content and action eligibility |
| Choices and search | Native searchable select, checkbox choices, searchable list, explicit selection/commit | Data fetching, matching policy, unavailable-value rules, action execution |
| Navigation and layout | Tabs, disclosure, split pane, responsive navigation/drawer | Routes, map loading, gameplay tabs, game-state actions |
| Collections and cards | List/grid/table shell, toolbar, empty/loading/error state, selection, badges and slots | Inventory semantics, item search transport, stacking, equipment, ownership |
| Forms and repeaters | Labeled fields, numeric/slider pairing, editable rows, add/remove/reorder, nested groups | Calendar references, formulas, ability/effect mechanics and validation |
| Feedback and async actions | Status/alert presentation, busy buttons, progress rows, activity cards, error details | WebSocket ownership, prompt identity/retry/cancel, job and transaction state |
| Media | Image/placeholder frame, lazy image, render progress, lightbox/gallery and action slots | Image generation, uploads, prompts, entity URLs and server jobs |
| Structured details | Read-only tables, expandable sections, chips, code/text viewer, diff presentation | Quest/check/turn interpretation and authoritative receipts |
| Graphs | Optional graph viewport/controls/tooltip composition | Cytoscape data, world geometry, routing, relationships and layouts |
| Feature editors and workflows | Compose the above primitives | Barter, containers, crafting, modules, techniques, Stories, world profiles, saves |

These are extraction categories, not a proposal for a single widget with dozens of caller-specific options. Modal, modeless, hover, immediate-action and explicit-submit interactions need distinct contracts even when they share visual chrome.

## Existing foundations to preserve

| Implementation | Current consumers and behavior | Extraction work |
| --- | --- | --- |
| [SearchableSelect](../../public/js/widgets/searchable-select.js), line 17 | Workflow model/encoder/VAE/LoRA/sampler/scheduler choices and technique selectors. Native single select or checkbox multiple choice; multi-term filtering; selected unavailable values retained; host owns serialization. | Strong first candidate. Replace `AIRPG_WIDGETS` registration with a library entry point, separate its styles from `main.scss`, define disposal/disabled-state API and instance-safe labels. Keep reconciliation of missing LoRAs in the workflow adapter. |
| [PopupDismissal](../../public/js/widgets/popup-dismissal.js) | ActionImages native `details` menus. Exclusive open, capture-phase outside/action dismissal, Escape focus return, detach cleanup; explicit `destroy()`. | Preserve this lifecycle as the seed for disclosure behavior. Entity, map, header and filter menus still have separate implementations; their interaction contracts must be checked before migration. |
| [ModelessChooser](../../public/js/widgets/modeless-chooser.js), line 4 | Ability, skill and discipline technique pickers. Exclusive open, initial focus, native choice buttons, insertion without submitting, page remains interactive. | Inject focus target and value/action formatting: current `close()` knows `#messageInput`, choices add brackets and an `Insert` label. Replace the permanent instance set/document listener with owned lifecycle/disposal. |
| [PromptWindows](../../public/js/widgets/prompt-windows.js), lines 15, 138 | Shared live prompt/failure floating window shell; drag, stacking, resize presentation, focused-window Escape. Chat delegates shell creation to it. | Extract generic FloatingWindow/drag behavior. Header/tab-bar avoidance, failure UUID deduplication and prompt snapshots belong in adapters. Standalone progress still has its own rendering. |
| [PageFeedbackController](../../public/js/page-feedback.js), line 5 | Native error/detail dialog, safe DOM-node content slot, original stack, focus restoration including same-ID replacement; standalone job dock. | Reuse dialog lifecycle, but separate it from prompt transport, WebSocket connection, job scopes and Play detection. The whole controller is not a portable widget. |
| `renderThingCollectionPanel`, index:25709; [filter partial](../../views/_includes/thing-list-filter-toggle.njk) | Actual shared collection renderer across inventory, location things/scenery, barter, containers, crafting and module inputs; common filter/sort/view toolbar. | Extract this existing collection seam rather than adding a second renderer. Item schemas, action rules, transport and drag/drop operations stay in adapters. |
| [FactionEditor](../../public/js/faction-editor.js), lines 62, 97, 139 | Asset/tier/relation row builders and collectors reused by world-profile and live faction editors. | Retain shared domain editor; generic row lifecycle can move lower. Relationship enums/tier semantics stay outside the generic library. |
| [AttributeSkillAllocator](../../public/js/attribute-skill-allocator.js), line 69; [attribute](../../views/_includes/attribute-allocation.njk) and [skill](../../views/_includes/skill-allocation.njk) partials | New Game and character view allocation, read-only and spend-point variants. | Generic numeric/stepper/rank rows can be extracted. Formula evaluation, pool changes, floors and server definitions remain game-specific; do not replace this entire subsystem with a generic form widget. |
| [Lightbox](../../public/js/lightbox.js), lines 20, 84, 167 | Images, rich entity details, async action buttons and mod illustrations share one viewer. | Parameterize root/elements and error reporting; remove document-ID/global coupling. Preserve stale-show protection, action sequencing, touch actions and existing keyboard behavior explicitly. |
| Shared SCSS/partials | `_globals.scss`, `main.scss`, `.entity-*`, `.modal__*`, `.action-card`, forms, effect cards, `.data-table`, allocation and vehicle partials. | Existing visual reuse is broader than JS reuse. Separate reusable styles from feature rules, keep theme tokens overridable, and reconcile `.btn` with `.button` conventions deliberately. |

## Detailed inventory

### Shells, navigation and layout

| Current widget or composition | Source anchors | Category and merge direction |
| --- | --- | --- |
| App header, brand/navigation links, Tools disclosure, game actions, phone menu/scrim | [app-header.njk](../../views/_includes/app-header.njk), [app-header-nav.njk](../../views/_includes/app-header-nav.njk), [app-header.js](../../public/js/app-header.js):4 | Responsive header/disclosure primitives; route links, loaded-game state and Save/Load forwarding remain application code. |
| Managed local LLM readiness LED/toggle | [local-llm-control.js](../../public/js/local-llm-control.js), header partial | Status button primitive plus application controller; backend readiness/control is not widget-library behavior. |
| Play global tabs and Adventure tabs/subtabs | `initTabs` in index; [mobile-adventure-nav.js](../../public/js/mobile-adventure-nav.js) | Tabs + responsive section navigation; mobile currently moves the same live prompt dock and measures the fixed header stack. Preserve node ownership. |
| Desktop Adventure split columns/resize handles | `initializeAdventurePanelResizing`, index:4689 | SplitPane candidate with pointer and keyboard resize; app owns column meaning, persisted widths and breakpoint policy. |
| System tabs, Worlds editor tabs, Worlds calendar subtabs, image-workflow Generate/Edit tabs | [config.js](../../public/js/config.js):176; [settings.njk](../../views/settings.njk):1257, 2160; [image-workflow-editor.js](../../public/js/image-workflow-editor.js):371 | Four separate tab controllers plus Play. Merge state/keyboard/ARIA lifecycle; Config already implements arrows/Home/End/roving tab index, while other controllers are simpler. |
| Master/detail libraries | Worlds `renderSettingsList`, settings:1204; [lorebooks.js](../../public/js/lorebooks.js):76, 155; [log-viewer.js](../../public/js/log-viewer.js):54, 79; [item-catalogue.js](../../public/js/item-catalogue.js); Stories below | Collection selection + detail layout + narrow-screen drill-in. Keep per-feature draft/auto-selection/activation policy. |
| Mod Manager list and enablement checkboxes | [mods.njk](../../views/mods.njk):59, 72 | Checkbox list, badges, status/action bar; runtime enablement/restart messaging stays with the page. |

### Dialog, popup and tooltip surfaces

| Current widget or composition | Source anchors | Category and merge direction |
| --- | --- | --- |
| Custom modal chrome/backdrops/body scroll lock | index:1518; modal open/close handlers; `hideNpcBackdropIfNoSharedModalOpen`, index:27371 | Largest lifecycle consolidation. Explicit modal list and many close handlers currently maintain shared backdrop state; central ownership must preserve nesting and elevated Load overlays. |
| Native form/detail dialogs | New Game `createSettingsDialog`, [new-game.js](../../public/js/new-game.js):762; PageFeedback; techniques; attachments; charge reload; Stories | Modal shell + pending/submit lifecycle. Retain native top layer, cancellation policy, focus return and original errors. |
| Modeless action choosers | `playerAbilitiesModal`, `playerSkillsModal`, `playerTechniquesModal`; index:5928, 6003; ModelessChooser | Already one common lifecycle. Keep independent image/menu controls beside choice buttons. |
| Draggable player-input/confirmation panel and recovery dialog | `chat.setupPlayerInputRequestPanel`:1242, `showPlayerInputRequest`:1568, `showTurnEventRecoveryModal`:1435 | Floating request shell plus project queue/answer/recovery adapter; confirmation hides answer fields and exposes server actions. |
| Live prompt viewers and terminal failure viewers | PromptWindows; chat:6621, 6865; PageFeedback | Shared floating shell exists; keep prompt snapshots, retry context and failure deduplication outside it. |
| Terminal output viewer | `chat.createTerminalOutputViewer`:4919 | Reuse floating shell + read-only streaming text viewer. Preserve selection and follow-scroll state; terminal streams stay application-owned. |
| Search-and-act entity chooser | `showSearchSelectionModal`, index:34937 | Searchable list dialog used by summon, teleport and put-in-inventory flows; row click executes immediately. Separate from explicit-selection dialogs. |
| Entity/location/map context menus, action-image menus, filter/sort/view popovers, chat-bubble filter | index:8904, 12993, 13062, 23814, 23914; [action-images.js](../../public/js/action-images.js); map scripts | Shared positioning and dismissal candidates. A `details` disclosure, body-ported menu and custom dialog popover are different presentations with overlapping lower-level behavior. |
| Item/equipment comparison, character/location/ability, tracker, faction, party and check/insight tooltips | `floatingTooltipController`, index:40454; separate party path index:43014; `renderTooltipEffectCard`, index:11044; `chat.showInsightTooltip`:4261 | Merge tooltip lifecycle/viewport anchoring/hover bridge first. Entity/effect formatting and compatible-equipped-item lookup remain adapters. Keyboard focus, Escape and scrollable content must remain supported. |
| Shared Ctrl/Cmd+Enter submission | [modal-submit-shortcuts.js](../../public/js/modal-submit-shortcuts.js):1 | Extractable behavior; use the enclosing form or explicit action and respect disabled/read-only/composition state. Remove hardcoded project-specific dialog selectors via options or a shared root contract. |
| Warnings/errors and browser dialogs | Chat cache-monitor warning, router-unload warning, `showChatErrorPopup`:11442; PageFeedback; log error dialog; scattered `alert`/`confirm`/`prompt` calls | Persistent error details/confirmation/status are separate primitives. Keep original message/stack and explicit user decisions; replacing every browser dialog is a later migration, not an audit change. |

### Cards, collections and transfer workflows

| Current widget or composition | Source anchors | Category and merge direction |
| --- | --- | --- |
| Entity card/image/name/context-action frame | `.entity-*` in [main.scss](../../public/css/main.scss); `renderEntityImage` and entity renderers in index | Card/media/action slots are reusable; item/NPC/location data and eligible actions stay outside the library. |
| Player, location NPC and party portrait cards | `updateChatPlayerPanel`, index:7463; `renderChatPartyPanel`:7617; main party renderer near index:43014 | Shared portrait frame, level/condition badges, health and need readouts; distinct player overlay geometry, portrait ratios and party actions remain variants/adapters. |
| Health/need/progress bars, numeric overlays and animated health changes | Shared health/need styles; player/party renderers; `showNpcNeedsModal`, index:28467 | Meter/readout and paired range-number input primitives. Resource meaning, formatting, color rules and update deltas stay with the game. |
| Item/scenery cards, count and mod badges, equipment slot/status markers | `renderThingCollectionPanel`, index:25709; `renderEntityImage`; `.thing-count-badge` and registered badges | Compose one card with slots for badges and actions. Mods must retain extension points. |
| List/grid/table views; category filters; sort/view menus; AI search; visible-item bulk actions | index:23814, 23914, 24287, 25709; shared filter partial | One collection toolbar/state model with replaceable match/sort/search providers. AI search, saved cookies/preferences and domain filters stay project-owned. |
| Inventory/equipment panels | `showNpcInventoryModal`, index:28726; `renderEquipmentList`:29887; player inventory consumers | Compose collection + equipment slots. Equip/unequip and slot validation are not generic widget behavior. |
| Container breadcrumb/two-column transfer browser and opening check | index:27585, 27853, 27967 | Reuse collection, breadcrumb, transfer/slot surfaces and dialog; container nesting, locks and open checks remain domain controllers. |
| Barter available/staged offers, quantity/currency dialogs and confirmation | `renderBarterOfferPanel`, index:26888; `openBarterModal`:27060; barter modal family | Share two-column collection, quantity input and async buttons; price, willingness and trade settlement remain separate. |
| Craft/process/modify-location inputs, station picker, slots, notes and result/status; salvage intent | index:28804, 28942, 29008 | Generic slot/drop target + collection + notes dialog; eligibility, unequip, consumption and result generation stay with crafting. |
| Module workbench/installed-module rows | index:14322, 14827; [modules-ui.js](../../mods/modules/public/js/modules-ui.js) | Workbench uses core collection/slot machinery; mod script only enables the integration. Extract slots/details; installation rules and backlinks stay in modules. |
| Stack-combiner group/keeper wizard | index:24926, 24953 | Wizard shell and selectable card grid; keeper mechanics, groups and commit payload stay application-owned. |
| Desktop and touch drag/drop, drag ghosts, lightbox touch actions | index:15991 and transfer handlers; [lightbox.js](../../public/js/lightbox.js) | Shared pointer/drag presentation can be isolated. Transaction ownership differs: narrow mobile allows scrolling and uses explicit lightbox actions; wider touch layouts retain dragging. |
| Ability/skill/technique action cards, blocking level-up multi-selection and declined cards | index:5928, 6003, 6280, 6485; [techniques.js](../../public/js/techniques.js) | Card/rank/choice primitives, independent image menus and selection state. Insertion, learning, source costs and required level-up choices remain adapters. |
| Tracker sidebar cards, progress fill, hidden toggle, hover edit/delete | index:6994, 7113, 7328 | Progress-card primitive plus project tracker controller. Preserve overlay action hit targets and keyboard visibility. |
| Quest lists/cards, pending offer decision card, reward rows and reminder | `chat.createQuestOfferElement`:3561; quest panels and `questEditModal` in index | Expandable card, action row, badges and repeaters. Quest gate, accept/decline/completion and typed rewards stay domain-specific. |
| Faction list/detail/emblem/reputation cards; favorites destination cards | Faction/Favorites sections in index; FactionEditor | Reuse collection/detail/card/tooltip primitives; faction tiers and travel eligibility remain adapters. |
| Read-only Item Catalogue browser | [item-catalogue.js](../../public/js/item-catalogue.js), [item-catalogue.njk](../../views/_includes/item-catalogue.njk), [_item-catalogue.scss](../../public/css/_item-catalogue.scss) | Good integration specimen: master/detail, keyboard navigation, filter, rarity variants, tables/effect cards and mobile Back. Keep game-change invalidation and detached catalogue payloads outside the library. |

### Forms and editors

| Current widget or composition | Source anchors | Category and merge direction |
| --- | --- | --- |
| Labeled text/textarea/number/select/checkbox/file fields, help/error text and buttons | Shared forms in main/config/settings styles; page templates | Foundation layer. Normalize labels/focus/disabled/busy/error presentation without moving domain constraints or serializers into controls. |
| Native select with Other text field; calendar-aware starting month/day/time controls | `setupOtherSelect`, new-game:421; `populateStartingDayOptions`:57; settings:2233 | Select-with-custom-entry and dependent-select behaviors. Calendar validity and reviewed setup locking stay in New Game/Worlds adapters. |
| Attribute numeric/modifier rows, skill rank/add/remove rows, point pools/warnings | AttributeSkillAllocator:715, 803, 837 | Already shared feature widget; extract low-level field/stepper rows while retaining formula/pool semantics. Standalone Player Stats has its own form, not this complete allocator. |
| Fixed/percentage stat modifiers and status-effect repeaters | `thingModifierTemplates`, index:12381; NPC status index:17744; location status index:33911; [player-stats.js](../../public/js/player-stats.js):16, 142; attachments | High-value domain-layer merge. Shared UI row lifecycle underneath; preserve hidden stored fields, duration semantics, resource/technique references and zero values. |
| Ability list rows, type/description editors, attachment effects and technique grants | NPC editor in index; [ability-attachments.js](../../public/js/ability-attachments.js):190; Player Stats abilities | Repeaters/nested groups + dedicated ability adapter. Attachment previews/review and stale-state protection stay intact. |
| Technique/discipline/cost/effect/access/recipe editors, use preview and formula-variable table | [techniques.js](../../public/js/techniques.js):655; [technique-formula-variables.js](../../public/js/technique-formula-variables.js) | Domain editor composed of tabs/fields/choices/repeaters/native dialogs/data tables. Catalogue revisions, mechanics and execution stay outside generic widgets. |
| Numeric-or-formula fields, cursor variable insertion, key/value metadata and typed row editors | Technique form helpers, techniques:67–324; item metadata helpers, index:13384, 13420 | Extract small field/repeater behaviors. `TechniqueMechanicsEditor` already shares mechanics authoring with attachments; preserve that domain composition while extracting the underlying controls. |
| Item charge/ammunition pools, reload options and reload dialog | [item-charges.js](../../public/js/item-charges.js):107; `itemChargeReloadDialog`, index:2863 | Resource rows, explicit choice/commit and async dialog; resource math, payment and accepted inventory sources remain domain code. |
| Memories and goals editable/reorderable lists | `createNpcMemoryRow`, index:18396; `createNpcGoalRow`:18458 | Close structural duplicate. Merge row/list lifecycle with text/metadata adapters; preserve order and drag behavior. |
| Disposition and needs editors | index:28286, 28467 | Paired numeric/slider controls, labeled rows and meter preview. Character IDs/ranges/resource applicability remain adapters. |
| Faction asset/relation/tier repeaters and live/settings faction editor | FactionEditor; `initSettingsFactionEditor`, settings:2955; live faction editor in index | Existing shared rows; merge surrounding editor/list lifecycle when draft/commit policies match. |
| Calendar editor: ordered months/weekdays/seasons/holidays/time-description rows and reference selectors | settings:2054, 2176, 2410, 2458, 2711; in-game index:36350 onward | Strong duplicate feature-editor candidate. Share calendar editor in the app layer; generic repeaters/selects underneath. World profiles allow an absent definition and generation/default actions; in-game save targets the active calendar. |
| Region weather seasons/types editor | index:35926, 35990, 36048 | Nested repeater/field primitives; season validation, dynamic weather and canonical weather payload remain domain-specific. |
| Shared vehicle fields, active destination picker, fixed-route suggestions/tags, ETA and exit choice | [vehicle-info-fields.njk](../../views/_includes/vehicle-info-fields.njk); index:32898, 33190, 33245, 33473 | Existing partial with separate similar single/multi pickers. Candidate searchable choice/token-list composition; preserve unresolved named/region targets and explicit clearing. |
| Entity editors: NPC/player, Thing/scenery, location/stub/region/exit, relocation cleanup and membership repair | index:15809, 18059, 21025, 34129, 34438, 34554, 35620; modal register below | Feature forms; reuse fields, nested rows, choices and shells. Preserve distinctions between stubs/live entities, extension fields and server mutations. |
| Generic mod setting/entity fields; modules slot-type rows | settings:1694, 1749, 1866; mod field hooks in entity editors | Descriptor-driven field/group/repeater primitives; namespaced serialization, registration and module slot validation stay project-owned. |
| World profile tonal-scale selectors/notation/preview and profile search/sort/actions | settings:797, 850, 903, 1100, 1621 | Select/form preview/master-detail primitives; all-axis validation and profile semantics remain feature code. |
| Image-workflow typed hidden value, conditional controls, resolutions and presets | [image-workflow-editor.js](../../public/js/image-workflow-editor.js):163; [workflow partial](../../views/_includes/image-workflow-editor.njk) | Already reused by System and Worlds. Keep the workflow editor as an app integration; extract choices, tabs, preset-name dialog and labeled fields. Preserve host-owned serialization and live-list reconciliation. |
| System configuration validation, provider-dependent sections, model add and secret reveal | ConfigManager:56, 68, 302, 459; `togglePassword`:643 | Generic field/error/conditional-section/secret-input/dialog primitives; backend discovery and complete-form saving stay project-owned. |
| Current-game YAML override editor with dirty/saving state | ConfigManager:549 | Read/write text-editor + async action/status primitives; YAML parsing, target and persistence stay in configuration. |
| New Game saved-form name/snapshot and searchable radio-card load dialogs | new-game:762, 874, 914; template:239, 267 | Good explicit-select/submit specimen. Preserve abort/epoch guards, pending dismissal lock, separate empty/no-match/error states and atomic form application. |
| Save/load browser, mismatch choices, alias prompt and debug saves | index:19565, 19727; debug:849; load modal register below | Shared searchable collection/confirmation/dialog only; cancellation, save compatibility, loading and alias-generation flow remain game controllers. |
| Lorebook upload/delete dialogs, enabled toggles, stats and entry previews | lorebooks:41, 76, 123, 180, 309 | Generic file field/confirmation/list-detail/toggle/card primitives; upload format, enablement and preview truncation stay feature-owned. |

### Chat, structured details, media and graphs

| Current widget or composition | Source anchors | Category and merge direction |
| --- | --- | --- |
| Chat log/bubble/header/body/timestamp/action row and editable-message dialog | chat:2983, 3435, 4731, 5591, 8041, 8070 | Transcript/message/action primitives. Markdown rendering is a supplied renderer; editing, resend/redo, message IDs and persistence are app logic. |
| Composer/prefix controls, prefix help, empty-action confirmation, suggested-action chooser, slash file upload, prompt guidance | chat:912, 1152, 1168, 1201, 11759; index modal register | Compose input/actions/choice/dialog/file widgets. Input prefix semantics, requests and submitting a turn remain game code. |
| Follow-scroll behavior for chat and streaming viewers | chat:6547, 10621, 10632 | Reusable scroll-follow behavior that distinguishes reader scrolling, explicit jump and late content growth; independent of chat transport. |
| Collapsible plausibility/skill/attack/slop details, insight buttons/tooltips and JSON debug views | chat:3831, 4261, 9696 onward; [plausibility template](../../public/templates/plausibility.njk), [server counterpart](../../views/popups/plausibility.njk) | Disclosure/detail/table/code primitives. Keep calculation/outcome interpretation in render adapters; avoid maintaining two copies of the plausibility presentation indefinitely. |
| What changed drawer, category chips, grouped need/disposition changes and entity links | [turn-state-diff-drawer.js](../../public/js/turn-state-diff-drawer.js):275, 314, 705 | Extract generic expandable diff/list/chip presentation; keep structured event normalization, severity, grouping and entity routing in game code. |
| Story Tools paged entry lists, search/highlights, text editing, summary/mystery tools | Inline Story Tools sections in index | Shared searchable/paged list, editor and disclosure compositions. Keep prose/summary/mystery content contracts and endpoints in feature controllers. |
| Prompt dock collapsed/one-line/table modes, progress bars/actions, modal progress mirrors and favicon progress | chat:6197, 6297, 6368, 7023, 7152, 7475 | Progress row/bar/table plus responsive dock primitives. Prompt grouping, estimated curves, final-token snapshots, cancel/retry and favicon routing stay in adapters. |
| Standalone PageFeedback job dock | page-feedback:91 onward | Shares conceptual progress/actions with Play, but separate job-scope ownership and simpler rendering. Merge view primitives; preserve one connection owner per page. |
| Inline status/spinner, loading overlays, busy buttons, notifications and error details | chat:7706, 10585; new-game:186, 396; page/local `showMessage` functions | Shared feedback primitives. Modal vs nonmodal status must remain distinct; progress updates must not dismiss active hover/focus tooltips. |
| Entity image frame, placeholder, generation spinner/progress and upload/prompt dialogs | `renderEntityImage` in index; [image-manager.js](../../public/js/image-manager.js); index:20177, 20396 | Separate media presentation from generation transport. Preserve stale/detached-image handling and per-entity concurrent job state. |
| Lazy action icons and image options | [action-images.js](../../public/js/action-images.js) | Lazy image + disclosure/action slots; entity kinds, image endpoints and regeneration prompts remain adapters. |
| Lightbox rich details/actions and gallery thumbnails | Lightbox; entity renderers; Debug recent images; Scene Illustration | Shared lightbox/gallery/card composition; do not bury item-transfer semantics inside it. |
| Region Map and World Map viewport/controls/context menu/tooltips | [map.js](../../public/js/map.js), [world-map.js](../../public/js/world-map.js) | Optional graph-host composition. Reuse viewport/control/tooltip lifecycle; layouts, region expansion/stubs, eligibility and travel remain domain adapters. |
| Vehicle markers and faction-emblem map overlays | [vehicle-overlay.js](../../public/js/vehicle-overlay.js); map scripts | VehicleOverlay is already shared; general overlay positioning may be reusable. Vehicle/faction identities and styling rules stay in app adapters. |
| Relationship graph, hidden toggle, status and entity tooltip | [relationship-graph.js](../../public/js/relationship-graph.js) | Reuse graph host/toolbar/status/tooltip, not world-map data or routing. Cytoscape remains an optional dependency. |
| Route and Travel ordered steps/summary/action form | `mapFastTravelConfirmModal`, index:1271; route inspector implementation in index | Read-only list/detail + form in a shared dialog. Server-revalidated route/hidden-safe blocker/travel behavior remains domain code. |
| Log session/file filter, master/detail reader, line gutter and error dialog | log-viewer:20, 54, 79; [log-viewer.njk](../../views/log-viewer.njk):14, 51 | Reusable text reader with scroll-synced gutter + list-detail. Current/previous log API and abort ownership remain application code. |
| Debug stat cards, native disclosures/JSON inspectors, image jobs/gallery and save browser | [debug.njk](../../views/debug.njk):159, 222, 304, 408, 616, 724, 849 | Compose card/disclosure/code/media/progress/collection widgets. JSON viewer and Cytoscape are vendor renderers, not bespoke controls to rewrite. |

### Bundled mod widgets

All four bundled mod browser scripts were included: StoryEditor, StoryAuthoringRunner, Scene Illustration and the modules adapter. Other bundled mods contribute metadata rendered through core controls.

In this table, `story-editor:N` refers to [mods/story-authoring/public/js/story-editor.js](../../mods/story-authoring/public/js/story-editor.js), `story-authoring:N` to [its Play integration](../../mods/story-authoring/public/js/story-authoring.js), and `scene-illustration:N` to [the gallery integration](../../mods/scene-illustration/public/js/scene-illustration.js).

| Current widget or composition | Source anchors | Category and merge direction |
| --- | --- | --- |
| Stories search/sort/archive library cards | `story-editor:397 renderLibrary` | Collection/filter/card primitives; archive and story commands remain mod-owned. |
| Workspace section navigation, breadcrumbs and Previous/Up/Next | `story-editor:388 selectTab`, `:404 renderChrome` | Navigation/breadcrumb primitives; URL identity, permitted transitions and dirty-navigation gates remain in StoryEditor. |
| Nested outline disclosures and mobile outline drawer | `story-editor:431 renderTree`, `:446 drawerHtml` | Nested list/disclosure navigation and drawer shell. Current implementation uses native disclosures, not an ARIA tree; preserve stable expansion/selection/focus. |
| Draft/approved/stale/machine-accepted/execution badges | `story-editor:88 badge` | Shared badge presentation fed explicit state; approval/evidence meaning remains domain code. |
| Scalar/line-list fields and remembered disclosures | `story-editor:449 field`, `:455 details` | Shared fields/disclosures with application-supplied state/persistence. |
| Native form/dialog/drawer shell and suspended parent form | `story-editor:577 dialog`, `:603 closeDialog`, `:630 trapFocus`; Story template | High-value shell extraction: title/body/footer, initial focus, Escape, restore, parent suspension and scroll lock. Preserve a New story draft while nested instruction dialogs are shown. |
| Unsaved-choice dialog, local/saved source conflicts and buffer conflicts | `story-editor:571 leaveReview`, `:958 sourceConflict`, `:962 bufferConflict` | Confirmation/comparison presentation; draft revision and conflict-resolution policies stay in StoryEditor. |
| New story, optional generation instructions, generation scope and YOLO scope forms | `story-editor:769 newStory`, `:974 generationInstructionsField`, `:982 instructionsDialog`, `:1074 generationDialog`, `:1178 chooseYoloScope` | Compose existing fields/dialog/choice primitives; generation actions and scope permissions remain mod-owned. |
| Side-by-side field differences and selected suggestion review | `story-editor:1107 diffHtml`, `:1111 proposalDialog` | Shared comparison renderer candidate; application of proposals, selected fields and freshness checks remain domain code. |
| Generation/error/activity cards, job receipts and YOLO controls | `story-editor:1148 renderActivity`, `:1160 yoloHtml`, `:1140 syncFeedbackJobs` | Activity/status/card primitives. Already reports owned jobs to PageFeedback; preserve scope/ownership and generation/run state transitions. |
| World/protagonist source selectors and recursive read-only projections | `story-editor:1248 renderSources`, `:1312 projectionHtml` | Choice/structured-detail presentation; live/saved source authority remains in the mod. |
| Descriptor-driven scalar/option/boolean/nullable/list/object/map/nested collection editor | `story-editor:1355 typedFields`, `:1384 setupDescriptor`, `:1420 setupFieldsHtml`, `:1426 editSetupField`, `:1472 editTypedCollection`, `:1495 readTyped` | Reusable schema/value-driven field/group/repeater layer. Add/remove/duplicate/restore and focus behavior can be shared; setup proposal identity, session drafts and conditional validation remain adapters. |
| Setup review, staged receipts, fact/evidence/outcome cards and written passages | `story-editor:1517 setupReview`, `:1603 setupReceiptsHtml`, `:1663 factsHtml`, `:1696 evidenceHtml`, `:1716 renderWritten`, `:1727 outcomeDialog` | Compose typed fields, comparison, cards, disclosures and prose. Preserve intention vs observation and reviewed-vs-canonical distinctions. |
| Reconciliation/timeline comparison, prerequisite preparation, scoped approval recovery and Play handoff | `story-editor:1751 renderReconciliation`, `:1758 timelineDiff`, `:1801 preparationReview`, `:1890 recoverPlayApprovals`, `:1939 playReview` | Feature workflows using shared presentation; authority, approval, saved timeline and canonical mutation stay mod-owned. |
| Persistent inline errors and announcements | `story-editor:550 announce`, `:551 fail` | Feedback primitives; the mod already invokes shared stack-bearing PageFeedback. |
| Play goal/notes form, checkpoint notice, start/pause/resume/undo, latest/completion fields | `story-authoring:37 mount`, `:165 renderStoryCheckpoint`, `:211 render` | Disclosure/form/action/notice primitives. Actor loop, heartbeat, request claiming and canonical choices stay in StoryAuthoringRunner. |
| Scene illustration message action, queue count and success state | `scene-illustration:142 createIllustrationButton`, `:632 updateButtonQueueState` | Async action/icon/status primitives; queue ownership and image generation remain mod-owned. |
| Scenes Gallery tab, loading/empty/error states, image/prompt/date/delete cards | `scene-illustration:228 injectGalleryTab`, `:381 loadGalleryContent`, `:405 renderGalleryGrid` | Shared tab registration, gallery/media card and collection-state presentation. Current gallery independently toggles global Play tabs and hash routing. |
| Illustration lightbox, delete confirmation and notifications | `scene-illustration:28 bindLightboxToImages`, `:500` delete handler, `:714 showNotification` | Lightbox is already shared. Notification currently uses `showToast` when present or a local overlay; consolidate presentation and error handling with the host. |
| Module integration adapter | [modules-ui.js](../../mods/modules/public/js/modules-ui.js):2 | Calls core `prepareModulesContextActionRequest`; core owns the workbench/slot/detail implementations listed above. |

Metadata-driven controls also belong to the inventory: Modules settings/preset/terminology/slot rows, module item fields/badges/install/remove actions; Implants settings/preset/terminology/badge/item slot/install actions; Spells label/resource/cost-map/formula fields and actor status sections; NSFW Boost character textarea; Story Authoring default-notes field; and need-bar definitions rendered by the core. See [modding hooks](../modding_hooks.md), [Modules](../mods/modules.md) and each owning `mods/*/mod.js`. These are consumers of field/card/action extension points, not separate generic widgets to reimplement.

The Scene Illustration integration is particularly coupled: it patches Chat message/action/WebSocket methods and installs global tab/hash handlers. Its gallery interpolates prompt/URL values into HTML and reveals delete actions through mouse hover. A shared media/card migration needs explicit safe-content and keyboard/touch contracts. StoryAuthoringRunner also assumes a page lifetime: input/ability unsubscribe handles and some observers/listeners are not fully disposed. Keep this lifecycle work in the integration layer rather than importing mod controllers into the library.

## Dialog and overlay register

The following register makes the numerous static shells individually traceable. Names in each row are DOM IDs. Shared backdrops, inner surfaces and popovers are identified separately. Runtime-created dialogs/windows follow the static register.

| Source | Shells or overlays | Inventory family |
| --- | --- | --- |
| index:338, 590 | `chatBubbleFilterPopover`, `setLastSeenModal` | Filter popover; time form |
| index:1129–1311 | `playerPromptGuidanceModal`, `prefixHelpModal`, `actionSuggestionsModal`, `emptyActionConfirmModal`, `questDecisionReminderModal`, `mapFastTravelConfirmModal`, `locationRegionFixerModal` | Forms/help/choices/confirmation/route/repair |
| index:1342–1444 | `slashUploadModal`, `entityImageUploadModal`, `entityImagePromptModal`, `playerInputRequestPanel`, `factionCreateModal` | Upload/media/input/faction forms |
| index:1520–1765 | `trackerEditModal`, `questEditModal`, `npcInventoryModal`, `thingStackCombinerModal`, `thingContainerModal` | Tracker/quest editor, inventory, wizard, transfer |
| index:1881–2045 | `containerOpenCheckModal`, `barterModal`, `barterStartConfirmModal`, `barterQuantityModal`, `barterCurrencyConfirmModal` | Opening check, barter and transaction prompts |
| index:2063–2238 | `playerAbilitiesModal`, `playerSkillsModal`, `playerTechniquesModal`, `npcViewModal`, `npcDispositionModal`, `npcNeedsModal` | Three modeless pickers; character view/fields |
| index:2263–2467 | `craftingModal`, `moduleWorkbenchModal`, `salvageIntentModal`, `npcMemoriesModal`, `npcGoalsModal`, `addNpcModal` | Crafting/modules/intention/repeaters/generation |
| index:2541–2863 | `loadGameModal`, `loadModMismatchModal`, `playerAbilitySelectionModal`, `newExitModal`, `npcEditModal`, `itemChargeReloadDialog` | Save selection, compatibility choice, blocking draft, entity forms, native reload |
| index:2877–3293 | `thingEditModal`, `locationEditModal`, `regionEditModal`, `regionWeatherEditModal`, `calendarEditModal` | Entity and structured world editors |
| index:3355 | `imageLightboxInner` within `imageLightbox` | Shared viewer inner surface, not a second dialog |
| Index shared overlays | `actionSuggestionsBackdrop`, `npcModalBackdrop`, `questEditBackdrop`, `craftingModalBackdrop`, `moduleWorkbenchModalBackdrop`, `salvageIntentBackdrop` | Backdrop ownership, not independent dialogs |
| [settings.njk](../../views/settings.njk):731 | `autofillInstructionsModal` | Instructions/image form |
| [config.njk](../../views/config.njk):1407 | `addModelModal` | Model-name form |
| [image-workflow-preset-modal.njk](../../views/_includes/image-workflow-preset-modal.njk):1 | `imageWorkflowPresetModal` | Reused preset-name form |
| [new-game.njk](../../views/new-game.njk):239, 267 | `saveNewGameSettingsDialog`, `loadNewGameSettingsDialog` | Native snapshot/name and explicit choice dialogs |
| [lorebooks.njk](../../views/lorebooks.njk):73, 104 | `uploadModal`, `deleteModal` | File form and destructive confirmation |
| [log-viewer.njk](../../views/log-viewer.njk):51 | `log-error` | Native stack-bearing error details |
| [story-editor.njk](../../mods/story-authoring/views/story-editor.njk):41 | `story-dialog` | Reused native form/drawer shell |

Runtime-created surfaces include PageFeedback dialogs; PromptWindows live/failure windows; Chat's edit dialog, turn-event recovery, cache-monitor/router-unload warnings, terminal output viewer and persistent error popup; `showSearchSelectionModal`; technique editor and ability attachment dialogs; tooltip/context-menu nodes; and Scene Illustration notifications. Their lifecycle must be inventoried alongside static markup when migrating a family.

## Merge order and completion criteria

1. **Library boundary and specimens.** Establish an independently loadable DOM-based entry point and theme stylesheet. A detached specimen page must work without `/api`, WebSocket, game globals, page-specific IDs, injected Nunjucks data or mod runtime. Supply roots, content, values and callbacks explicitly. Keep Cytoscape and other heavy renderers optional. Package/repository choice can be decided during implementation.
2. **Foundations and isolated widgets.** Move tokens/forms/buttons, SearchableSelect and PopupDismissal first. Preserve native keyboard behavior, filtering/selection, event contracts and popup cleanup. This creates portable pieces without involving gameplay.
3. **Overlay lifecycles.** Extract ModalDialog, ModelessDialog/FloatingWindow, anchored popup and tooltip behavior. Start with native New Game/PageFeedback/Stories specimens and existing PromptWindows shell. Define stacking, focus, Escape ownership, pending-dismiss rules, root detachment and disposal before migrating the many custom Play modals.
4. **Repeated interaction primitives.** Consolidate tabs, searchable choice lists, explicit selectable-card lists, repeatable rows, paired slider/number controls, status/busy/error widgets and follow-scroll behavior. First merge memories/goals; then the duplicated Worlds/Play calendar editor and status/modifier editors in the project layer.
5. **Collections and media.** Extract around `renderThingCollectionPanel` and the lightbox/card/image seams. Migrate toolbar and card presentation before container/barter/crafting/module workflows. Preserve mobile scroll vs drag behavior, per-item concurrent operations and server-authoritative changes.
6. **Larger compositions.** Reuse list-detail, activity/diff/details and optional graph-host primitives across Item Catalogue, Worlds, Stories, Story Tools, logs and maps. Keep stateful gameplay/story editors in the project, consuming the library through adapters.

A family is ready when its portable specimen works independently, migrated consumers exercise the same implementation, project semantics remain in adapters, keyboard/mobile behavior is preserved, cleanup is explicit, and relevant documentation/interaction coverage has been updated. No implementation, server restart or data mutation is part of this audit.

## Extraction constraints that affect the work

- **Visual reuse is not full decoupling.** `main.scss` contains shared styles and screen-specific rules together. Global `.modal`, `.container`, `.btn` and `.button` conventions can leak across an extracted boundary. Keep authoritative SCSS and compile outputs whenever implementation changes it.
- **Overlay semantics differ.** Modeless choices leave the composer usable; mandatory recovery suppresses Escape; native dialogs occupy the top layer; some custom dialogs share a backdrop. The lightbox currently dismisses on non-Tab keys except native interactive Enter/Space. One blanket focus trap/body lock/Escape handler would change behavior.
- **Async ownership is part of correctness.** Epoch/abort guards, same-ID focus restoration, prompt job scopes, draft revisions and stored IDs cannot be replaced with generic global busy state. Collection transfers intentionally permit distinct in-flight operations; a dialog's submit lock is a different concern.
- **Library failures need a host error hook.** Controls should surface errors without importing PageFeedback, `alert`, Chat or prompt transport. The application must preserve original diagnostics and show persistent stack-bearing UI where required.
- **Serialization remains explicit.** SearchableSelect's controls intentionally have no form names; workflow JSON and game/mod field serializers remain authoritative. Optional empty scalars, explicit zero/false, empty collections and conditional fields must retain their contracts during form consolidation.
- **Existing persistence and extension points remain app-owned.** Cookies/localStorage, user tab/view settings, saved IDs, mod-registered fields/badges/actions and unsaved drafts should not become hidden library side effects.
- **Lifetime contracts are uneven.** PopupDismissal already provides teardown; several page widgets assume one mount per document. Extracted widgets need owned event/observer cleanup and reusable instances rather than permanent singleton references.

## Existing verification anchors

Useful focused browser specimens already exist in `tests/e2e`: `image-workflow-loras`, `modal-submit-shortcuts`, `new-game.form-settings`, `header.navigation`, `entity-tooltips`, `ability-tooltip`, `ability-attachments`, `prompt-failure-windows`, `modal-prompt-progress`, `map-route-inspection`, `mobile-lightbox-actions`, `item-catalogue-isolated`, `item-charge-isolated`, `techniques-panel-editor`, `faction-sparse-editor`, `story-form-fill`, `story-new-story-fill` and `story-approval-recovery` (`.spec.js` files).

Related unit/source/UI checks include `tests/pagefeedback.owned_jobs.test.js`, `tests/entity_tooltips_ui.test.js`, `tests/mobile_tooltip_dismissal.test.js`, `tests/lightbox_backdrop_close.test.js`, `tests/mobile_lightbox_actions.test.js`, `tests/turn_state_diff_drawer_ui.test.js` and the bundled Story Authoring tests. During migration, use these as regression anchors and add independent library interaction specimens where existing coverage depends on the game shell. Audit-only documentation does not require running gameplay or browser tests.
