# StoryAuthoringRunner

`public/js/story-authoring.js` owns the Story Authoring panel on Play. The existing
[controller contract](StoryAuthoringController.md) remains authoritative for run
ownership, decisions, request claims, narrative answers, checkpoints and settlement.
This document covers the bounded UI composition and lifetime migration (L03 of the
[full widget disposition](../../../docs/superpowers/plans/2026-11-05-full-widget-disposition.md)).

## Native composition

The runner composes the existing `AIRPG_WIDGETS` application exports from
`@ui-widgets/dom`: `createDisclosure` supplies the native Story Authoring details,
`createField` supplies the labelled goal/notes textareas, `ActionGroup` owns the
Start/Pause/Resume and reviewed-checkpoint manual actions, and `StatusSurface`
updates the existing run/save announcements. Original IDs, classes, labels,
readonly/disabled predicates, Ctrl+Shift+P and native disclosure keyboard behavior
remain intact. Save, Undo and the ability-modal handoff use explicitly owned native
listeners; they do not acquire a new busy policy or request serializer.

Latest action and completion reason stay literal text in the existing definition
list. Reviewed direction, receipt text and actual-outcome links stay domain content.
The checkpoint action group retires each replaced manual button's listener, so an
old detached action cannot switch the current packet. No shared schema, transport,
actor controller, new connection or polling owner is introduced.

## UI and departure ownership

One `AbortController` owns the runner's input/button/keyboard and pagehide
listeners. The runner retains both unregister functions returned by the native
player-input and ability-selection hooks. Its existing ability-modal observer
still moves the same panel back to its original anchor when the modal closes.

Every pagehide, including a persisted history-cache hide, invokes the original
`leave` policy: request a pause locally, clear the existing heartbeat and polling
timers, close the existing handoff channel, and send the existing pause beacon if
a run is owned. There is no pageshow reconnection or automatic poll/channel
restart. A settled cached runner therefore returns with its UI available and its
background polling/channel stopped. Existing pending domain operations retain
their persisted-hide behavior; the final-disposal start guard described below
does not change a pending start across a persisted hide.

A persisted hide retains the UI hooks, observer, keyboard binding and widget
owners so this same cached document remains interactive. The pagehide listener
remains registered for a later final departure. A non-persisted hide additionally
calls idempotent `disposeUI`: abort native UI listeners, unregister input/ability
hooks, disconnect the observer, destroy action/status owners and remove the panel,
its anchor and the ability handoff button. This is UI cleanup; server leave/pause,
lease, actor loop and submitted-work settlement remain domain responsibilities.

Pending refresh/save/packet results cannot access destroyed widget owners or
reinstall the panel. Handoff replies verify that their original channel is still
owned before posting. If final departure occurs during a settings request before
Start, that request settles without submitting a new Start. If Start was already
submitted, its returned run is paused without installing a heartbeat, actor loop
or ability UI in the retired document. Existing final state refresh still runs.
Errors retain their original details and logging; a retired document does not
open new error popups.

## Verification ownership

The coding check is `node --check mods/story-authoring/public/js/story-authoring.js`.
The isolated verification owner exercises actual manual/reviewed controls,
checkpoint return, native input/ability interception, Undo, cached/final cleanup
and pending continuations. The migration does not restart the game server or load
a save; see the controller document for its existing isolated integration commands.

Six Chromium cases pass: five actual-controller cases use mocked host/protocol
services; one renders real Play/Chat and verifies both hook lifetimes. They cover
checkpoint/manual drafts, input/ability/Undo, keyboard/observer movement, cached
and final hides, and delayed start/state/settings/packet responses. Final startup
installs neither heartbeat nor decision loop. These cases do not run an LLM or
prove the backend actor loop. Focused source review found no introduced defect.
Exact artifacts are in [Playwright guidance](../../../docs/playwright.md).
