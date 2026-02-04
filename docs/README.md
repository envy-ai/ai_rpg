# Docs Table of Contents

This index lists every other Markdown file under `docs/` with a brief description.

## Root docs

- [API_README.md](API_README.md) — High-level index of Express routes registered in `api.js`, pointing to detailed endpoint docs in `docs/api/`.
- [developer_overview.md](developer_overview.md) — Quick-start developer overview of the game, architecture, and where to look first.
- [potential_redundancies.md](potential_redundancies.md) — List of potential redundancies/inconsistencies found across docs and code, with suggested fixes.
- [server_llm_notes.md](server_llm_notes.md) — Deep notes on `server.js`, `api.js`, `Events.js`, and `LLMClient.js` responsibilities and flow.
- [slash_commands.md](slash_commands.md) — Quick guide to slash command lifecycle, shape, arg parsing, interaction API, best practices, example, and testing.
- [slop_and_repetition.md](slop_and_repetition.md) — Overview of slop checking and repetition-busting systems, detection logic, and key files.

## UI docs (`docs/ui`)

- [ui/README.md](ui/README.md) — UI documentation index and scope.
- [ui/pages.md](ui/pages.md) — Route-to-template map with scripts and injected data.
- [ui/chat_interface.md](ui/chat_interface.md) — Main chat UI layout, behavior, data flow, and LLM modal submit behavior.
- [ui/modals_overlays.md](ui/modals_overlays.md) — Inventory of chat-page modals/overlays, including immediate-close LLM modals.
- [ui/maps.md](ui/maps.md) — Region and world map rendering and interactions.
- [ui/assets_styles.md](ui/assets_styles.md) — Styling, assets, and vendor libraries.

## API reference (`docs/api`)

- [api/attributes.md](api/attributes.md) — Attributes endpoints; notes the duplicate route definitions in `api.js` and that only the first binds.
- [api/chat.md](api/chat.md) — Chat endpoints, sorted by path; references shared payloads in `docs/api/common.md`.
- [api/common.md](api/common.md) — Shared response shapes and conventions referenced by multiple endpoints.
- [api/crafting.md](api/crafting.md) — Crafting endpoints; references shared payloads in `docs/api/common.md`.
- [api/factions.md](api/factions.md) — Faction listing and player standings endpoints.
- [api/game.md](api/game.md) — Game lifecycle endpoints; references shared payloads in `docs/api/common.md`.
- [api/images.md](api/images.md) — Image generation and job endpoints; references job shapes in `docs/api/common.md`.
- [api/locations.md](api/locations.md) — Location and exit endpoints; references shared shapes in `docs/api/serialization.md`.
- [api/lorebooks.md](api/lorebooks.md) — Lorebook listing endpoints with metadata details.
- [api/map.md](api/map.md) — Legacy index for map endpoints; points to newer docs.
- [api/misc.md](api/misc.md) — Misc/utility endpoints (currently the image-gen feature flag).
- [api/npcs.md](api/npcs.md) — NPC endpoints; references shared payloads in `docs/api/common.md`.
- [api/players.md](api/players.md) — Player and party endpoints; references shared payloads in `docs/api/common.md`.
- [api/quests.md](api/quests.md) — Quest endpoints; references shared payloads in `docs/api/common.md`.
- [api/regions.md](api/regions.md) — Region endpoints; references shared payloads in `docs/api/common.md`.
- [api/serialization.md](api/serialization.md) — Legacy index for shared shapes; points to `docs/api/common.md` as authoritative.
- [api/settings.md](api/settings.md) — Settings endpoints; references shared payloads in `docs/api/common.md`.
- [api/things.md](api/things.md) — Things and inventory endpoints; references shared payloads in `docs/api/common.md`.

## Class reference (`docs/classes`)

- [classes/ComfyUIClient.md](classes/ComfyUIClient.md) — Client for ComfyUI servers: queue workflows, poll status, download images, and save results.
- [classes/Events.md](classes/Events.md) — LLM-based event checks that parse structured outcomes and apply world mutations, including NPC name normalization details.
- [classes/Faction.md](classes/Faction.md) — Faction model with goals/tags/relations/assets/reputation and static indexes.
- [classes/Globals.md](classes/Globals.md) — Centralized static state/helpers for current player, locations, regions, and prompt wiring.
- [classes/LLMClient.md](classes/LLMClient.md) — LLM chat client with concurrency, streaming, retries, prompt logging, and cancellation utilities.
- [classes/Location.md](classes/Location.md) — Location model (description, exits, NPCs, items, status effects) with stub promotion support.
- [classes/LocationExit.md](classes/LocationExit.md) — Connection between locations/regions, with optional vehicle semantics and bidirectional travel.
- [classes/LorebookManager.md](classes/LorebookManager.md) — Lorebook manager for JSON lorebooks: load, enable/disable, keyword match, and prompt injection.
- [classes/ModLoader.md](classes/ModLoader.md) — Mod loader for `mods/` with per-mod scope helpers, configs, and client asset discovery.
- [classes/NanoGPTImageClient.md](classes/NanoGPTImageClient.md) — NanoGPT image generation client that saves returned base64 images to disk.
- [classes/OpenAIImageClient.md](classes/OpenAIImageClient.md) — OpenAI image generation client that saves returned base64 images to disk.
- [classes/Player.md](classes/Player.md) — Player/NPC model (attributes, skills, inventory, gear, needs, quests) with shared definitions.
- [classes/Quest.md](classes/Quest.md) — Quest model with objectives/rewards/giver info, completion state, and static indexes.
- [classes/QuestConfirmationManager.md](classes/QuestConfirmationManager.md) — Manages async quest confirmations per client via `Globals.emitToClient`.
- [classes/RealtimeHub.md](classes/RealtimeHub.md) — WebSocket hub for realtime updates with targeted send, broadcast, and typed emits.
- [classes/Region.md](classes/Region.md) — Region model containing locations, metadata, random events, and status effects.
- [classes/SanitizedStringMap.md](classes/SanitizedStringMap.md) — Map wrapper that normalizes string keys for case/punctuation-insensitive lookup.
- [classes/SanitizedStringSet.md](classes/SanitizedStringSet.md) — Set wrapper that normalizes string values for case/punctuation-insensitive lookup.
- [classes/SceneSummaries.md](classes/SceneSummaries.md) — Stores scene summaries from chat history and tracks scene ranges and NPC names.
- [classes/SettingInfo.md](classes/SettingInfo.md) — Game setting/world configuration (theme/genre/prompts/defaults) with persistence support.
- [classes/Skill.md](classes/Skill.md) — Skill model with name, description, and optional attribute association.
- [classes/StatusEffect.md](classes/StatusEffect.md) — Status effect model for modifiers, need-bar deltas, and duration semantics.
- [classes/Thing.md](classes/Thing.md) — Item/scenery model with rarity, bonuses, status effects, placement, and indexes.
- [classes/Utils.md](classes/Utils.md) — Utility helpers (set math, text similarity, XML parsing, serialization, stub maintenance, capitalizeProperNoun options).

