# Module choice and fixed slot consolidation

Group 6 of the [remaining reader routing](2026-11-05-remaining-reader-collection-foundations.md),
following checkpoint `e34f4c1`. Implemented and verified with Group5: nineteen
distinct Chromium cases and twenty-nine Node cases pass across the combined slice.

`chooseModulesContextCandidate` currently throws `No compatible ${label} found.`
for zero candidates, returns a single candidate directly, and uses a numbered
native prompt for multiple candidates. Cancel, blank and invalid numbers all throw
`Choose a valid ${label}.` Preserve this cancellation error contract in the existing
search-selection shell: valid native option buttons commit a candidate; Cancel,
Escape/backdrop or replacement reject the same error. Close the shell before
resolving the selected record. All three already-async module request-preparation
branches await it and retain exact item/source/slot IDs, filtering and payloads.
Server revalidation remains authoritative while a nonblocking chooser is open.

`renderModuleWorkbenchSlots` and `renderCraftingSlots` compose CollectionView with
per-entry drag/drop/remove subscriptions. These are fixed indices, not editable
rows. Crafting's in-place preview replacement additionally releases its old child
listeners, tooltip owner and ImageFrame before rebuilding. Reuse current markup,
classes, source previews, occupied slots and assignments; create no generic slot
controller or station chooser. Existing Thing tooltip binding uses explicit owner
identity for safe disposal, as other card collections already do.

Close clears owned slot entries, final unload destroys them, and cached hide keeps
them live. Workbench async status/busy/slot updates capture the existing session
object so closing/reopening cannot redirect them into a different base item.
Committed requests/global refreshes remain host-owned. Craft initialization and
async unequip similarly ignore obsolete modal-session writes. No new transport,
polling, clamp or global pending lock is introduced.

Core owns the bounded index choice/preparation/workbench/craft slot functions and
shared helper integration; Group 5 independently owns Faction/Favorites/StoryTools
and standalone libraries. Fresh index writes are coordinated. No package API or
parallel renderer is expected. Original failures from touched request paths retain
Error/JSON/server details in existing persistent PageFeedback.

Terra gates: single/zero/multiple compatible candidates for install/remove; filter,
selection/cancellation and exact payload sources/IDs; no duplicate transaction on
stale controls; occupied/type-incompatible slots and fixed indices; normal/touch/
lightbox assignment and equipped-item unequip behavior; rerender/remove/close image
and tooltip disposal; retained station/source context; pending close/reopen and
cached/final unload boundaries. Existing collection/media portable evidence is
retained; new primitives or a parallel specimen are unnecessary.

## Implemented source register

The three request-preparation branches now await shared selection. Both actual
fixed-index roots use CollectionView, with explicit crafting preview replacement
and owner-safe Thing tooltip/image cleanup. Close clears entries, final hide
settles open module choices and attempts all view cleanup, cached hide retains
owners. Session guards apply only to obsolete local writes; page-live committed
global refresh and error reporting continue. No new package API or style was needed.

The coordinator added Scene Gallery's remaining card lifecycle to this checkpoint.
Its actual `renderGalleryGrid/createGalleryCard` now compose SnapshotList: full
fetches still clear/rebuild, while deleting one card retains neighboring native
nodes/focus. Each entry owns hover/delete/lightbox subscriptions; retired cards
cannot act. Fetch generations prevent older UI responses overriding newer loads;
deletes remain page-owned across entry replacement and still refresh chat/notices.
Final disposal suppresses late UI and destroys the view, while cached hide keeps
it live. Original error/server details reach persistent PageFeedback alongside
inline errors. No gallery layout or generation request policy changed.

Terra additionally checks Gallery full refresh, stale retained controls/lightbox,
single deletion with a neighbor focused, deletion finishing after rerender, native
error details and cached/final teardown. The later foundation/mod parity register
still includes Debug gallery and static readers; they are not declared exempt by
this migration.

## Frozen build/source evidence

After Group 5/6 and Gallery froze, widget/main/settings builds passed twice and all
fourteen generated JS/CSS/map/template files rebuilt byte-identically. The browser
plausibility asset still exactly matches its canonical source. Sixty-seven relevant
modules passed syntax checks; Play and Worlds render with both inline scripts
parsed, and each shared constructor asset occurs once. Behavioral evidence is
aggregated by the coordinator from Terra's focused runs; coding agents ran no tests.

Focused review identified delete/GET overlap: the pre-delete response could restore
an already-deleted card while the current jobs array was cleared for loading. A
successful delete during the current load now starts one post-mutation refresh and
invalidates the older generation. Ordinary single deletion still retains neighbor
identity/focus. No tombstone persists beyond a snapshot and no polling/lock is added.
