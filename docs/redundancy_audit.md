# Redundant Code Audit

**Date:** 2026-07-31
**Scope:** All first-party JavaScript in the repository (~147k lines across 472 files), excluding `node_modules/`, `public/vendor/`, saves/logs/exports, and this audit's scratch dir (`tmp/audit/`).
**Method:** automated copy-paste detection (jscpd, min 10 lines / 60 tokens), a require/import-graph reachability scan, and manual verification of every finding by reading the code. Existing documentation was not consulted.

## Executive summary

- jscpd found **502 clone instances covering ~9,900 lines (~6.2% of the codebase)**. Roughly **65% of that is test↔test duplication** (shared fixture/setup blocks); ~3,500 clone-lines involve production source.
- The single largest production offender is the **bridge-client trio** (`ClineBridgeClient.js`, `CodexBridgeClient.js`, `KimiBridgeClient.js`): ~550–620 lines of identical helper code copied into each file, plus triplicated dispatch code in `LLMClient.js` and `api.js`. **~1,250–1,350 lines eliminable.**
- The **entity classes** (`Location`, `Region`, `Thing`, `Player`) have no shared base class and re-implement the same status-effect suite (4 copies, ~600 lines) and mod extension-field machinery (2 copies, ~300 lines). **~550–650 lines eliminable.**
- The **frontend** has ~350–450 eliminable lines in `public/js/chat.js` alone, ~200 elsewhere in `public/js/`, and **~1,000 duplicated lines inside the 39k-line inline `<script>` block in `views/index.njk`** (including a faction editor verbatim-duplicated in `views/settings.njk`).
- **Truly dead code is rare**: `NameCache.js` (41 lines, no export, never referenced), a ~20-line dead demo block in `nunjucks_dice.js`, and stale extracted-script artifacts in `tmp/`. Several config files (`config2.yaml.old`, `config.yaml.old`, `config.yaml.cline`, `config.yaml.polaris`, `config.yaml.qwen*`) are referenced by no code — disk clutter only.
- An import-graph scan flagged 37 files as unreferenced, but all turned out to be slash commands auto-discovered by `SlashCommandRegistry.js` via `readdirSync` (`SlashCommandRegistry.js:79`). **No dead modules among them.**

Estimated total eliminable production code: **~3,000–3,500 lines**, plus ~1,000 in templates and a large but lower-priority amount in tests.

---

## 1. Bridge clients — the biggest production duplication

Files: `ClineBridgeClient.js` (1,446 lines), `CodexBridgeClient.js` (2,001), `KimiBridgeClient.js` (1,370). All three are required and actively used (`LLMClient.js:11-13`, `api.js:15-17`) — none is deletable, but their shared helper layer is copy-pasted three times.

**Identical or near-identical helpers (per-file line ranges):**

| Function | Cline | Codex | Kimi |
|---|---|---|---|
| `formatMessageContent` | 98-149 | 48-99 | 61-112 |
| `renderToolCallBlock` / `renderConversation` / `splitBridgeMessages` | 151-243 | 101-195 | 114-206 |
| `renderSystemInstructionBlock` | 245-261 | 197-213 | 208-224 |
| `renderToolDefinitions` / `buildDeveloperInstructions` | 263-349 | 215-301 | 226-310 |
| `extractJsonPayload` / `normalizeToolCallArguments` / `parseBridgeMessage` | 361-569 | 344-456 | 322-430 |
| `normalizeUsage` | 571-596 | 562-587 | — |
| `buildResponseData` / `extractBridgeContentPreview` / `buildBridgePreviewUpdate` | 598-744 | 610-747 | 432-566 |
| `getBridgeLogResponseText` / `logBridgePrompt` | 821-893 | 793-866 | 602-675 |

Most "differences" are just the backend name baked into error strings, log titles, and tool-call id prefixes (`cline_call_`/`codex_call_`/`kimi_call_`).

**Duplication spilling outside the trio:**
- `LLMClient.js:4620-4715` — three ~32-line dispatch branches identical except the class name, including an inline `onStdoutEvent` handler repeated 3×.
- `api.js:49156-49238` — the config-test endpoint repeats the same ~28-line block once per bridge.
- `LLMClient.js:1978-2038` (`#formatMessageContent`) is a **fourth copy** of the bridge `formatMessageContent`.
- `LLMClient.js:547-572` and `1315-1355` — parallel per-backend `switch` chains repeated for `getConfigurationErrors` and `getMaxConcurrent`.

