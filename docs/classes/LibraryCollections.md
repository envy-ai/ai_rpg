# LibraryCollections

Native application collection adapters compose
[CollectionView](CollectionView.md), preserving their existing markup and host
selection, validation and transport policies. They deliberately retain rebuilt
rows rather than imposing keyed identity where the original renderer rebuilt.

| Consumer/source | Shared ownership | Host authority retained |
| --- | --- | --- |
| Play `initFactionPanel:renderList` | Native list buttons, abortable selection, emblem ImageFrame disposal | Faction IDs/order/selection, standings, relation/editor forms, emblems and server refresh |
| Play `renderFavoriteLocations/buildFavoriteLocationCard` | Native card rebuilding, stale travel action disposal | Favorite/visited/non-stub eligibility, current disable, route time, location cache and travel confirmation |
| `ItemCataloguePanel` | Paged result and rarity-button collections | 60-row paging, filters, saved generations/variants/recorded values, detail focus, mobile Back/Escape |
| Worlds `renderSettingsList` | Original profile cards and empty state | Delegated selection, retained draft/editor state, search/sort, selected/applied IDs and badges |
| `lorebooks.js` | Book/checkbox actions and first-50 preview entries | Filename IDs, selection, enable/delete/upload transactions, stats/preview formatting |
| Stories `renderLibrary/renderActivity` | Native library cards, jobs/proposal content and section teardown | Search/archive/sort, delegated actions, remembered details, job/run scope and polling, review/pending authority |
| Play `initStoryToolsPanel` | Page/history cards, scene/thread/box buttons, mention rows and native type options | 250-entry pages, filters/regex/highlights, selected IDs, history edit, detail fields/save validation |

Each list with direct actions owns per-entry abort signals. Delegated Worlds and
Stories controls become inert when detached because they no longer bubble to the
owning root. Parsed markup is explicitly adopted into the live document. No new
layout wrappers or package-level schemas are introduced.

Existing request IDs are retained, and newly owned read paths reject obsolete
responses before repaint. StoryTools has separate history/scene/thread/box request
epochs; selecting a different thread also invalidates a previous box read.
Lorebooks keeps list and selected-detail reads separate. Touched Play reads and Lorebooks retain parser and server stacks through
PageFeedback alongside their existing inline error state.
Native required/quote validation stays at its original field/status boundary.

Final pagehide destroys display owners and prevents late UI writes; cached hides
retain them. Submitted mutations and image jobs are not cancelled by ordinary
rebuilds. Scalar detail forms/tables/prose remain native host rendering: they have
no list identity, while repeated variants/actions/rows use the shared lifecycle.
Stories suspended forms/dialogs are outside these display roots.

Verification commands/artifacts belong in [Playwright](../playwright.md); the
[implementation plan](../superpowers/plans/2026-11-05-list-detail-activity-consolidation.md)
records scope and completion evidence.
