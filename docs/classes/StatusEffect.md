# StatusEffect

## Purpose
Represents a temporary or permanent modifier applied to an entity, including attribute/skill modifiers, need bar deltas, and duration semantics.

## Construction
- `new StatusEffect({ name, description, attributes, skills, needBars, duration })`
  - `description` is required and must be a non-empty string.
  - `attributes` and `skills` are arrays of `{ attribute|skill, modifier }`.
  - `needBars` is an array of `{ name, delta }`.
  - `duration` accepts numbers, strings with a numeric value (e.g. `"10 minutes"` → `10`), `'instant'` (treated as 1), `'permanent'`/`'continuous'` (treated as -1), or null.
  - Any negative duration is treated as infinite and does not decrement; `0` means expired.
  - Invalid duration strings raise a clear error so malformed prompts are surfaced.

## Instance API
- `update({ name, description, attributes, skills, needBars, duration })`: normalizes and updates fields in place.
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
- `#normalizeDuration(value)`: converts duration inputs to integer turns or null (throws on invalid inputs).

## Notes
- All normalizers throw clear errors on invalid structures or missing data.
- `generateFromDescriptions` fails loudly on malformed XML or missing effect elements.
