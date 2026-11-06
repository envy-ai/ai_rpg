# SceneIllustrationGallery

`mods/scene-illustration/public/js/scene-illustration.js` composes the actual Gallery
cards with SnapshotList. Full fetches retain the existing clear/loading/rebuild
behavior; a successful single deletion removes only its current card before keyed
cleanup, preserving neighboring nodes and focus. Host timestamp/prompt/status/image
markup and the registered Play tab remain unchanged.

Each card owns hover/delete handlers and native Lightbox trigger bindings. Retired
controls are inert, while requests already started remain page-owned: a successful
delete can update the current matching card and still notify/refresh chat after
its original entry was replaced. No card-local abort cancels server work. Fetch
generations discard obsolete UI responses without changing transport ownership.

Final pagehide destroys cards/bindings and suppresses late load/delete UI; persisted
pagehide retains them. Original request/JSON/server errors use existing persistent
PageFeedback and the Gallery inline error message. Generation queue jobs, metadata,
server endpoints and notifications remain the mod adapter's responsibilities.

A committed delete overlapping the current gallery GET invalidates that pending
snapshot and starts one post-mutation refresh. The older request generation cannot
restore the deleted card. Ordinary deletion keeps its in-place neighbor-preserving
path; no permanent deleted-ID filter, polling or transport lock is introduced.
