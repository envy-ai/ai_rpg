# DuplicateNameUtils

`DuplicateNameUtils.js` provides shared normalization for duplicate person and place names without changing their stored or displayed spelling.

- `normalizeDuplicateName(value)` trims and collapses whitespace, compares case-insensitively, and omits one leading `the`.
- `normalizePersonNameForDuplicateCheck(value)` additionally retains the existing punctuation-insensitive NPC-name behavior.
- `omitLeadingThe(value)` removes `the` only when it is a complete leading word, so names such as `Theodore` are unchanged.

NPC generation/deduplication, new-exit location and region conflict checks, generated exit suggestion deduplication, and location/region name-regeneration candidate checks use these keys. For example, `The Brass Warden` conflicts with `Brass Warden`, and `The Sunken Archive` conflicts with `Sunken Archive`; the original chosen name remains intact.
