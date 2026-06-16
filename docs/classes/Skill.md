# Skill

## Purpose
`Skill` represents a reusable skill definition for the active game. A definition has a display name, a short description, and an optional associated attribute. Character-specific ranks are not stored on `Skill`; players and NPCs store skill ranks separately as `{ skillName: rank }` maps keyed by definition name.

## Data Shape

- `name`: required non-empty string. The constructor trims it and throws when the input is missing or not a string.
- `description`: optional string. Non-string input becomes `''`; string input is trimmed.
- `attribute`: optional string. Non-string input becomes `''`; string input is trimmed. Attack resolution can use this value as the preferred attack attribute when the selected attack skill has a matching definition.

## Instance API

- `new Skill({ name, description, attribute })`: constructs a trimmed skill definition and validates `name`.
- `update({ name, description, attribute } = {})`: mutates the definition and returns `this`. `name` updates only when it is a non-empty string after trimming; `description` and `attribute` update whenever the provided value is a string, including a string that trims to `''`.
- `toJSON()`: returns `{ name, description, attribute }` for API responses and save serialization.

## Static API

- `fromJSON(data)`: requires a non-null object and constructs a `Skill` from `data.name`, `data.description`, and `data.attribute`. Invalid objects or invalid names throw.

## Runtime Registry

The server keeps the active definitions in the module-level `skills` `Map`, keyed by canonical skill name. `Player.setAvailableSkills(...)` copies/coerces that registry into `Player.availableSkills`, and `Player.getAvailableSkills()` returns a defensive `Map` copy.

`Player` instances store ranks in their private skills map:

- When `Player.availableSkills` is non-empty, player/NPC construction initializes every available skill to the provided finite rank or rank `1`.
- When no available-skill registry exists, construction preserves provided rank entries.
- `setSkillValue(name, value)` rejects unknown names while `Player.availableSkills` is non-empty.
- `increaseSkill(name, amount)` requires a known non-empty skill name, a positive integer amount, and enough formula-derived unspent skill points.
- `syncSkillsWithAvailable()` fills missing available skills at rank `1` and removes ranks that are no longer in the available registry.

Unspent skill points are computed from `config.formulas.character_creation.skill_pool_formula` and the stored ranks. Direct setters for unspent skill points throw.

## Settings And Generation

`SettingInfo.defaultExistingSkills` stores skill names only. The settings page seeds that list from `defs/default_skills.yaml` for blank settings, and hide/perception settings store optional skill names from the same list.

During `/api/new-game`, the server:

- Reads the active setting's `defaultExistingSkills`.
- Normalizes non-empty skill names.
- Calls `generateSkillsByNames(...)` to populate descriptions and attributes from `prompts/skills-generator-by-name.xml.njk`.
- Creates name-only `Skill` definitions with empty metadata for requested names that do not receive generated metadata.
- Populates both the runtime `skills` map and `Player.availableSkills`.

Player and NPC update routes also register unknown submitted skill names. They canonicalize against existing registry entries case-insensitively, request metadata for missing names through `generateSkillsByNames(...)`, and insert the resulting `Skill` definitions before assigning ranks.

## Prompt And API Use

- Chat, player stats, and new-game responses expose available skills with `skill.toJSON()`.
- Base context and setting helper prompts pass the available skill names as `setting.skills`.
- NPC skill-assignment prompts receive skill names and descriptions from `Player.getAvailableSkills()`.
- The attack resolver looks up a skill definition by name and uses `skill.attribute` as the attack attribute when present.
- Status effects, item effects, and check payloads reference skills by name; their modifier entries are not `Skill` instances.

## Persistence

`Utils.serializeGameState(...)` writes the active skill definitions as an array of `{ name, description, attribute }` records in `skills.json`. Loading clears the runtime registry, reconstructs each valid entry with `Skill.fromJSON(...)`, skips invalid entries with a warning, and then calls `Player.setAvailableSkills(skills)`.

Players and NPCs persist their rank maps separately on their own `skills` fields.
