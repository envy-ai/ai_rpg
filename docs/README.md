# Docs Table of Contents

This index lists every other Markdown file under `docs/` with a brief description.

## Root docs

- [API_README.md](API_README.md) — High-level index of Express routes registered in `api.js`, pointing to detailed endpoint docs in `docs/api/`.
- [config.md](config.md) — Configuration options for gameplay behavior (including point pool formulas, AI `custom_args` payload injection with per-key override merging, AI `headers` request-header injection with per-key override merging and null-delete semantics, extensible `random_event_frequency` file-based event types, faction generation count behavior (extras accepted), world-time config, slop-remover base attempts, supplemental/offscreen NPC prompt cadence with turn-cap safety limits, `recent_history_turns` vs `client_message_history` history-window behavior, plot-expander cadence config, and startup `--config-override` YAML layering).
- [developer_overview.md](developer_overview.md) — Quick-start developer overview of the game, architecture, and where to look first.
- [potential_redundancies.md](potential_redundancies.md) — List of potential redundancies/inconsistencies found across docs and code, with suggested fixes.
- [playwright.md](playwright.md) — Playwright browser test setup and run commands for headless/headed Chromium, including same-user existing-X-session helper usage, one-off new-game flow automation, and a one-off settings-page capture/validation script for live UI snapshots.
- [server_llm_notes.md](server_llm_notes.md) — Deep notes on `server.js`, `api.js`, `Events.js`, and `LLMClient.js` responsibilities and flow (including ComfyUI init behavior, supplemental/offscreen/plot-summary/plot-expander hidden-prompt scheduling behavior plus missing-counter immediate-run fallback on load, calendar-generation prompt behavior including Earth-like => Gregorian guidance plus Gregorian fallback, season `timeDescriptions`, region weather parsing/persistence, compact end-of-base-context conditions with 24-hour time and weather-aware omission, normalized punctuation-insensitive faction-name resolution with warning+none fallback on unmatched names, three-stage faction generation prompts (core roster -> relationships -> reputation tiers) with per-stage up-to-3 retry behavior, relation-neutral defaults plus missing-asset tolerance, defensive region-entry stub controlling-faction reconciliation, region-entry stub cleanup from runtime+index stores, load-time stale faction-reference reconciliation, retry-time AI override/config refresh in LLM calls, formula-driven NPC skill/attribute progression with budget logging, NPC race/class representation guidance plus contemplation steps in generation prompts, event-summary filtering, scene-summary fallback filtering for hidden/event-status blocks, scene-summarizer input filtering that keeps hidden entries while excluding event/status blocks, overlap-aware and compact-rendered scene-detail inclusion in older-story history, per-minute status-effect ticking with `appliedAt` tracking, success-gated `<playerAction>` inclusion in event-check prompts, travel move-lock and strict graph-integrity checks, standardized prompt logging via `LLMClient.logPrompt` across summarize/disposition/NPC-memory/setting-autofill and region/location/NPC generation flows, and craft-history filtering).
- [slash_commands.md](slash_commands.md) — Quick guide to slash command lifecycle, shape, arg parsing, interaction API, best practices, example, and testing.
- [slop_and_repetition.md](slop_and_repetition.md) — Overview of slop checking and repetition-busting systems, including configured-PPM ngram filtering (`defs/slopwords.yaml` `ngrams`), active-setting `customSlopWords` additions (single-word => slop words, multi-word => ngrams), game-intro slop-removal coverage, travel prose output normalization, and detection logic (including retained `could`/`would` variants plus NPC name/alias token exclusion in k-gram normalization).

## UI docs (`docs/ui`)

