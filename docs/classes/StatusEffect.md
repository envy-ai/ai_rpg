# StatusEffect

## Purpose
Represents a temporary or permanent modifier applied to an entity, including attribute/skill modifiers, need bar deltas, duration semantics, and applied-time tracking.

## Construction
- `new StatusEffect({ name, description, attributes, skills, needBars, duration, appliedAt })`
  - `description` is required and must be a non-empty string.
  - `attributes` and `skills` are arrays of `{ attribute|skill, modifier }`.
  - `needBars` is an array of `{ name, delta }`.
  - `duration` is normalized to **minutes**:
    - Accepted formats include `HH:MM`, integer minutes, and explicit day/hour/minute units.
    - Bare numeric strings and numeric inputs are treated as **minutes**.
    - `'instant'` -> `1`, `'permanent'`/`'continuous'` -> `-1`, `'none'`/`'n/a'` -> `null`.
    - Numeric values must be integer minute counts (non-integer values throw).
  - Any negative duration is treated as infinite and does not decrement; `0` means expired.
  - `appliedAt` is an optional non-negative world-time minute stamp used to compute elapsed minute ticks.
  - Invalid duration strings raise a clear error so malformed prompts are surfaced.

## Instance API
- `update({ name, description, attributes, skills, needBars, duration, appliedAt })`: normalizes and updates fields in place.
- `toJSON()`: returns a plain object snapshot.

## Static API
- `fromJSON(data)`: validates and constructs a StatusEffect from a plain object.
- `generateFromDescriptions(descriptions, { promptEnv, parseXMLTemplate, prepareBasePromptContext })`:
  - Takes a list of text descriptions (strings or objects with `description`, optional `name`, `level`).
  - Renders `base-context.xml.njk` and parses XML output from `LLMClient.chatCompletion`.
  - Validates and returns a `Map` keyed by source description with `StatusEffect` instances.
  - Logs prompts through `LLMClient.logPrompt` when available.

## Private Helpers
- `#normalizeModifiers(list, keyName)`: validates and normalizes attribute/skill modifier lists.
- `#normalizeNeedBars(list)`: validates and normalizes need bar deltas.
- `#normalizeDuration(value)`: converts duration inputs to canonical minutes or null (throws on invalid inputs).
- `#normalizeAppliedAt(value)`: validates optional world-time application timestamp.

## Notes
- All normalizers throw clear errors on invalid structures or missing data.
- Legacy save hour-to-minute conversion is handled at load migration time (`Utils.hydrateGameState`), not in `StatusEffect.fromJSON`.
- `generateFromDescriptions` fails loudly on malformed XML or missing effect elements.
