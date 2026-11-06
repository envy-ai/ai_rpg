# Remaining reader, collection and foundation routing

Planning only after `854896d`; no runtime changes or new verification are claimed. The original audit/master remains authoritative. Core owns the current navigation implementation; its tab/header/split/Scene Gallery blocks are excluded here. The groups below are ordered implementation candidates, each requiring real consumers before completion.

## 1. Structured readers and duplicated plausibility presentation

Sources: `chat.js:buildCollapsibleDetailsMessageElement`, `renderPlausibilityMarkup`, skill/attack/slop builders; `public/templates/plausibility.njk` and `views/popups/plausibility.njk`; `turn-state-diff-drawer.js:createDrawer/createGroupedChangeRows`; Stories `details`, `diffHtml`, `projectionHtml`, source/buffer conflicts and proposal review.

The two plausibility templates are currently byte-identical. Establish one authoring source and a deterministic browser asset/include boundary; trace the server counterpart's consumer before removing it (direct references were not found in server.js/api.js). Chat already shares one native-details builder across its check readers. Stories and grouped turn changes repeat native disclosure structure; share a small native builder/style only where it preserves their actual markup and remembered-open ownership. Native details continues to own keyboard/open behavior; no global disclosure registry or fake ARIA tree.

Stories' existing `diffHtml` already serves source conflict, buffer conflict and generated proposal review. A small read-only field-comparison renderer can accept host-formatted labels/values/change flags. Preserve its key order, missing/empty/zero/false/null display and explicit accept/merge actions. TurnStateDiffDrawer is an event summary with severity/category normalization, deduplication, grouped need/disposition changes and entity-routing events, not a before/after field diff; reuse disclosure/chip/list presentation rather than moving those game rules into the comparison renderer. `projectionHtml` is recursive literal key/value/list presentation, not the reviewed editable document controller.

Gates: actual history/live/insight plausibility parity; skill/attack/slop details; Turn diff counts/grouping/open/empty/severity and `airpg:turn-diff-entity-selected` IDs; Stories source/buffer conflict and proposal comparisons retain values until explicit acceptance; recursive projections stay read-only and escape text. Debug's `pretty-json` custom element (`views/debug.njk:145,223…`) already owns JSON-tree behavior: preserve that vendor inspector and theme its container rather than rewriting it.

## 2. Selectable text, Log reader and gutter

Sources: `chat.js:updateSelectableTextElement`, terminal output and prompt/failed-response viewers; `log-viewer.js:selectFile/renderFiles`, scroll listener; `docs/classes/LogViewer.md`.

Extract the existing incremental selectable-text update used by terminal and prompt readers, composing existing FollowScroll/FloatingWindow. Preserve DOM Range selection and source-specific text snapshots; transport, retries and offsets stay hosts. Log uses a read-only textarea and scroll-synchronized line-number gutter, while terminal uses selectable text nodes and has no gutter. A small owned gutter binding can serve Log without adding a terminal gutter or forcing both selection models into one reader class. Log's file list can compose CollectionView with its existing abort/selection state.

Gates: terminal/prompt/failed-text append and replacement preserve selection and follow state; Log literal HTML remains text, line counts/newline/empty behavior and vertical sync match, file/session switches cancel stale reads, filtering preserves a matching file or selects the first as before, and desktop/phone scroll regions remain usable. No polling, log mutation or altered failure transport.

## 3. Ability, skill and technique action collections

Sources: index `renderPlayerAbilitiesModalAbilities`, `renderPlayerSkillsModalSkills`; `techniques.js:renderCards` and discipline groups. Mandatory ability/keeper choice collections are already migrated and are not a reason to change these action models.

Compose CollectionView/createCollectionEntry around repeated card/empty/content disposal; retain ModelessChooser, ActionImages, tooltips and original native action buttons. Card header/body/provenance slots and structural styles are common. Ability name insertion, skill ranks, technique source availability/costs/blockers, previews and catalogue revisions are distinct domain behavior.

Gates: actual ability/skill/technique chooser navigation and composer insertion; source changes/availability; retained old cards cannot act after rerender/close; images/tooltips release; focus and mandatory-choice blocking remain correct.

## 4. Quest and tracker collections

Sources: index `initQuestPanel:createQuestCard/renderQuestPanel`, `renderChatTrackersPanel`, tracker tooltip/progress helpers. Quest edit rows are already shared; this group covers display collections.

Move repeated root clearing/count/empty and owned card actions into CollectionView. Consider SnapshotList only where current identity/update policy requires retaining nodes; do not silently change the quest list's current default-open/order behavior. Native quest details remains native. Tracker time/count/progress, hidden visibility and formatting remain adapters, composing ProgressMeter where its existing visual semantics match.

Gates: active/completed/paused quest ordering and default disclosures; completion/retry/abandon retain exact IDs and single requests; hidden-only tracker empty state, hidden toggle, countdown/value/progress and edit/delete refresh; stale controls inert and no scroll/focus regression.

## 5. Faction, Favorites, Catalogue and Stories library lists

Sources: index `initFactionPanel:renderList`, `renderFavoriteLocations/buildFavoriteLocationCard`; `item-catalogue.js:renderList/renderDetail`; Stories `renderLibrary/renderActivity`.