**Genuinely different (must stay separate):** the transport layers — Cline's one-shot CLI spawn (`runClineCommand`, ~290 lines), Codex's persistent JSON-RPC app-server (`runCodexAppServer`, ~288 lines), Kimi's ACP session protocol (`runKimiCommand`, ~490 lines); contract forks inside `parseBridgeMessage` (Cline's JSON-salvage path; Kimi's both-keys-required rule at `KimiBridgeClient.js:383`); per-backend config schemas.

**Recommendation:** extract a shared `bridgeClientUtils` module (the static-only class shape makes a classic base class awkward) with a backend-label parameter for strings, and strategy hooks for `parseBridgeMessage`/`buildDeveloperInstructions`. **~1,250–1,350 lines eliminable**, plus ~100–150 more from shared spawn/timeout boilerplate. The same pattern repeats at smaller scale in the image clients (`saveImage` cloned in `ComfyUIClient.js:316-330`, `OpenAIImageClient.js:72-96`, `NanoGPTImageClient.js:69-89`; ~60–70 lines eliminable).

## 2. Entity classes — no base class, repeated subsystems

`Location`, `Region`, `Thing`, `Player` (plus `Faction`, `Quest`) share no base class or mixin; every duplicated block bypasses any reuse mechanism.

- **Status-effect suite ×4** (~150 lines each, ~600 total): `#normalizeStatusEffects`, `getStatusEffects`, `setStatusEffects`, `addStatusEffect`, `removeStatusEffect`, `tickStatusEffects`, `clearExpiredStatusEffects` at `Location.js:1872-2095`, `Region.js:1470-1621`, `Thing.js:2512-2891`, `Player.js:5257-5649`. Near-exact, but with real deltas: `Location` mixes `Date` objects and ISO strings, `Thing` fires enrichment (`Thing.js:2789`), `Player` reconciles health (`Player.js:5535`), and **`Region` stores plain objects instead of `StatusEffect` instances** — unification would change its serialized shape.
- **Mod extension-field machinery ×2** (~150 lines each, rename-identical): `Thing.js:1794-1927` + `932-964` vs `Player.js:219-308` + `4111-4184`. Only the registry key and class name differ.
- **Location ↔ Region** (~148 lines): `#normalizeVehicleInfo`, `#normalizeWeatherExposure`, `minutesSinceLastVisit`, `lastVisitedTime` setter, `addRandomEvent`/`removeRandomEvent`, `characterConcepts`/`enemyConcepts` accessors — exact or near-exact.
- **Static-registry boilerplate ×6+**: `#indexById`/`get`/`getAll`/`clear`/`fromJSON`/`serializeAll` repeated in `Faction.js:17-444`, `Quest.js:67-303`, `MysteryBox.js:33-134`, `MysteryThread.js:62-190`, `Tracker.js:147-271`, `ScheduledEvent.js:47-158` (~25 lines each, ~75–100 eliminable via a shared registry base).

