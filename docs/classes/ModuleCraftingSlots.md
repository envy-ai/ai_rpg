# ModuleCraftingSlots

`views/index.njk:renderModuleWorkbenchSlots/renderCraftingSlots` compose the actual
fixed-index slot roots with CollectionView. Item/source/slot compatibility,
installed backlinks, resource assignment, unequip and station context remain app
policies. These roots are not free-form repeaters and introduce no slot framework.

Root drag/drop/double-click subscriptions belong to each entry. In-place crafting
preview replacement separately releases child remove/tooltip/image/lightbox
bindings before rebuilding. Thing tooltip disposal supplies explicit preview
identity, preserving newer unrelated tooltips; legacy tooltip calls keep their
original unowned behavior. Close clears entries; final unload destroys views and
settles pending module choices; cached hide retains live owners.

Workbench operations capture their originating session for local status/busy/slot
writes. Committed page-live responses still refresh global state and surface
original errors after an ordinary close/reopen. Craft initialization/unequip and
retained lightbox actions reject or ignore obsolete local session writes. Request
IDs, payloads, transaction validation and per-operation concurrency remain local.

`chooseModulesContextCandidate` preserves zero/single/multiple candidate semantics
through the shared search chooser. Cancel/Escape/backdrop/replacement keeps the
original `Choose a valid …` error; no candidates keeps `No compatible … found.`.
The selected shell closes before the chosen record resolves to request preparation.
