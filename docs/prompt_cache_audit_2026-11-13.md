# Prompt cache and latency audit — 2026-11-13

## Findings

The largest repeatable waste is NPC inventory generation switching between different location contexts. Eight item-family requests each reread approximately 39,300 tokens and wait 12–13 seconds for output. The final two requests stay with the same NPC, reuse another 32,768 tokens, and wait only 2.3 seconds. Grouping each NPC's complete inventory operation is the clearest first improvement.

Player-action and event-check startup also suffers 18–27 second near-cold or large partial misses. Early history changes, inconsistent setting projections, changing scene state, and insufficient retained conversation/checkpoint capacity all contribute. The initial player-action cold start follows an actual engine restart and should be classified separately.

Across 327 dispatched attempts, the backend reused **94.12% of input tokens**, yet **27 large misses consumed 450.399 seconds (7.5 minutes) of prefill**. High aggregate reuse hides the expensive transitions between otherwise efficient staged conversations. This is measured prefill work, not a claim that all 7.5 minutes can be eliminated.

The initial audit changed documentation only, plus local analysis artifacts under `tmp/`. The subsequent authorized fixes are recorded in [Implementation follow-up](#implementation-follow-up); the measurements below remain the original baseline.

## Scope and method

- Fixed dispatch window: **2026-11-13 21:51:17.000 through 22:50:17.600 UTC**, corresponding to the current prompt files present when the audit started. Subsequent live activity is excluded.
- Inspected **42 prompt/transcript files and four completed turn-audit files** directly under `logs/`; excluded `logs/logs_prev/` and earlier sessions in cumulative telemetry.
- Used [completion timing](../logs/completion-timing-2026-11-13.jsonl), [termination traces](../logs/strata-termination.jsonl), and the [native Strata log](/home/bart/.local/share/strata/install/strata-davidau-iq3_s-plain-ram.log). Model: `qwen3.8-flash-next-davidau-turbo-brilliance-iq3_s-plain`; logged endpoint: `http://127.0.0.1:8080/v1/chat/completions`.
- Joined provider response IDs between completion timing and termination traces, then matched native prompt/output token counts in dispatch order. All **327 attempts** match unique, monotonically increasing native rows, lines **159958–161287**. For **25 disconnected attempts**, termination traces lack a final output count; those use ordered prompt counts instead. Two consecutive native rows have identical prompt/output counts; their order and distinct latency measurements resolve the match.
- Application timing rows contain numeric prompt/cached-input usage for **261 attempts**; all 261 counts agree exactly with native prompt/reused counts. The other **66 attempts** lack that usage metadata and are covered by the native correlation.
- As an independent check on that correlation, every matched dispatch-to-first-output measurement exceeds native prefill by only **17–398 ms**, with a median difference of **58 ms**. Latency therefore strongly corroborates the cache measurements here.
- “Large miss” means **at least 30,000 newly read prompt tokens**, including partial hits. This threshold ranks expensive work; it is not a backend cache setting.
- Compared initial rendered prompt text, including the first TinyBrain checkpoint, separately from transport telemetry. Removed only the log's `user: ` display prefix. Raw template markers and logging wrappers are not wire-level tokenization evidence.

The 327 attempts include retries/continuations, not 327 independent user actions. App prompt logs often represent several transports; completed TinyBrain event-result logs are not additional requests. The cumulative output-character statistics are historical averages, not current-session token counts. Files named `ERROR_xmlSchemaCompletion_*` in this window contain successful schema completion diagnostics; their filenames alone do not establish failures.

Reproduction and detailed results:

- [Read-only analysis script](../tmp/audit_prompt_cache_2026_11_13.py), run with `python tmp/audit_prompt_cache_2026_11_13.py` while the source logs remain available.
- [Per-attempt CSV](../tmp/prompt-cache-audit-2026-11-13/attempts.csv), including response IDs, native line numbers, read/reused tokens, prefill, TTFT, and matching method.
- [Grouped measurements](../tmp/prompt-cache-audit-2026-11-13/summary.json), [source prefix comparisons](../tmp/prompt-cache-audit-2026-11-13/prefix-comparisons.json), and [prompt sizes](../tmp/prompt-cache-audit-2026-11-13/prompt-sizes.json).

These temporary artifacts may expire; the key measurements and source references are retained below. Source locations describe the working files inspected for this audit, not a guaranteed identity with every running process's loaded source.

## Where the prefill time goes

| Family | Transport attempts | Newly read tokens | Total prefill | Large misses |
| --- | ---: | ---: | ---: | ---: |
| Player action | 253 | 318,950 | 239.375 s | 4 |
| Event checks | 32 | 251,119 | 100.771 s | 4 |
| Inventory: Beta_Curator | 5 | 204,949 | 65.054 s | 5 |
| Inventory: HighScore_Hana | 7 | 217,979 | 69.054 s | 5 |
| Inventory: Zit | 1 | 47,623 | 15.077 s | 1 |
| NPC progression assignments | 2 | 115,464 | 38.329 s | 2 |
| Quest check | 2 | 81,321 | 25.853 s | 2 |
| Plot analysis | 1 | 70,251 | 24.133 s | 1 |
| Region stub locations | 1 | 70,712 | 23.810 s | 1 |
| Tonal-scale evaluation | 1 | 42,632 | 14.729 s | 1 |
| Housekeeping | 1 | 45,886 | 14.594 s | 1 |
| Need-bar event checks | 8 | 10,831 | 10.894 s | 0 |
| Cyber-Kilowatt memories | 1 | 19,877 | 7.216 s | 0 |
| Region NPC generation | 6 | 11,049 | 7.184 s | 0 |
| NPC ability assignments | 1 | 14,535 | 4.443 s | 0 |
| Equipment selection, region level, name and alias helpers | 5 | 5,822 | 7.410 s | 0 |
| **Total** | **327** | **1,529,000** | **667.926 s** | **27** |

Total input was 25,995,584 tokens, of which 24,466,584 were reused. Large misses account for **89.82% of newly read tokens** and **67.43% of prefill time**. Native prefill includes per-request work even for warm short continuations, so the remaining 217.527 seconds is not all avoidable cache waste. Warm player-action attempts have a median TTFT of roughly 0.6 seconds across the family, despite its expensive starts.

## 1. Inventory and item-family context switching — highest-confidence improvement

The three roster requests each read 47,623–47,709 tokens, taking about 15 seconds before output. The following family requests alternate Beta_Curator's **Pixel Museum Exterior** with HighScore_Hana's **Arcade Alley Exterior**:

| Dispatch UTC | Owner | Reused | Read | Prefill | TTFT |
| --- | --- | ---: | ---: | ---: | ---: |
| 22:46:18 | Beta_Curator | 28,770 | 39,317 | 12.688 s | 12.804 s |
| 22:46:41 | HighScore_Hana | 28,770 | 39,306 | 12.407 s | 12.483 s |
| 22:47:07 | Beta_Curator | 28,770 | 39,304 | 12.393 s | 12.490 s |
| 22:47:34 | HighScore_Hana | 28,770 | 39,308 | 12.425 s | 12.524 s |
| 22:47:56 | Beta_Curator | 28,770 | 39,316 | 12.851 s | 12.958 s |
| 22:48:22 | HighScore_Hana | 28,770 | 39,306 | 12.344 s | 12.436 s |
| 22:48:49 | Beta_Curator | 28,770 | 39,303 | 12.209 s | 12.305 s |
| 22:49:17 | HighScore_Hana | 28,770 | 39,303 | 12.433 s | 12.534 s |
| 22:49:46 | HighScore_Hana | 61,538 | 6,525 | 2.233 s | 2.335 s |
| 22:50:02 | HighScore_Hana | 61,538 | 6,536 | 2.206 s | 2.301 s |

Native evidence: lines **161239–161277**. Prompt examples: [Beta family request](../logs/2026-11-13T22-48-21-041Z_inventory_generation_BetaCurator_inventory_generation_BetaCurator.log) and [Hana family request](../logs/2026-11-13T22-48-47-190Z_inventory_generation_HighScoreHana_inventory_generation_HighScoreHana.log). Prompt-file timestamps normally describe logging/completion, not dispatch.

The family prompts have identical 12,053-character system text. Their generation text first differs about **111,645 characters** in, at `<currentLocation><name>`. Much of the large remaining player/party/history context is unchanged but follows this location difference and therefore cannot be reused across it. Successive Hana family prompts instead share **259,267 characters**, up to the requested item name. The observed reuse difference is exactly **32,768 tokens**.

The inspected region population code launches all inventory operations using immediately started async callbacks and `Promise.all` in [server.js](../server.js:30735). `generateInventoryForCharacter` performs the roster, resolves missing families, and then handles unresolved expansion. `authorStandardItemFamily` rebuilds the base context for the owner's location for each family. This allows two logical inventories to alternate their completions even when the native backend serves only one request at a time. The existing [location Things ownership fix](classes/LocationThingGenerationPlan.md) does not serialize these separate NPC inventory operations.

Recommended changes, in order:

1. **Retain one logical owner across an NPC's complete inventory program**, including roster, family resolution, necessary expansion and corrections. At single-backend concurrency, finish that operation before switching to the next NPC. Use the existing reservation/nested-prompt lifecycle, with deliberate behavior when callers already share a parent owner; a shared owner alone does not prevent sibling programs from interleaving. Preserve independent capacity for configurations with multiple actual serving slots.
2. **Give standard-family authoring a small canonical context.** It needs world/item rules, rarity/equipment/attribute/mod definitions, explicit item constraints and relevant lore. Evaluate removing unrelated player equipment, party detail, trackers and story history. Keep any scene/owner facts actually needed for classification or hard constraints. Preserve canonical standard-family mechanics and all existing validation.
3. **Make roster and family location projection consistent.** The roster includes stub/blueprint descriptions; family logs replace them with `No description available.` This is both a cache difference and lost useful context. Use the existing resolved location projection consistently.

Grouping these ten family requests removes six of their seven internal owner switches. Applying the observed roughly ten-second warm/cold difference suggests **about one minute less prefill in this sample**, before any context-size reduction. That is a counterfactual estimate, not a measured implementation result; commits, new context and other queued work can change the benefit. Do not add this estimate to a separate context-shrinking estimate for the same requests.

## 2. Early-changing history and scene state invalidate large suffixes

| Dispatch UTC | Request | Prompt | Reused | Read | Prefill | TTFT |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 21:51:22 | Player action, after engine startup | 70,644 | 0 | 70,644 | 24.272 s | 24.435 s |
| 21:53:36 | Event checks | 78,885 | 23,619 | 55,266 | 17.821 s | 17.936 s |
| 21:57:51 | Event checks | 80,383 | 23,619 | 56,764 | 17.486 s | 17.612 s |
| 22:27:43 | Player action | 73,124 | 2,633 | 70,491 | 23.889 s | 23.967 s |
| 22:30:33 | Event checks | 82,770 | 2,633 | 80,137 | 27.389 s | 27.520 s |
| 22:33:50 | Player action | 73,438 | 2,633 | 70,805 | 24.740 s | 24.823 s |
| 22:36:37 | Event checks | 81,749 | 28,548 | 53,201 | 18.362 s | 18.554 s |

The initial cold request follows the native engine startup at **16:50:42 local / 21:50:42 UTC**, native line **159903**. It is not evidence that the first request's cache policy is broken. An in-memory cache cannot survive that process restart.

Later misses have concrete source-text changes:

- Between the 21:55/21:58 and 22:27 contexts, an older-story absent-character annotation drops `Warlord Luna`; the first difference is only **45,765 characters** into generation text. This is a rewrite inside older history, not just a new action appended at the end.
- Between the 22:27 player-action context and its 22:30 event context, `<olderStoryHistory>` grows at about **65,398 characters**, before the world/NPC index. Moving history between recent and older blocks changes the early prefix even if most facts are unchanged.
- Between the 21:51 action and event contexts, an existing status duration changes from 2 to 1; between 21:55 action/events, another changes from 3 to 1. These changes appear in scene NPC state before the large player/party suffix.
- Between the 22:33 action and 22:36 event contexts, an unchanged tracker's `lastUpdated` age changes from `...48 minutes ago` to `...49 minutes ago`, around character **236,503**. This is much later, so a suitably retained checkpoint should let most context survive, but the event request only reused 28,548 tokens.

The current [base template](../prompts/base-context.xml.njk:207) orders older history before the all-NPC index, world outline and factions. Its pinned stable boundary follows those blocks, before scene context. Scene location/NPCs precede the player/party, and tracker continuity precedes recent history. In one family request, older history alone is **71,368 characters**, player detail **24,961**, and recent history **24,003**. Prefix ordering is consequential at these sizes.

Recommended changes:

1. **Keep historical projections stable where their facts have not changed.** Avoid recomputing old absence annotations from present-day membership if that is the source of the rewrite; verify the history builder first. Prefer canonical historical timestamps over repeatedly aged prose where chronology remains clear from a separately supplied current clock.
2. **Put slowly changing reference blocks ahead of rolling history and scene state.** Separate long stable descriptions/definitions from changing health, needs, durations, memberships, location selection and elapsed-age labels. Keep fresh authoritative state in the request; only its placement/projection should change.
3. **Retain a useful checkpoint before each measured volatile region.** The app already adds message-boundary markers. Those do not guarantee native checkpoints at those boundaries. Existing Strata pinning protects one designated prefix, not arbitrary later blocks.
4. Preserve the existing [batched history rollover](classes/base_context_history.md). The named Strata profile already requests `recent_history_batch_interval: 10`; do not assume per-turn rolling is enabled or simply increase the interval without checking actual effective configuration and context growth.

Actual changed state, new story evidence and new task instructions still require evaluation. These changes can substantially reduce the reread suffix; they cannot make every request a full hit.

## 3. Conversation retention and checkpoint placement amplify misses

The native startup command in this session uses **`--conversation-cache-mib 4096`** and **`--conversation-cache-min-free-mib 16384`**, with no explicit spread/minimum-conversation-size options. Within matched native lines 159958–161287 there are **70 `skip parking` messages**, repeatedly reporting snapshots around **1.7–2.1 GiB** exceeding the remaining budget. This is direct evidence of retention pressure, not proof that every such message causes the next miss.

Examples:

- Before the 22:33 near-cold player-action start, the log says there is no room beside the parked conversation and then restores only a **2,633-token checkpoint** (lines **160675–160678**).
- A short region-level request parks **1,046 tokens**; NPC name and alias work later parks **1,167** and **460 tokens**, while large snapshots are refused (lines **160894**, **161201–161217**). Short contexts consume entries/bytes despite low recomputation cost.
- Returning to a long request can therefore require substantial prefill even though it shares much of its source text with an earlier request. Unavailable or poorly placed checkpoints are a separate issue from actual prefix changes.

The installed executable contains options for **`--prompt-cache-spread`** and **`--conversation-cache-min-tokens`**; their native behavior is described in the [local engine documentation](/home/bart/tmp/codex/strata-ram-standby-pr2/src/docs/DETAILS.md:1130). Source defaults include six checkpoints and 16,384-token periodic intervals. The spread policy keeps checkpoints distributed back from the end; the minimum-token setting avoids parking short helper conversations. Neither is shown in this session's startup arguments.

Recommended evaluation, after reducing unnecessary context switches:

1. Trial **checkpoint spread** for late changes such as trackers or recent history, where a long common prefix exists but only the root/stable checkpoint survives. It cannot help a mismatch near the beginning of older history.
2. Trial a **minimum parked-conversation size above these short helpers**, so recomputably small requests do not displace expensive contexts. Choose the threshold from observed sizes and keep it below contexts worth retaining.
3. Measure actual snapshots and available cgroup/host memory before increasing the **4 GiB** retention budget. More capacity may help multiple active long conversations, but does not fix different prompt content and must respect the current 16 GiB free-memory floor and runtime containment.

These are future configuration experiments, not settings changed by the audit. Any required runtime restart needs user permission. The existing [disk-session proposal](strata_disk_context_cache.md) is a later option for genuine long-lived context switching or restart recovery; adding full disk saves/restores between every helper is not the first remedy.

## 4. Helpers carry large or inconsistent base contexts

| Request | Newly read | Prefill | Concrete observation |
| --- | ---: | ---: | --- |
| Region stub locations | 70,712 | 23.810 s | Shares only 2,633 tokens; `<setting><description>` switches to a compact setting summary about 496 characters into generation text. |
| NPC progression, first pass | 65,223 | 21.709 s | Comes after short name/alias requests and only reuses the 2,633-token root. |
| NPC progression, second pass | 50,241 | 16.620 s | New NPCs enter the sorted global `<allNpcs>` list, changing the prefix around character 87,273. |
| Plot analysis | 70,251 | 24.133 s | Full cold read despite identical logged base system text and substantial shared generation text; retention/checkpoint or wire-prefix differences remain relevant. |
| Quest checks, two calls | 81,321 total | 25.853 s | Each rereads roughly 40–41K tokens from a 69K-token request. |
| Housekeeping | 45,886 | 14.594 s | 69,505-token request. |
| Tonal-scale evaluation | 42,632 | 14.729 s | 66,251-token request. |

For standard-family authoring, progression allocation and focused world generation, build a deliberate task-specific projection with the required entities, setting, mechanics and output rules. For plot, quest, housekeeping and tonal review, broad narrative context may be necessary; first remove irrelevant mechanics and stabilize the shared prefix while retaining the history each task actually reviews. Do not omit relevant quest evidence or continuity merely to achieve a cache hit.

The compact setting description should either be used consistently within a reusable prompt cohort or be placed in task context rather than overriding a canonical early shared setting field. Current `prompt_uses_caching: true` deliberately ignores several omission flags in [base-context.xml.njk](../prompts/base-context.xml.njk:31), so setting those flags alone will not shrink these requests. Use an explicit, documented context policy if implementing selective helpers.

The 12,053-character base system text is identical across the audited base-context families. There is no source-log evidence that random system text or a prepended cachebuster is the principal problem; the named Strata profile has cachebusting disabled. Identical logged system text does **not** establish identical tokenized system prefixes: provider chat templates can incorporate tool schemas. Execution-scoped tool changes are a plausible additional invalidator, but the available normal prompt logs do not retain enough wire payload detail to assign an exact cost to them here. Keep existing tool permissions; do not expose prohibited tools merely to stabilize caching.

## 5. Separate cache stalls from other latency

Latency is strong cache evidence here because native prefill closely tracks TTFT. Still separate:

- **Pre-dispatch delay:** the 22:31 quest check waits **53.761 seconds** from logical completion start to dispatch, then another **12.777 seconds** for first output. The roughly 66.5-second startup is not 66.5 seconds of cache miss. The 22:33 player-action start similarly includes **17.906 seconds** before dispatch plus **24.823 seconds** TTFT. These values can include queueing and preparation; they are not decode time.
- **Cumulative continuation delay:** several live-rewrite continuations have long logical-start-to-dispatch times because previous transports in the same completion already ran. Do not interpret those cumulative values as independently queued waits or add them together.
- **Validation and output time:** region NPC generation takes six attempts, but only the first rereads 10,651 tokens. Later attempts reread **78–82 tokens** with **0.50–0.61-second TTFT**, despite their XML guard failures. Fixing those failures would reduce output/retry cost, not eliminate repeated 80K-token prefill; that repeated prefill is not happening there.
- **Small cold helpers:** name, aliases, region level and the two completed equipment selections consume only **7.410 seconds** of prefill combined. Their zero reuse percentage is a low priority compared with repeated 39K-token inventory rereads.

## Suggested implementation order and acceptance evidence

1. **Group NPC inventory work using native logical ownership**, and make roster/family location context consistent. Reproduce multiple NPCs in different stub locations at single-request concurrency; verify complete inventory programs no longer alternate and that subsequent same-owner family requests preserve a deep prefix. Target the observed 12–13-second versus 2.3-second gap, allowing measured new item/validation work.
2. **Shrink item-family and focused assignment contexts**, retaining full item/mod mechanics, hard constraints, relevant setting/lore, XML validation, canonical family reuse and save semantics. Compare both first-request size and repeated-request prefill; no semantic information required by the task may disappear.
3. **Stabilize and reorder base-context projections**, covering standard and TinyBrain paths. Verify healthy chronological history, correct absent-character evidence, new NPC indexing, durations, tracker timestamps and recent-history rollover. Measure first changed field and reusable token boundary, not just total prompt length.
4. **Evaluate checkpoint spread and parking thresholds**, then memory capacity only if needed. Use the same workload and lifecycle settings; record reused/read counts and native prefill. Keep output validation and tool-execution restrictions intact.
5. **Keep bounded correlation data for future audits:** provider response ID, actual tool-schema identity, shared-prefix boundary, native read/reused tokens and prefill duration. Existing response IDs and timing already work well; cached-token usage is missing from some streams. Any added detailed tracing should be opt-in and disabled after qualification.

Measure end-to-end user wait as well as TTFT and prefill. Report context reduction and cache-retention savings without double counting. No runtime implementation or benchmark of the proposed changes was performed for this audit.

## Implementation follow-up

The subsequent implementation addresses the avoidable issues while leaving early history changes alone:

- **Inventory operation ownership:** one native reservation covers each complete inventory operation, including roster, family resolution, expansion, correction and commit. NPC population starts lazy inventory programs sequentially when they inherit one owner, after its already-started ability/alias work settles. Independent owners still use configured parallel capacity. This closes the sibling interleaving path identified above. See [ItemBatchGenerationPlan](classes/ItemBatchGenerationPlan.md).
- **Focused item-family context:** family authoring retains the canonical setting, item/attribute/equipment/rarity/mod rules, hard seed constraints, relevant lore, and explicit owner/region/location context. Unrelated global indexes, story history, player/party state and trackers are excluded through an explicit context policy, including when ordinary caching mode ignores omission flags. It uses native base-context construction without launching irrelevant character-memory selection. Canonical catalogue reuse, scaling, XML correction and placement remain governed by their existing contracts. See [ItemReuseService](classes/ItemReuseService.md).
- **Consistent context projections:** scene descriptions retain available stub/blueprint/short descriptions. Location/region generation keeps the canonical setting description in the shared context and places caller-supplied setting text in the task section instead of replacing an early shared field.
- **Tool-free plot analysis:** automatic analysis now calls `LLMClient.chatCompletion` directly with `allowToolCalls: false`. Provider payloads omit tool/function definitions and use the ordinary disabled-tool policy; no plot-analysis tool loop runs. Background execution, cancellation, prompt logging, stale-result guards and parsed plot-state persistence remain. Its prompt explicitly requests analysis without tools. See [chat API](api/chat.md).
- **Uniform history selection and recent notices:** caching mode also ignores craft-history omission and places requested meta/admin extras after the shared context in `<supplementalPromptHistory>`. Status-summary and level-up notices appear by default only within `<recentStoryHistory>` for all ordinary/meta prompt cohorts, with caching enabled or disabled. They retain chronology without changing canonical older history or prose-turn counts; historical changes must not be applied again to authoritative current state. Direct history-tool selection remains independent. See [base_context_history](classes/base_context_history.md).
- **Image prompt writers:** requests lacking shared base context now receive the canonical current-scene wrapper. Their original image instructions and target facts stay after the task boundary. Already wrapped faction/seasonal requests retain their original context. Batched image instructions are in the task rather than appended to the shared system prompt, and direct/batched writers expose no tools. See [image API](api/images.md).
- **Disk protection across images:** the configured Strata image lifecycle saves its held session before VRAM release, then restores it after the image batch and GPU cleanup/recovery while retaining the same exclusive text gate. Recovery runs after cancellation/failure as well. Following the requested path change, `ai.strata_context_cache_directory` defaults to `/tmp`; the named Strata profile and native `slot_save_path` select `/c/tmp`. The new directory is prepared and the former `/d/tmp` directory is preserved. Exact runtime/file/response checks protect against restoring a stale or unrelated artifact. See [StrataImageContextCache](classes/StrataImageContextCache.md).
- **Native cache retention settings:** saved `--prompt-cache-spread` and `--conversation-cache-min-tokens 4096` in the existing [Strata run configuration](/home/bart/.local/share/strata/install/strata-davidau-iq3_s-plain-ram.json), using native `user_args` capture/merge/stamp semantics so future setup preserves them. The 4 GiB conversation budget, 16 GiB free-memory floor, model identity and concurrency are unchanged. The minimum exceeds the audited short name/alias/level/equipment contexts while preserving larger useful conversations. Before/after copies and the exact patch are under [tmp/cache-fixes-2026-11-13](../tmp/cache-fixes-2026-11-13).

These source/profile changes require the next ordinary application/model restart to take effect; no server or model was restarted during implementation. Offline profile verification confirms that all previous effective arguments are retained and every other configuration field is unchanged. Runtime latency savings remain to be measured after activation; the baseline's one-minute inventory estimate is not a post-change benchmark.

Broad progression, ability, region, plot, quest and housekeeping prompts keep required evidence: progression explicitly considers prior story development, ability assignment also serves existing characters, and region generation needs canonical naming, factions and world connections. Applying the item-family omission policy to these indiscriminately would remove relevant facts. The later history-filter changes above follow explicit additional user instructions; no global rollover, historical annotation or scene-summary algorithm was changed.

Validation used mocked providers/services and native offline configuration parsing. The affected cache/history/inventory/tool suite passed 160 tests; final disk/image checks passed 54 tests, and the final narrow history run passed 27 tests including summary-only/blank notices. Additional scene-summary history edge checks and logs are recorded under [tmp/cache-fixes-2026-11-13](../tmp/cache-fixes-2026-11-13). These suites overlap and their counts are not an additive unique-test total. Coverage includes retained queue ownership, shared-parent siblings, canonical setting/stub projections, focused family pins, tool-free plot payloads, recent notice boundaries, meta extras, image writer wrapping/batching, snapshot identity/files/counts, exact empty-session handling, cancellation, recovery error aggregation and retained failure artifacts. No live SAVE/RESTORE, model restart or post-change latency benchmark has been run.

## Region-generation follow-up

The region/location audit of `logs/logs_prev` attributed about 438 s of 1,070 s to cache misses. Beyond the setting-description fix above:

- **Task location after the shared prefix:** per-NPC/inventory `locationOverride` no longer rewrites the game-state location section (about 28k tokens into the prompt); the target location is a `<taskLocation>` block after the base-context end marker. See "Task locations" in [server_llm_notes](server_llm_notes.md).
- **Small prompts on the base context:** alias, equip-best, item-name regeneration, ability attachment authoring (selection and authoring) and starting techniques now reuse the shared prefix instead of evicting the single cache slot with their own system prompts. `npc_name_regen` already ran inside the generator conversation and is unchanged.


## Location-things and inventory follow-up (2026-11-14 logs)

- **Override builds leaked task-location data into the shared prefix.** Location-things shared only 34% of its text with location generation. Technique summaries, NPC memory selection, relationship lists and mod scene contributions (the nsfw-boost trait vocabulary) were still derived from the task location's characters. Ability attachments after inventory kept only 28,903 cached tokens and re-prefilled about 57k (about 18 s). `buildBasePromptContext` now returns the player-location build with only the task location fields overlaid; see "Task locations" in [server_llm_notes](server_llm_notes.md).
- **Inventory rosters re-prefilled the family catalogue for every NPC.** The roster task section is about 41k characters, 36k of which is `<reusableFamilies>`, identical across NPCs, but it followed the NPC's `<character>` block. Each roster spent about 10 s before first output. `_includes/item-batch-plan-reference.njk` now renders before `<character>` in `inventory-generator.njk`, so consecutive rosters differ only in the last few hundred characters.
