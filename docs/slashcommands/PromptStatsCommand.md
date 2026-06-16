# PromptStatsCommand

## Purpose
Slash command `/promptstats` inspects and clears persistent prompt output-character averages.

## Args
- `action` (string, optional): `clear` clears all stored prompt output-character averages. The command also accepts `clear` from raw slash-command argument text when the parsed `action` arg is absent.

## Behavior
- `/promptstats` replies publicly with a markdown table headed `Prompt Output Character Stats`.
- Table columns are `Prompt`, `Runs`, `Average Output Characters`, and `Last Output Characters`; numeric display values are rounded to the nearest integer, and missing averages or last-output counts display as `null`.
- Rows include normalized prompt labels stored in `logs/prompt-output-character-stats.json` and normalized configured `prompt_progress.character_targets` labels or wildcard patterns. Configured targets without stored runs appear with `0` runs and `null` output-character values.
- Rows are sorted by prompt label.
- Character-appended labels for `inventory_generation`, `npc_memories`, `npc_progression_assignments`, `npc_ability_assignments`, and `npc_alias_assignments` aggregate under the base prompt label instead of one row per character-specific prompt label.
- `/promptstats clear` replaces the stats file with an empty stats object and reports how many stored prompt entries were cleared.
- Any non-empty `action` other than `clear` throws `Unknown /promptstats option "...". Usage: /promptstats [clear]`.

## Notes
- The command uses `LLMClient` stats helpers. Loading validates the stats file and throws on invalid JSON, unsupported versions, non-normalized keys, invalid numeric values, or inconsistent zero-run entries. Clear writes use the atomic temp-file rename path shared with normal stats updates.
