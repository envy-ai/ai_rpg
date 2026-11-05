# Technique extensions

Status: implemented and verified with isolated automated checks. User approved the defaults below on 2026-11-05. Baseline checkpoint: `84dd78a`.

## Agreed scope

1. Weapon-based damage selects an exact equipped weapon, uses the ordinary weapon calculation with authored multiplier and bonus before defenses, and consumes its normal ammunition/charge once. Weapon identity and mechanics are checked again at commit and recorded in the receipt.
2. Utility effects initially cover teleportation, summoning and resurrection. Teleportation uses canonical existing destinations and native movement/arrival behavior. Summoning supports existing characters and new creatures from saved templates with authored lifetimes, without copying another character's inventory. Resurrection requires an existing dead character at the scene, restores authored health, clears Deceased/Incapacitated, and preserves other statuses, inventory and XP. Removed corpses are not recreated.
3. Standard area/mixed recipes retain component strength. Costs scale by actual selected target count and the sum of component costs. The initial configurable status baseline is one attribute/skill at +/-1 point or +/-5 percent for three world minutes at the ordinary recipe cost. Recipes are the default authoring path; deliberate custom mechanics remain supported. Existing same-cost failure behavior and applicable configured resource profiles continue.
4. Reviewed personal reset/rebase controls restore the pinned base or copy a selected newer catalogue revision, respectively. They append personal history, preserve acquisition/evidence, replace personal modifications explicitly, and affect only that actor. Catalogue revisions and other owners remain unchanged.

## Integration and acceptance

- Keep all changes in the shared technique preparation/commit/receipt path; ordinary attacks retain their existing results. No second weapon damage application, second ammo payment, implicit weapon substitution or reroll on replay.
- Utility preparation must finish all asynchronous work before synchronous mutation. Revalidate movement, actors, destinations, summon templates and resources; restore actor/world membership and spawned records on failure. Timed summon expiry uses world time and survives saves without requiring an LLM.
- Preserve old custom/managed mechanics, pinned policy snapshots and historical receipts. New state is persisted and included in explicit ID migration. Absent legacy fields retain their previous meaning; malformed present data rejects.
- Standard and TinyBrain authoring use the same strict nested XML contracts, contextual facts and actionable correction feedback. Existing logging/retry ownership remains authoritative.
- Expose the mechanics in shared editors, previews, target/source selection and receipt rendering. Use existing UI components, keyboard behavior and SCSS, with mockups before new UI implementation.
- Verify weapon calculations and mitigation, stale source/resource rejection, utility rollback/replay/save/expiry, target-count and component pricing, snapshot compatibility, rebase history/guards, and representative browser workflows. Tests run in the required 16 GB/no-swap systemd scope, using isolated fixtures and no real LLM or user save.

## Ordered delivery

1. Implement shared core weapon/rebase contracts alongside isolated utility and recipe helpers, with explicit ownership of shared files.
2. Integrate service hooks, native gameplay adapters, save/migration and XML/prompt parity.
3. Implement the shared UI and focused service/integration/browser tests.
4. Resolve concrete review/test failures, compile styles, update focused documentation and the index. Server restart requires separate permission; no save is loaded automatically.

## Delivered behavior and verification

- Weapon attack checks supply authored target toughness and effectiveness to the native calculator. Prepared weapon facts include the configured base damage, item identity, level, rarity and charge state. Exact selection, pre-defense multiplier/bonus, one native ammunition payment, failed attempts, stale facts and transactional rollback have focused coverage.
- Teleport narration receives canonical destination facts in both standard tool results and TinyBrain retained results. Ordinary stubs expand through the native preparation path before a roll or payment; a region-entry expansion that changes a pinned destination ID stops with the replacement ID and correction guidance. The existing arrival pipeline handles while-away changes, hostiles and discovery once. Nested preparation yields the parent prompt reservation in both modes, with concurrency-one regression coverage.
- Player/party group teleports share one automatic or skill-check result to preserve native party representation. Attack/opposed group checks reject with separate-target guidance. Summon lifetimes persist, protect corpses until expiry, preserve acquired inventory/barter stock, and cancel on intentional actor removal. Resurrection clears death/incapacitation names case-insensitively and retains unrelated state.
- Version 2 component recipes, old version 1 snapshots, per-target payment, personal reset/rebase, saved summon state, migration, typed XML, authoring previews and standard/TinyBrain selection parity have service/API coverage.
- Browser checks exercised the shared panel, weapon editor/use preview, mixed percentage recipe, resurrection target selection, reviewed reset/rebase, recorded effects, narrow layout, sidebar and ability attachment integration. UI styles were compiled from SCSS. Screenshots are in `tmp/techniques-ui-review`.
- The earlier combined seven-suite technique run passed 110 tests, and the ordinary attack/charge group passed 36 tests. After arrival changes, the affected service/prompt/intent group passed 87 tests, plus focused standard and TinyBrain queue-yield cases. These runs overlap and are not additive. The panel suite passed 14 cases, attachment suite five, with additional focused new UI cases. Twenty production JavaScript files passed final syntax checks; edited XML schemas and default YAML parsed successfully.

Verification used isolated worlds, mocked transport/completions and the required 16 GB/no-swap scopes. No live LLM, user save, server restart or post-baseline commit was performed for this implementation.
