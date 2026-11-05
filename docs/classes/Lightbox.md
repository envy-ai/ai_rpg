# Lightbox

`packages/ui-widgets/src/lightbox.js` adopts an HTML viewer with supplied
`{inner,media,image,caption,details,actions,closeButton,onError,canHandleKeys}`.
Elements must belong to its root; image/details may be omitted for the supported
single-pane roles. The package owns its SCSS; main.scss includes the same mixin
at the former rule location so app cascade and desktop/mobile geometry remain.

`show({src,alt,caption,detailsHtml,actions,trigger})` retains the existing image,
details-only and combined modes. Trusted details markup remains caller supplied.
`hide()` clears content/actions, aborts active keys and restores the trigger.
`isOpen` reports visible state. Queued focus work checks the current show generation
and preserves existing focused descendants. Tab does not dismiss or introduce a
trap. Other keys dismiss except Enter/Space on interactive controls. Bubble routing
respects prevented events, actual native `:modal` ownership and injected
`canHandleKeys(event)`; popup capture therefore wins regardless of installation
order.

Actions require `{id,label,handler}` and may supply `disabled`, `disabledReason`,
`closeBeforeRun`, `closeOnSuccess` (default true). Their controls lock while pending.
The handler receives `{action,button,hide}`. Only its current show generation may
hide on success or through the supplied hide callback; a slow previous action
cannot close a newer viewer. `onError(originalError,{action,button})` injects host
error presentation. Current failing controls become available after the error hook.
App errors use persistent PageFeedback with the original stack and appropriate
return focus, rather than browser alerts.

`bind(element,provider)` supports existing thumbnail/data attributes and returns an
idempotent binding disposer. Binding again updates the provider. WeakMap records
and WeakRef trigger references avoid retaining detached historical thumbnails;
owned listeners abort on binding or service disposal. ImageFrame returns each
binding disposer during image replacement. Scene Illustration gallery/message
images retain their existing bind composition. `destroy()` clears the viewer,
aborts its permanent/active/action subscriptions and releases bound triggers.

`public/js/lightbox.js` is the app adapter and retains `window.lightboxController`.
Its key predicate compares actual media/custom z-index and DOM ordering using the
existing app resolver. ModalStack's injected `canHandleKeys(root,event)` yields
only when media is above that custom owner. Higher custom/native owners retain
keys; lower custom forms cannot consume the lightbox's special keys or ignored
Tab. The responsive header uses the same app predicate. This adds no modal lock,
trap, new placement bounds or domain behavior. Independent modes/actions and
bindings are demonstrated in `examples/collection-media.js`.

The app's pagehide adapter skips persisted back/forward-cache navigation and keeps
its cleanup subscription until a real unload. The cached document retains the
same live viewer and thumbnail bindings. The independent specimen follows the
same boundary for all its widget controllers.
