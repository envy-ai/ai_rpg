# Navigation and layout consolidation

Status: source inventory and scope reviewed; navigation runtime changes follow the conditional-control checkpoint.
This follows checkpoint `99cdba4`. Conditional native controls are a separate,
concurrent slice. The full [master ledger](2026-11-05-ui-widget-merge-master.md)
remains authoritative for readers, cards, foundations and remaining mod surfaces.

## Native contracts and extraction boundary

| Source and actual consumers | Existing contract | Shared seam / explicit distinction |
| --- | --- | --- |
| `views/index.njk:initTabs` (29812); Scene Illustration `injectGalleryTab` (228) | Retained native buttons/panels; `#tab-name` and raw `#name`; programmatic activation invokes feature hooks; repeated clicks reload only World, Relationships and Favorites. Gallery is inserted after initial Play binding and independently repeats activation, hash handling and delayed race repair. | Compose existing Tabs, adding explicit dynamic registration and an every-activation callback separate from existing changed-only `onChange`. One Play registry owns Gallery too; remove Gallery's parallel selection/hash/timer repair. App owns hashes, graph refreshes, queued map IDs, Favorites readiness and gallery requests. |
| `views/index.njk:initStoryToolsPanel`, `setStoryToolsSection` (41169, 41313) | Four retained subpanels; history count visibility; lazy Scene Summary/Mystery Thread reads; Catalogue activation, including reselect. | Existing Tabs plus host activation callback; remove repeated class/ARIA/panel loops and click selection handlers. Keep loaded flags, readers and requests in the controller. |
| `public/js/mobile-adventure-nav.js:setSelected`, `bindTablist`, `syncResponsiveMode` (48, 131, 165) | Three native button groups select CSS datasets. Desktop still exposes the same underlying panes. Navigation opens relevant native details, preserves zero-count enabled choices, scrolls on changed choice and follows Chat when appropriate. | Factor button selection/roving keyboard handling into a small TabList used by Tabs and these three groups. It does not hide panels. Mobile controller retains datasets, native details, counts and follow rules. |
| Mobile Adventure dock and measurement (`mobile-adventure-nav.js:34–212`) | The exact live dock node moves to the Play root at <=540px and returns to its original parent/sibling above that boundary. Resize/mutation observers schedule measured CSS insets. | Retain this unique responsive composition as an app adapter; add explicit owned listener/observer/RAF disposal. No clone/rebuild, polling, generic portal invented solely for this markup, or replacement progress owner. |
| `views/index.njk:initializeAdventurePanelResizing` (4689) | Native separators; pointer capture/lost-capture; location/party width directions; desktop >=901px; saved widths; arrows with Shift, Home/Escape/double-click reset; existing min-width policy and ARIA values. | Extend PointerDrag with an injected movement writer (default floating-window movement unchanged) and opt-in capture ownership, then use two actual separators. Width math/storage/keyboard/ARIA stay host-owned. Explicitly stop active drag when desktop mode ends. |
| `public/js/app-header.js:setOpen` (18) | <=540px drawer, desktop always-visible navigation; scrim/Escape/navigation close; return focus; shared trapFocus; native Tools details use PopupDismissal. Existing native-modal/custom/media precedence applies. | Keep a thin responsive app adapter: no second generic drawer merely to wrap this unique markup. Own its listeners/media hooks/MutationObservers and final teardown; continue using shared focus and popup services. |
| `public/js/item-catalogue.js:back` (272), `_item-catalogue.scss` (responsive detail rule at 128) | Narrow list/detail Back removes a CSS class, preserves selected ID/detail and focuses the selected list button; Escape excludes editable controls. Rarity choices rerender one reader rather than select retained panels. | Preserve the catalogue domain adapter; no equivalent second master/detail state model has been established. Shared card/reader lifetime belongs to the later reader/collection gate. Do not apply Tabs to rarity buttons. |
| Worlds `views/settings.njk`, `public/css/settings.scss:863` | Native setting radio selection; library and editor stack together <=980px. Existing editor Tabs already shared. | No hidden-pane/Back model to merge. Setting application, clone/delete and selected-setting authority stay domain-owned. |
| Stories `story-editor.js:openUrl/navigate/selectTab` (336, 366, 397) | Route/node identity, history restoration, asynchronous dirty-draft leave review, query-selected section; sections rebuild content. Native links/details are authoritative. | Keep route and dirty-state navigation in the mod; this is not the retained-panel Tabs contract. Do not add a navigation widget only around unique markup. Existing shared fields/dialogs/feedback remain composition points. |