- [ui/README.md](ui/README.md) — UI documentation index and scope.
- [ui/pages.md](ui/pages.md) — Route-to-template map with scripts, injected data, and key form notes (including default skills prefill, new-game skill add/remove plus start-time hour input, remote new-game form settings save/load, blank-safe attribute alias matching during load, load-time NPC-alias generation confirmation for legacy saves, master-detail settings manager layout with tabbed editor sections, stable tab pill sizing, container-scoped library/editor scrolling, search/sort library controls, settings prompt-guidance custom slop words list behavior, region edit modal parent/faction field handling, settings rename/new-id behavior, persistent settings delete behavior, shared allocation partials, and allocation pool behavior/timing).
- [ui/chat_interface.md](ui/chat_interface.md) — Main chat UI layout, behavior, data flow, player-point warning indicator behavior, left-sidebar world-time indicator + transition summaries + unlabeled light-level line + conditional weather line + weather/light-threshold event summaries (with no-weather light-update suppression), player-view modal point allocation flow (including in-modal skill add/remove for player view and hidden unspent-point totals in non-player NPC views), player/NPC edit modal aliases list support (one alias per line), inventory modal filter persistence across equip/unequip refreshes, floating prompt-progress overlay behavior (including cancel/retry controls, contract/expand, header drag + resize handles, and a 3.5-second empty-state debounce via hidden placeholder row), location thing drag/drop behavior (item inventory drops plus item/scenery conversion between grids), item/scenery create-modal optional-name behavior, faction creation modal + AI fill-missing precreate flow, LLM modal submit behavior (including no-prose craft/process/salvage/harvest submits), location exit caching, direct-move origin verification (`expectedOriginLocationId`), and client-history cap behavior independent from base-context recent-history segmentation.
- [ui/modals_overlays.md](ui/modals_overlays.md) — Inventory of chat-page modals/overlays and tooltip behaviors (including status effect selectors/details, attribute bonus visibility, single-scroll character view allocation sections, and hidden unspent-point totals in non-player NPC views), plus immediate-close LLM modals.
- [ui/maps.md](ui/maps.md) — Region and world map rendering and interactions.
- [ui/assets_styles.md](ui/assets_styles.md) — Styling, assets, and vendor libraries (plus shared entity theming primitives, shared `npc-list-editor-*` modal classes with legacy compatibility notes, long-name downscale via `.entity-name-long` with `1.25` base line-height behavior for regular names, skill allocation class hooks, and visibility-based warning spacing).

## API reference (`docs/api`)

- [api/attributes.md](api/attributes.md) — Attributes endpoints; notes the duplicate route definitions in `api.js` and that only the first binds.
- [api/chat.md](api/chat.md) — Chat endpoints, sorted by path; documents travel-prose split event payloads (including move-turn `item_appear`/`scenery_appear` handling), world-time payloads, destination stub creation, move-lock `409` behavior for overlapping travel actions, authoritative movement lookups against `gameLocations`, `?` question-action routing (`user-question`/`storyteller-answer` entries, slop-remover bypass), `@`/`@@`/`@@@` generic prompt routing with persistence modes, server-only supplemental/offscreen/plot-summary/plot-expander hidden story-note entries and cadence rules (including server-side NPC relocation when offscreen activity marks `moved=true`), and `client_message_history.max_messages` turn-capped `/api/chat/history` behavior (separate from `recent_history_turns`), plus shared payload references in `docs/api/common.md`.
- [api/common.md](api/common.md) — Shared response shapes and conventions referenced by multiple endpoints (including hidden ChatEntry types, StatusEffect modifier fields, and unspent attribute point fields on actor payloads).
- [api/crafting.md](api/crafting.md) — Crafting endpoints (including `timeTaken`-driven world-time advancement with malformed-value fallback and minimum 1-minute advance, `noProse` execution mode, deterministic summary wording with `from`/`using` source context, and the `player-action-craft` XML prose contract); references shared payloads in `docs/api/common.md`.
- [api/factions.md](api/factions.md) — Faction listing/CRUD, player standings endpoints, and AI fill-missing endpoint for partial faction creation payloads (including explicit nested-XML autofill schema guidance, robust relation/tier/asset format parsing, quote-insensitive relation name mapping, and detailed autofill-missing errors).
- [api/game.md](api/game.md) — Game lifecycle endpoints (including new-game form settings save/load/list APIs, start-time hour input handling, save-path server logging on successful saves/autosaves, save/load metadata `npcAliasesGenerated` handling, calendar generation/regeneration behavior with Earth-like Gregorian prompt guidance plus season/holiday/time-of-day descriptions, and optional unspent attribute point input); references shared payloads in `docs/api/common.md` and notes settings-sourced skills for new games.
- [api/images.md](api/images.md) — Image generation and job endpoints; references job shapes in `docs/api/common.md`, including automatic `baseContextPreamble` prepending for image prompts.
- [api/locations.md](api/locations.md) — Location and exit endpoints (including optional-name item/scenery generation on `POST /api/locations/:id/things`); references shared shapes in `docs/api/serialization.md`.
- [api/lorebooks.md](api/lorebooks.md) — Lorebook listing endpoints with metadata details.
- [api/map.md](api/map.md) — Legacy index for map endpoints; points to newer docs.
- [api/misc.md](api/misc.md) — Misc/utility endpoints (feature flags, prompt cancel, and prompt retry controls).
- [api/npcs.md](api/npcs.md) — NPC endpoints (including bulk `/api/npcs/generate-aliases` batching at 20 NPCs per prompt and metadata persistence, plus alias editing support in `PUT /api/npcs/:id`); references shared payloads in `docs/api/common.md`.
- [api/players.md](api/players.md) — Player and party endpoints (including strict `/api/player/move` origin verification + move-lock behavior, level-up chat logging with base-context history exclusion, plus admin stats updates with runtime registration of newly submitted skill names and definition-based attribute validation in `/api/player/update-stats`); references shared payloads in `docs/api/common.md`.
- [api/quests.md](api/quests.md) — Quest endpoints; references shared payloads in `docs/api/common.md`.
- [api/regions.md](api/regions.md) — Region endpoints; references shared payloads in `docs/api/common.md`.
- [api/serialization.md](api/serialization.md) — Legacy index for shared shapes; points to `docs/api/common.md` as authoritative.
- [api/settings.md](api/settings.md) — Settings endpoints (including AI fill-missing guidance, default-skill augmentation, `customSlopWords` parsing/autofill XML handling, rename-as-new-id updates, and persistent delete behavior); references shared payloads in `docs/api/common.md`.
- [api/things.md](api/things.md) — Things and inventory endpoints; references shared payloads in `docs/api/common.md`.

