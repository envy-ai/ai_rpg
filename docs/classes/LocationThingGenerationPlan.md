# LocationThingGenerationPlan

The TinyBrain roster parser forwards `parseContext.withNestedPrompt` through `resolveLocationPlan` and `resolveItemBatchRoster`. Unknown item-family authoring temporarily yields the outer program's retained queue reservation; cached-family resolution keeps it. This prevents self-deadlock at single-request model/global concurrency without changing roster validation, retries or commit boundaries.

`LocationThingGenerationPlan.js` validates location item/scenery planning and final expansion without registering Things or changing world state.

- `parseLocationThingsPlan(response, requirements)` requires one strict `<thingsPlan>` root with direct `<item>` entries. Each entry has exactly one plain-text `<name>`, `<itemOrScenery>`, `<rarity>`, and `<description>` child; attributes, nested fields, unknown/duplicate/missing fields, blank text and case-insensitive duplicate names across kinds are rejected. Descriptions are prompted as one sentence; validation requires nonblank plain text without a sentence-count heuristic. Configured rarity labels and keys normalize to their canonical key. The existing `validateGeneratedLocationThingBatch` enforces minimum item/scenery counts and per-kind rarity counts; extra entries remain allowed at this compact planning stage.
- `parseLocationThingsDocument(response)` selects and strictly parses a complete `<things>` envelope, requiring direct `<item>` children. Missing closing roots, wrong roots and malformed XML fail before item parsing.
- `normalizeLocationThingRarities(entries, rarityDefinitions)` returns detached entries with canonical rarity keys, including when a configured label differs from its key.
- `validateLocationThingsAgainstPlan(parsedItems, plan)` requires every approved exact name once, with its approved kind and canonical rarity. Missing, extra, duplicated or changed entries fail; descriptions and other Thing details may expand.

The `location_things_generation` TinyBrain family renders through the existing base-context wrapper. One roster checkpoint is followed by final full `<things>` generation using the ordinary item/mod/hidden-discovery schema. Roster errors retry that checkpoint; final XML, count, roster-match, and whole-Thing validation errors retry only the final stage with the exact error. Each stage has `ai.retryAttempts + 1` domain attempts under the shared runner's log, progress group and queue reservation. No native tools are exposed. Compact planning guidance aims for requested counts and permits only distinct necessary extras; final expansion cannot add entries.

Standard mode also begins with the compact roster and its original minimum-count and rarity checks. Both standard and TinyBrain resolve that approved roster through an item-reuse session before requesting full Thing XML. Reusable exact-rarity item entries are supplied by the catalogue; only unresolved item and scenery entries reach full expansion. Expansion preserves the unresolved names, kinds and rarities exactly. The server restores the original approved order, combines both sources, and then applies the original full-batch count, rarity, roster and whole-Thing validation before native preparation and atomic creation. Cached raw bonuses use the location's existing level calculation and scaler exactly once.

When every approved entry is reusable, standard mode skips expansion. TinyBrain's approved checkpoint returns an empty unresolved roster and the template terminates through `location_things_catalogue_result`, also skipping the final completion. The assembled XML log records the accepted catalogue roster. Mixed rosters continue through the ordinary final schema and parser-feedback stage. Planning uses the existing `location_things_generation` metadata label and AI configuration; audit prefixes/stages distinguish roster work.

Each completion stage has bounded correction retries. Recoverable failures remain quiet, actual correction retries are counted, and terminal exhaustion emits a failure notification through the existing logical owner. Both paths disable inner completion XML/root validation so domain errors reach the responsible parser rather than triggering blind nested retries. Exhausted transport/completion errors propagate directly through `throwOnError: true`.

Only a fully validated batch reaches the existing Thing preparation and atomic batch-commit path. Registered fields, hidden discovery data and pending container contents remain handled by the ordinary parser and mutation service. Generation itself does not restart services or load saves.

The reuse session rejects a changed game immediately before committing live Things. Newly authored families are persisted only after native placement and canonicalization succeed. Standard copies receive verified catalogue provenance before duplicate-name handling so ordinary copies retain their reusable family name.

The file-schema pilot explicitly selects things-plan.schema.xml for the TinyBrain
roster and things.schema.xml for final standard/TinyBrain expansion. Shared item
fields/mod fragments and empty-batch/cardinality rules are documented in
[ThingGenerationSchema](ThingGenerationSchema.md). Final business validation is
unchanged.

Shared `server.js` Thing XML parsing treats blank optional `<count>` as omitted (one), blank `<relativeLevel>` as omitted (null), and blank `<hiddenFromPlayer>` as omitted (false). Explicit zero counts/relative levels and false flags remain explicit values. Required hidden-target discovery difficulty and populated invalid values retain validation. This also applies to standard generation using the same parser; see the [validation audit](../superpowers/plans/2026-11-01-tinybrain-validation-guidance.md).
