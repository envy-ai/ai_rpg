# CollectionView

`packages/ui-widgets/src/collection-view.js` exports presentation for records the
caller already selected. It does not know item schemas, filters, sorting, request
ownership, equipment or persistence.

`new CollectionView(root,{empty,count,modeClasses,classNames,disposeContent})`
adopts existing HTML. `modeClasses` maps CSS class names to supported mode arrays;
`classNames` optionally supplies table/head/headerRow/body chrome. Defaults use
portable `collection-table`; package SCSS styles an opt-in `collection-view` root.
`disposeContent(root)` releases explicitly owned nested presentation before DOM
replacement. Each `renderItem` may additionally return an entry-specific disposer.

`render({items,totalCount,countText,emptyText,mode,columns,showHeaders,renderItem,
keepVisibleWhenEmpty})` updates count datasets/text, empty/visible state, mode
classes and mounted entries. `columns` supplies `{id,label,colClass,headerClass,
hiddenHeader}` for optional table chrome; the caller supplies matching row cells.
The renderer returns an HTMLElement, `{element,dispose}`, or explicit null to omit
a record. It receives the record and `{mode}`. Already selected records are returned
unchanged. `clear()` releases mounted disposers and content then removes children;
`destroy()` additionally releases adopted references and is idempotent. Multiple
disposal errors retain their original causes in an AggregateError. Captured cleanup
state tolerates disposal of the owner from an entry's disposer.

`createCollectionEntry({document,tagName,className,focusable,label,dataset})`
consolidates native entry chrome. It does not manufacture domain content or decide
which actions belong in a card. Classic/grid/table formatters retain their media,
name, slots and action presentation.

Play's existing `renderThingCollectionPanel` is the adapter: it retains sort/filter/
AI state, count wording, item caches, table columns and feature builders, then calls
one CollectionView per root. All eight existing shared call sites use that path:
module workbench, NPC inventory, barter's player/merchant sides, both container
panes, crafting, location items and location scenery. Entry construction still uses
the existing shared `buildThingCollectionEntry`; only its repeated root attributes
move into the portable builder. Per-item/session transactions and mobile drag versus
scroll remain features. ImageFrame bindings are disposed before entry replacement.
The independent example is `examples/collection-media.js`.

App pagehide cleanup preserves document-owned instances when `event.persisted`
indicates back/forward caching. That event does not consume the cleanup listener;
actual later unload still disposes the owners. Cached restoration therefore keeps
both DOM content and the WeakMap's live renderers without a fallback remount.

Choice surfaces also compose this content lifetime: entity search buttons, native saved-game options, New Game saved-form radio cards, mandatory ability cards and stack keeper cards. Hosts retain selection/commit/cardinality and async policy. Native option/list hosts explicitly keep their roots visible and own empty placeholders; per-card disposal releases their action/tooltip subscriptions. See [ChoiceSurfaces](ChoiceSurfaces.md).

Play's modeless ability and skill lists also use CollectionView and native entry
chrome. Ability cards retain their tooltip formatting and per-card listeners;
disposal aborts them and hides only that card's explicitly owned tooltip. Skill
ranks/order and bracket insertion remain host rules. The ability grid still hides
when empty; the skill grid retains its original visibility. Closing clears cards;
reopening renders fresh choices. Pending ability-name refreshes are revision and
page-lifetime guarded. See [TechniquesPanel](TechniquesPanel.md) for the equivalent
technique/discipline collection ownership and [ActionImages](ActionImages.md) for
nested icon cleanup.