These repeat rebuilding records, counts/empty state and selected/action presentation. Compose CollectionView/SnapshotList using host keys and explicit disposers. Keep filtering/sorting/page boundaries, selected IDs and any master/detail Back behavior host-owned or coordinated with navigation. Catalogue's 60-row pages, remembered-versus-standard-family distinction, variant rarity and historical definitions are not live inventory state. Favorites' visited/non-stub eligibility, current-location disable, travel time/cache and route commit are not generic selection. Faction emblem/standing/relations remain domain content.

Stories library/archive sorting and read-only/export actions can share content ownership. Activity's jobs/proposals/cards can consume keyed view snapshots and existing ActionGroup/StatusSurface, but `syncFeedbackJobs` scope, polling, job/run identity, freshness, cancel/retry/YOLO and error reporting stay in the mod. Remembered native disclosure state remains the existing app Set.

Gates: actual Faction selection/refresh and Favorites eligibility/current/travel; Catalogue filter→page→variant→detail/Back with original focus and recorded values; Stories search/sort/archive/read-only library and job/proposal updates preserve scope/identity, retain pending guards and cannot fire obsolete actions. Do not repeat the already verified item-holder migrations.

## 6. Module choices and indexed workbench/crafting slots

Sources: index `chooseModulesContextCandidate/prepareModulesContextActionRequest`, `renderModuleWorkbenchSlots`, `renderCraftingSlots`; `mods/modules/public/js/modules-ui.js`; ModExtensionRegistry documentation.

Module candidate selection still uses a numbered window.prompt for multiple matches. Compose the existing explicit search chooser and await it inside the already-async request preparation; preserve single-candidate selection, cancellation/error contract, compatibility filtering, item source and payload IDs. Confirm cancellation behavior before changing it from its current invalid-choice error into a new transaction policy.

Workbench and crafting repeat indexed slot-root rendering and drag/drop subscriptions. Compose CollectionView with explicit entry disposers, or a small slot-chrome helper if the shared structure warrants it. These are fixed indexed slots, not free-form ReaderRows. Installation compatibility/backlinks/occupied slots, resource assignment/consumption, unequip, request signatures and server revalidation stay adapters. The mod script is already a thin delegation to core; no separate module-station picker was found there. Crafting's captured station context (`craftingSourceThing`, station ID/name payload) must not become a newly invented selection step.

Gates: multiple-compatible install/remove choice, cancellation, no compatible candidates, exact item/source/slot payload; occupied/unavailable slot and stale inventory validation; fixed indices and repeated rerender/close clean drag listeners; native and existing touch/lightbox actions retain transaction behavior.

## 7. Portable visual foundations

Sources: `packages/ui-widgets/styles/index.scss`, `_globals.scss`, main `.button/.btn/.form-grid/.form-group/.data-table`, settings/config themes and mod styles; `docs/ui/assets_styles.md`.

Extract genuinely common structural mixins/tokens for native fields/help/errors, button/icon chrome, surfaces, badges/chips, tabular/scroll regions and focus/disabled/busy states. Keep app fonts/branding, backend accents, game severity/type colors and responsive domain layouts in adapters. Use opt-in namespaced rules or mixins mapped to existing selectors; importing the package must not globally restyle unrelated .btn/.button controls. Reconcile aliases deliberately, not by a global rename or design refresh.

Gates: independent specimen without app globals; actual Config/Worlds/New Game/Play/mod controls at desktop/phone, visible labels/focus/keyboard/disabled/error states and long content; compiled CSS and deterministic outputs. Existing native details and vendor inspectors may retain their behavior while consuming common structural/theme rules.

## 8. Final mod/metadata parity and remaining workflow composition

Sources: index `renderImageBadgesOverlay`, registered Thing context actions/fields, shared effect/tooltip renderers, module workbench; `docs/classes/ModExtensionRegistry.md`; Stories/Scene Illustration/module frontend adapters.

Verify the same hooks after each underlying composition: namespaced fields/defaults, zero/false/null and unknown saved IDs; badge mask/image/corner/order plus configured paths/labels; action contexts/order/server handler identity; page/tab registration and typed effect/grant content. Existing ExtensionFieldEditor, Calendar/Status editors and media/notification primitives remain the shared seams. Do not create another metadata registry, move server handlers into widgets or drop unknown persisted fields. Barter/container/craft and mod approval/generation remain transaction controllers; compose their already-shared views/actions where duplicated, without claiming the controller itself is portable.

Gates: an actual registered extension field/badge/action/page fixture through core and mod contexts; save/reopen preserves known hidden data and unsupported values fail at the authoritative boundary; Stories draft/approval/history and Scene Gallery/lightbox/job controls keep their established ownership. Finish with a ledger disposition for every remaining source family: migrated consumer or precise native/vendor/domain rationale, with evidence. No blanket single-consumer exemption.

## Recommended next cut and constraints

Start with group 1's exact template duplication and native disclosure/read-only comparison composition, then group 2. Groups 3–5 can proceed as bounded collection passes after section ownership is assigned; group 6 closes the remaining module choice/slot seam. Foundations and parity finish the cross-cutting audit without a new generic framework. All gates above are planned, not executed in this inventory. Root owns README/master; core owns package exports/build/styles and navigation; Terra owns test changes/runs. No runtime, git, server or title actions were taken for this plan.