## Ordered implementation and gates

1. **Tabs and actual mod integration.** Introduce button-only TabList, compose Tabs
   with it, and retain existing Tabs API/default behavior. Add explicit
   `Tabs.add({id,button,panel})` registration ownership and an activation callback
   carrying `{changed, source}` while keeping `onChange` changed-only. A registration disposer is exposed only where
   actual owner teardown uses it; no general remove API solely for specimens. Adopt Play,
   Story Tools and all three mobile groups. Expose a narrow Play registration
   method for Scene Gallery; registration reconciles the current hash immediately,
   eliminating delayed activation repair. Build assets before new constructors.
2. **Layout lifetime.** Add only PointerDrag's movement/capture extension exercised
   by the two actual separators. Keep existing floating-window defaults. Make
   Mobile Adventure and header listener/observer/RAF ownership explicit. Preserve
   document-owned controllers across `pagehide.persisted`; dispose once on final
   unload, stopping active drags and releasing body classes/resources.
3. **Documentation and reconciliation.** Update Tabs/PointerDrag class contracts,
   add TabList documentation and independent specimens. Record the distinct native
   ItemCatalogue/Worlds/Stories policies above in the audit, rather than claiming
   their readers/domain controllers have been merged.

## Gotchas and preserved policies

- Play currently invokes activation hooks on hash changes even after a click has
  already invoked them. Preserve route-triggered hook semantics during extraction;
  do not silently coalesce requests or move request ownership into Tabs. Repeated
  active-tab click behavior is distinct from explicit `activateTab` calls.
- Gallery currently binds after Play snapshots its buttons and repairs races using
  two RAFs plus a 100ms timeout. Explicit registration replaces this duplication;
  no discovery observer, polling or missing-service fallback is introduced.
- Mobile selected groups control datasets rather than permanent panel hidden
  state. The same fields, Chat log, scroll/follow state and dock node must survive
  phone/desktop transitions. Native NPC/Things details keep their own open state.
- Existing splitter numeric limits are existing app policy, not new package
  clamps. Injected movement must bypass the floating-window position writer;
  windows keep their established bounds and callback behavior.
- Header drawer key routing must continue yielding to native top-layer dialogs,
  higher custom/media owners and popup capture. Its desktop navigation must remain
  available after closing the phone drawer.
- Stories dirty-route promises and browser history are materially different from
  synchronous tab selection. No generic adapter may bypass leave review or replace
  native link semantics.

## Verification delegated to Terra

Portable checks: TabList selection/disabled keyboard/wrap/modifier behavior,
Tabs retained panels/change versus reselect/dynamic add-remove/disposal, injected
PointerDrag movement/capture cleanup and unchanged default window movement.

Actual Play/mod checks: click/hash/programmatic and same-tab hooks; initial Gallery
hash before late registration and switching back; all four Story Tools sections;
phone group keyboard/native details/counts; the same dock node and live pending
controls across 540px; preserved Chat follow intent; separator pointer direction,
capture cancellation, keyboard/reset/storage and desktop exit; header scrim/Escape/
Tab/focus under native/custom/media ownership. Exercise persisted then final
pagehide cleanup. Retain existing Worlds/Stories route/dirty-draft tests as their
native distinction gates. No live server restart or save loading is required.