## Class reference (`docs/classes`)

- [classes/ComfyUIClient.md](classes/ComfyUIClient.md) — Client for ComfyUI servers: queue workflows, poll status, download images, and save results.
- [classes/Events.md](classes/Events.md) — LLM-based event checks that parse structured outcomes and apply world mutations, including move suppression for event-driven travel, move-turn appearance override support for `<travelProse>` checks, NPC name normalization details (including same-location leading-name resolution like `Bob` -> `Bob Ross`), robust arrow-delimiter parsing (`->` and unicode arrows such as `→`), item inflict handling, duplicate NPC-death no-op handling, and minimum one-minute advancement when `time_passed` is `0`.
- [classes/Faction.md](classes/Faction.md) — Faction model with goals/tags/relations/assets/reputation and static indexes.
- [classes/Globals.md](classes/Globals.md) — Centralized static state/helpers for current player, locations, regions, prompt wiring, and canonical world time/calendar utilities (including non-recursive world-time initialization/context flow, season/holiday descriptors in world-time context, season `timeDescriptions`-driven light level descriptions, and Gregorian fallback calendar generation).
- [classes/LLMClient.md](classes/LLMClient.md) — LLM chat client with concurrency, streaming, automatic + user-triggered retries, retry-time config/override refresh, prompt logging, cancellation utilities, and request payload notes.
- [classes/Location.md](classes/Location.md) — Location model (description, exits, NPCs, items, status effects) with stub promotion support, stub description/shortDescription prompting rules, authoritative stub handling behavior, and persisted `generationHints.hasWeather`.
- [classes/LocationExit.md](classes/LocationExit.md) — Connection between locations/regions, with optional vehicle semantics and bidirectional travel.
- [classes/LorebookManager.md](classes/LorebookManager.md) — Lorebook manager for JSON lorebooks: load, enable/disable, keyword match, and prompt injection.
- [classes/ModLoader.md](classes/ModLoader.md) — Mod loader for `mods/` with per-mod scope helpers, configs, and client asset discovery.
- [classes/NanoGPTImageClient.md](classes/NanoGPTImageClient.md) — NanoGPT image generation client that saves returned base64 images to disk.
- [classes/OpenAIImageClient.md](classes/OpenAIImageClient.md) — OpenAI image generation client that saves returned base64 images to disk.
- [classes/Player.md](classes/Player.md) — Player/NPC model (attributes, skills, aliases, unspent skill/attribute points, inventory, gear, needs, quests) with shared definitions, formula-derived live point pools, health-delta syncing when health-affecting attributes raise max HP, and party/location invariant enforcement for party members.
- [classes/Quest.md](classes/Quest.md) — Quest model with objectives/rewards/giver info, completion state, and static indexes.
- [classes/QuestConfirmationManager.md](classes/QuestConfirmationManager.md) — Manages async quest confirmations per client via `Globals.emitToClient`.
- [classes/RealtimeHub.md](classes/RealtimeHub.md) — WebSocket hub for realtime updates with targeted send, broadcast, and typed emits.
- [classes/Region.md](classes/Region.md) — Region model containing locations, metadata, random events, status effects, and dynamic weather definitions/state, including per-location short descriptions in blueprints, stub expansions, and authoritative controlling-faction handling for region-entry stubs.
- [classes/SanitizedStringMap.md](classes/SanitizedStringMap.md) — Map wrapper that normalizes string keys for case/punctuation-insensitive lookup.
- [classes/SanitizedStringSet.md](classes/SanitizedStringSet.md) — Set wrapper that normalizes string values for case/punctuation-insensitive lookup.
- [classes/SceneSummaries.md](classes/SceneSummaries.md) — Stores scene summaries from chat history, tracks scene ranges/per-scene detail lines/NPC names, and replaces overlapping scenes on re-summarization.
- [classes/SettingInfo.md](classes/SettingInfo.md) — Game setting/world configuration (theme/genre/prompts/defaults, including starting location instructions, default skill lists, and `customSlopWords`) with persistence support, including id-based saved-file deletion helpers and `baseContextPreamble` usage in image prompt execution.
- [classes/Skill.md](classes/Skill.md) — Skill model with name, description, and optional attribute association.
- [classes/StatusEffect.md](classes/StatusEffect.md) — Status effect model for modifiers, need-bar deltas, decimal-hour duration parsing (including minute/unit normalization), `appliedAt` tracking, and expiry semantics (negative=infinite, 0=expired).
- [classes/Thing.md](classes/Thing.md) — Item/scenery model with rarity, bonuses, status effects, placement, and indexes.
- [classes/Utils.md](classes/Utils.md) — Utility helpers (set math, text similarity, XML parsing, serialization including world-time/calendar persistence, stub maintenance, capitalizeProperNoun options).

