# Health, need and vehicle fill consolidation

L07 of the [full widget disposition](2026-11-05-full-widget-disposition.md).
Source implementation and isolated real-consumer verification are complete below.

## Native investigation and scope

The existing portable `ProgressMeter` accepts a contained fill and an already
computed finite fraction. It owns the width assignment and optional state classes,
with a WeakMap and `data-progress-meter` marker for explicit cleanup. It adds no
listeners, timers, polling, observers, application imports or required styling.
This meets the existing contained-fill semantics without a new package option.

Actual callers in `views/index.njk` now use this native primitive:

- `updateHealthBar` covers the persistent player sidebar and health bars created
  by `buildEntityPortraitContent` for location NPCs/sidebar party, plus the Party
  tab's separate portrait markup using the same updater.
- `renderNeedBars` covers player, location NPC, sidebar party and Party tab needs,
  including direct need-editor refreshes.
- The existing vehicle-header render/clear closures in `updateLocationDisplay`
  use the same primitive for their contained travel fill.

All domain calculations stay in the host: health's existing unknown/negative/max
handling and bounded ratio, upward-rounded readouts and ARIA; needs' existing
min/max/value normalization, bounded ratio and rounded readouts; vehicle's existing
finite/bounded trip fraction, countdown, labels and CSS icon-position clamp.
Health/need percentages still round with `toFixed(1)` before conversion to a numeric
fraction for `ProgressMeter`; CSSOM retains the equivalent displayed percentage.
The migration adds no numeric clamp. Existing colors, markup/classes, width
transitions, health-change animation and portrait condition/variant overlays stay
unchanged. These are read-only indicators, so no new keyboard control is needed.

Tracker progress remains a whole-card CSS gradient, with different presentation
semantics. Native item-charge `<progress>` retains browser semantics. Neither is
converted to a contained-fill controller solely to reuse a class.

## Ownership and implementation sequence

1. Reuse `ProgressMeter.attach(root, {fill}).update({fraction})` through a narrow
   host helper; keep existing normalized/rounded percentages and all domain text.
2. Destroy owned meters before known DOM replacement: need roots, sidebar party,
   location NPC normal/empty/no-location rendering, and the Party tab. Explicit
   `removeNpcCards` paths release meters before removing cards.
3. On non-persisted pagehide, destroy meters only in the six resource roots:
   `chatPlayerHealthBar`, `chatPlayerNeedBars`, `chatPartyMembers`, `locationNPCs`,
   `partyMembers`, and `locationVehicleCurrentLocationProgress`. Retire that hide
   listener and prevent late display continuations from creating fresh meters.
   Persisted hides retain the current owners. Other prompt/image meters keep
   their existing owners and cleanup policies.
4. Render the Play template and syntax-check its inline script, then hand actual
   browser behavior to the isolated verification owner. No package API, build
   output, SCSS, server process, save or transport changes are required.

Weak ownership already permits collection of detached dynamic roots. Known
replacement/removal boundaries provide explicit retirement without introducing a
new observer, a historical-root registry or recurring detach scan.

## Verification

Nunjucks rendered `views/index.njk` with explicit portrait dimensions and message
history configuration. Its one inline script passed `vm.Script` syntax checking;
rendered output is `tmp/resource-meters.index.rendered.html`.

Browser acceptance must exercise actual health/need/ETA consumers, fractional and
zero/unknown readouts, existing numeric bounds and colors, update/rebuild cleanup,
cached/final departure and late continuation ownership. The coding agent did not
execute tests or restart any server. Test evidence is recorded by the coordinator
once the isolated verification owner completes this gate.

Two distinct real Play Chromium cases pass. The player/vehicle case verifies
fractional health/readout rounding, need values/ARIA, unknown clearing, ETA fill/icon
and nonvehicle reset. The NPC/Party case exercises location NPCs, sidebar Party
and Party tab, zero values, death styling, replaced meter retirement and cached/
final ownership. Drain indicators and health animation retain their original source;
these two cases do not claim a dedicated runtime animation/drain scenario. Existing
portrait/image evidence remains valid. Artifacts: `tmp/resource-meters-final-results`
and `tmp/resource-npc-party-pass-results`. Focused source review found no introduced
defect. No package/style/build inputs changed from the verified foundation assets.
