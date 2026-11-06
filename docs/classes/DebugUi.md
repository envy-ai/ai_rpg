# DebugUi

`public/js/debug-ui.js` adopts `/debug`'s existing dynamic image/save controls at
DOMContentLoaded, after shared widget registration and PageFeedback. Its template
keeps the injected JSON console report, static statistics, native disclosures,
readonly output and vendor `pretty-json` inspector. These native/vendor readers
have distinct semantics and do not need a parallel library controller.

Generated result history uses SnapshotList to append cards while retaining previous
nodes/full-size links. Recent images (six maximum) and save rows use CollectionView;
entry replacement releases image frames and local action listeners. Recent cards
fill the generator form on click, Enter or Space; they do not open Lightbox. Empty
recent responses retain the existing snapshot policy. Save rows preserve exact
save names, native delete confirmation, client ID payload and explicit load/delete
requests. Requests remain page-owned across ordinary list replacements.

ImageFrame owns image listeners, BusyButton adopts existing image/portrait busy
states, and StatusSurface presents save/image text with host-owned palettes and
native line breaks. ProgressMeter receives the job's fraction, including zero,
without clamping. The controller retains the existing initial 1s delay, 2s polling
cadence, 60-attempt bound and retry-on-status-error policy. It preserves explicit
load (2s), portrait (3s) and completed-image (1s) reload delays. There is no second
job connection, server cancellation or new save-action pending lock.

Final pagehide cancels timers and disposes collections, frames, meters, surfaces,
busy controls and listeners. Cached pagehide preserves the live document. Late
requests cannot repopulate final-disposed controls or schedule reloads. Original
parser/request/server errors keep their stack in persistent PageFeedback, together
with existing inline feedback; repeated identical poll errors are deduplicated.
Portrait/check-image template callbacks remain page-level entry points; removed
inline save-row callbacks are replaced by explicitly owned native listeners.

See the [scope and verification plan](../superpowers/plans/2026-11-05-debug-mod-controls-consolidation.md).