## Design ideas (`docs/ideas`)

- [ideas/DayNightCycle.md](ideas/DayNightCycle.md) — Design draft for a day/night cycle affecting danger, services, and NPC behavior.
- [ideas/Factions.md](ideas/Factions.md) — Design draft for faction systems and emergent conflict/cooperation.
- [ideas/dramatis_personae.md](ideas/dramatis_personae.md) — Brainstorm for a nemesis-style, setting-agnostic recurring NPC cast system.
- [ideas/Vechicles2.md](ideas/Vechicles2.md) — Setting-agnostic vehicle brainstorm across items, scenery, NPCs, locations, and regions.
- [ideas/vehicles.md](ideas/vehicles.md) — Brainstorm of vehicle concepts spanning items, scenery, NPCs, locations, and regions.

## Slash command reference (`docs/slashcommands`)

- [slashcommands/Command.md](slashcommands/Command.md) — `/awardxp` command to grant experience points.
- [slashcommands/CalendarInfoCommand.md](slashcommands/CalendarInfoCommand.md) — `/calendar_info` (alias `/calendar`) command to display in-game calendar details in markdown.
- [slashcommands/ClearSecretsCommand.md](slashcommands/ClearSecretsCommand.md) — `/clear_secrets` command to remove hidden supplemental/offscreen story info entries.
- [slashcommands/ExportHistoryCommand.md](slashcommands/ExportHistoryCommand.md) — `/export_history` command to export chat history to text/HTML.
- [slashcommands/GameIntroCommand.md](slashcommands/GameIntroCommand.md) — `/game_intro` (alias `/intro`) command to generate and append intro narration.
- [slashcommands/GenerateMissingSkillsCommand.md](slashcommands/GenerateMissingSkillsCommand.md) — `/generate_missing_skills` (aliases `/skills_generate_missing`, `/regen_skill_metadata`) to list skills missing metadata and generate/fill them.
- [slashcommands/GetConfigCommand.md](slashcommands/GetConfigCommand.md) — `/get` command to retrieve a nested config value.
- [slashcommands/HealCommand.md](slashcommands/HealCommand.md) — `/heal` (alias `/resurrect`) command to restore NPC health and clear death.
- [slashcommands/HelpCommand.md](slashcommands/HelpCommand.md) — `/help` command to list available slash commands and usage.
- [slashcommands/IncapacitateCommand.md](slashcommands/IncapacitateCommand.md) — `/incapacitate` command to drop an NPC to zero health without killing.
- [slashcommands/KillCommand.md](slashcommands/KillCommand.md) — `/kill` command to immediately kill an NPC by name.
- [slashcommands/RandomCommand.md](slashcommands/RandomCommand.md) — `/random` command to trigger a random event by type.
- [slashcommands/RegexReplaceCommand.md](slashcommands/RegexReplaceCommand.md) — `/regex_replace` command to run regex replacement across chat history.
- [slashcommands/ReloadConfigCommand.md](slashcommands/ReloadConfigCommand.md) — `/reload_config` command to reload config files and definition caches.
- [slashcommands/ReloadLorebooksCommand.md](slashcommands/ReloadLorebooksCommand.md) — `/reload_lorebooks` command to reload lorebooks from disk.
- [slashcommands/RunPlotExpanderCommand.md](slashcommands/RunPlotExpanderCommand.md) — `/runplotexpander` command to run the plot-expander prompt immediately for a specified plot thread, storing it as hidden history and optionally echoing output with `true`.
- [slashcommands/RunPlotSummaryCommand.md](slashcommands/RunPlotSummaryCommand.md) — `/runplotsummary` command to run the plot-summary prompt immediately, storing it as hidden history and optionally echoing output with `true`.
- [slashcommands/RespecAbilitiesCommand.md](slashcommands/RespecAbilitiesCommand.md) — `/respec_abilities` command to regenerate abilities from a start level.
- [slashcommands/RpCommand.md](slashcommands/RpCommand.md) — `/rp` command to toggle roleplay mode and related config checks.
- [slashcommands/OrphanedLocationsCommand.md](slashcommands/OrphanedLocationsCommand.md) — `/orphaned_locations` command to list locations missing valid region links and/or usable exits.
- [slashcommands/SceneSummaryCommand.md](slashcommands/SceneSummaryCommand.md) — `/summarize` (alias `/scene_summary`) command to export scene summaries, including `all + redo=true` full rebuild behavior.
- [slashcommands/ShortDescriptionCheckCommand.md](slashcommands/ShortDescriptionCheckCommand.md) — `/short_description_check` command to list missing short descriptions for regions, locations, things, and abilities.
- [slashcommands/SetConfigCommand.md](slashcommands/SetConfigCommand.md) — `/set` command to update a nested config value at runtime.
- [slashcommands/SlashCommandBase.md](slashcommands/SlashCommandBase.md) — Base class for slash commands: metadata, arg validation, and listing.
- [slashcommands/SlopwordsCommand.md](slashcommands/SlopwordsCommand.md) — `/slopwords` command to report slop words over ppm thresholds.
- [slashcommands/TeleportCommand.md](slashcommands/TeleportCommand.md) — `/teleport` command to move the player to a location by id or name.
- [slashcommands/WeatherCommand.md](slashcommands/WeatherCommand.md) — `/weather` command to display current-region seasonal weather details in markdown.
- [slashcommands/WorldOutlineCommand.md](slashcommands/WorldOutlineCommand.md) — `/world_outline` command to list regions, locations, and pending stubs.
