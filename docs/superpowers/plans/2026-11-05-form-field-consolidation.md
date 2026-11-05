# Form fields and editable rows

## Scope and acceptance

This slice follows checkpoint `abaa09b`. Extract equivalent native field construction and row ownership while retaining domain serializers, validation, saved IDs, null/zero/false values and existing modal transactions. No backend behavior, new numeric clamping, UI redesign or generic form framework is introduced.

The worker owns application form blocks in `views/index.njk`, the World Profiles module rows, `faction-editor.js`, `attribute-skill-allocator.js`, the new scalar extension adapter and focused documentation. Core owns package exports/build/specimens, shared script integration and compiled SCSS; collection/media index functions remain core-owned. Terra owns tests. The coordinator owns README integration and commits. Index changes use fresh reads and bounded function replacements.

## Implemented consumers

| Family | Shared mechanics | Domain policy retained |
| --- | --- | --- |
| Thing/NPC mod scalar fields | New application-owned ExtensionFieldEditor composes createField and owns current input readers | Different native type defaults; Thing top-level/metadata precedence; descriptor defaults, namespaces and special module fields; optional null, zero, false, [] and {}; path/cause-preserving validation |
| Thing metadata and attribute bonuses | ReaderRows plus labeled native fields | Metadata text-or-JSON parsing; unavailable saved attribute IDs; existing bonus parsing |
| NPC free-form skills/abilities | ReaderRows plus labeled native fields; explicit per-row listener disposal | Existing numeric policies, required short description, type styling, IDs/images and ability attachment payloads |
| NPC fixed attributes | createField plus per-render listener ownership | Fixed attribute definitions, modifier/health behavior; no free-list conversion |
| Faction asset/tier rows in Play live/create and Worlds | FactionEditor append/clear/collect methods compose ReaderRows/createField | Sparse assets, threshold/list conversion and each caller's validation messages |
| Faction fixed relations | createField only | Target identity remains fixed; Clear changes directed relation state rather than removing its row; absent edges and explicit neutral edges remain distinct |
| Worlds module slot types | ReaderRows, labeled fields and transient Add listener lifetime | Required/minimum/unique IDs, current raw draft edits, save-time validation and configured parse errors |
| Thing module type/slots | ReaderRows and labeled native selects | Equippable/module branching, clearing rules, stored unavailable IDs and minimum configured type validation |
| New Game/character attribute allocation | createField nodes placed in the existing allocator structure | Point pools, floors, rank choices, formula/help/read-only behavior stay in AttributeSkillAllocator |

Persistent modal list owners use clear through close/reopen/render; their static Add buttons do not inherit an aborted transient signal. Rebuilt module/extension subtrees explicitly destroy the previous transient ReaderRows owners. Unknown Thing module/slot IDs remain selected unavailable options. A missing module configuration may use its documented seed; malformed configuration and an explicitly empty configured list are not replaced by a hidden default. Worlds surfaces the original parse cause through its existing page feedback error hook.

Visible labels replace former placeholder-only row fields. `_form-rows.scss` scopes wrapper width/min-content and responsive layout; core compiles main/settings CSS with the partial after legacy rules. Mobile ability rows stack to prevent the old five-column grid from squeezing labeled controls.

## Vehicle choices: required next substep, planning only

The subsequent checkpoint released this substep after `d44cba0`; current implementation and verification status are recorded in the [vehicle choice plan](2026-11-05-vehicle-choice-consolidation.md). The source inventory below preserves the boundary used to authorize that work.

Source: shared `views/_includes/vehicle-info-fields.njk`; index functions `initializeVehicleDestinationEditor`, `initializeVehicleCurrentDestinationEditor`, their search/render/hide methods, `setVehicleDestinationSelections`, both async label-refresh methods, `resetVehicleEditor`, `populateVehicleEditor` and `collectVehicleInfoFromEditor`.

Both Location and Region already use the same adapter. Two equivalent input/suggestion lifecycles remain: input/focus query, matching native buttons, mousedown selection without blur, Enter choosing the first matching option, Escape hiding suggestions, and a 100ms blur hide. Empty queries/no matches clear and hide the suggestion root. Fixed-route search excludes selected IDs; current-target search does not. Matching is case-insensitive name/label substring search and displays the existing first ten results. There are no Arrow-key navigation or separate document outside handlers in these functions. Clicking elsewhere relies on blur; existing modal Escape routing remains separately owned.

The next portable seam should adopt existing native input/suggestion elements and own only query delivery, native option activation, Enter/Escape, delayed blur and listener/disposal lifetime. Matching, result cap, named-location transport and normalized option data remain injected adapters. Existing SearchableSelect creates a different select/checkbox surface and would alter the current UI; AnchoredPopup's default global active-owner/outside policy would also add behavior unless explicitly configured. Reuse an existing primitive only where its policy is equivalent. Confirm final API and specimen integration with core before coding.

