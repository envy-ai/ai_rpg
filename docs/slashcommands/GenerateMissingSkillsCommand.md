# GenerateMissingSkillsCommand

## Purpose
`/generate_missing_skills` scans the active skill registry for definitions without complete generated metadata and asks the shared skill-generation helper to populate descriptions and associated attributes.

The command is useful when skill names exist in the save/runtime registry but their `Skill` records have empty metadata.

## Aliases
- `/skills_generate_missing`
- `/regen_skill_metadata`

## Args
- None.

## Metadata Criteria
A skill counts as complete only when all of these are true:

- The registry entry is an object.
- `description` trims to a non-empty string.
- `attribute` trims to a non-empty string.
- `attribute` is not `n/a`, case-insensitively.

Blank names are ignored while scanning the registry.

## Execution Flow
- Uses `interaction.skillRegistry` when it is a `Map`; otherwise uses `Player.availableSkills` when that is a `Map`.
- Throws `Skill registry is unavailable in command context.` when neither registry source is available.
- Sorts missing skill names alphabetically with locale-aware, case-insensitive comparison.
- Replies `All registered skills already have generated metadata.` and stops when no skills are missing metadata.
- When `interaction.generateSkillsByNames` is unavailable, replies with the missing-skill list and does not write registry entries.
- Builds setting context through `interaction.getActiveSettingSnapshot()` and `interaction.describeSettingForPrompt(...)` when those helpers are available.
- Calls `interaction.generateSkillsByNames({ skillNames, settingDescription })`.
- Wraps thrown generation errors as `Skill metadata generation failed: ...`.
- For each missing name, merges generated metadata with any existing metadata, constructs a `Skill`, and writes it to both the selected registry and `Player.availableSkills` when available.
- Reports which skills have complete metadata after the write and which still fail the metadata criteria.

## Replies
Successful generation replies use markdown with these sections:

- `Missing before generation (N):`
- `Generated/filled (N):`
- `Still missing metadata (N):` when any generated entries remain incomplete

Empty bullet lists render as `- None`.

## Generation Helper Behavior
The command relies on the shared `generateSkillsByNames(...)` helper exposed by `api.js`. That helper renders `prompts/skills-generator-by-name.xml.njk`, calls `LLMClient.chatCompletion(...)` with metadata label `skill_generation_by_name`, logs prompts through `LLMClient.logPrompt(...)`, parses `<skill>` XML, and returns one `Skill` per requested name.

If the helper cannot render prompts, lacks configured AI backend, receives no matching parsed skill, or catches a generation error internally, it returns name-only `Skill` records with empty metadata for affected names. The command writes those records and lists them under `Still missing metadata`.

## Registration And Help
- Implementation: `slashcommands/generate_missing_skills.js`.
- `SlashCommandRegistry` loads the command from the `slashcommands/` directory and registers the canonical name plus aliases.
- `/help` lists the canonical `/generate_missing_skills` entry through `SlashCommandBase.listCommands()`; aliases are accepted for dispatch but are not separate help entries.

## Persistence
The command mutates the live skill registry and `Player.availableSkills`. It does not call `interaction.performGameSave(...)`; the updated skill definitions persist when the game state is saved through the normal save path.
