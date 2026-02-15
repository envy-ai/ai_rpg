# StatusEffect

## Purpose
Represents a temporary or permanent modifier applied to an entity, including attribute/skill modifiers, need bar deltas, duration semantics, and applied-time tracking.

## Construction
- `new StatusEffect({ name, description, attributes, skills, needBars, duration, appliedAt })`
  - `description` is required and must be a non-empty string.
  - `attributes` and `skills` are arrays of `{ attribute|skill, modifier }`.
  - `needBars` is an array of `{ name, delta }`.
  - `duration` is normalized to **decimal hours**:
    - Strings with units are converted (`"30 minutes"` -> `0.5`, `"2 hours"` -> `2`).
    - Bare numeric strings and numeric inputs are treated as **minutes** (`5` -> `0.0833...`).
    - `'instant'` -> `1/60`, `'permanent'`/`'continuous'` -> `-1`.
    - When deserializing objects that already carry an `appliedAt` field, numeric durations are interpreted as already-normalized hours.
  - Any negative duration is treated as infinite and does not decrement; `0` means expired.
  - `appliedAt` is an optional non-negative world-time hour stamp used to compute elapsed minute ticks.
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
- `#normalizeDuration(value)`: converts duration inputs to decimal hours or null (throws on invalid inputs).
- `#normalizeAppliedAt(value)`: validates optional world-time application timestamp.

## Notes
- All normalizers throw clear errors on invalid structures or missing data.
- `generateFromDescriptions` fails loudly on malformed XML or missing effect elements.
