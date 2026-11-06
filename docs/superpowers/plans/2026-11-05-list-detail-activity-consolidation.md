# List, detail and activity consolidation

Group 5 after `e34f4c1`, covering the original audit's collection compositions.
Existing CollectionView/createCollectionEntry own rebuilt content and entry
subscriptions; host navigation and domain state remain authoritative.

Verified with Group6: nineteen distinct Chromium cases and twenty-nine affected
Node cases pass. The strengthened history case crosses the 250-entry boundary;
supplemental crafting touch/lightbox tests invoke actual host callbacks directly,
with the physical-gesture limitation recorded in [Playwright verification](../../playwright.md).

1. Faction/Favorites/Catalogue: faction selection/standings/emblems; favorite
   eligibility/current location/route times/travel; Catalogue 60-row paging,
   recorded values, variants and mobile Back focus. Release old action and image
   bindings; invalidate final-page UI continuations while keeping cached pages.
2. Worlds profiles/Lorebooks: preserve Worlds delegated profile/draft selection,
   search/sort/applied markers, and Lorebooks filename selection, enable/delete
   transactions and first-50 entry preview. No shared navigation policy invented.
3. Stories library/activity: preserve archive/search/sort, read-only/source labels,
   job/proposal/run authority, explicit review actions, polling, scope ownership
   and remembered native disclosures. Reuse content ownership, not job transport.
4. StoryTools: own page/history, scene summary, mystery thread/box/mention content
   and actions; keep search/highlights/type filters/page indices, selected IDs,
   detail fields and request freshness in the app.

Gotchas: detached old controls must be inert immediately; committed operations
remain valid across ordinary rebuilds; stale queries/final unload cannot paint
new owners. Native HTML escaping, empty states and original grid/display policies
must survive wrapper-free adoption. Lorebooks uses mixed CRLF: edit byte-preserving
bounded blocks. Scalar detail tables/forms and read-only prose remain native host
content; actual repeated list/variant/action content still adopts shared ownership.

Terra owns real consumer/filter/paging/selection/rebuild/final-hide gates and records
accepted evidence in [Playwright verification](../../playwright.md). Root owns
README/master/commit; core owns package/build/style integration and separate group6.

## Implementation notes

All four subgroups above are source-ready. LibraryCollections.md records the
actual source/ownership matrix. Catalogue owns its result and rarity button
collections; fixed native detail values/tables remain host presentation. Stories
owns only library/activity content, including nested repeated jobs/proposals;
suspended dialog DOM and drafts remain untouched. Template-produced nodes use an
explicit live-document adoption boundary, preserving strict library validation.

Lorebooks byte-preserving edits retain untouched mixed newline segments. Its
latest list/detail reads cannot repaint superseded selections; delete captures
its target and does not clear a different current selection. StoryTools owns
seven existing content roots (page/history/scene/thread/box/mentions/type choices)
with independent freshness counters for reads and abortable entry actions.
Submitted save/enable/delete/travel/job operations retain host completion policy.

Syntax passed for all three changed standalone scripts and rendered Play/Worlds
inline scripts. Focused browser evidence is in progress with Terra; accepted
results will be linked above rather than inferred from source readiness. No
styles or new package APIs were required. Remaining foundations/parity and core's
separate group6 still have their own acceptance gates.