## Design ideas (`docs/ideas`)

- [ideas/DayNightCycle.md](ideas/DayNightCycle.md) — Design draft for a day/night cycle affecting danger, services, and NPC behavior.
- [ideas/Factions.md](ideas/Factions.md) — Design draft for faction systems and emergent conflict/cooperation.
- [ideas/dramatis_personae.md](ideas/dramatis_personae.md) — Brainstorm for a nemesis-style, setting-agnostic recurring NPC cast system.
- [ideas/Vechicles2.md](ideas/Vechicles2.md) — Setting-agnostic vehicle brainstorm across items, scenery, NPCs, locations, and regions.
- [ideas/vehicles.md](ideas/vehicles.md) — Brainstorm of vehicle concepts spanning items, scenery, NPCs, locations, and regions.

## Slash command reference (`docs/slashcommands`)

- [slashcommands/Command.md](slashcommands/Command.md) — `/awardxp` command to grant experience points.
- [slashcommands/ExportHistoryCommand.md](slashcommands/ExportHistoryCommand.md) — `/export_history` command to export chat history to text/HTML.
- [slashcommands/GetConfigCommand.md](slashcommands/GetConfigCommand.md) — `/get` command to retrieve a nested config value.
- [slashcommands/HealCommand.md](slashcommands/HealCommand.md) — `/heal` (alias `/resurrect`) command to restore NPC health and clear death.
- [slashcommands/HelpCommand.md](slashcommands/HelpCommand.md) — `/help` command to list available slash commands and usage.
- [slashcommands/IncapacitateCommand.md](slashcommands/IncapacitateCommand.md) — `/incapacitate` command to drop an NPC to zero health without killing.
- [slashcommands/KillCommand.md](slashcommands/KillCommand.md) — `/kill` command to immediately kill an NPC by name.
- [slashcommands/RandomCommand.md](slashcommands/RandomCommand.md) — `/random` command to trigger a random event by type.
- [slashcommands/RegexReplaceCommand.md](slashcommands/RegexReplaceCommand.md) — `/regex_replace` command to run regex replacement across chat history.
- [slashcommands/ReloadConfigCommand.md](slashcommands/ReloadConfigCommand.md) — `/reload_config` command to reload config files and definition caches.
- [slashcommands/ReloadLorebooksCommand.md](slashcommands/ReloadLorebooksCommand.md) — `/reload_lorebooks` command to reload lorebooks from disk.
- [slashcommands/RespecAbilitiesCommand.md](slashcommands/RespecAbilitiesCommand.md) — `/respec_abilities` command to regenerate abilities from a start level.
- [slashcommands/RpCommand.md](slashcommands/RpCommand.md) — `/rp` command to toggle roleplay mode and related config checks.
- [slashcommands/SceneSummaryCommand.md](slashcommands/SceneSummaryCommand.md) — `/summarize` (alias `/scene_summary`) command to export scene summaries.
- [slashcommands/ShortDescriptionCheckCommand.md](slashcommands/ShortDescriptionCheckCommand.md) — `/short_description_check` command to list missing short descriptions for regions, locations, things, and abilities.
- [slashcommands/SetConfigCommand.md](slashcommands/SetConfigCommand.md) — `/set` command to update a nested config value at runtime.
- [slashcommands/SlashCommandBase.md](slashcommands/SlashCommandBase.md) — Base class for slash commands: metadata, arg validation, and listing.
- [slashcommands/SlopwordsCommand.md](slashcommands/SlopwordsCommand.md) — `/slopwords` command to report slop words over ppm thresholds.
- [slashcommands/TeleportCommand.md](slashcommands/TeleportCommand.md) — `/teleport` command to move the player to a location by id or name.
- [slashcommands/WorldOutlineCommand.md](slashcommands/WorldOutlineCommand.md) — `/world_outline` command to list regions, locations, and pending stubs.
