# Action collection consolidation

Scope: remaining-reader routing group 3, after `44a60f3`. Existing CollectionView
and createCollectionEntry own ability/skill and TechniqueSidebar discipline/card
content. ModelessChooser, ActionImages and the native card markup/theme remain.
No new package widget or domain renderer is introduced.

## Implemented boundaries

- `views/index.njk`: render/show/close player ability and skill lists, associated
  collection declarations and final-page ownership; ability tooltips use explicit
  control ownership plus per-entry abort signals.
- `public/js/techniques.js:TechniqueSidebar`: discipline/card collections, owned
  delegated subscriptions/retry action, close/rerender cleanup, request/revision
  and final-unload guards. Existing sorting, source/cost/availability formatting,
  catalogue invalidation, T shortcut and composer insertion are retained.
- `public/js/action-images.js`: idempotent subtree disposal over the existing
  observers, per-icon menu subscriptions, PopupDismissal and ImageFrame. Page-local
  entity metadata/promises/jobs retain their existing demand and transport policy.

Ability-name insertion, skill ranks, technique source selection/previews and
mandatory selection blocking remain domain behavior. The authoring TechniquesPanel
is distinct: its editor mutations, catalogue revisions and previews are not the
sidebar's modeless insertion collection. Native image details retain their browser
keyboard/open behavior. Persisted hides retain owners; final unload suppresses
obsolete UI continuations without cancelling committed domain work.

## Verification

Source is frozen. Terra verified actual ability/skill/technique insertion, ranks,
costs/source presentation, former card/icon controls after rebuild and close,
image demand/cache completion, tooltip ownership, chooser focus and cached versus
final-hide continuations. Group 3 and concurrent group 4 passed 11 distinct
Chromium cases and 19 Node checks; exact commands/artifacts are recorded in
[Playwright verification](../../playwright.md). The initial skill fixture issue was
an inconsistent authoritative ability-selection snapshot, corrected in the test;
no production skill-policy change was needed.

Core owns final shared builds/rendered syntax. Root owns README/master integration
and commits. Remaining reader/collection/foundation routing groups stay open.
