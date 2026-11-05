# NativeDialog

[`packages/ui-widgets/src/native-dialog.js`](../../packages/ui-widgets/src/native-dialog.js)
exports the portable native `<dialog>` lifecycle. The generated
`public/js/widgets/overlays.js` adapter registers `AIRPG_WIDGETS.NativeDialog` and
loads through the shared head before PageFeedback/New Game. Build it with
`npm run widgets:build`; edit package/adapter source, not the generated bundle.

Construct with the existing root and `{returnFocus, onClose, removeOnClose}`.
`open({initialFocus, returnFocus})` preserves the native top layer and captures its
focus target. `close(returnValue)` returns false while pending. `setPending(boolean)`
updates `aria-busy` and prevents native Escape cancellation; it does not disable
fields or start/cancel requests. Direct native `root.close()` remains supported.

`whenClosed()` waits until the current native close lifetime finishes, or resolves
immediately when none is active. Class-owned waiters also settle on destruction
and are safe when a host close listener registered before the controller asks for
the promise during that same close dispatch. This allows reusable-root adapters
to wait for the queued close before reopening without losing later requests.

On native close, the host callback runs first, then focus returns to the original
control or its same-ID replacement. Transient feedback roots use `removeOnClose`
to remove/dispose after closing; New Game retains its roots for later use. Native
close events are queued, so reopening before the preceding close event completes
throws a clear error. Idempotent `destroy()` closes and releases listeners and
references without invoking host close cleanup or adding focus work. Other methods
reject use after disposal.

PageFeedback retains content/error generation, its native-element return value and
dialog bookkeeping. New Game retains pending control state, request epochs,
AbortController invalidation, snapshot/list validation and commit rules. Custom
Play overlays and modeless windows keep their existing lifecycles.

Technique and ability-attachment native editors now delegate pending cancellation,
close/removal and focus restoration while retaining disabled snapshots, drafts,
actor revisions and successful commit rules. Item charge reload adopts one reusable
controller: generation is reserved before `whenClosed()`, so a superseded opening
cannot install its UI after a newer request. Charge payment/replay and control
state stay local. Log Viewer's native error root uses the same lifecycle while
retaining file-request diagnostics.

See the [package README](../../packages/ui-widgets/README.md) for direct ESM use and
the app-free specimen, and [modals_overlays](../ui/modals_overlays.md) for consumers.
