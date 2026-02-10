# GenerateMissingSkillsCommand

## Purpose
Slash command `/generate_missing_skills` to detect skills missing generated metadata, list them, and generate/fill their details.

## Aliases
- `/skills_generate_missing`
- `/regen_skill_metadata`

## Args
- None.

## Behavior
- Scans the runtime skill registry for skills with missing metadata fields.
  - Missing metadata is defined as blank/missing `description` or `attribute`.
- Replies with the pre-generation missing list.
- Runs skill metadata generation for those names using the same server generation pipeline used elsewhere.
- Writes generated results back to the runtime skill registry and `Player.availableSkills`.
- Replies with:
  - skills generated/filled this run
  - skills still missing metadata (if any)