**Recommendation:** extract a `StatusEffectList` helper operating on a passed-in array (a base class can't touch `#private` fields; a helper module is the lower-risk route), an extension-field mixin, and a registry base class. **~550–650 lines eliminable.** Watch the timestamp-type inconsistencies (`Location.js:1708` ISO vs `Location.js:2026` `Date`) — consolidation can alter saved-game output.

## 3. Frontend (`public/js/` + templates)

**`public/js/chat.js` (10,819 lines, ~350–450 eliminable):**
- Message-bubble scaffolding copy-pasted into ~10 render methods (e.g. `addMessage` 6752-6767, `addNpcMessage` 6784-6797, `addExperienceAward` 7090-7104, `addCurrencyChange` 7158-7172, +6 more); the identical `new Date().toISOString().replace(...)` timestamp appears 9×. → one `buildBubble()` helper, ~120–150 lines.
- Three near-verbatim ~65-line pointer-drag implementations (757-820, ~4907-4965, ~5297-5355) → ~120 lines.
- `buildSkillCheckMessageElement` (8535-8792) vs `buildAttackCheckMessageElement` (8843-9362): shared section logic, a verbatim 26-line `formatCircumstanceEntry` (8641 vs 9041), `formatSigned` redefined 3×, collapsible `<details>` scaffolding duplicated 4× → ~80–100 lines.

**Cross-file in `public/js/` (~200 eliminable):**
- `escapeHtml` implemented 4× (`chat.js:9458`, `player-stats.js:664`, `lorebooks.js:320`, inline in `index.njk`); `formatHealthDisplayValue` verbatim in `chat.js:4292` and `player-stats.js:16`; currency-label logic in 3 places (`currency-utils.js` canonical, `chat.js:7121-7134`, inline in `index.njk`).
- Vehicle-overlay logic duplicated between the two cytoscape maps (`map.js:70,87-104,611-623` vs `world-map.js:10,579-601,812-824`).
- `loadClientId()` near-verbatim in `chat.js:2055-2074` and `new-game.js:156-175`.
- `turn-state-diff-drawer.js`: `createDispositionRows` (582-661) vs `createNeedRows` (725-802) — structurally identical row renderers (~85 lines).
- No dead frontend files — every `public/js` file is referenced by a template.

**Templates (~1,000 eliminable):**
- `views/index.njk:3109-42072` is a single **38,962-line inline `<script>`** (912 functions) with ~1,003 lines of intra-block duplication. Largest: `wireModalInventoryTouchDrag` (14617-14832) vs `wireNpcPartyTouchDrag` (17098-17300) — ~170 verbatim lines; `renderThingCollectionPanel` config blocks (36006-36089); thing-list sort popover (22106-22208 vs 18997-19099).
- **Faction editor duplicated across templates**: `initSettingsFactionEditor` (`settings.njk:2670-3321`) vs `initFactionPanel` (`index.njk:39405-40194`) — ~175 verbatim lines inside two parallel ~650/~790-line implementations of the same UI. A shared `faction-editor.js` could eliminate 300+ lines.
- The inline block has **zero verbatim overlap with `public/js/`** — the problem is internal, not cross-boundary. Extracting it into modules would also make it visible to linters/duplication scanners.
- Note: `formula-evaluator.js` and `currency-utils.js` are already correctly shared between frontend and backend (`server.js:37,64`, `api.js:6,27`).

## 4. Utilities and misc root modules

- **`Utils.js` internal duplication (~100 eliminable):** 12 byte-identical lazy-require getters (`Utils.js:1051-1134`, ~70 lines → one factory); the days/hours/minutes decomposition copied into `formatMinutesAsDuration` (320-350), `formatMinutesAsCountdownDuration` (352-383), `formatMinutesAsNaturalDuration` (412-448) (~30-40 lines).
- **Formula helpers:** `normalizeFormula` is identical in `utils/dc-formulas.js:19-31`, `utils/outcome-margin-formulas.js:21-33`, `utils/point-pool-formulas.js:4-16` (extended variant in `utils/critical-threshold-formulas.js:15-33`); the `validate*` compile loops repeat too. → shared `utils/formula-utils.js`, ~50–60 lines.
- **`Globals.js:1212-1276`:** six near-identical `locationsById`/`regionsById`/... getters → factory, ~45 lines. (The rest of `Globals.js` is a state registry by design, not a duplicator.)
- **Sanitizer triple:** identical sanitize-regex chain in `SanitizedStringMap.js:6-10`, `SanitizedStringSet.js:7-11`, and `sanitizeLookupKey` in `slashcommand_utils/characterTargeting.js:22-30`.
- **Scene summaries:** interval clamp/sort/cursor-walk duplicated between `slashcommands/scene_summary.js:85-116` and `computeCoverageGaps` in `slashcommands/scene_summaries.js:38-74` (~25 lines, belongs in `scene_summary_index.js`). All five scene-summary files are otherwise live and distinct; `SceneSummaies.js` (filename typo) is the data store, not dead.
- **`nunjucks_dice.js:145-164`:** dead demo block referencing a nonexistent `roll_detail` filter (~20 lines). Despite the name, the module never registers a nunjucks filter — naming confusion only, not duplication.
- **Checked and clean:** `base_context_history.js` / `base_context_relationships.js` (zero shared code); `ScheduledEvent.js` / `scheduled_event_runtime.js` (clean model/runtime layering); the Mod quartet (`ModDiscovery`/`ModLoader`/`ModManager`/`ModExtensionRegistry` are distinct layers); `slashcommand_utils/` vs `utils/` (no overlap beyond the sanitizer above). `quest_disposition_reward_delta.js:30` has a local `roundAwayFromZero` that deliberately differs from `Utils.roundAwayFromZero` — do not merge.

## 5. Dead code and clutter

| Item | Status | Lines |
|---|---|---|
| `NameCache.js` | Dead — no export, never required anywhere | 41 |
| `nunjucks_dice.js:145-164` | Dead demo block | ~20 |
| `tmp/index-inline-script-1.js`, `tmp/index-rendered-inline.js`, etc. | Stale extraction artifacts, not served | — |
| `config2.yaml.old`, `config.yaml.old`, `config.yaml.cline`, `config.yaml.polaris`, `config.yaml.qwen27B-ternary`, `config.yaml.qwen35B-A3B` | Zero references in any `.js` file — disk clutter, not code redundancy | — |

No dead modules were found in `public/js/`, `utils/`, `slashcommands/`, or `mods/`.

## 6. Tests (~65% of all detected duplication)

Test↔test clones account for ~6,500 of the ~9,900 duplicated lines. The biggest contributors:

- `tests/chat_tool_calls.test.js` — 1,314 duplicated lines, including 53/52/40-line intra-file clones (e.g. 1143 vs 1611/1428, 1304 vs 1767): repeated tool-call fixture builders.
- `tests/events.xml_event_parser.test.js` — 1,056 duplicated lines (mostly intra-file).
- `tests/events.need_bar_prompt.test.js:13` — a ~75-103-line setup block copied into at least 8 other test files (`player.persist_when_dead`, `player.relationships`, `player.need_bar_prompt_sentences`, `player.party_history_flag`, `player.last_seen_tracking`, `player_entity_fields`, `utils.counter_id_migration`).
- `tests/base_context_all_npcs.test.js` setup duplicated into 5+ other `base_context_*`/`player_*` tests.
- `tests/llmclient.*bridge.test.js` trio mirrors the production bridge-client duplication (~230-270 lines each).
- `tests/location.favorites.test.js` ↔ `tests/location.visited_state.test.js` (90 lines).

A shared `tests/helpers/` (fixture factories for players/locations/chat turns) would eliminate the bulk of this. Priority is lower than production code, but the copied 75–103-line setup blocks are a maintenance hazard: a change to the real defaults must be synced across ~10 files.

## Prioritized recommendations

1. **Bridge-client helper extraction** (~1,250–1,350 lines) — biggest win, low behavioral risk if done as a helpers module with a backend-label parameter. Cover with the existing `tests/llmclient.*bridge.test.js` suite.
2. **Extract the `views/index.njk` inline script into modules** — not just duplication (~1,000 lines) but the 39k-line inline block is invisible to tooling; start with the faction editor (shared with `settings.njk`) and the touch-drag pair.
3. **Entity-class status-effect + extension-field helpers** (~550–650 lines) — moderate risk; Region's plain-object status effects and the `Date`/ISO inconsistencies need deliberate handling.
4. **`chat.js` helpers** (`buildBubble`, shared drag binder, shared check-markup sections) (~350–450 lines).
5. **Small utility extractions** (~250 lines total): `Utils.js` getter factory + duration decomposition, `utils/formula-utils.js`, `Globals.js` getter factory, shared sanitizer, registry base class, image-client `saveImage`.
6. **Delete dead weight**: `NameCache.js`, the `nunjucks_dice.js` demo block, stale `tmp/` artifacts; decide on the unreferenced config variants.
7. **Test fixture factories** (~large, low urgency) — target the copied 75–103-line setup blocks first.

## Raw data

- jscpd machine-readable report: `tmp/audit/jscpd-report/jscpd-report.json`
- Import-graph script: `tmp/audit/import_graph.js` (rerun: `node tmp/audit/import_graph.js`)
- jscpd installed in scratch dir `tmp/audit/tools/` (project `package.json` untouched)
