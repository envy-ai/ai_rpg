# PromptStatsCommand

## Purpose
Slash command `/promptstats` to inspect or clear persistent prompt output-character averages.

## Args
- `action` (string, optional): use `clear` to clear all stored prompt output-character averages.

## Behavior
- `/promptstats` replies with a markdown table of prompt labels, completed run counts, average output characters, and latest output characters.
- The table includes configured `prompt_progress.character_targets` labels/patterns with `null` averages when they have not run yet, plus any concrete labels stored in `logs/prompt-output-character-stats.json`.
- Character-appended stats for `inventory_generation`, `npc_memories`, `npc_progression_assignments`, `npc_ability_assignments`, and `npc_alias_assignments` appear under the base prompt label rather than as one row per character.
- `/promptstats clear` removes all stored prompt output-character averages and reports how many prompt entries were cleared.

## Notes
- The command uses `LLMClient` stats helpers, so the stats file is still validated loudly and clear writes use the same atomic temp-file rename path as normal stats updates.
