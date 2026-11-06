# ModManagerUi

The DOMContentLoaded adapter in `views/mods.njk` retains the server-rendered native
configured-enable checkbox form. Explicit Refresh and Save replace row snapshots
through CollectionView; active runtime flags, mod.js/defs metadata and the
restart-required warning remain host content. StatusSurface adopts existing
info/success/error classes. Saving changes configuration only; it does not restart
services or add a global pending lock.

GET refresh generations ignore superseded snapshots. Successful PUT completion is
page-owned, replaces the authoritative configured state and invalidates older
reads. Native checkbox values remain the submitted IDs. Parser/API errors retain
original details and server stacks in persistent PageFeedback and inline status.
Final pagehide releases view, status and listeners and prevents late UI writes;
cached navigation retains the live document. Initial server markup is adopted
without a redundant startup fetch or rerender.

The [shared local LLM header](ManagedLocalLlmController.md#header) is a separate
controller: its transition state and polling belong to the existing service API.
See the [scope plan](../superpowers/plans/2026-11-05-debug-mod-controls-consolidation.md).
