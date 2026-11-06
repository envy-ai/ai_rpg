# ItemCataloguePanel

`public/js/item-catalogue.js` implements Play → Story Tools → Item Catalogue.
Its server-rendered shell is `views/_includes/item-catalogue.njk`; authoritative
styles are `public/css/_item-catalogue.scss`, included by `main.scss` and compiled
to `main.css`.

## Collections and mechanics

The default **Remembered items** collection lists stored observed definitions.
**Standard families** lists canonical families and their configured inclusive
rarity ranges. Neither view claims player discovery, current ownership, surviving
quantity or learned recipes. Catalogue records have no archived images.

Search requires all space-separated words to match names, descriptions, short
descriptions, properties or item type. Rarity and item type compose with that
search on the same variant; a matching family initially opens its first matching
variant. Explicit rarity buttons then allow inspecting every saved variant.
Changing a filter chooses a matching variant again. Historical unclassified or
no-longer-configured observed rarities remain searchable and readable.

Entries sort by name then stable ID. Previous/Next limits mounted rows to 60.
Remembered details label **Recorded level** and **Recorded attribute bonuses**.
Families show **Base attribute bonuses** from `unscaledAttributeBonuses` and
explain native scaling when an item is created; the UI invents no display level.
Value and weight preserve explicit zero. Full description, slot, properties,
capabilities, intrinsic/inflicted/equipper effects and direct technique grants
remain inspectable. An expandable **Definition details** disclosure preserves
remaining structural/mod metadata and technical IDs as escaped text.
Charge definitions show mode, capacity, unit, optional starting amount,
compatible ammunition type and cost per use; loose ammunition shows its type.
A missing starting amount is marked **Unknown**. The catalogue does not infer
refills or show a current charge gauge from a remembered blueprint.

`initStoryToolsPanel` supplies the existing `renderTooltipEffectSection` renderer
and a narrow preparation adapter. Missing granted-technique names hydrate through
the shared `TechniqueCatalogue.load` before rendering. Unknown references fail
with the original stack. The whole live Thing tooltip cannot represent raw family
weapons because its damage calculation requires a materialized level; the
catalogue therefore composes shared effect cards and semantic read-only tables.

## Loading and lifecycle

The panel reads [ItemCatalogueApi](ItemCatalogueApi.md) on section activation or
explicit **Refresh**. Ordinary chat-history Story Tools updates do not refresh the
catalogue, and it never polls or scans live inventories. Request serials and
AbortController invalidate superseded reads. A changed catalogue `generation`
clears old selection; normal save/load navigation reloads the page.

The existing app-header `setAirpgGameLoaded` lifecycle emits
`airpg:game-state-changed` with `{ gameLoaded }`. The panel clears data and cancels
pending reads on this event, loading only if visible. No-game, loading, empty
collection, no matches and errors have distinct persistent states. Failures use
the shared stack-bearing PageFeedback modal and retain Refresh for retry.

## Input and responsive behavior

Desktop uses a 35/65 list/detail split. At 540px and below, choosing an entry opens
the detail pane and hides filters/list; **Back to results** or Escape outside a
text control restores the preserved filtered page and selected row focus. Native
Tab/Enter operate rows and variant buttons. `/` focuses search while this section
is visible, outside editable controls and open dialogs. Search labels stay above
controls. Shared button, form, effect-card and `.data-table-scroll`/`.data-table`
contracts retain native keyboard behavior and bounded overflow.

## Content ownership

The results list and rarity-variant buttons compose CollectionView; each native
button owns an abortable subscription. Repainting, changing detail, reset and
errors release former controls immediately. No wrapper changes the direct-child
list/detail or mobile Back layout. Native facts, tables, effects and Definition
details remain host read-only presentation with their original values/escaping.

`destroy()` invalidates reads, aborts page subscriptions and disposes both result
and current variant content. Cached pagehide keeps owners alive; final unload
prevents pending fetch/effect preparation from repainting destroyed content.
