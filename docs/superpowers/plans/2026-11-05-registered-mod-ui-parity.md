# Registered mod UI parity (L08)

Source-led closure of the metadata and bundled-mod rows in the original
[widget audit](../../ui/widget_audit.md#bundled-mod-widgets) and
[full disposition](2026-11-05-full-widget-disposition.md). Existing primitives and
accepted unchanged gates remain authoritative; this is not a new extension API,
schema framework, mechanics rewrite or wholesale dialog replacement.

## Actual registration → consumer boundary

| Family/source | Actual exported snapshot and native consumer | Composition/disposition and finite gate |
| --- | --- | --- |
| Modules `mods/modules/mod.js:702,729,875,904,962,1120` | `getSettingTabs`, editable Thing fields, badges/actions, actor contributor; `server.js:36345` injects Play snapshots and `:36859` Worlds settings | ExtensionFieldEditor + ReaderRows module-slot adapter; Worlds native preset/terminology fields and ordered slot-type rows; shared item CollectionView/ImageFrame badges and AnchoredPopup actions; existing awaited workbench/slot/close-reopen evidence retained. New gate must call actual `.register(scope)` and assert namespaced fields/badges/actions rather than hand-seeding equivalents. |
| Implants `mods/implants/mod.js:147–276,392` | Settings tab/preset/labels/asset, `implantSlot`, top-left mask badge, install/uninstall context allowlists, actor status contributor | Same core fields, image overlays, item context action transport and native readonly actor status. Verify active setting changes label/asset; inventory/NPC owner IDs and allowlist; slot clearing remains existing domain policy. No implant-specific widget. |
| Spells `mods/spells/mod.js:128–178,291`; `mods/spells/defs/need_bars.yaml` | Native Worlds label/resource/formula fields, object cost-map textarea; actor contributor supplies name/level/manaUsage/cost; mana definition flows through existing need-bar loader | Object textarea is an intentional native structured configuration surface, with existing parse validation. Actor readonly section has no independent row actions/listeners. Need-bar fills already share core health/need rendering (L07). Verify real registration, native cost-map round trip and contributor section including explicit zero cost. Startup validator/formula/casting remain domain. |
| NSFW Boost `mods/nsfw-boost/mod.js:120` | Registered Player `sexualTraits` textarea through `getEntityFields('player',{exposeToEditModal:true})` | Same NPC ExtensionFieldEditor/createField; verify registered label/type/help and submitted literal text. Prompt references/scoping remain mod services, not UI. |
| Story Authoring `mods/story-authoring/mod.js:28,52` | `registerUiPage` and untabbed `defaultNotes` setting; ModLoader page shell and Worlds `modSettingFields` native field macro | Page registration controls namespace/URLs/navigation/scripts/styles; existing shared head, feedback, dialogs, controls and foundations compose the actual Stories page. Verify real registration metadata, untabbed notes persistence and native page registration. Do not launch generation/recovery/LLM to inspect metadata. |
| Need-bar lust `mods/need-bar-lust/defs/need_bars.yaml` | Defs-only `sex` need definition, no browser script or runtime `mod.js` | Data consumer of the same core need bar, icon/color/visibility and actor-derived values; verify actual defs-derived identity and visibility through existing L07 host. Do not invent a mod controller. |
| Scene Illustration `mods/scene-illustration/public/js/scene-illustration.js:51,137,225,301,331,513` | Actual Chat action/render/WebSocket patches, explicit tab registration, SnapshotList gallery entries, Lightbox/NoticeHost | Existing real-hook message image/replacement, queue/error/notice, tab, delete/fetch overlap and media priority gates remain valid. Retain actual script composition in a final integration gate; no new backend job subscriber, hooks or transport owner. |

Registry contracts are `ModExtensionRegistry.js:1397` (tabs), `:1564` (filtered
entity fields), `:1659` (sorted cloned badges), `:1709` (sorted action snapshots),
`:1192` (actor contributions). Real scopes come from `ModLoader.createModScope`;
`tests/modules_mod_registration.test.js:createModulesScope` is the fixture pattern.
Browser snapshots must be obtained from the registry after actual bundled
registration. Native defs are loaded as data, not substituted hand-written metadata.

Play adopts config at `views/index.njk:3476–3479`; field adapters are
`getRegisteredThingEditFields/renderThingEditModFields` and NPC equivalents;
badge setting/URL resolution and context allowlists remain app functions
`resolveModThingBadgeAssetUrl/getModThingContextActions`. Action invocation posts
namespaced IDs with existing context/owner hints and keeps committed refreshes.
Worlds `renderModSettingField` handles tabbed and untabbed settings; unknown saved
values and omission/type validation keep their existing host contracts.

## Concrete source gap repaired

Actual Module actor status emits `moduleItemName/baseItemName`, while
`renderModStatusSections` previously chose only `itemName/name/id`: the visible
name becomes `Entry`. The reader now maps the real module name and base item. The reader now also preserves explicit zero cost/level in numeric detail presentation. This is host formatting, not new state or
collection machinery. Coordinate the bounded index helper with L05/L07 owners.

## Stories nested review and receipts

`story-editor.js:1482 typedFields`, `:1552 editSetupField`, `:1598
editTypedCollection`, `:1621 readTyped` form one schema-aware reviewed-draft owner.
Native fields are generated through createField/serializeField, nesting uses
shared native disclosure chrome; delegated parent click/input listeners survive
whole-form redraw. Domain paths, optional descriptor presence, generated IDs,
remembered removed values/shapes, draft persistence and staged attachment/review
must stay together. Repeater would impose independent mutable DOM rows while the
actual transaction intentionally re-reads and redraws the entire reviewed form;
there is no second generic row lifecycle to extract.

Accepted finite browser gate (evidence below): actual setup dialog add/remove/duplicate/restore of
nested object/list/map entries; retain zero/false/null/empty distinctions and
literal text; restored field and newly added entry receive focus and their native
disclosures open. Retain existing scalar/unavailable-option and native dialog
cache/final tests unchanged. Detect obsolete redraw/RAF UI writes at final unload
or replacement if this gate exposes them; do not change schema/approval policy.

The actual nested restore gate exposed a native reopen focus race: an independent
setup-path RAF could run before `NativeDialog.whenClosed()` completed, then the
post-open default focus replaced the intended restored field. `focusSetupPath`
now records a typed path with the current `dialogTicket`; the existing
`focusDialog` callback resolves it after native open, expands its ancestor
native disclosures and focuses/scrolls the control. Later focus callbacks for
that same ticket honor the same target. Dialog replacement, close and final
pagehide clear the request. No polling, retry timer, new promise layer or schema
change is added. `node --check mods/story-authoring/public/js/story-editor.js`
passed; the verification owner reruns the actual nested dialog gate.

`setupReceiptsHtml`, `projectionHtml`, `diffHtml`, scoped approval/recovery and
Play handoff already compose native disclosures/projection/comparison/shared
dialogs. Reuse the accepted unchanged `story-approval-recovery.spec.js` scoped
cancel/review/actual-content mismatch/receipt invariance evidence; add only missing
actual staged receipt and explicit reviewed handoff presentation checks. Badges
remain domain labels for draft/approved/stale/written states with shared SCSS
structure, not a new state machine or automatic approval.

## Execution and completion gates

1. Terra builds actual registry-backed browser fixtures; no live server/LLM calls,
   no backend whole-suite rerun for unchanged mechanics.
2. Narrow actor status formatting fix applied after index ownership coordination; no structural or lifecycle changes.
3. Run affected registry-backed core/Worlds/NPC pipeline and Stories nested gates;
   preserve existing accepted Scene/approval/receipt evidence when inputs match.
4. Record exact new proof and any explicit remaining gate. L08 is not complete
   merely because a generic primitive specimen or manually seeded fixture passes.

Root owns master/index/commit and final all-family reconciliation. L05 and L09 are separately resolved in the final matrix; this focused plan records
only its own accepted parity scope.

### Actual Worlds hidden-setting preservation repair

Registry-backed UI verification exposed a real data-loss boundary: Worlds built
`modSettings` from `{}`, while `PUT /api/settings/:id` calls `SettingInfo.update`
and the `modSettings` setter replaces the complete map. The collector now starts
from a deep-cloned per-form loaded baseline, overwrites rendered persistent
controls and explicitly removes registered nonpersisted action keys. Unknown
namespaces/keys retain zero/false/null/empty values. Profile load replaces the
baseline and New/clear resets it; no backend normalization, merge authority or
restart policy changed. The actual fixture must assert preserved hidden namespace
and hidden keys inside known namespaces as well as exclusion of preset selectors.

### Actual faction marker trigger lifetime repair

The final C46 gate found a concrete missed trigger lifetime in
`attachFactionEmblem`: replacing its raw button did not retire listeners and
unowned hide/show could affect a newer tooltip. It now uses per-host weak binding
ownership, owned AbortSignals and the existing FloatingTooltip owner token for
show/move/hide; replacement releases the old image binding and only its own
tooltip. Location hover, current formatted faction content, focus/Escape, explicit
narrow-screen tap and lazy image generation remain adapters. Cached pagehide
preserves the document; final disposal aborts bindings and ignores late directory
UI/errors. The actual Play map replacement/stale/focus fixture and VehicleOverlay
identity/follow fixture provide the focused remaining marker gate. No new generic
API, controller, positioning bounds or transport behavior was added.

## Accepted final parity evidence

Six distinct Chromium cases pass: real registered Play/NPC holder and Worlds;
nested reviewed object/list/map setup; actual staged receipt presentation; actual
VehicleOverlay helper callbacks; and actual Play faction-host replacement/tooltip.
All five relevant bundled `.register(createModScope(...))` calls supply actual
registry snapshots. Play verifies registered fields and literal NPC values, ordered
badge metadata plus configured implant mask/corner/label in the actual holder,
native context menu and a mocked namespaced POST carrying exact Thing/NPC owner
and context. Context-menu opening used a physical right click; its action used DOM
dispatch because this fixture's scroll container intercepted a physical click.
No physical action-click claim is made. Actor section display uses real provider
shapes; its gameplay computation is unchanged source, not a new actor-loop test.

Worlds verifies real tabs, structured zero cost maps, unknown slot/resource values,
Story notes/page metadata, preservation of unknown namespaces/keys and exclusion of
action-only presets. Clear resets the loaded baseline. The test exposed actual
whole-map data loss; the baseline-preserving collector fix passes.

The same registered Play case loads actual lust/mana YAML definitions into need
bars and verifies zero/icon/color; generic empty/zero visibility has accepted E13
proof. Server audience selection remains unchanged domain code and is not claimed
as a new filter test. Nested setup covers optional map keys, scalar values and
list add/remove/duplicate/restore with focus/open disclosures. Its failing native
reopen focus race is fixed by the ticket-owned intent and passes. Staged receipts
retain complete/pending/error/retry and explicit Start/New Game wording.

Accepted unchanged E4/E5/E6/E9 Scene hook/message/WebSocket/gallery/notice evidence
and E2/E7/E9 approval/projection/handoff evidence remain valid: final fixes do not
change those source inputs. Marker helper tests supply engine nodes; the faction
case exposes the actual map host without loading the graph. Full graph lifetime
proof is retained E4. No new graph geometry or gameplay result is asserted.

Artifacts: `tmp/l08-mod-results`, `tmp/l08-story-results`,
`tmp/l08-receipts-results`, `tmp/native-marker-reader-results`,
`tmp/native-faction-marker-results-3`. Changed test scripts pass syntax. Focused
reviews found no remaining introduced defect in the map/settings/focus changes.
L08 is resolved; no live server, LLM, save or restart operation occurred.
