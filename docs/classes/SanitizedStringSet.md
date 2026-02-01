# SanitizedStringSet

## Purpose
A Set wrapper that normalizes string values so lookups are case- and punctuation-insensitive. Values are normalized by replacing punctuation/underscores with spaces, collapsing whitespace, trimming, and lowercasing.

## Construction
- `new SanitizedStringSet()`: creates an empty set.

## Static Helpers
- `#sanitizeValue(value)`: validates input is a string, normalizes it, and throws on non-strings.
- `fromArray(arr)`: builds a new set by calling `add` on each array entry.

## Instance API
- `add(value)`: normalizes and stores a string; ignores non-strings.
- `has(value)`: normalized lookup; returns false for non-strings.
- `delete(value)`: normalized delete; returns false for non-strings.
- `keys()`: returns an array copy of the set contents.

## Notes
- Sanitization is always applied; the original string value is not stored.
