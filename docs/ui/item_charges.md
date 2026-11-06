# Item charges and reload UI

Reload's native lifecycle delegates to [NativeDialog](../classes/NativeDialog.md).
Opening over an earlier reload waits for its queued close, with generation reserved
before waiting so only the latest request can install state. Source/amount/payment,
operation replay and host disabled controls remain in the charge controller.

The Play item editor in `views/index.njk` edits loose `ammoType` and an optional `chargePool`. Charge mode, current amount, capacity and unit define a pool; initial amount, compatible ammunition type and cost per use remain optional. Blank optional numbers are omitted and zero is preserved. Clearing the mode sends `chargePool: null`; clearing loose ammunition type sends `ammoType: null`. Charged items are individual items, while loose ammunition uses stack count.

Item cards show current amount and capacity. Thing hover and lightbox details include a native progress gauge, mode, ammunition type and cost per use where present. A discrete ammunition item in the player inventory exposes **Reload** in its context menu. Dropping loose ammunition onto that item opens the same dialog before generic item transfer. On phones the dialog's source cards provide tap selection. Continuous pools are edited manually and have no Reload action.

`public/js/item-charges.js` owns the native `#itemChargeReloadDialog`. It reads `GET /api/things/:id/reload-options`, marks incompatible ammunition unavailable, lets the player search/select a source, enter a discrete integer amount, and previews the resulting loaded and loose amounts. It submits `POST /api/things/:id/reload` with `ammoItemId`, `amount` and `operationId`. An unchanged retry keeps its operation ID; changing the source or amount creates a new operation on the next submission. The dialog preserves errors and the original stack, blocks dismissal while pending, supports Escape and Ctrl/Cmd+Enter, and restores focus to its trigger. Success refreshes inventory and technique displays.

`public/js/techniques.js` supports `charge` in cost and failed-cost editors, with `grantingItem` or `ownedItem` binding and an owned item ID where required. Resolved cost labels show the exact item, mode unit and amount. `public/js/chat.js` renders charged item before/after values in technique receipts. The styles live in `public/css/main.scss`; compile `main.css` with `npm run scss:build:main`.

The source list now composes CollectionView with explicit per-entry click/drag
subscriptions and StatusSurface preserves the original text/data-kind/hidden
presentation. Filtering, selecting, closing and reopening retire old source
controls. NativeDialog queued-close ownership still reserves the latest opening
generation; an external native close also retires its prior state.

Submit continuations capture their operation owner. A committed success callback
and inventory/technique refresh remain page-owned across an ordinary native close
or a newer reload dialog, while old catch/finally paths cannot reset that newer
owner's fields or pending state. Unchanged retries retain operationId; source/amount
edits retain their existing reset policy. Cached pagehide preserves pending work;
final unload disposes source/status/native-dialog listeners and suppresses late UI
and success callbacks without canceling the server operation. Original request,
parser and server errors retain inline details and persistent PageFeedback.
