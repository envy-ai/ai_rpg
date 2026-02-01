# SanitizedStringMap

## Purpose
A Map wrapper that normalizes string keys so lookups are case- and punctuation-insensitive. Keys are normalized by replacing punctuation/underscores with spaces, collapsing whitespace, trimming, and lowercasing.

## Construction
- `new SanitizedStringMap()`: creates an empty map.

## Static Helpers
- `#sanitizeKey(key)`: validates input is a string, normalizes it, and throws on non-strings.

## Instance API
- `set(key, value)`: normalizes the key before storing.
- `get(key)`: normalized lookup.
- `has(key)`: normalized existence check.
- `delete(key)`: normalized delete.

## Notes
- All key access passes through sanitization; non-string keys raise errors.
