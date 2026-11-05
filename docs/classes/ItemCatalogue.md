# ItemCatalogue

## Scope and implementation plan

Remember item definitions per game independently of live item instances. Normalize accepted registered items, retain definitions when the last copy is removed, persist a versioned catalogue, seed surviving items from older saves, and reset when changing games. Validate before replacing catalogue state. Verify normalization, consumption, rollback, save round trips, malformed input and world isolation.

## Records and lifecycle

`ItemCatalogue` is a process-local static catalogue reset with `Thing.clear()`. Definitions have stable shared `itemdef_first_three_words` IDs, `reusable: false`, and a canonical `blueprint`. Exact blueprints deduplicate; names alone never merge differing definitions. Name lookup returns all matching definitions. Getters return detached copies.

Blueprints retain core fields, recorded rarity when present (including native unclassified/null rarity), recorded level, raw bonuses, structural target/equipper effects and registered mod definition fields and permanent intrinsic item statuses (duration -1), with instance bindings removed. Owner/location/count, temporary statuses on the item, hidden/discovery state, contents, installed module bindings, source/grant identities and harvest history are excluded. Value, weight and properties are preserved from metadata. Images remain instance presentation and are not archived or referenced by this phase. These are observed level-specific snapshots; automatic scaling/materialization is a later phase.

Legacy Thing metadata may store value or weight as a display-formatted number such as `"1,200"`. Observed blueprint projection recognizes valid comma thousands grouping and records the numeric value (`1200`), including signed values, decimal fractions and explicit zero. The original Thing metadata, identities and references remain unchanged. Malformed grouping, unit-bearing text and arbitrary prose are not guessed or defaulted. Ordinary numeric strings retain their existing representation so previously saved definition identities remain stable. Saved catalogue records and standard-family variants retain strict canonical numeric validation; this compatibility conversion applies only when projecting live/loaded Things into archival definitions.

Registered construction tracks a provisional definition. Save capture retains current live definitions; normal deletion retains the final definition. Accepted replacement retains the old definition before tracking the replacement. Provisional snapshots superseded during initial generation are discarded. Rollback deletion uses `delete({ remember: false })` and removes unretained orphan definitions. Validation candidates never enter the catalogue. No recurring gameplay scans or LLM calls are added.

## API and saves

`validateThing(thing)` performs pure blueprint preflight without IDs or catalogue changes. Candidate preparation and live replacement use it before mutation. `remember(thing, { retain })`, `capture(iterableOrMap)`, `forget(thing)`, `getById(id)`, `getByName(name)`, `getAll()`, `toJSON()`, `validateState(payload)`, `hydrate(payload)` and `clear()` own the catalogue. `itemCatalogue.json` contains `{ version: 2, definitions: [...], families: [...] }`; version 1 saves load with no standard families; missing legacy files initialize empty and loaded live items seed it. Present malformed data fails explicitly. Definitions survive with no remaining instances.

## Standard families

`getFamilies()`, `getFamiliesByName(name)`, `validateFamilyCommit(families)` and `commitFamilies(families)` manage canonical reusable families independently of observed snapshots. Each family has a stable `itemfamily_first_three_words` ID, exact name, minimum/maximum rarity, inclusive ordered `rarities`, and complete raw parsed `variants` retaining original unscaled bonuses. A family commit validates the full collection before allocation or persistence, deduplicates equal proposals, and rejects competing mechanics under an existing family name. Family getters return detached copies.

Version 2 load validates standard family ranges against the current configured rarity order, including every intermediate tier. Unknown or missing reusable rarity variants reject before world reset. Historical observed snapshots still preserve their recorded rarity keys. Live observations and alterations never overwrite saved family templates. `generation` increments on clear/hydration so asynchronous reuse sessions cannot commit into a replacement game.

See [ItemReuseService](ItemReuseService.md) for first-use classification, complete rarity authoring and native reuse. Observed definition `reusable: false` remains archival; reusable eligibility comes only from the explicitly authored family. Recipe knowledge is separate.

[ItemCatalogueApi](ItemCatalogueApi.md) exposes detached stored definitions and
families without live-world scans. [ItemCataloguePanel](ItemCataloguePanel.md)
browses them under Play → Story Tools while distinguishing observed recorded-level
mechanics from raw family templates.

## Charge definitions

Blueprints include structural `chargePool` fields and loose `ammoType` but omit `chargePool.amount`. Depleting a live item therefore does not create another mechanical definition or change a standard family. An observed amount is never promoted into an implicit default. Family templates require an explicit `initialAmount`, validate it against mode/capacity, and omit current amount. Fresh reuse initializes only from that declared value; copying an existing Thing retains its current amount instead.