Choice/token rendering can compose Repeater or the newly extracted CollectionView with caller-built token rows while the domain Map/single snapshot remains authoritative. Check their final contracts before selecting one. Keep fixed-route insertion order and duplicate exclusion, route token Remove versus current-target Clear, empty messages, pending-region entries and unresolved saved IDs. Do not use a fake serializer to make the Map look like DOM-owned editable fields.

Async named-option label refresh currently preserves unknown route entries and pending-region routes; current-label refresh requires a resolved ID. Neither existing refresh has a captured-selection check after awaiting transport. Query/close/reopen ownership must be explicit in the extracted lifetime so a late result cannot reopen a dismissed list or replace a newer selection. Preserve error causes at existing feedback boundaries rather than silently replacing failed transport results.

ETA, departure time, fixed-route target validity, new-region prompts, pending destination snapshots and exit choices remain vehicle adapters. Reset/disable clears and hides both suggestion surfaces. Clearing a current target remains explicit; saving an ETA without a destination rejects at the existing focused error. An empty ETA stays null, explicit zero stays zero. No token extraction may discard pending destination metadata or rewrite route order.

Required gates after checkpoint release: direct native suggestion ownership/disposal; actual Location and Region current/fixed-route search and Enter/mousedown/blur/Escape; duplicate exclusion and order; pending/unavailable entries through save; explicit Clear with ETA error; delayed query/label result after dismissal or owner replacement. Runtime work remains frozen until the coordinator releases the checkpoint.

## Distinct lifecycle work still tracked

Stories typed setup fields edit a reviewed document: clone/mutate complete draft, preserve authoritative shapes, regenerate descriptor-marked identities and redraw with focus restoration. Their native dialog lifecycle already composes NativeDialog. They do not have DOM-owned list authority; inspect equivalent scalar construction as a separate bounded follow-up, without replacing the reviewed document with generic row serialization.

Allocator skill ranks and fixed faction relations retain their source-backed domain controllers. Sharing native field construction is appropriate where mechanics match; forcing them into free-form list ownership is not. This slice does not claim that the broader forms or whole widget audit are complete.

## Verification

Syntax checks passed for the new scalar module, FactionEditor and AttributeSkillAllocator; Nunjucks compilation passed for Play and Worlds after the scoped edits. Core compiled main/settings CSS. The coordinator accepted **22 distinct Chromium cases and 34 distinct affected Node source/UI cases** across the combined collection/media/form checkpoint. This is an aggregate checkpoint count, not 22 form-only tests. See [Playwright evidence](../../playwright.md#isolated-collection-and-form-verification-2026-11-05).

The form subset has **10 distinct Chromium cases**: direct typed extension fields (1); actual Thing/NPC save/reopen/remount (1); desktop/phone control geometry (1); sparse faction relations and asset/tier geometry (2); Worlds seeded module edit/save and malformed configuration (2); New Game allocator save/load preservation (2); unavailable saved Thing module/slot IDs (1). Reports include `tmp/form-owners-2-results`, `tmp/form-geometry-final-results`, `tmp/faction-rows-results`, `tmp/world-modules-results`, `tmp/allocator-owner-results` and `tmp/module-boundaries-2-results`. Screenshots were inspected at desktop and phone widths; native input/label boxes were checked for overlap.

The final module error/data-preservation gates used:

```bash
XDG_RUNTIME_DIR=/run/user/1000 \
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
PLAYWRIGHT_BROWSERS_PATH=/home/bart/.cache/ms-playwright \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_HTML_OUTPUT_DIR=tmp/module-boundaries-report \
systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 \
npm run test:e2e:headless -- \
tests/e2e/settings-npc-naming-isolated.spec.js tests/e2e/ability-tooltip.spec.js \
--grep 'Worlds rejects malformed|Thing editor retains unavailable' \
--output=tmp/module-boundaries-2-results --workers=2
```

Both passed. The expanded malformed-config syntax/cause assertion reran the Worlds case with `tests/e2e/settings-npc-naming-isolated.spec.js --grep 'Worlds rejects malformed' --output=tmp/world-invalid-syntax-results --workers=1` under the same prefix and passed. It verifies path/original cause, raw value retention and no replacement/save. The Thing case verifies an unavailable selected module type and a separate equippable base's unavailable slot type survive frontend collection; existing authoritative module validation remains server-owned.

A separately accepted Stories lifecycle case uses `tests/e2e/story-new-story-fill.spec.js --grep 'persisted pagehide' --output=tmp/persisted-story-final-results --workers=1` under that prefix. Persisted hide retains native dialog editing, nested instructions/Escape and close/reopen; later non-persisted hide closes native modal ownership and releases the named lock. It does not impose a new app close transaction or change runner/socket transport departure policy. This case belongs to the combined 22 count, not the 10 form cases.

This form checkpoint's source was frozen after these gates. The next checkpoint released the required vehicle implementation, tracked separately above.
