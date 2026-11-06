# Structured reader consolidation

Group 1 of the [remaining-family routing plan](2026-11-05-remaining-reader-collection-foundations.md), released after navigation checkpoint `c8d23be`. Runtime is frozen. Group 2's selectable text/Log work is independently owned by core.

## Implemented boundary

Portable `structured-details.js` supplies native disclosure chrome, an unparsed host-HTML disclosure bridge, ordered host-formatted field comparison and read-only value projection. Core integrated exports/classic adapter, isolated specimen and independent structural styles; Stories passes its original class map. No selection/schema/diff engine or new keyboard/open-state controller was added.

Actual consumers:

- Chat `buildCollapsibleDetailsMessageElement` remains the shared app adapter for skill/attack/plausibility/slop wrappers, timestamps and bubble decoration. Only native disclosure chrome is lower-level; body interpretation stays local.
- TurnStateDiffDrawer grouped need/disposition native details uses the same builder. Normalization, deduplication, severity, ordering, elapsed time, entity/exit routing and the distinct outer button-controlled section remain unchanged.
- Stories `details` retains remembered `data-disclosure` keys/open Set and its existing delegated toggle handling. Host body HTML is appended without parsing, preserving embedded field markup and leading newlines.
- Stories `diffHtml` still computes the before/after key union/order, JSON equality, labels, pretty values and `Empty` decisions. The portable renderer consumes those already-formatted rows. Source/buffer conflicts and suggestion review still require explicit accept/merge.
- Stories `projectionHtml` retains its root no-source decision and host labels/nullish formatting; the portable helper only builds literal lists/dl/text. Editable reviewed documents, generation/approval and saved/live source authority do not move.

Native details is retained because it already owns activation, focus and open state correctly; factory sharing removes repeated chrome construction without replacing browser behavior. Debug's existing pretty-json vendor inspector is untouched. The Turn outer section has a different header/disabled composition and remains a thin native-button app binding rather than being forced into the field comparison or native details factory.

## Plausibility template authoring trace

Before this slice, `views/popups/plausibility.njk` and `public/templates/plausibility.njk` were byte-identical independently editable files. Chat explicitly uses a Nunjucks WebLoader at `/templates` and renders `plausibility.njk` from normalized structured data.

The trace checked server.js's `nunjucks.configure('views', {autoescape:true, express:app})`, named UI routes, API UI render sites and generic mod-page rendering. ModLoader's registered-page environment searches mod views then core views and renders `mod-page.njk`, which includes `page.template`. No dedicated built-in popup route or direct server plausibility include was found in those paths. This does not justify deleting a resolvable core template or inventing a compatibility route.

`views/popups/plausibility.njk` is now the one authoring source. `scripts/build-ui-widgets.mjs` explicitly copies its exact bytes to the existing `public/templates/plausibility.njk` browser asset. No banner/newline, endpoint, loader/cache or rendered data contract changes. Both existing paths remain; builds enforce the deterministic source→asset boundary.

## Verification

All five worker-owned JS/module/example syntax checks passed. Core's final widget/main/settings builds ran twice with 14 byte-identical outputs, including the exact template copy; its broader module/template/inline checks passed. The focused critic found no actionable issue.

Terra's **5 distinct Group 1 Chromium cases and 33 Turn adapter cases passed**, including native details keyboard/open behavior, ordered zero/false/null/escaped values, unparsed nested textarea leading LF, history/live/insight parity, grouped turn construction and retained Stories draft/conflict/proposal/projection rendering. The adapter cases retain normalization, routing, severity and count coverage. The first browser Turn fixture used zero delta, correctly omitted by existing policy; the fixture was corrected to nonzero changes without production changes. Final combined reader commands, strengthened assertions and artifacts are maintained in [Playwright verification](../../playwright.md).

Transport, prompt, server, persistence and vendor-inspector behavior remains with its existing owners. Root owns README/master/commit; Terra owns tests; core owns shared build/styles and Group 2.
